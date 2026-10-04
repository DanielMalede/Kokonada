'use strict';

// J2 (BE-094; Plan B T9, DT-11, DT-14, and DT-13 FINAL of 2026-10-04) — the sweep of deleted accounts' data.
//
// A deleted account's data can outlive the deletion: a recompute or a health-data sync that wrote after the
// cascade ran, a server stopped between a write and its re-check. Every such row sits under an id no User doc
// carries any more. The sweep finds those ids and runs the house cascade (erasure.js) for each, then the
// strict Redis purge. It is the bound behind "within a day" in the declarations, so it must never erase a
// live account, and it must never run before the production record and the owner's clean:
//   • DISCOVERY: every user id in every cascade collection (`distinct('userId')`, lockstep with erasure.js)
//     and in every user-scoped Redis namespace (a SCAN per registry entry). An id is an orphan only when no
//     User doc carries it (primary read), read AGAIN for that id right before its cascade; a doc with
//     `deletedAt` set is still an account. An id from Redis that cannot be an ObjectId names no account: it
//     is purged in Redis only, never passed to the Mongo cascade.
//   • ARMING (DT-13 FINAL §A, §C): the nightly run erases only while a strict marker document
//     (`opsmarkers/_id:'orphan-sweep'`) says so, read on the primary; ORPHAN_SWEEP_DISABLED can only disarm.
//     Only armOrphanSweep writes the marker, and only once a fresh discovery finds no orphan at all, so it
//     cannot be armed before the owner's clean. The reader never creates the collection.
//   • THE NIGHTLY RUN (§B) never throws. Disarmed: read-only discovery, `disabled` with the real backlog.
//     A read failure: `refused`, backlog `unknown`, a failure. Armed: DT-14 as before, the users-empty and
//     the ratio refusals, 50 accounts a run.
//   • THE FORCED RUN (§B, the private tool on the owner's word): the exact orphan count and the 8-hex
//     fingerprint of the exact set (orphanSetFingerprint) replace only the ratio refusal; the users-empty
//     refusal stays and the cap is lifted.
//
// Real: MongoDB (mongodb-memory-server, test commands on for real read failures), the cascade, the existence
// helper. Faked: Redis, by a STATEFUL store that answers SCAN/DEL/GET/SET over real keys. The nightly step
// through sessionTrim's own processJob, with command allowlists, is orphanSweepNightly.integration.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.REDIS_URL;
delete process.env.ORPHAN_SWEEP_DISABLED;

jest.mock('../app/config/redis', () => {
  const store = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const fake = {
    store,
    sticky: new Set(), // keys whose DEL is answered but which stay, as if written again at once
    async scan(_cursor, _match, pattern) { const re = glob(pattern); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
    async del(...keys) { return keys.flat().reduce((n, k) => n + (!fake.sticky.has(k) && store.delete(k) ? 1 : 0), 0); },
    async set(key, value) { store.set(key, value); return 'OK'; },
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async exists(key) { return store.has(key) ? 1 : 0; },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const { __fake: redis } = require('../app/config/redis');
const accountExistence = require('../app/services/privacy/accountExistence');
const {
  sweepDeletedAccountOrphans, discoverOrphans, isArmed, armOrphanSweep, disarmOrphanSweep, orphanSetFingerprint,
  OrphanSweepRefused, CASCADE_MODELS, ORPHAN_SWEEP_CAP,
} = require('../app/services/privacy/orphanSweep');

jest.setTimeout(120000);

const DB = 'kokonada_j2_orphan_sweep';
const ERASURE_SRC = path.join(__dirname, '../app/services/privacy/erasure.js');
const SHA = 'f'.repeat(64);
const COMMIT = 'c'.repeat(40);
const ARM = { confirm: 'arm-orphan-sweep', recordSha256: SHA, deployedCommit: COMMIT };
let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
  await mongoose.connect(mem.getUri(), { dbName: DB });
  await Promise.all(CASCADE_MODELS.map((m) => m.init()));
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});

let lines;
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), ...CASCADE_MODELS.map((m) => m.collection.deleteMany({}))]);
  await mongoose.connection.db.collection('opsmarkers').drop().catch(() => {});
  redis.store.clear();
  redis.sticky.clear();
  delete process.env.ORPHAN_SWEEP_DISABLED;
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
});
afterEach(async () => {
  jest.restoreAllMocks();
  delete process.env.ORPHAN_SWEEP_DISABLED;
  await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
});

