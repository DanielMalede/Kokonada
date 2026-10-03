'use strict';

// J2 (BE-087; Plan B T5, DT-4 A1, DT-5 W-c) — the state-recompute job reads and writes health data only for
// an account that still exists and holds a current health-data grant, and a run that writes while the
// account is deleted or the consent is withdrawn undoes what it wrote.
//
//   • Start gate, before any read or decrypt (healthConsentGate.healthWriteFence). Refused: nothing is read
//     or written. A refusal because the account is GONE also removes the profile and the two keys a
//     killed earlier run left (a stalled job re-run after a hard kill lands here).
//   • The run's writes, with the affect save AWAITED on this lane, so nothing of this run lands after the
//     check below.
//   • The fenced re-check, on the success path and on the throw path. Account gone: the whole profile and
//     both keys go. Any other refusal, or a different consent row than at the start (a withdraw-then-
//     re-grant): both keys go, and the profile if this run created it, else only this run's stateVector.
//   • One closed-token line per undo, with no user id and no job id.
//
// Real: MongoDB (mongodb-memory-server, test commands on so a `failCommand` fail point can fail one command
// on one collection with a real server error), the worker, the gate, the consent service, the deletion
// controller and cascade, the baseline and affect services. Faked: Redis, by a STATEFUL in-memory store
// that answers GET/SET/DEL/SCAN over real keys and can delay one key's write. The same job through a real
// BullMQ Worker on a real Redis is stateVectorWorker.redis.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
delete process.env.REDIS_URL;
delete process.env.WAVE4_AFFECT_DISABLED;

jest.mock('../app/sockets/index', () => ({ getIo: () => null }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));
jest.mock('../app/config/redis', () => {
  const store = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const fake = {
    store,
    writeDelay: new Map(), // key prefix -> ms: that key's SET lands this much later
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async set(key, value) {
      const delay = [...fake.writeDelay].find(([prefix]) => key.startsWith(prefix))?.[1];
      if (delay) await new Promise((r) => setTimeout(r, delay));
      store.set(key, value);
      return 'OK';
    },
    async del(...keys) { return keys.flat().reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0); },
    async scan(_cursor, _match, pattern) { const re = glob(pattern); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
    async exists(key) { return store.has(key) ? 1 : 0; },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const MedicalProfile = require('../app/models/MedicalProfile');
const { __fake: redis } = require('../app/config/redis');
const baselinesService = require('../app/services/biosonic/baselines');
const { HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION, withdrawConsent } = require('../app/services/privacy/consent');
const { deleteAccount } = require('../app/controllers/authController');
const { STATE_JOB_RESULT } = require('../app/queues/stateVectorJob');
const worker = require('../app/workers/stateVector.worker');

jest.setTimeout(60000);

const DB = 'kokonada_j2_state_fence';
let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
  await mongoose.connect(mem.getUri(), { dbName: DB });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});

let lines;
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({}), MedicalProfile.deleteMany({})]);
  redis.store.clear();
  redis.writeDelay.clear();
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
});
afterEach(async () => {
  jest.restoreAllMocks();
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
});

let seq = 0;
const account = (over = {}) => {
  seq += 1;
  return User.create({ ssoProvider: 'google', ssoId: `sso-fence-${seq}`, email: `state-${seq}@example.com`, ...over });
};
const consentRow = (userId, status, version = CURRENT_CONSENT_VERSION) => ConsentRecord.create({
  userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: version, status,
  ...(status === 'granted' ? { grantedAt: new Date() } : { withdrawnAt: new Date() }),
});
const granted = async () => {
  const user = await account();
  await consentRow(user._id, 'granted');
  return user;
};
const run = (userId) => worker.process({ data: { userId: String(userId) } });
const keysOf = (userId) => [...redis.store.keys()].filter((k) => k.includes(String(userId))).sort();
const bioKeys = (userId) => [`bio:affect:${userId}`, `bio:baseline:${userId}`];
const stateLines = () => lines.filter((l) => l.startsWith('[stateVector]'));
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const failNext = (command, collection) => mongoose.connection.db.admin().command({
  configureFailPoint: 'failCommand',
  mode: { times: 1 },
  data: { failCommands: [command], errorCode: 2, namespace: `${DB}.${collection}` },
});

/** Holds the run inside computeBaselines (after the start gate, before any write) until `release()`. */
function holdRun() {
  let release;
  let reached;
  const held = new Promise((r) => { release = r; });
  const atRead = new Promise((r) => { reached = r; });
  const real = baselinesService.computeBaselines.bind(baselinesService);
  jest.spyOn(baselinesService, 'computeBaselines').mockImplementation(async (...args) => {
    reached();
    await held;
    return real(...args);
  });
  return { atRead, release: () => release() };
}

