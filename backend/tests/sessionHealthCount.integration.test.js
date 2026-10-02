'use strict';

// BE-016 (DEC-111, DEC-118 K1) — the owner-run, READ-ONLY count of what the session-health erasure
// still owes, on a REAL MongoDB seeded with a known history. It is the daily sweep's dry run and the
// record of the backlog, taken BEFORE the first sweep (the regulatory brief's MUST 3 and MUST NOT 4).
// What is pinned:
//   • the counts, exactly, per account and per erasure step, for a withdrawn, a re-granted, a
//     never-granted and an operator account that never withdrew (counted as if it withdrew now);
//   • it agrees with the sweep: the counts equal what the erasure changes, and after the sweep the
//     count is all zero;
//   • STOP: an account with a withdrawal that is not the operator's → nothing counted, exit 2;
//   • it writes NOTHING: every collection, document and index is identical afterwards, and Redis sees
//     SCAN only;
//   • counts only: every line is a closed shape, and no id, value or time ever appears;
//   • the collection names cannot drift from the models, and the script loads no model.
// The script is also run as a real child process, so its exit codes are the ones the owner sees.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.MONGO_DB_NAME;
delete process.env.REDIS_URL;

// The sweep (run in the agreement test) purges Redis through the app's client; a stateful fake.
jest.mock('../app/config/redis', () => {
  const store = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const fake = {
    store,
    calls: [],
    async scan(cursor, _match, pattern) {
      fake.calls.push('scan');
      const re = glob(pattern);
      return ['0', [...store.keys()].filter((k) => re.test(k))];
    },
    async del(...keys) { fake.calls.push('del'); return keys.flat().reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0); },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent = require('../app/models/ServeEvent');
const { __fake: redis } = require('../app/config/redis');
const { sweepOwedHealthErasures } = require('../app/services/privacy/sessionHealthSweep');
const { eraseSessionHealth, readHistory } = require('../app/services/privacy/sessionHealthErasure');
const { windowsFor } = require('../app/services/privacy/sessionHealthPolicy');

const SCRIPT = path.resolve(__dirname, '../scripts/sessionHealthCount.js');
const healthCount = require('../scripts/sessionHealthCount');

jest.setTimeout(120000);

const { ObjectId } = mongoose.Types;
const DAY = 24 * 3600_000;
const NOW = new Date();
const ago = (ms) => new Date(NOW.getTime() - ms);
const PURPOSE = 'health_biometric_processing';

const A = new ObjectId('5f0000000000000000000001'); // granted, withdrew; latest status withdrawn
const B = new ObjectId('5f0000000000000000000002'); // granted, withdrew, granted again; owed record set
const C = new ObjectId('5f0000000000000000000003'); // withdrew with no grant before it (DAN-016): not erased
const D = new ObjectId('5f0000000000000000000004'); // granted, never withdrew, not an operator: never listed
const E = new ObjectId('5f0000000000000000000005'); // an operator account that never withdrew: counted as if it withdrew now
const HR = 131; // a heart-rate value that must never reach the output

const DB_NAME = 'kokonada_session_health_count_it';
let mem;
let uri;
let db;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  uri = `${mem.getUri()}${DB_NAME}`;
  await mongoose.connect(mem.getUri(), { dbName: DB_NAME });
  db = mongoose.connection.db;
  // The sweep loads consent.js lazily, and with it more models, whose indexes Mongoose then builds in
  // the background. Load them now and wait for every build, so none lands between a test's
  // before/after snapshots and reads as a write the count never made.
  require('../app/services/privacy/consent');
  await Promise.all(mongoose.modelNames().map((name) => mongoose.model(name).init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User, ConsentRecord, PlaylistSession, ServeEvent].map((M) => M.deleteMany({})));
  redis.store.clear();
  redis.calls.length = 0;
  delete process.env.HEALTH_ERASURE_SWEEP_DISABLED;
  delete process.env.HEALTH_ERASURE_SWEEP_BATCH;
});