const oid = () => new mongoose.Types.ObjectId();
let seq = 0;
const account = (over = {}) => {
  seq += 1;
  return User.create({ ssoProvider: 'google', ssoId: `sso-orphan-${seq}`, email: `orphan-${seq}@example.com`, ...over });
};
const NAMESPACE_KEYS = (id) => [`ledger:${id}:served`, `pool:${id}:calm`, `buffer:${id}:bio:peak:running`, `bio:baseline:${id}`, `bio:affect:${id}`];

/** One raw row in every cascade collection, and a key in every namespace, under `id`. */
async function seedEverywhere(id) {
  const userId = new mongoose.Types.ObjectId(String(id));
  for (const model of CASCADE_MODELS) {
    await model.collection.insertOne({ userId, providerUserId: `p-${id}`, tokenHash: `h-${id}`, seeded: true });
  }
  for (const key of NAMESPACE_KEYS(id)) redis.store.set(key, 'x');
}
/** One row (a serve event) under `id`, the cheapest way to make an id discoverable. */
const seedOne = (id) => mongoose.models.ServeEvent.collection.insertOne({ userId: new mongoose.Types.ObjectId(String(id)), seeded: true });
const serveRows = () => mongoose.models.ServeEvent.countDocuments({});

async function rowsUnder(id) {
  const userId = new mongoose.Types.ObjectId(String(id));
  return Promise.all(CASCADE_MODELS.map((m) => m.collection.countDocuments({ userId })));
}
const keysUnder = (id) => [...redis.store.keys()].filter((k) => k.includes(String(id)));
const markers = () => mongoose.connection.db.collection('opsmarkers');
const markerExists = async () => (await mongoose.connection.db.listCollections({ name: 'opsmarkers' }).toArray()).length > 0;
const failNext = (command, collection, mode = { times: 1 }) => mongoose.connection.db.admin().command({
  configureFailPoint: 'failCommand', mode, data: { failCommands: [command], errorCode: 2, namespace: `${DB}.${collection}` },
});
const sweepLines = () => lines.filter((l) => l.startsWith('[orphanSweep]'));
const fingerprintOf = (ids) => orphanSetFingerprint(ids.map(String));
/** Arms for real: only possible while no orphan exists, so call it before seeding any. */
const arm = () => armOrphanSweep(ARM);

