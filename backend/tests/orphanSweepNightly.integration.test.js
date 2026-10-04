'use strict';

// J2 (BE-094; DT-13 FINAL §F 1) — with no marker the nightly run touches nothing, proven through the daily
// job's own processJob (sessionTrim), never by calling the sweep directly.
//
// Seed: a live account and a deleted account's leftovers in every cascade collection and every Redis
// namespace, plus a key under an id that is not an ObjectId; every row dated so the job's other steps have
// nothing to do. Then one run, and:
//   • every MongoDB command the sweep sends is a read (find, aggregate, distinct, count, getMore,
//     killCursors, endSessions), seen by the driver's own command monitoring;
//   • every Redis command the whole run sends is a SCAN or a read (no DEL, SET, EVAL or EVALSHA);
//   • a full snapshot of every collection and every key is unchanged, the ConsentRecord rows included;
//   • the run reports `orphanErasures=disabled orphanBacklog=2`, and no `opsmarkers` collection exists.
//
// Real: MongoDB, sessionTrim's processJob and every step it runs, the sweep. Faked: Redis, by a STATEFUL store
// that records each command. The same run on a real Redis under MONITOR is in orphanSweep.redis.test.js.
// The sweep is observed (wrapped, not replaced) only to know which commands are its own.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.REDIS_URL;
delete process.env.ORPHAN_SWEEP_DISABLED;

jest.mock('../app/config/redis', () => {
  const store = new Map();
  const commands = [];
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const fake = {
    store,
    commands,
    async scan(_cursor, _match, pattern) { commands.push('scan'); const re = glob(pattern); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
    async del(...keys) { commands.push('del'); return keys.flat().reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0); },
    async set(key, value) { commands.push('set'); store.set(key, value); return 'OK'; },
    async get(key) { commands.push('get'); return store.has(key) ? store.get(key) : null; },
    async exists(key) { commands.push('exists'); return store.has(key) ? 1 : 0; },
    async eval() { commands.push('eval'); return null; },
    async evalsha() { commands.push('evalsha'); return null; },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});
const mockWindow = { open: false };
jest.mock('../app/services/privacy/orphanSweep', () => {
  const actual = jest.requireActual('../app/services/privacy/orphanSweep');
  return {
    ...actual,
    sweepDeletedAccountOrphans: jest.fn(async (...args) => {
      mockWindow.open = true;
      try {
        return await actual.sweepDeletedAccountOrphans(...args);
      } finally {
        mockWindow.open = false;
      }
    }),
  };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { EJSON } = require('bson');
const User = require('../app/models/User');
const { __fake: redis } = require('../app/config/redis');
const { CASCADE_MODELS, sweepDeletedAccountOrphans } = require('../app/services/privacy/orphanSweep');
const { process: runSessionTrim } = require('../app/workers/sessionTrim.worker');

jest.setTimeout(120000);

const DB = 'kokonada_j2_orphan_nightly';
const READS = new Set(['find', 'aggregate', 'distinct', 'count', 'getMore', 'killCursors', 'endSessions']);
const REDIS_READS = new Set(['scan', 'get', 'exists']);
let mem;
const commands = []; // { name, collection, sweep }

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: DB, monitorCommands: true });
  mongoose.connection.getClient().on('commandStarted', (e) => {
    commands.push({ name: e.commandName, collection: e.command?.[e.commandName], sweep: mockWindow.open });
  });
  await Promise.all([User.init(), ...CASCADE_MODELS.map((m) => m.init())]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});

async function snapshot() {
  const db = mongoose.connection.db;
  const out = {};
  for (const { name } of (await db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
    out[name] = EJSON.stringify(await db.collection(name).find({}).sort({ _id: 1 }).toArray());
  }
  out.__redis = JSON.stringify([...redis.store.entries()].sort());
  return out;
}

it('no marker: the nightly run through processJob reads only, changes nothing and reports the real backlog', async () => {
  const live = await User.create({ ssoProvider: 'google', ssoId: 'sso-nightly-live', email: 'nightly-live@example.com' });
  const gone = new mongoose.Types.ObjectId();
  const now = new Date();
  for (const id of [live._id, gone]) {
    for (const model of CASCADE_MODELS) {
      await model.collection.insertOne({
        userId: id, createdAt: now, servedAt: now, recordedAt: now, date: now, updatedAt: now,
        providerUserId: `p-${id}`, tokenHash: `h-${id}`, seeded: true,
      });
    }
    for (const key of [`ledger:${id}:served`, `pool:${id}:calm`, `buffer:${id}:bio:peak:running`, `bio:baseline:${id}`, `bio:affect:${id}`]) redis.store.set(key, 'x');
  }
  redis.store.set('pool:not-an-id:x', 'x');
  const consentRows = await mongoose.models.ConsentRecord.countDocuments({});
  const lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
  }
  const before = await snapshot();
  commands.length = 0;
  redis.commands.length = 0;

  const out = await runSessionTrim();

  expect(sweepDeletedAccountOrphans).toHaveBeenCalledTimes(1);
  expect(sweepDeletedAccountOrphans).toHaveBeenCalledWith(); // the nightly entry point takes no argument
  expect(out).toEqual(expect.objectContaining({ orphanErasures: 'disabled', orphanBacklog: 2, failures: 0 }));
  expect(lines).toContain('[orphanSweep] disarmed reason=absent backlog=2');
  const sweepCommands = commands.filter((c) => c.sweep);
  expect(sweepCommands.length).toBeGreaterThan(13); // not vacuous: a distinct per collection, the users read, the marker read
  expect(sweepCommands.filter((c) => !READS.has(c.name))).toEqual([]);
  expect(commands.filter((c) => c.collection === 'opsmarkers').map((c) => c.name)).toEqual(['find']);
  expect(redis.commands.filter((c) => !REDIS_READS.has(c))).toEqual([]);
  expect(redis.commands).toContain('scan');
  expect(await snapshot()).toEqual(before);
  expect(await mongoose.models.ConsentRecord.countDocuments({})).toBe(consentRows);
  expect(await mongoose.connection.db.listCollections({ name: 'opsmarkers' }).toArray()).toEqual([]);
});