async function account(id, over = {}) {
  await User.create({ _id: id, ssoProvider: 'google', ssoId: `sso-${id}`, email: `${id}@example.com`, ...over });
}
async function consentAt(userId, status, at) {
  await ConsentRecord.collection.insertOne({
    _id: new ObjectId(), userId, purpose: PURPOSE, consentVersion: 1, status,
    ...(status === 'granted' ? { grantedAt: at } : { withdrawnAt: at }), createdAt: at, updatedAt: at,
  });
}
// A session as the generation writes one (through the model: encrypted fields are real), back-dated.
async function session(userId, createdAt, over = {}) {
  const doc = await PlaylistSession.create({
    userId, emotionTaps: [{ x: 0.3, y: 0.4 }], contextPrompt: '', moodKey: 'calm',
    biometricSnapshot: { heartRate: null, activity: null },
    targetBpm: 96, targetEnergy: 0.4, targetValence: 0.55, targetGenres: ['ambient'], musicProvider: 'spotify',
    ...over,
  });
  await PlaylistSession.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  return doc._id;
}
const heart = (userId, createdAt, over = {}) => session(userId, createdAt, {
  moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: HR, activity: 'running' },
  targetBpm: 150, targetEnergy: 0.9, targetValence: 0.62, targetGenres: ['edm'], ...over,
});
const serve = (userId, servedAt, over = {}) => ServeEvent.create({
  userId, canonicalKey: 'isrc:A', moodKey: 'calm', bioState: { tempoBand: null, activity: null }, servedAt, ...over,
});
const bioServe = (userId, servedAt) => serve(userId, servedAt, { moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } });

async function seed() {
  for (const id of [A, B, C, D, E]) await account(id);

  // A: granted 20 days ago, withdrew 10 days ago.
  await consentAt(A, 'granted', ago(20 * DAY));
  await consentAt(A, 'withdrawn', ago(10 * DAY));
  await heart(A, ago(12 * DAY)); // heart-sessions
  await heart(A, ago(1 * DAY)); // made after the withdrawal (a race survivor): heart-sessions
  await session(A, ago(11 * DAY), { biometricSnapshot: { heartRate: 88, activity: 'running' } }); // heart-rates
  // older than the trim (sessionTrim nulled the heart rate and the note): its activity may be the watch's
  await session(A, ago(40 * DAY), { contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'running' } }); // trimmed-activities AND targets
  await session(A, ago(41 * DAY), { contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'winding down' } }); // targets only (a chip)
  await session(A, ago(2 * DAY), { biometricSnapshot: { heartRate: null, activity: 'walking' } }); // after the withdrawal, mood only: nothing
  await bioServe(A, ago(12 * DAY)); // bio-keys
  await serve(A, ago(11 * DAY), { bioState: { tempoBand: 'active', activity: 'running' } }); // bands
  await serve(A, ago(3 * DAY)); // nothing

  // B: granted, withdrew, granted again; its withdrawal erasure did not finish (owed record).
  await consentAt(B, 'granted', ago(20 * DAY));
  await consentAt(B, 'withdrawn', ago(10 * DAY));
  await consentAt(B, 'granted', ago(5 * DAY));
  await User.collection.updateOne({ _id: B }, { $set: { healthErasurePendingAt: ago(10 * DAY) } });
  await heart(B, ago(12 * DAY), { targetBpm: null, targetEnergy: null, targetValence: null }); // heart-sessions
  await heart(B, ago(7 * DAY), { targetBpm: null, targetEnergy: null, targetValence: null }); // heart-sessions (no grant then)
  await heart(B, ago(2 * DAY)); // after the re-grant: lawful, not counted
  await bioServe(B, ago(12 * DAY)); // bio-keys
  await bioServe(B, ago(2 * DAY)); // after the re-grant: lawful
  for (const k of [`ledger:${B}:mood:bio:peak:running`, `ledger:${B}:served`, `buffer:${B}:bio:peak:running`, `bio:affect:${B}`]) redis.store.set(k, 'x');

  // C: withdrew with no grant before it (DAN-016's population): never erased here.
  await consentAt(C, 'withdrawn', ago(10 * DAY));
  await consentAt(C, 'granted', ago(5 * DAY));
  await heart(C, ago(12 * DAY));

  // D: granted, never withdrew, and not on the operator list.
  await consentAt(D, 'granted', ago(20 * DAY));
  await heart(D, ago(3 * DAY));
  redis.store.set(`buffer:${D}:bio:peak:running`, 'x');

  // E: the operator's own consenting account (the device run's "before").
  await consentAt(E, 'granted', ago(20 * DAY));
  await heart(E, ago(1 * DAY));
  await bioServe(E, ago(1 * DAY));
  for (const k of [`ledger:${E}:served`, `ledger:${E}:mood:bio:peak:running`, `pool:${E}:bio:peak:running`, `pool:${E}:calm`, `bio:baseline:${E}`]) redis.store.set(k, 'x');

  redis.calls.length = 0;
}