describe('the discovery list is the cascade (lockstep with erasure.js)', () => {
  it('CASCADE_MODELS names exactly the collections eraseUserChildData deletes', () => {
    const src = fs.readFileSync(ERASURE_SRC, 'utf8');
    const body = src.slice(src.indexOf('async function eraseUserChildData'), src.indexOf('await purgeUserKeys'));
    const parsed = [...body.matchAll(/(\w+)\.deleteMany\(\s*\{\s*userId\s*\}/g)].map((m) => m[1]);
    expect(parsed).toHaveLength(13);
    expect(CASCADE_MODELS.map((m) => m.modelName).sort()).toEqual([...parsed].sort());
  });
});

describe('every user-scoped Redis namespace can be discovered', () => {
  it('each registry entry has a scan pattern that matches its keys, and idOf gives back the id', () => {
    const { USER_KEY_NAMESPACES } = require('../app/utils/userRedisPurge');
    const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    const id = String(oid());
    for (const ns of USER_KEY_NAMESPACES) {
      const key = ns.pattern(id).replace('*', 'calm');
      expect({ ns: ns.name, matches: glob(ns.scan).test(key), id: ns.idOf(key) }).toEqual({ ns: ns.name, matches: true, id });
      expect(ns.scan.startsWith('*')).toBe(false);
    }
  });
});

// §A — the marker, read on the primary, strict.
describe('isArmed: the marker', () => {
  it('no marker: disarmed, reason absent, and reading it creates no collection', async () => {
    await expect(isArmed()).resolves.toEqual({ armed: false, reason: 'absent' });
    expect(await markerExists()).toBe(false);
  });

  it('the marker armOrphanSweep writes: armed', async () => {
    await arm();
    await expect(isArmed()).resolves.toEqual({ armed: true, reason: null });
  });

  // §F 5 and the architect's malformed list: anything not exactly the v1 shape disarms.
  it.each([
    ['an unknown extra field', { note: 'x' }],
    ['a wrong v', { v: 2 }],
    ['v as a string', { v: '1' }],
    ['a wrong kind', { kind: 'sweep' }],
    ['a short recordSha256', { recordSha256: 'f'.repeat(63) }],
    ['an upper-case recordSha256', { recordSha256: 'F'.repeat(64) }],
    ['recountOrphans other than 0', { recountOrphans: 1 }],
    ['a bad deployedCommit', { deployedCommit: 'c'.repeat(39) }],
    ['armedAt not a date', { armedAt: '2026-10-04' }],
    ['a missing field', { deployedCommit: undefined }],
  ])('%s: disarmed, reason malformed', async (_why, change) => {
    const doc = { _id: 'orphan-sweep', v: 1, kind: 'orphan-sweep', armedAt: new Date(), recordSha256: SHA, recountOrphans: 0, deployedCommit: COMMIT, ...change };
    for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
    await markers().insertOne(doc);

    await expect(isArmed()).resolves.toEqual({ armed: false, reason: 'malformed' });
  });

  // §F 4: ORPHAN_SWEEP_DISABLED can only disarm, by the house envFlag rules.
  it.each([['true', false], ['1', false], ['false', true], ['', true]])('ORPHAN_SWEEP_DISABLED=%p with a valid marker: armed=%s', async (value, armed) => {
    await arm();
    process.env.ORPHAN_SWEEP_DISABLED = value;

    await expect(isArmed()).resolves.toEqual(armed ? { armed: true, reason: null } : { armed: false, reason: 'override' });
  });

  it('a marker read that fails: disarmed, reason read-error', async () => {
    await arm();
    await failNext('find', 'opsmarkers');

    await expect(isArmed()).resolves.toEqual({ armed: false, reason: 'read-error' });
  });
});

// §C, §F 7 — the writer.
describe('armOrphanSweep and disarmOrphanSweep', () => {
  it.each([
    ['no confirm literal', { ...ARM, confirm: undefined }, 'confirm'],
    ['a wrong confirm literal', { ...ARM, confirm: 'arm' }, 'confirm'],
    ['a bad recordSha256', { ...ARM, recordSha256: 'x'.repeat(64) }, 'record-sha256'],
    ['a bad deployedCommit', { ...ARM, deployedCommit: 'c'.repeat(41) }, 'deployed-commit'],
  ])('%s: refuses and writes nothing', async (_why, args, reason) => {
    await expect(armOrphanSweep(args)).rejects.toEqual(expect.objectContaining({ name: 'OrphanSweepRefused', reason }));
    expect(await markerExists()).toBe(false);
  });

  it('while an orphan exists: refuses and writes nothing (it cannot be armed before the clean)', async () => {
    await seedOne((await account())._id);
    await seedOne(oid());

    await expect(armOrphanSweep(ARM)).rejects.toEqual(expect.objectContaining({ reason: 'orphans', orphans: 1 }));
    expect(await markerExists()).toBe(false);
  });

  it('with none: writes exactly the v1 marker; a second arm changes nothing; disarm deletes it', async () => {
    await seedOne((await account())._id);

    await expect(arm()).resolves.toEqual({ armed: true, v: 1 });
    const first = await markers().findOne({ _id: 'orphan-sweep' });
    expect(Object.keys(first).sort()).toEqual(['_id', 'armedAt', 'deployedCommit', 'kind', 'recordSha256', 'recountOrphans', 'v']);
    expect(first).toEqual(expect.objectContaining({ v: 1, kind: 'orphan-sweep', recordSha256: SHA, recountOrphans: 0, deployedCommit: COMMIT }));

    await expect(armOrphanSweep({ ...ARM, deployedCommit: 'd'.repeat(40) })).resolves.toEqual({ armed: true, v: 1 });
    expect(await markers().findOne({ _id: 'orphan-sweep' })).toEqual(first);

    await expect(disarmOrphanSweep()).resolves.toEqual({ disarmed: 1 });
    await expect(isArmed()).resolves.toEqual({ armed: false, reason: 'absent' });
  });
});

describe('armed, the nightly run: DT-14 unchanged', () => {
  it('an orphan with rows in all 13 collections and keys in all 5 namespaces ends at 0 everywhere; a live account is untouched', async () => {
    const live = await account();
    const live2 = await account();
    await arm();
    const gone = oid();
    for (const id of [live._id, live2._id, gone]) await seedEverywhere(id);

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 1, backlog: 0, failed: 0 });

    expect(await rowsUnder(gone)).toEqual(CASCADE_MODELS.map(() => 0));
    expect(keysUnder(gone)).toEqual([]);
    for (const id of [live._id, live2._id]) {
      expect(await rowsUnder(id)).toEqual(CASCADE_MODELS.map(() => 1));
      expect(keysUnder(id)).toHaveLength(5);
    }
  });

  it('a User doc with deletedAt set is an account, not an orphan', async () => {
    const flagged = await account({ deletedAt: new Date() });
    await arm();
    await seedEverywhere(flagged._id);

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 0, backlog: 0, failed: 0 });
    expect(await rowsUnder(flagged._id)).toEqual(CASCADE_MODELS.map(() => 1));
  });

  it('an id from Redis that cannot be an ObjectId: its keys go, no Mongo cascade runs for it, and the real orphan is swept too', async () => {
    await seedOne((await account())._id);
    await arm();
    const gone = oid();
    await seedEverywhere(gone);
    redis.store.set('ledger:guest:served', 'x');
    redis.store.set('pool:guest:calm', 'x');
    const deletes = CASCADE_MODELS.map((m) => jest.spyOn(m, 'deleteMany'));

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 2, backlog: 0, failed: 0 });

    expect([...redis.store.keys()].filter((k) => k.includes('guest'))).toEqual([]);
    expect(await rowsUnder(gone)).toEqual(CASCADE_MODELS.map(() => 0));
    const filters = deletes.flatMap((d) => d.mock.calls.map(([filter]) => String(filter?.userId)));
    expect(filters).not.toContain('guest');
    expect(filters).toContain(String(gone));
  });

  it('re-reads each orphan on the primary right before its cascade: an account created after discovery is left alone', async () => {
    await seedOne((await account())._id);
    await arm();
    const late = oid();
    await seedEverywhere(late);
    const real = accountExistence.existingAccountIds;
    jest.spyOn(accountExistence, 'existingAccountIds').mockImplementationOnce(async (ids) => {
      const found = await real(ids); // the discovery's read: `late` has no account yet
      await account({ _id: late }); // …and signs up right after it
      return found;
    });

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 0, backlog: 0, failed: 0 });
    expect(await rowsUnder(late)).toEqual(CASCADE_MODELS.map(() => 1));
    expect(keysUnder(late)).toHaveLength(5);
  });

  it('caps a run at 50 accounts; the rest is the backlog', async () => {
    expect(ORPHAN_SWEEP_CAP).toBe(50);
    for (let i = 0; i < 60; i += 1) await seedOne((await account())._id);
    await arm();
    for (let i = 0; i < 55; i += 1) await seedOne(oid());

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 50, backlog: 5, failed: 0 });
    expect(await serveRows()).toBe(65);
  });

  it('refuses, deleting nothing, when the users read returns none while ids exist (§F 2)', async () => {
    await arm();
    for (let i = 0; i < 3; i += 1) await seedEverywhere(oid());

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 'refused', backlog: 3, failed: 1 });
    expect(await serveRows()).toBe(3);
    expect(redis.store.size).toBe(15);
    expect(sweepLines()).toEqual(['[orphanSweep] refused reason=no_accounts_read orphans=3 ids=3']);
  });

  it('refuses, deleting nothing, when the orphans are more than 5 and more than half of all ids', async () => {
    for (let i = 0; i < 2; i += 1) await seedOne((await account())._id);
    await arm();
    for (let i = 0; i < 6; i += 1) await seedOne(oid());

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 'refused', backlog: 6, failed: 1 });
    expect(await serveRows()).toBe(8);
    expect(sweepLines()).toEqual(['[orphanSweep] refused reason=too_many orphans=6 ids=8']);
  });

  it('5 orphans, or orphans that are not more than half, are swept', async () => {
    await seedOne((await account())._id);
    await arm();
    for (let i = 0; i < 5; i += 1) await seedOne(oid());

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 5, backlog: 0, failed: 0 });
  });

  it('a cascade that fails for one orphan is counted, stays in the backlog, and the others are still swept', async () => {
    await seedOne((await account())._id);
    await seedOne((await account())._id);
    await arm();
    const [a, b] = [oid(), oid()].sort((x, y) => String(x).localeCompare(String(y)));
    await seedOne(a);
    await seedOne(b);
    await failNext('delete', 'serveevents');

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 1, backlog: 1, failed: 1 });
    expect(sweepLines()).toEqual(['[orphanSweep] erase failed scope=account error=MongoServerError']);
  });
});

