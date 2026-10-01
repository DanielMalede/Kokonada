'use strict';

// BE-016 (DEC-111, DEC-118) K1 and F1 — the daily sweep, on REAL MongoDB. It finishes a withdrawal
// erasure that did not complete (the owed record, `User.healthErasurePendingAt`) and the backlog of
// withdrawals made before this code existed, with the SAME windows rule the withdrawal uses:
//   • latest status withdrawn → heart-rate data on rows made before the sweep started;
//   • re-granted              → rows made before the first grant after the latest withdrawal;
//   • targets                 → rows made before the latest withdrawal;
//   • never granted before the withdrawal → nothing (DAN-016).
// It runs inside sessionTrim and reports `healthErasures=`; HEALTH_ERASURE_SWEEP_DISABLED stops it.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.REDIS_URL;

jest.mock('../app/config/redis', () => {
  const store = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const fake = {
    store,
    async scan(_c, _m, pattern) { const re = glob(pattern); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
    async del(...keys) { return keys.flat().reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0); },
  };
  return { getRedis: () => fake, __fake: fake };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent = require('../app/models/ServeEvent');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const { __fake: redis } = require('../app/config/redis');
const { sweepOwedHealthErasures } = require('../app/services/privacy/sessionHealthSweep');
const { latestIsWithdrawn } = require('../app/services/privacy/sessionHealthPolicy');
const { process: runJob } = require('../app/workers/sessionTrim.worker');

jest.setTimeout(120000);

const DAY = 24 * 3600_000;
const PURPOSE = 'health_biometric_processing';
const ago = (ms) => new Date(Date.now() - ms);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_session_health_sweep_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  delete process.env.HEALTH_ERASURE_SWEEP_DISABLED;
  delete process.env.HEALTH_ERASURE_SWEEP_BATCH;
  await Promise.all([User, ConsentRecord, PlaylistSession, ServeEvent, UnclassifiedTrack].map((M) => M.deleteMany({})));
  redis.store.clear();
});
afterEach(() => jest.restoreAllMocks());