const OPERATORS = [A, B, C, E].map(String);

const EXPECTED = [
  'session-health-count read-only counts-only',
  'S0 withdrawn-accounts=3 listed-without-withdrawal=1',
  'S0 account-1 operator=yes',
  'S0 account-2 operator=yes',
  'S0 account-3 operator=yes',
  'S0 account-4 operator=yes',
  'S1 account-1 status=withdrawn owed-record=no',
  'S1 account-2 status=re-granted owed-record=yes',
  'S1 account-3 status=no-grant-before-withdrawal owed-record=no',
  'S1 account-4 status=no-withdrawal owed-record=no',
  'S2 account-1 playlistsessions heart-sessions=2 heart-rates=1 trimmed-activities=1 targets=2',
  'S2 account-1 serveevents bio-keys=1 bands=1',
  'S2 account-2 playlistsessions heart-sessions=2 heart-rates=0 trimmed-activities=0 targets=0',
  'S2 account-2 serveevents bio-keys=1 bands=0',
  'S2 account-3 playlistsessions=n/a serveevents=n/a',
  'S2 account-4 playlistsessions heart-sessions=1 heart-rates=0 trimmed-activities=0 targets=0',
  'S2 account-4 serveevents bio-keys=1 bands=0',
  'S3 account-1 redis keys=0 band-named=0',
  'S3 account-2 redis keys=4 band-named=2',
  'S3 account-3 redis=n/a',
  'S3 account-4 redis keys=5 band-named=2',
  'RESULT non-zero',
];

const CLOSED_LINES = [
  /^session-health-count read-only counts-only$/,
  /^S0 withdrawn-accounts=\d+ listed-without-withdrawal=\d+$/,
  /^S0 account-\d+ operator=(?:yes|no)$/,
  /^S1 account-\d+ status=(?:withdrawn|re-granted|no-grant-before-withdrawal|no-withdrawal) owed-record=(?:yes|no)$/,
  /^S2 account-\d+ playlistsessions heart-sessions=\d+ heart-rates=\d+ trimmed-activities=\d+ targets=\d+$/,
  /^S2 account-\d+ serveevents bio-keys=\d+ bands=\d+$/,
  /^S2 account-\d+ playlistsessions=n\/a serveevents=n\/a$/,
  /^S3 account-\d+ (?:redis keys=\d+ band-named=\d+|redis=n\/a|redis=unavailable)$/,
  /^RESULT (?:all-zero|non-zero)$/,
  /^STOP an account with a withdrawal is not the operator's: nothing in S1–S3 was counted and nothing was erased\. Keep the daily sweep off \(HEALTH_ERASURE_SWEEP_DISABLED=true\) and take this result to counsel\.$/,
  /^ERROR [A-Za-z0-9_ ,:()./-]+$/,
];

function assertCountsOnly(lines) {
  for (const line of lines) expect(CLOSED_LINES.some((re) => re.test(line))).toBe(true);
  const text = lines.join('\n');
  expect(text).not.toMatch(/[0-9a-f]{24}/i); // no id
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{2}:\d{2}/); // no date or time
  expect(text).not.toMatch(/\b1[5-9]\d{8,}\b/); // no epoch seconds or milliseconds
  for (const secret of [String(HR), '88', 'running', 'peak', 'winding', 'edm', 'isrc:', 'bio:']) expect(text).not.toContain(secret);
}

async function snapshot() {
  const out = {};
  for (const { name } of await db.listCollections().toArray()) {
    const c = db.collection(name);
    out[name] = { docs: await c.find({}).sort({ _id: 1 }).toArray(), indexes: await c.indexes() };
  }
  out.redis = [...redis.store.keys()].sort();
  return JSON.stringify(out);
}