// §B — the nightly run never throws to the worker loop.
describe('never throws: a read failure is refused, with an unknown backlog', () => {
  it('the marker read fails', async () => {
    await arm();
    await seedOne((await account())._id);
    await failNext('find', 'opsmarkers');

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 'refused', backlog: 'unknown', failed: 1 });
    expect(sweepLines()).toEqual(['[orphanSweep] refused reason=read-error']);
  });

  it.each([['armed', true], ['disarmed', false]])('discovery fails (%s)', async (_state, armed) => {
    if (armed) await arm();
    await seedOne((await account())._id);
    await seedOne(oid());
    await failNext('distinct', 'serveevents');

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 'refused', backlog: 'unknown', failed: 1 });
    expect(await serveRows()).toBe(2);
    expect(sweepLines()).toEqual(['[orphanSweep] refused reason=read-error']);
  });

  it('the users read fails', async () => {
    await arm();
    await seedOne((await account())._id);
    await seedOne(oid());
    await failNext('find', 'users', 'alwaysOn');

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 'refused', backlog: 'unknown', failed: 1 });
    await failNext('find', 'users', 'off');
    expect(await serveRows()).toBe(2);
  });
});

describe('disarmed: nothing is erased, and the backlog is still the real count', () => {
  it.each([
    ['no marker', async () => {}, 'absent'],
    ['a malformed marker', async () => { await markers().insertOne({ _id: 'orphan-sweep', v: 2 }); }, 'malformed'],
    ['the override', async () => { await arm(); process.env.ORPHAN_SWEEP_DISABLED = 'true'; }, 'override'],
  ])('%s: disabled, backlog n, its own line', async (_state, setUp, reason) => {
    await seedOne((await account())._id);
    await seedOne((await account())._id);
    await setUp();
    await seedOne(oid());

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 'disabled', backlog: 1, failed: 0 });
    expect(await serveRows()).toBe(3);
    expect(sweepLines()).toEqual([`[orphanSweep] disarmed reason=${reason} backlog=1`]);
  });

  it('the predicate is injectable: it is the only thing asked', async () => {
    await seedOne((await account())._id);
    await seedOne((await account())._id);
    await seedOne(oid());

    await expect(sweepDeletedAccountOrphans({ armed: async () => ({ armed: true, reason: null }) })).resolves.toEqual({ count: 1, backlog: 0, failed: 0 });
  });
});