describe('admitted: the refresh runs as before', () => {
  it('writes the profile\'s state vector, the baseline key and the affect key; no undo, and the constant result', async () => {
    const user = await granted();

    await expect(run(user._id)).resolves.toEqual(STATE_JOB_RESULT);

    const profile = await MedicalProfile.findOne({ userId: user._id }).lean();
    expect(profile.stateVector.computedAt).toBeInstanceOf(Date);
    expect(keysOf(user._id)).toEqual(bioKeys(user._id));
    expect(stateLines()).toEqual([]);
    expect(STATE_JOB_RESULT).toEqual({ done: true });
    expect(Object.isFrozen(STATE_JOB_RESULT)).toBe(true);
  });
});

describe('the start gate: an account that is not admitted is neither read nor written', () => {
  it.each([
    ['never granted', async () => account()],
    ['withdrawn', async () => { const u = await granted(); await consentRow(u._id, 'withdrawn'); return u; }],
    ['granted at an older consent version', async () => { const u = await account(); await consentRow(u._id, 'granted', CURRENT_CONSENT_VERSION - 1); return u; }],
    ['flagged for deletion', async () => { const u = await account({ deletedAt: new Date() }); await consentRow(u._id, 'granted'); return u; }],
  ])('%s: no read, no profile, no key, no line', async (_state, seed) => {
    const user = await seed();
    const compute = jest.spyOn(baselinesService, 'computeBaselines');

    await expect(run(user._id)).resolves.toEqual(STATE_JOB_RESULT);

    expect(compute).not.toHaveBeenCalled();
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    expect(keysOf(user._id)).toEqual([]);
    expect(lines.filter((l) => l.startsWith('[biometric-access]'))).toEqual([]);
    expect(stateLines()).toEqual([]);
  });

  // A job re-run after a hard kill (BullMQ's stalled check) for an account deleted in between finds what
  // the killed run wrote: the profile it created and the two keys.
  it('an account that is gone: the re-run removes the profile and both keys it finds, with one line and no id', async () => {
    const gone = new mongoose.Types.ObjectId();
    await MedicalProfile.create({ userId: gone });
    for (const key of bioKeys(gone)) redis.store.set(key, 'x');
    const compute = jest.spyOn(baselinesService, 'computeBaselines');

    await expect(run(gone)).resolves.toEqual(STATE_JOB_RESULT);

    expect(compute).not.toHaveBeenCalled();
    expect(await MedicalProfile.countDocuments({ userId: gone })).toBe(0);
    expect(keysOf(gone)).toEqual([]);
    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=user_missing outcome=undone']);
  });

  it('an account that is gone, with nothing left: outcome=nothing', async () => {
    await run(new mongoose.Types.ObjectId());

    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=user_missing outcome=nothing']);
  });
});

describe('the fenced re-check undoes this run\'s writes', () => {
  it('the account is deleted during the run: the whole profile and both keys go', async () => {
    const user = await granted();
    const hold = holdRun();

    const job = run(user._id);
    await hold.atRead;
    await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());
    hold.release();

    await expect(job).resolves.toEqual(STATE_JOB_RESULT);
    expect(await User.exists({ _id: user._id })).toBeNull();
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    expect(keysOf(user._id)).toEqual([]);
    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=user_missing outcome=undone']);
  });

  it('the consent is withdrawn during the run: a profile this run created goes, and both keys', async () => {
    const user = await granted();
    const hold = holdRun();

    const job = run(user._id);
    await hold.atRead;
    await withdrawConsent(user._id, HEALTH_CONSENT_PURPOSE);
    hold.release();
    await job;

    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    expect(keysOf(user._id)).toEqual([]);
    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=consent_not_current outcome=undone']);
  });

  // Plan A T5: on a read error the grant may well stand, so a profile that existed before the run keeps its
  // document and loses only what this run wrote to it. (A real withdrawal's own erasure already removes a
  // profile with no samples left, so this case is shown where nothing else deletes it.)
  it('the consent cannot be read at the re-check, with a profile from before: the document stays, without this run\'s state vector', async () => {
    const user = await granted();
    await MedicalProfile.create({ userId: user._id, fitnessLevel: 'active' });
    const hold = holdRun();

    const job = run(user._id);
    await hold.atRead;
    await failNext('find', 'consentrecords');
    hold.release();
    await job;

    const profile = await MedicalProfile.findOne({ userId: user._id }).lean();
    expect(profile).not.toBeNull();
    expect(profile.fitnessLevel).toBe('active');
    expect(profile.stateVector).toBeUndefined();
    expect(keysOf(user._id)).toEqual([]);
    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=consent_read_error outcome=undone']);
  });

  it('withdrawn and granted again during the run: the fence changed, so this run\'s writes are undone', async () => {
    const user = await granted();
    const hold = holdRun();

    const job = run(user._id);
    await hold.atRead;
    await consentRow(user._id, 'withdrawn');
    await consentRow(user._id, 'granted');
    hold.release();
    await job;

    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    expect(keysOf(user._id)).toEqual([]);
    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=consent_changed outcome=undone']);
  });

  it('the consent cannot be read at the re-check: fail closed, this run\'s writes are undone', async () => {
    const user = await granted();
    const hold = holdRun();

    const job = run(user._id);
    await hold.atRead;
    await failNext('find', 'consentrecords'); // the start gate has read; the next consent read is the re-check
    hold.release();
    await job;

    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    expect(keysOf(user._id)).toEqual([]);
    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=consent_read_error outcome=undone']);
  });

  // RED with the fire-and-forget save the serving lane uses: the key landed after the undo had run.
  it('an affect save that lands 50 ms late is still gone after the undo', async () => {
    const user = await granted();
    redis.writeDelay.set('bio:affect:', 50);
    const hold = holdRun();

    const job = run(user._id);
    await hold.atRead;
    await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());
    hold.release();
    await job;
    await new Promise((r) => setTimeout(r, 150));

    expect(keysOf(user._id)).toEqual([]);
  });
});