const listener = (tag, over = {}) => User.create({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com`, ...over });
async function consentAt(user, status, at, extra = {}) {
  await ConsentRecord.collection.insertOne({
    _id: extra._id || new mongoose.Types.ObjectId(), userId: user._id, purpose: PURPOSE, consentVersion: 1, status,
    ...(status === 'granted' ? { grantedAt: at } : { withdrawnAt: at }), createdAt: at, updatedAt: at,
  });
}
async function heartSession(user, createdAt, over = {}) {
  const doc = await PlaylistSession.create({
    userId: user._id, emotionTaps: [{ x: 0, y: 0 }], moodKey: 'bio:peak:running',
    biometricSnapshot: { heartRate: 131, activity: 'running' },
    targetBpm: 150, targetEnergy: 0.9, targetValence: 0.6, targetGenres: ['edm'], musicProvider: 'spotify',
    ...over,
  });
  await PlaylistSession.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  return doc._id;
}
const moodSession = (user, createdAt, over = {}) => heartSession(user, createdAt, {
  moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: 'walking' }, targetBpm: 96, targetEnergy: 0.4, targetValence: 0.5, targetGenres: ['ambient'], ...over,
});
const raw = (id) => PlaylistSession.collection.findOne({ _id: id });
const bioServe = (user, servedAt) => ServeEvent.create({
  userId: user._id, canonicalKey: 'isrc:A', moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' }, servedAt,
}).then((d) => d._id);
const rawServe = (id) => ServeEvent.collection.findOne({ _id: id });
const pendingOf = async (user) => (await User.collection.findOne({ _id: user._id })).healthErasurePendingAt;

describe('the sweep finishes the backlog with the withdrawal\'s own windows (K1)', () => {
  it('latest status withdrawn (a withdrawal made before this code): every heart-rate row and serve is cleared', async () => {
    const u = await listener('a');
    await consentAt(u, 'granted', ago(20 * DAY));
    await consentAt(u, 'withdrawn', ago(10 * DAY));
    const before = await heartSession(u, ago(12 * DAY));
    const after = await heartSession(u, ago(2 * DAY)); // made after the withdrawal: a race survivor
    const moodBefore = await moodSession(u, ago(11 * DAY));
    const moodAfter = await moodSession(u, ago(1 * DAY));
    const serve = await bioServe(u, ago(12 * DAY));

    const out = await sweepOwedHealthErasures();

    expect(out).toEqual({ count: 1, failed: 0 });
    for (const id of [before, after]) {
      expect(await raw(id)).toMatchObject({ moodKey: 'bio:', biometricSnapshot: { heartRate: null, activity: null }, targetBpm: null, targetGenres: [] });
    }
    expect((await raw(moodBefore)).targetBpm).toBeNull(); // made before the withdrawal (P1)
    expect((await raw(moodAfter)).targetBpm).toBe(96); // made after it, mood only: kept
    expect(await rawServe(serve)).toMatchObject({ moodKey: null, bioState: { tempoBand: null, activity: null } });
  });

  it('re-granted: rows made after the re-grant are lawful and untouched; earlier ones are cleared', async () => {
    const u = await listener('b');
    await consentAt(u, 'granted', ago(20 * DAY));
    await consentAt(u, 'withdrawn', ago(10 * DAY));
    await consentAt(u, 'granted', ago(5 * DAY));
    const beforeWithdrawal = await heartSession(u, ago(12 * DAY));
    const inGap = await heartSession(u, ago(7 * DAY));
    const afterRegrant = await heartSession(u, ago(2 * DAY));
    const lawful = await raw(afterRegrant);
    const lawfulServe = await bioServe(u, ago(2 * DAY));
    const oldServe = await bioServe(u, ago(12 * DAY));

    expect(await sweepOwedHealthErasures()).toEqual({ count: 1, failed: 0 });

    expect((await raw(beforeWithdrawal)).moodKey).toBe('bio:');
    expect((await raw(inGap)).moodKey).toBe('bio:');
    expect(await raw(afterRegrant)).toEqual(lawful);
    expect((await rawServe(lawfulServe)).bioState).toEqual({ tempoBand: 'peak', activity: 'running' });
    expect((await rawServe(oldServe)).moodKey).toBeNull();
  });

  it('never granted before the withdrawal: untouched (DAN-016 decides those rows)', async () => {
    const u = await listener('c');
    await consentAt(u, 'withdrawn', ago(10 * DAY));
    await consentAt(u, 'granted', ago(5 * DAY));
    const row = await heartSession(u, ago(12 * DAY));
    const before = await raw(row);

    expect(await sweepOwedHealthErasures()).toEqual({ count: 0, failed: 0 });
    expect(await raw(row)).toEqual(before);
  });

  it('a user who never withdrew is never read, let alone erased', async () => {
    const u = await listener('d');
    await consentAt(u, 'granted', ago(20 * DAY));
    const row = await heartSession(u, ago(12 * DAY));
    const before = await raw(row);
    const historyReads = jest.spyOn(ConsentRecord, 'find');

    expect(await sweepOwedHealthErasures()).toEqual({ count: 0, failed: 0 });
    expect(await raw(row)).toEqual(before);
    expect(historyReads).not.toHaveBeenCalled();
  });

  it('is idempotent: the second run finds nothing owed', async () => {
    const u = await listener('e');
    await consentAt(u, 'granted', ago(20 * DAY));
    await consentAt(u, 'withdrawn', ago(10 * DAY));
    await heartSession(u, ago(12 * DAY));

    expect(await sweepOwedHealthErasures()).toEqual({ count: 1, failed: 0 });
    expect(await sweepOwedHealthErasures()).toEqual({ count: 0, failed: 0 });
  });
});

describe('the owed record (F1): a withdrawal whose erasure did not finish', () => {
  it('a Redis step that failed alone is retried: the keys go and the record is cleared', async () => {
    const u = await listener('f');
    await consentAt(u, 'granted', ago(20 * DAY));
    await consentAt(u, 'withdrawn', ago(1 * DAY));
    await User.collection.updateOne({ _id: u._id }, { $set: { healthErasurePendingAt: ago(1 * DAY) } });
    const id = String(u._id);
    for (const k of [`ledger:${id}:mood:bio:peak:running`, `buffer:${id}:bio:peak:running`, `bio:affect:${id}`]) redis.store.set(k, 'x');
    redis.store.set('ledger:someone-else:served', 'x');

    expect(await sweepOwedHealthErasures()).toEqual({ count: 1, failed: 0 });
    expect([...redis.store.keys()]).toEqual(['ledger:someone-else:served']);
    expect(await pendingOf(u)).toBeNull();
  });

  it('without an owed record the sweep never touches Redis (a mood-only listener\'s lawful cache stays)', async () => {
    const u = await listener('g');
    await consentAt(u, 'granted', ago(20 * DAY));
    await consentAt(u, 'withdrawn', ago(10 * DAY));
    await heartSession(u, ago(12 * DAY));
    redis.store.set(`ledger:${u._id}:mood:calm`, 'x');

    await sweepOwedHealthErasures();

    expect(redis.store.has(`ledger:${u._id}:mood:calm`)).toBe(true);
  });

  it('an owed record for a user the history shows never granted is cleared without erasing anything', async () => {
    const u = await listener('h');
    await consentAt(u, 'withdrawn', ago(1 * DAY));
    await User.collection.updateOne({ _id: u._id }, { $set: { healthErasurePendingAt: ago(1 * DAY) } });
    redis.store.set(`buffer:${u._id}:bio:peak:running`, 'x');

    expect(await sweepOwedHealthErasures()).toEqual({ count: 0, failed: 0 });
    expect(await pendingOf(u)).toBeNull();
    expect(redis.store.has(`buffer:${u._id}:bio:peak:running`)).toBe(true);
  });

  it('one account failing does not stop the others; it is counted, and its record stays for the next run', async () => {
    const bad = await listener('bad');
    const good = await listener('good');
    for (const u of [bad, good]) {
      await consentAt(u, 'granted', ago(20 * DAY));
      await consentAt(u, 'withdrawn', ago(1 * DAY));
      await User.collection.updateOne({ _id: u._id }, { $set: { healthErasurePendingAt: ago(1 * DAY) } });
      await heartSession(u, ago(12 * DAY));
    }
    const realUpdateMany = ServeEvent.updateMany.bind(ServeEvent);
    jest.spyOn(ServeEvent, 'updateMany').mockImplementation(async (filter, ...rest) => {
      if (String(filter?.userId) === String(bad._id)) throw Object.assign(new Error('x'), { name: 'MongoServerError' });
      return realUpdateMany(filter, ...rest);
    });

    expect(await sweepOwedHealthErasures()).toEqual({ count: 1, failed: 1 });
    expect(await pendingOf(bad)).toBeInstanceOf(Date);
    expect(await pendingOf(good)).toBeNull();
  });
});

describe('controls: the batch cap and the kill switch', () => {
  async function owed(tag) {
    const u = await listener(tag);
    await consentAt(u, 'granted', ago(20 * DAY));
    await consentAt(u, 'withdrawn', ago(10 * DAY));
    return heartSession(u, ago(12 * DAY));
  }

  it('HEALTH_ERASURE_SWEEP_BATCH caps the accounts one run erases; the next run takes the rest', async () => {
    const rows = [await owed('p'), await owed('q')];
    process.env.HEALTH_ERASURE_SWEEP_BATCH = '1';

    expect(await sweepOwedHealthErasures()).toEqual({ count: 1, failed: 0 });
    expect((await Promise.all(rows.map(raw))).filter((r) => r.moodKey === 'bio:')).toHaveLength(1);
    expect(await sweepOwedHealthErasures()).toEqual({ count: 1, failed: 0 });
    expect((await Promise.all(rows.map(raw))).filter((r) => r.moodKey === 'bio:')).toHaveLength(2);
  });

  it('HEALTH_ERASURE_SWEEP_DISABLED stops it: nothing changes, and it says so', async () => {
    const row = await owed('k');
    const before = await raw(row);
    process.env.HEALTH_ERASURE_SWEEP_DISABLED = 'true';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await sweepOwedHealthErasures()).toEqual({ count: 0, failed: 0 });
    expect(await raw(row)).toEqual(before);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('[sessionHealth] sweep disabled by HEALTH_ERASURE_SWEEP_DISABLED');
  });

  it.each(['false', '0', ''])('HEALTH_ERASURE_SWEEP_DISABLED=%p does not stop it', async (value) => {
    const row = await owed('v');
    process.env.HEALTH_ERASURE_SWEEP_DISABLED = value;

    expect(await sweepOwedHealthErasures()).toEqual({ count: 1, failed: 0 });
    expect((await raw(row)).moodKey).toBe('bio:');
  });
});

describe('the sessionTrim line carries healthErasures= (the production check that the sweep ran)', () => {
  it('one counts-only line, with the sweep\'s count', async () => {
    const u = await listener('t');
    await consentAt(u, 'granted', ago(20 * DAY));
    await consentAt(u, 'withdrawn', ago(10 * DAY));
    await heartSession(u, ago(12 * DAY));
    const lines = [];
    for (const m of ['log', 'info', 'warn', 'error']) jest.spyOn(console, m).mockImplementation((...a) => lines.push(a.join(' ')));

    const result = await runJob();

    expect(result.healthErasures).toBe(1);
    const trim = lines.filter((l) => l.includes('[sessionTrim]'));
    expect(trim).toHaveLength(1);
    expect(trim[0]).toMatch(/ spotifyErasures=\d+ healthErasures=1 failures=0$/);
    expect(lines.join('\n')).not.toContain(String(u._id));
  });

  it('runs after the 30-day trim: a row the trim reaches in this run gives up an activity that is not provably a chip in this run', async () => {
    const u = await listener('o');
    await consentAt(u, 'granted', ago(60 * DAY));
    await consentAt(u, 'withdrawn', ago(1 * DAY));
    // 35 days old and not trimmed yet: no heart rate, a note, and an activity a watch could have written
    const old = await moodSession(u, ago(35 * DAY), { biometricSnapshot: { heartRate: null, activity: 'running' }, contextPrompt: 'note' });
    const chip = await moodSession(u, ago(35 * DAY), { biometricSnapshot: { heartRate: null, activity: 'commuting' }, contextPrompt: 'note' });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    await runJob();

    // the trim removed the note and the heart rate; once trimmed, nothing shows the row had no heart
    // rate, so DT-1b′ O1 applies — and only a value no watch can write survives
    expect(await raw(old)).toMatchObject({ contextPrompt: null, biometricSnapshot: { heartRate: null, activity: null } });
    expect(await raw(chip)).toMatchObject({ contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'commuting' } });
  });
});

describe('the policy\'s status rule agrees with ConsentRecord.latestFor on real Mongo', () => {
  // ObjectIds with a chosen writer field, generated in order, at chosen times.
  let counter = 0;
  const oid = (atMs, writer) => new mongoose.Types.ObjectId(
    Math.floor(atMs / 1000).toString(16).padStart(8, '0') + writer.toString(16).padStart(10, '0') + (++counter).toString(16).padStart(6, '0'),
  );
  const shapes = [
    [['granted', 0, 1], ['withdrawn', 5, 1]],
    [['granted', 0, 1], ['withdrawn', 5, 1], ['granted', 9, 1]],
    [['granted', 5, 1], ['withdrawn', 5, 1]], // same ms, one writer, withdrawal generated last
    [['withdrawn', 5, 1], ['granted', 5, 1]], // same ms, one writer, grant generated last
    [['granted', 5, 1], ['withdrawn', 5, 2]], // same ms, two writers
    [['withdrawn', 5, 2], ['granted', 5, 1]],
    [['granted', 0, 1], ['withdrawn', 5, 1], ['granted', 5, 1], ['granted', 5, 2]],
  ];

  it.each(shapes.map((s, i) => [i, s]))('shape %i', async (_i, shape) => {
    const u = await listener(`shape-${counter}`);
    const base = Date.now() - DAY;
    for (const [status, offsetMs, writer] of shape) {
      const at = new Date(base + offsetMs);
      await consentAt(u, status, at, { _id: oid(at.getTime(), writer) });
    }
    const latest = await ConsentRecord.latestFor(u._id, PURPOSE);
    const history = await ConsentRecord.find({ userId: u._id, purpose: PURPOSE }).lean();

    expect(latestIsWithdrawn(history)).toBe(latest.status === 'withdrawn');
  });
});