// §B forced, §F 8 and 9 — the owner's clean, through the private tool.
describe('forced: the exact count and the exact set replace only the ratio refusal', () => {
  async function eightOrphansOneAccount() {
    await seedOne((await account())._id);
    const ids = [];
    for (let i = 0; i < 8; i += 1) { const id = oid(); ids.push(id); await seedOne(id); }
    return ids;
  }

  it('the exact n and set proceed, past the ratio refusal, with no marker', async () => {
    const ids = await eightOrphansOneAccount();

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 8, expectedSet: fingerprintOf(ids) })).resolves.toEqual({ count: 8, backlog: 0, failed: 0 });
    expect(await serveRows()).toBe(1);
  });

  it('a different n refuses, and deletes nothing', async () => {
    const ids = await eightOrphansOneAccount();

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 7, expectedSet: fingerprintOf(ids) })).resolves.toEqual({ count: 'refused', backlog: 8, failed: 1 });
    expect(await serveRows()).toBe(9);
  });

  it('the same n with a different set refuses, and deletes nothing', async () => {
    const ids = await eightOrphansOneAccount();
    const other = [...ids.slice(1), oid()];

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 8, expectedSet: fingerprintOf(other) })).resolves.toEqual({ count: 'refused', backlog: 8, failed: 1 });
    expect(await serveRows()).toBe(9);
    expect(sweepLines()).toEqual(['[orphanSweep] refused reason=set_mismatch orphans=8 ids=9']);
  });

  it.each([['no expected count', { expectedSet: '00000000' }], ['no expected set', { expectedOrphans: 8 }], ['a set that is not 8 hex', { expectedOrphans: 8, expectedSet: 'zz' }]])('%s refuses', async (_why, args) => {
    await eightOrphansOneAccount();

    await expect(sweepDeletedAccountOrphans({ force: true, ...args })).resolves.toEqual(expect.objectContaining({ count: 'refused', failed: 1 }));
    expect(await serveRows()).toBe(9);
  });

  it('the users-empty refusal stays', async () => {
    const ids = [oid(), oid()];
    for (const id of ids) await seedOne(id);

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 2, expectedSet: fingerprintOf(ids) })).resolves.toEqual({ count: 'refused', backlog: 2, failed: 1 });
    expect(await serveRows()).toBe(2);
  });

  it('the cap is lifted for the verified set', async () => {
    for (let i = 0; i < 60; i += 1) await seedOne((await account())._id);
    const ids = [];
    for (let i = 0; i < 55; i += 1) { const id = oid(); ids.push(id); await seedOne(id); }

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 55, expectedSet: fingerprintOf(ids) })).resolves.toEqual({ count: 55, backlog: 0, failed: 0 });
  });

  it('a pool:not-an-id:x key is counted in n and the set, cleared in Redis only, and then arming succeeds (§F 8)', async () => {
    await seedOne((await account())._id);
    const gone = oid();
    await seedEverywhere(gone);
    redis.store.set('pool:not-an-id:x', 'x');
    await expect(armOrphanSweep(ARM)).rejects.toEqual(expect.objectContaining({ reason: 'orphans', orphans: 2 }));
    const deletes = CASCADE_MODELS.map((m) => jest.spyOn(m, 'deleteMany'));

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 2, expectedSet: fingerprintOf([gone, 'not-an-id']) })).resolves.toEqual({ count: 2, backlog: 0, failed: 0 });

    expect(redis.store.has('pool:not-an-id:x')).toBe(false);
    expect(deletes.flatMap((d) => d.mock.calls.map(([f]) => String(f?.userId)))).not.toContain('not-an-id');
    await expect(armOrphanSweep(ARM)).resolves.toEqual({ armed: true, v: 1 });
  });
});