describe('the throw path', () => {
  it('a write that fails: the fixed reason names only the error\'s type, and nothing is undone while the grant stands', async () => {
    const user = await granted();
    await failNext('findAndModify', 'medicalprofiles');

    const err = await run(user._id).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('state-vector recompute failed (MongoServerError)');
    expect(err.message).not.toMatch(/[0-9a-fA-F]{24}/);
    expect(stateLines()).toEqual([]);
    expect(keysOf(user._id)).toEqual(bioKeys(user._id)); // written before the failure, the grant still current
  });

  it('a write that fails after the account was deleted: the re-check still runs and undoes, then the fixed reason', async () => {
    const user = await granted();
    const hold = holdRun();

    const job = run(user._id);
    await hold.atRead;
    await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());
    await failNext('findAndModify', 'medicalprofiles');
    hold.release();
    const err = await job.then(() => null, (e) => e);

    expect(err.message).toBe('state-vector recompute failed (MongoServerError)');
    expect(keysOf(user._id)).toEqual([]);
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    expect(stateLines()).toEqual(['[stateVector] compensating-undo reason=user_missing outcome=undone']);
  });
});

describe('closed lines', () => {
  it('no [stateVector] line carries a user id or a job id, whatever the reason', async () => {
    const user = await granted();
    const hold = holdRun();
    const job = run(user._id);
    await hold.atRead;
    await withdrawConsent(user._id, HEALTH_CONSENT_PURPOSE);
    hold.release();
    await job;
    await run(new mongoose.Types.ObjectId());

    expect(stateLines()).toHaveLength(2);
    for (const line of stateLines()) {
      expect(line).not.toMatch(/[0-9a-f]{24}|sv-/);
      expect(line).toMatch(/^\[stateVector\] compensating-undo reason=[a-z_]+ outcome=(?:undone|nothing|failed error=[A-Za-z][A-Za-z0-9]*)$/);
    }
  });
});

// Plan A §3 item 8: the zone write-back loads the profile, then saves it. A profile deleted in between must
// not come back: save() of a document that no longer exists is a DocumentNotFoundError, caught as a failed
// decoration, never an insert.
describe('persistDerivedProfile never re-creates a profile deleted under it', () => {
  it('the save after a deletion writes nothing', async () => {
    const user = await granted();
    await MedicalProfile.create({ userId: user._id });
    const realFind = MedicalProfile.findOne.bind(MedicalProfile);
    jest.spyOn(MedicalProfile, 'findOne').mockImplementationOnce(async (...args) => {
      const doc = await realFind(...args);
      await MedicalProfile.collection.deleteOne({ userId: user._id });
      return doc;
    });
    const blob = {
      maxHeartRate: 190,
      maxHeartRateSource: 'default',
      zones: { zones: [{ label: 'easy', minBpm: 100, maxBpm: 120, percentOfMax: '50-60%' }] },
    };

    await expect(baselinesService.persistDerivedProfile(user._id, blob)).resolves.toBe(false);

    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    expect(lines).toContain('[baselines] derived-profile write failed: DocumentNotFoundError');
  });
});
