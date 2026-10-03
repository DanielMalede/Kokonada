'use strict';

// J2 (BE-094; Plan B T9, DT-11, DT-13, DT-14) — the daily sweep of deleted accounts' data.
//
// A deleted account's data can outlive the deletion: a recompute or a health-data sync that wrote after
// the cascade ran, a server stopped between a write and its re-check. Every such row sits under an id that
// no User doc carries any more. The sweep finds those ids and runs the house cascade (erasure.js) for each,
// then the strict Redis purge. It is the bound behind "within a day" in the declarations, so it must never
// erase a live account:
//   • discovery: every user id in every cascade collection (`distinct('userId')`, in lockstep with
//     erasure.js) and in every user-scoped Redis namespace (a SCAN per registry entry);
//   • an id is an orphan only when no User doc carries it, read on the PRIMARY, and read AGAIN for that id
//     right before its cascade; a doc with `deletedAt` set is still an account;
//   • it REFUSES, deleting nothing, when the users read returns none while ids exist, or when the orphans are
//     more than 5 and more than half of all ids (a wrong database must never read as "everyone deleted");
//   • at most 50 accounts per run; the rest is the backlog, for the next run;
//   • an id from Redis that cannot be an ObjectId names no account and has no Mongo rows: its keys only,
//     never the Mongo cascade, never an aborted run;
//   • ORPHAN_SWEEP_DISABLED stops the nightly run (DT-13); the operator's own call still works, bound to the
//     count the operator recorded.
//
// Real: MongoDB (mongodb-memory-server, test commands on for a real users-read failure), the cascade, the
// existence helper. Faked: Redis, by a STATEFUL store that answers SCAN/DEL/GET/SET over real keys. With
// no REDIS_URL the job purge inside the cascade has nothing to reach; the waiting job on a real queue is
// orphanSweep.redis.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.REDIS_URL;
delete process.env.ORPHAN_SWEEP_DISABLED;