// §B, §F 10 — the lockstep with the private count tool: the same vector gives the same constant there.
describe('orphanSetFingerprint', () => {
  it('the pinned vector: lower-cased ObjectIds, raw other ids, a set, sorted, joined by \\n, first 8 hex of sha256', () => {
    const vector = ['not-an-id', '64F0C0FFEE00000000000A0A', '0123456789abcdef01234567', '64f0c0ffee00000000000a0a'];
    expect(orphanSetFingerprint(vector)).toBe('5d9d9dc3');
    const spelledOut = crypto.createHash('sha256').update('0123456789abcdef01234567\n64f0c0ffee00000000000a0a\nnot-an-id').digest('hex').slice(0, 8);
    expect(spelledOut).toBe('5d9d9dc3');
    expect(orphanSetFingerprint([...vector].reverse())).toBe('5d9d9dc3');
  });
});

describe('discoverOrphans is read-only', () => {
  it('reports the ids, the orphans and their fingerprint, and changes nothing', async () => {
    const live = await account();
    await seedEverywhere(live._id);
    const gone = oid();
    await seedEverywhere(gone);

    const found = await discoverOrphans();

    expect(found).toEqual({ ids: 2, accountIds: 2, accountsRead: 1, orphans: [String(gone)], set: fingerprintOf([gone]) });
    expect(await rowsUnder(gone)).toEqual(CASCADE_MODELS.map(() => 1));
    expect(keysUnder(gone)).toHaveLength(5);
  });

  it('no [orphanSweep] line carries an id', async () => {
    await sweepDeletedAccountOrphans();
    for (let i = 0; i < 2; i += 1) await seedOne((await account())._id);
    await arm().catch(() => {});
    for (let i = 0; i < 6; i += 1) await seedOne(oid());
    await sweepDeletedAccountOrphans();

    expect(sweepLines()).toHaveLength(2);
    expect(lines.join('\n')).not.toMatch(/[0-9a-f]{24}|sv-/);
  });

  it('OrphanSweepRefused is what the writer throws', () => {
    expect(new OrphanSweepRefused('confirm', { orphans: 0, ids: 0 })).toEqual(expect.objectContaining({ name: 'OrphanSweepRefused', reason: 'confirm' }));
  });
});