// `undefined` in `env` REMOVES that variable from the child's environment.
function runProcess(env) {
  const childEnv = { ...process.env, MONGO_DB_NAME: '', ...env };
  for (const [k, v] of Object.entries(childEnv)) if (v === undefined) delete childEnv[k];
  return spawnSync(process.execPath, [SCRIPT], { cwd: path.resolve(__dirname, '..'), env: childEnv, encoding: 'utf8', timeout: 60000 });
}
const stdoutLines = (r) => r.stdout.split(/\r?\n/).filter(Boolean);
const count = (operatorIds = OPERATORS, opts = {}) => healthCount.countSessionHealth(db, { operatorIds, now: NOW, redis, ...opts });

describe('S0–S3 counts on a seeded history (real Mongo)', () => {
  it('counts, per account and per erasure step, exactly what the erasure would still change', async () => {
    await seed();

    const { lines, exitCode } = await count();

    expect(lines).toEqual(EXPECTED);
    expect(exitCode).toBe(0);
    assertCountsOnly(lines);
  });

  it('reads Redis by SCAN only, and changes nothing anywhere', async () => {
    await seed();
    const before = await snapshot();

    await count();

    expect(new Set(redis.calls)).toEqual(new Set(['scan']));
    expect(await snapshot()).toBe(before);
  });

  it('with no Redis client the cache is not counted (redis=n/a), and the Mongo counts stand', async () => {
    await seed();

    const { lines } = await count(OPERATORS, { redis: null });

    expect(lines.filter((l) => l.startsWith('S3'))).toEqual([
      'S3 account-1 redis=n/a', 'S3 account-2 redis=n/a', 'S3 account-3 redis=n/a', 'S3 account-4 redis=n/a',
    ]);
    expect(lines.filter((l) => !l.startsWith('S3'))).toEqual(EXPECTED.filter((l) => !l.startsWith('S3')));
  });

  it('a Redis that fails mid-count reads redis=unavailable, closed, and the rest still counts', async () => {
    await seed();
    const failing = { async scan() { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:6379'), { name: 'ReplyError' }); } };

    const { lines, exitCode } = await count(OPERATORS, { redis: failing });

    expect(exitCode).toBe(0);
    expect(lines).toContain('S3 account-2 redis=unavailable');
    expect(lines.join('\n')).not.toContain('10.0.0.9');
    assertCountsOnly(lines);
  });

  it('no withdrawal anywhere and no operator account to list: zero accounts, all-zero, exit 0', async () => {
    await account(D);
    await consentAt(D, 'granted', ago(3 * DAY));

    const { lines, exitCode } = await healthCount.countSessionHealth(db, { operatorIds: [], now: NOW, redis });

    expect(lines).toEqual(['session-health-count read-only counts-only', 'S0 withdrawn-accounts=0 listed-without-withdrawal=0', 'RESULT all-zero']);
    expect(exitCode).toBe(0);
  });

  it('the operator\'s account that never withdrew is listed but left out of RESULT', async () => {
    await account(E);
    await consentAt(E, 'granted', ago(20 * DAY));
    await heart(E, ago(1 * DAY));

    const { lines } = await count([String(E)]);

    expect(lines).toContain('S2 account-1 playlistsessions heart-sessions=1 heart-rates=0 trimmed-activities=0 targets=0');
    expect(lines[lines.length - 1]).toBe('RESULT all-zero');
  });

  it('an owed record alone makes RESULT non-zero (the sweep still has to finish it)', async () => {
    await account(A, { healthErasurePendingAt: ago(1 * DAY) });
    await consentAt(A, 'granted', ago(20 * DAY));
    await consentAt(A, 'withdrawn', ago(1 * DAY));

    const { lines } = await count([String(A)]);

    expect(lines).toContain('S1 account-1 status=withdrawn owed-record=yes');
    expect(lines).toContain('S2 account-1 playlistsessions heart-sessions=0 heart-rates=0 trimmed-activities=0 targets=0');
    expect(lines[lines.length - 1]).toBe('RESULT non-zero');
  });
});

describe('it is the sweep\'s dry run: the same rule, the same rows', () => {
  it('each account\'s counts equal what the erasure changes with the same windows', async () => {
    await seed();
    const { lines } = await count();
    const totals = (n) => {
      const nums = (re) => lines.find((l) => re.test(l)).match(/=\d+/g).map((s) => Number(s.slice(1)));
      const [hs, hr, ta, tg] = nums(new RegExp(`^S2 account-${n} playlistsessions `));
      const [bk, bd] = nums(new RegExp(`^S2 account-${n} serveevents `));
      return { sessions: hs + hr + ta, sessionTargets: tg, serveEvents: bk + bd };
    };
    const expected = { 1: totals(1), 2: totals(2) };

    for (const [n, id] of [[1, A], [2, B]]) {
      const changed = await eraseSessionHealth(id, windowsFor(await readHistory(id), NOW));
      expect({ sessions: changed.sessions, sessionTargets: changed.sessionTargets, serveEvents: changed.serveEvents }).toEqual(expected[n]);
    }
  });

  it('count, then the sweep, then count: all zero', async () => {
    await seed();
    expect((await count()).lines[EXPECTED.length - 1]).toBe('RESULT non-zero');

    expect(await sweepOwedHealthErasures({ now: NOW })).toEqual({ count: 2, failed: 0 });

    const { lines } = await count();
    expect(lines).toContain('S1 account-2 status=re-granted owed-record=no');
    for (const n of [1, 2]) {
      expect(lines).toContain(`S2 account-${n} playlistsessions heart-sessions=0 heart-rates=0 trimmed-activities=0 targets=0`);
      expect(lines).toContain(`S2 account-${n} serveevents bio-keys=0 bands=0`);
    }
    expect(lines).toContain('S3 account-2 redis keys=0 band-named=0'); // the owed record's strict purge
    expect(lines[lines.length - 1]).toBe('RESULT all-zero');
  });
});

describe('STOP — an account with a withdrawal that is not the operator\'s', () => {
  it('prints STOP after S0, counts nothing in S1–S3, and exits 2', async () => {
    await seed();
    const before = await snapshot();

    const { lines, exitCode } = await count([String(A)]);

    expect(exitCode).toBe(2);
    expect(lines).toEqual([
      'session-health-count read-only counts-only',
      'S0 withdrawn-accounts=3 listed-without-withdrawal=0',
      'S0 account-1 operator=yes',
      'S0 account-2 operator=no',
      'S0 account-3 operator=no',
      "STOP an account with a withdrawal is not the operator's: nothing in S1–S3 was counted and nothing was erased. Keep the daily sweep off (HEALTH_ERASURE_SWEEP_DISABLED=true) and take this result to counsel.",
    ]);
    expect(redis.calls).toEqual([]);
    assertCountsOnly(lines);
    expect(await snapshot()).toBe(before);
  });
});

describe('as a real process', () => {
  it('the same lines (no Redis URL: redis=n/a), exit 0, and nothing in the database changed', async () => {
    await seed();
    const before = await snapshot();

    const r = runProcess({ MONGO_URI: uri, REDIS_URL: undefined, [healthCount.OPERATOR_ENV]: OPERATORS.join(',') });

    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(stdoutLines(r)).toEqual(EXPECTED.map((l) => (l.startsWith('S3') ? l.replace(/ redis.*$/, ' redis=n/a') : l)));
    expect(await snapshot()).toBe(before);
  });

  it('a Redis URL that cannot be reached: redis=unavailable, closed lines, exit 0', async () => {
    await seed();

    const r = runProcess({ MONGO_URI: uri, REDIS_URL: 'redis://127.0.0.1:1', [healthCount.OPERATOR_ENV]: OPERATORS.join(',') });

    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const lines = stdoutLines(r);
    expect(lines.filter((l) => l.startsWith('S3'))).toEqual([
      'S3 account-1 redis=unavailable', 'S3 account-2 redis=unavailable', 'S3 account-3 redis=n/a', 'S3 account-4 redis=unavailable',
    ]);
    assertCountsOnly(lines);
  });

  it('STOP exits 2', async () => {
    await seed();
    const r = runProcess({ MONGO_URI: uri, [healthCount.OPERATOR_ENV]: String(A) });
    expect(r.status).toBe(2);
    expect(stdoutLines(r).pop()).toMatch(/^STOP /);
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not an id', 'my-account'],
    ['one bad id among good ones', `${A},zz0000000000000000000001`],
  ])('operator list %s: exit 1 before any connection, the variable named, the value never echoed', (_label, value) => {
    const r = runProcess({ MONGO_URI: 'mongodb://127.0.0.1:1/never-connected', [healthCount.OPERATOR_ENV]: value });
    expect(r.status).toBe(1);
    const lines = stdoutLines(r);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^ERROR /);
    expect(lines[0]).toContain(healthCount.OPERATOR_ENV);
    if (value) expect(r.stdout + r.stderr).not.toContain(value.split(',').pop());
    expect(r.stdout + r.stderr).not.toMatch(/[0-9a-f]{24}/i);
  });

  it('MONGO_URI unset: exit 1 with a closed ERROR line', () => {
    const r = runProcess({ MONGO_URI: '', [healthCount.OPERATOR_ENV]: String(A) });
    expect(r.status).toBe(1);
    expect(stdoutLines(r)).toEqual(['ERROR MONGO_URI is not set: run it through railway run']);
  });
});

describe('structure — read-only by construction, and no drift from the models or the registry', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

  it('calls no Mongo write, delete, index or drop method, and no Redis command but SCAN', () => {
    const writes = source.match(/\.(?:insert\w*|update\w*|replace\w*|delete\w*|remove\w*|findOneAnd\w+|bulkWrite|drop\w*|create(?:Index\w*|Collection)?|save|rename|collMod)\s*\(/g);
    expect(writes).toBeNull();
    const redisWrites = source.match(/\.(?:del|unlink|set\w*|hset|expire\w*|persist|flush\w*|zadd|zrem\w*|lpush|rpush|incr\w*|eval\w*|rename\w*|copy|restore|move)\s*\(/gi);
    expect(redisWrites).toBeNull();
    expect(source).toMatch(/autoIndex:\s*false/);
    expect(source).toMatch(/autoCreate:\s*false/);
  });

  it('loads no Mongoose model, directly or through what it requires (a model builds indexes)', () => {
    expect(source).not.toMatch(/require\([^)]*models/);
    jest.isolateModules(() => {
      require(SCRIPT);
      expect(require('mongoose').modelNames()).toEqual([]);
    });
  });

  it('the collection names are the models\' own', () => {
    expect(healthCount.COLLECTIONS).toEqual({
      consent: ConsentRecord.collection.collectionName,
      users: User.collection.collectionName,
      PlaylistSession: PlaylistSession.collection.collectionName,
      ServeEvent: ServeEvent.collection.collectionName,
    });
  });

  it('the cache it counts is the registry the strict purge deletes', () => {
    const { patternsFor } = require('../app/utils/userRedisPurge');
    expect(healthCount.redisPatterns('u1')).toEqual(patternsFor('u1'));
  });
});

// J1 follow-up (code hygiene). With no retries, a failed connect has already ended the client;
// disconnecting it again arms ioredis's 2 s close timer on a socket that has already closed, and nothing
// clears it. In process, main() must return with no ioredis timer still alive.
describe('an unreachable Redis leaves no ioredis timer behind (in process)', () => {
  it('main() returns redis=unavailable with no timer from ioredis still alive', async () => {
    const asyncHooks = require('async_hooks');
    const alive = new Map();
    const hook = asyncHooks.createHook({
      init(id, type) {
        if (type !== 'Timeout') return;
        const stack = new Error().stack;
        if (/node_modules[\\/]ioredis[\\/]/.test(stack)) alive.set(id, stack); // either separator: Windows paths use \
      },
      destroy(id) { alive.delete(id); },
    });
    const lines = [];
    hook.enable();
    let code;
    try {
      code = await healthCount.main({
        env: { MONGO_URI: uri, REDIS_URL: 'redis://127.0.0.1:1', [healthCount.OPERATOR_ENV]: String(A) },
        out: (line) => lines.push(line),
      });
    } finally {
      hook.disable();
    }

    expect(code).toBe(0);
    expect(lines).toContain('S3 account-1 redis=unavailable');
    expect([...alive.values()]).toEqual([]);
  });
});