jest.mock('../app/config/redis', () => {
  const store = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const fake = {
    store,
    async scan(_cursor, _match, pattern) { const re = glob(pattern); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
    async del(...keys) { return keys.flat().reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0); },
    async set(key, value) { store.set(key, value); return 'OK'; },
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async exists(key) { return store.has(key) ? 1 : 0; },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

const fs = require('fs');
const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const { __fake: redis } = require('../app/config/redis');
const accountExistence = require('../app/services/privacy/accountExistence');
const {
  sweepDeletedAccountOrphans, nightlyOrphanSweep, discoverOrphans, OrphanSweepRefused,
  CASCADE_MODELS, ORPHAN_SWEEP_CAP,
} = require('../app/services/privacy/orphanSweep');

jest.setTimeout(120000);

const DB = 'kokonada_j2_orphan_sweep';
const ERASURE_SRC = path.join(__dirname, '../app/services/privacy/erasure.js');
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
  redis.store.clear();
  delete process.env.ORPHAN_SWEEP_DISABLED;
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
});
afterEach(async () => {
  jest.restoreAllMocks();
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

async function rowsUnder(id) {
  const userId = new mongoose.Types.ObjectId(String(id));
  const counts = await Promise.all(CASCADE_MODELS.map((m) => m.collection.countDocuments({ userId })));
  return CASCADE_MODELS.reduce((acc, m, i) => ({ ...acc, [m.modelName]: counts[i] }), {});
}
const keysUnder = (id) => [...redis.store.keys()].filter((k) => k.includes(String(id)));
const allZero = (counts) => Object.values(counts).every((n) => n === 0);

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

describe('sweepDeletedAccountOrphans', () => {
  it('an orphan with rows in all 13 collections and keys in all 5 namespaces ends at 0 everywhere; a live account is untouched', async () => {
    const live = await account();
    const live2 = await account();
    const gone = oid();
    for (const id of [live._id, live2._id, gone]) await seedEverywhere(id);

    const out = await sweepDeletedAccountOrphans();

    expect(out).toEqual(expect.objectContaining({ erased: 1, failed: 0, backlog: 0 }));
    expect(allZero(await rowsUnder(gone))).toBe(true);
    expect(keysUnder(gone)).toEqual([]);
    for (const id of [live._id, live2._id]) {
      expect(Object.values(await rowsUnder(id))).toEqual(CASCADE_MODELS.map(() => 1));
      expect(keysUnder(id)).toHaveLength(5);
    }
  });

  it('a User doc with deletedAt set is an account, not an orphan', async () => {
    const flagged = await account({ deletedAt: new Date() });
    const live = await account();
    await seedEverywhere(flagged._id);
    await seedOne(live._id);

    const out = await sweepDeletedAccountOrphans();

    expect(out).toEqual(expect.objectContaining({ erased: 0, backlog: 0 }));
    expect(Object.values(await rowsUnder(flagged._id))).toEqual(CASCADE_MODELS.map(() => 1));
  });

  it('an id from Redis that cannot be an ObjectId: its keys go, no Mongo cascade runs for it, and the real orphan is swept too', async () => {
    const live = await account();
    await seedOne(live._id);
    const gone = oid();
    await seedEverywhere(gone);
    redis.store.set('ledger:guest:served', 'x');
    redis.store.set('pool:guest:calm', 'x');
    const deletes = CASCADE_MODELS.map((m) => jest.spyOn(m, 'deleteMany'));

    const out = await sweepDeletedAccountOrphans();

    expect(out).toEqual(expect.objectContaining({ erased: 2, failed: 0, backlog: 0 }));
    expect([...redis.store.keys()].filter((k) => k.includes('guest'))).toEqual([]);
    expect(allZero(await rowsUnder(gone))).toBe(true);
    const filters = deletes.flatMap((d) => d.mock.calls.map(([filter]) => String(filter?.userId)));
    expect(filters).not.toContain('guest');
    expect(filters).toContain(String(gone));
  });

  it('re-reads each orphan on the primary right before its cascade: an account created after discovery is left alone', async () => {
    const live = await account();
    await seedOne(live._id);
    const late = oid();
    await seedEverywhere(late);
    const real = accountExistence.existingAccountIds;
    jest.spyOn(accountExistence, 'existingAccountIds').mockImplementationOnce(async (ids) => {
      const found = await real(ids); // the discovery's read: `late` has no account yet
      await account({ _id: late }); // …and signs up right after it
      return found;
    });

    const out = await sweepDeletedAccountOrphans();

    expect(out).toEqual(expect.objectContaining({ erased: 0, failed: 0 }));
    expect(Object.values(await rowsUnder(late))).toEqual(CASCADE_MODELS.map(() => 1));
    expect(keysUnder(late)).toHaveLength(5);
  });

  it('caps a run at 50 accounts; the rest is the backlog', async () => {
    expect(ORPHAN_SWEEP_CAP).toBe(50);
    for (let i = 0; i < 60; i += 1) await seedOne((await account())._id);
    for (let i = 0; i < 55; i += 1) await seedOne(oid());

    const out = await sweepDeletedAccountOrphans();

    expect(out).toEqual(expect.objectContaining({ erased: 50, failed: 0, backlog: 5 }));
    expect(await mongoose.models.ServeEvent.countDocuments({})).toBe(65);
  });
});

describe('the refusal guard: it deletes nothing', () => {
  it('when the users read returns none while ids exist', async () => {
    for (let i = 0; i < 3; i += 1) await seedEverywhere(oid());

    const err = await sweepDeletedAccountOrphans().then(() => null, (e) => e);

    expect(err).toBeInstanceOf(OrphanSweepRefused);
    expect(err.reason).toBe('no_accounts_read');
    expect(await mongoose.models.ServeEvent.countDocuments({})).toBe(3);
    expect(redis.store.size).toBe(15);
  });

  it('when the orphans are more than 5 and more than half of all ids', async () => {
    for (let i = 0; i < 2; i += 1) await seedOne((await account())._id);
    for (let i = 0; i < 6; i += 1) await seedOne(oid());

    const err = await sweepDeletedAccountOrphans().then(() => null, (e) => e);

    expect(err).toBeInstanceOf(OrphanSweepRefused);
    expect(err).toEqual(expect.objectContaining({ reason: 'too_many', orphans: 6, ids: 8 }));
    expect(await mongoose.models.ServeEvent.countDocuments({})).toBe(8);
  });

  it('5 orphans, or orphans that are not more than half, are swept', async () => {
    await seedOne((await account())._id);
    for (let i = 0; i < 5; i += 1) await seedOne(oid());

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual(expect.objectContaining({ erased: 5, backlog: 0 }));
  });

  it('a users read that fails is a failure, not a verdict: it throws and deletes nothing', async () => {
    await seedOne((await account())._id);
    await seedOne(oid());
    await mongoose.connection.db.admin().command({
      configureFailPoint: 'failCommand', mode: 'alwaysOn', data: { failCommands: ['find'], errorCode: 2, namespace: `${DB}.users` },
    });

    await expect(sweepDeletedAccountOrphans()).rejects.toThrow();
    await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
    expect(await mongoose.models.ServeEvent.countDocuments({})).toBe(2);
  });
});

// The operator's call (DT-12 C-2, the private tool): bound to the orphan count recorded by its own count in
// the same session. A mismatch refuses; a match passes the ratio guard, never the empty-users guard.
describe('the expected count', () => {
  it('refuses on any mismatch and deletes nothing', async () => {
    await seedOne((await account())._id);
    for (let i = 0; i < 3; i += 1) await seedOne(oid());

    const err = await sweepDeletedAccountOrphans({ expectedOrphans: 4 }).then(() => null, (e) => e);

    expect(err).toEqual(expect.objectContaining({ name: 'OrphanSweepRefused', reason: 'count_mismatch', orphans: 3 }));
    expect(await mongoose.models.ServeEvent.countDocuments({})).toBe(4);
  });

  it('a matching count passes the ratio guard (still capped at 50)', async () => {
    await seedOne((await account())._id);
    for (let i = 0; i < 8; i += 1) await seedOne(oid());

    await expect(sweepDeletedAccountOrphans({ expectedOrphans: 8 })).resolves.toEqual(expect.objectContaining({ erased: 8, backlog: 0 }));
  });

  it('never the empty-users guard', async () => {
    for (let i = 0; i < 2; i += 1) await seedOne(oid());

    await expect(sweepDeletedAccountOrphans({ expectedOrphans: 2 })).rejects.toEqual(expect.objectContaining({ reason: 'no_accounts_read' }));
  });
});

describe('the nightly step (sessionTrim): tokens, the switch, counts only', () => {
  it('swept: orphanErasures is the count, orphanBacklog the real remainder', async () => {
    await seedOne((await account())._id);
    await seedOne((await account())._id);
    await seedOne(oid());

    await expect(nightlyOrphanSweep()).resolves.toEqual({ orphanErasures: 1, orphanBacklog: 0, failed: 0 });
  });

  it('ORPHAN_SWEEP_DISABLED: nothing is deleted, one separate line, and the backlog is still counted', async () => {
    process.env.ORPHAN_SWEEP_DISABLED = 'true';
    await seedOne((await account())._id);
    await seedOne((await account())._id);
    await seedOne(oid());

    await expect(nightlyOrphanSweep()).resolves.toEqual({ orphanErasures: 'disabled', orphanBacklog: 1, failed: 0 });
    expect(await mongoose.models.ServeEvent.countDocuments({})).toBe(3);
    expect(lines.filter((l) => l.startsWith('[orphanSweep]'))).toEqual(['[orphanSweep] disabled']);
  });

  it('refused: the token says so, the backlog is the real count, and the run counts a failure', async () => {
    for (let i = 0; i < 2; i += 1) await seedOne((await account())._id);
    for (let i = 0; i < 6; i += 1) await seedOne(oid());

    await expect(nightlyOrphanSweep()).resolves.toEqual({ orphanErasures: 'refused', orphanBacklog: 6, failed: 1 });
    expect(lines.filter((l) => l.startsWith('[orphanSweep]'))).toEqual(['[orphanSweep] refused reason=too_many orphans=6 ids=8']);
  });

  it('a cascade that fails for one orphan is counted, stays in the backlog, and the others are still swept', async () => {
    await seedOne((await account())._id);
    await seedOne((await account())._id);
    const [a, b] = [oid(), oid()].sort((x, y) => String(x).localeCompare(String(y)));
    await seedOne(a);
    await seedOne(b);
    await mongoose.connection.db.admin().command({
      configureFailPoint: 'failCommand', mode: { times: 1 }, data: { failCommands: ['delete'], errorCode: 2, namespace: `${DB}.serveevents` },
    });

    await expect(nightlyOrphanSweep()).resolves.toEqual({ orphanErasures: 1, orphanBacklog: 1, failed: 1 });
    expect(lines.filter((l) => l.startsWith('[orphanSweep]'))).toEqual(['[orphanSweep] erase failed scope=account error=MongoServerError']);
  });

  it('no [orphanSweep] line carries an id', async () => {
    process.env.ORPHAN_SWEEP_DISABLED = 'true';
    await nightlyOrphanSweep();
    delete process.env.ORPHAN_SWEEP_DISABLED;
    for (let i = 0; i < 2; i += 1) await seedOne((await account())._id);
    for (let i = 0; i < 6; i += 1) await seedOne(oid());
    await nightlyOrphanSweep();

    expect(lines.filter((l) => l.startsWith('[orphanSweep]'))).toHaveLength(2);
    expect(lines.join('\n')).not.toMatch(/[0-9a-f]{24}/);
  });
});

describe('discoverOrphans is read-only', () => {
  it('reports ids and orphans and changes nothing', async () => {
    const live = await account();
    await seedEverywhere(live._id);
    const gone = oid();
    await seedEverywhere(gone);

    const found = await discoverOrphans();

    expect(found).toEqual(expect.objectContaining({ ids: 2, accountsRead: 1 }));
    expect(found.orphans).toEqual([String(gone)]);
    expect(Object.values(await rowsUnder(gone))).toEqual(CASCADE_MODELS.map(() => 1));
    expect(keysUnder(gone)).toHaveLength(5);
  });
});