// Resilience §7 (on T12 v2): discovery attributes a key to an id, and the purge must delete exactly what it
// found. An id that is not an ObjectId is never turned into a pattern: `pool:*:x` gives the id `*`, and a
// pattern built from it (`pool:*:*`, `ledger:*:*`, `bio:baseline:*`) reached every user. And the backlog is a
// fresh count after the loop, never `orphans - erased`, which read 0 while a key the purge missed stayed.
describe('the purge deletes exactly what discovery found; the backlog is read again after the loop', () => {
  it('a forced run with a key pool:*:x deletes only that key; every live account keeps its keys', async () => {
    const live = await account();
    await seedOne(live._id);
    const liveKeys = [`pool:${live._id}:calm`, `ledger:${live._id}:served`, `buffer:${live._id}:bio:peak:running`, `bio:baseline:${live._id}`, `bio:affect:${live._id}`];
    for (const key of liveKeys) redis.store.set(key, 'x');
    redis.store.set('pool:*:x', 'x');
    const found = await discoverOrphans();
    expect(found.orphans).toEqual(['*']);

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 1, expectedSet: found.set })).resolves.toEqual({ count: 1, backlog: 0, failed: 0 });

    expect(redis.store.has('pool:*:x')).toBe(false);
    expect(liveKeys.filter((key) => !redis.store.has(key))).toEqual([]);
  });

  it('ledger:<orphan> with no sub-key is deleted, and the backlog reads 0 from the re-read', async () => {
    await seedOne((await account())._id);
    await arm();
    const gone = String(oid());
    redis.store.set(`ledger:${gone}`, 'x');

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 1, backlog: 0, failed: 0 });

    expect(redis.store.has(`ledger:${gone}`)).toBe(false);
    expect((await discoverOrphans()).orphans).toEqual([]);
  });

  it('a key that stays after its DEL: the backlog is the true remaining count, read after the loop', async () => {
    await seedOne((await account())._id);
    await arm();
    const gone = String(oid());
    redis.store.set(`pool:${gone}:calm`, 'x');
    redis.sticky.add(`pool:${gone}:calm`);

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 1, backlog: 1, failed: 0 });

    expect(redis.store.has(`pool:${gone}:calm`)).toBe(true);
  });

  it('the re-read fails: the backlog is unknown and the run counts a failure', async () => {
    await seedOne((await account())._id);
    await arm();
    await seedOne(oid());
    // The first discovery reads serveevents once; the re-read after the loop is the next read there.
    await mongoose.connection.db.admin().command({
      configureFailPoint: 'failCommand', mode: { skip: 1 }, data: { failCommands: ['distinct'], errorCode: 2, namespace: `${DB}.serveevents` },
    });

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 1, backlog: 'unknown', failed: 1 });
    expect(sweepLines()).toEqual(['[orphanSweep] backlog read failed error=MongoServerError']);
  });
});
