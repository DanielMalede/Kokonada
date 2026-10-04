'use strict';

// J2 (BE-094; Plan B T9, DT-13 FINAL §F 1 and §F 8) — the sweep of deleted accounts' data on a REAL Redis (the
// lane in tests/helpers/realRedis.js) and a REAL MongoDB (mongodb-memory-server).
//
// What only a real Redis shows: the discovery SCAN over the real keyspace, the job purge inside the cascade
// removing a deleted account's WAITING job from a real BullMQ queue, the strict purge, and — under MONITOR —
// that a disarmed nightly run sends Redis nothing but SCAN and reads. The same sweep with a stateful
// in-memory Redis is orphanSweep.integration.test.js and orphanSweepNightly.integration.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.ORPHAN_SWEEP_DISABLED;

const IORedis = require('ioredis');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { connectRedis, getRedis } = require('../app/config/redis');
const User = require('../app/models/User');
const ServeEvent = require('../app/models/ServeEvent');
const { QUEUES } = require('../app/queues/definitions');
const { enqueue, closeQueues } = require('../app/queues/queue');
const {
  sweepDeletedAccountOrphans, armOrphanSweep, disarmOrphanSweep, orphanSetFingerprint,
} = require('../app/services/privacy/orphanSweep');
const { process: runSessionTrim } = require('../app/workers/sessionTrim.worker');

jest.setTimeout(120000);

const R = `bull:${QUEUES.REWARD_INGEST}:`;
const ARM = { confirm: 'arm-orphan-sweep', recordSha256: 'f'.repeat(64), deployedCommit: 'c'.repeat(40) };
const KEYS = (id) => [`ledger:${id}:served`, `pool:${id}:calm`, `buffer:${id}:bio:peak:running`, `bio:baseline:${id}`, `bio:affect:${id}`];
const payload = (userId) => ({
  v: 1, userId, bucket: { stateDomain: 'stress', targetBand: 'resting', hourBin: 3 }, reward: 0.4, posterior: null, novelty: null, weightStep: null, at: 1_700_000_000_000,
});

describeRealRedis('J2 T9: the orphan sweep on a real Redis', (url) => {
  let mem;
  let redis;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: 'kokonada_j2_orphan_redis' });
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url;
    jest.spyOn(console, 'log').mockImplementation(() => {}); // 'Redis connected'
    await connectRedis();
  });
  afterAll(async () => {
    await closeQueues();
    getRedis()?.disconnect();
    redis?.disconnect();
    delete process.env.REDIS_URL;
    await mongoose.disconnect();
    await mem?.stop();
  });
  beforeEach(async () => {
    await flushTestDb(redis);
    await Promise.all([User.deleteMany({}), ServeEvent.deleteMany({}), disarmOrphanSweep()]);
  });

  async function jobOwners() {
    const owners = [];
    for (const key of await redis.keys(`${R}*`)) {
      if (/^bull:reward-ingest:\d+$/.test(key)) owners.push(JSON.parse(await redis.hget(key, 'data')).userId);
    }
    return owners.sort();
  }
  async function seed() {
    const live = await User.create({ ssoProvider: 'google', ssoId: 'sso-live', email: 'live@example.com' });
    const gone = String(new mongoose.Types.ObjectId());
    for (const id of [String(live._id), gone]) {
      await ServeEvent.collection.insertOne({ userId: new mongoose.Types.ObjectId(id), seeded: true });
      for (const key of KEYS(id)) await redis.set(key, 'x');
      await expect(enqueue(QUEUES.REWARD_INGEST, payload(id))).resolves.toEqual({ queued: true });
    }
    await redis.set('pool:not-an-id:x', 'x');
    return { live: String(live._id), gone };
  }

  it('§F 1 on a real Redis: a disarmed nightly run sends Redis only SCAN and reads, under MONITOR', async () => {
    await seed();
    const monitor = await new IORedis(url, { lazyConnect: true }).monitor();
    const seen = [];
    monitor.on('monitor', (_time, args) => seen.push(String(args[0]).toLowerCase()));

    const out = await runSessionTrim();
    await new Promise((r) => setTimeout(r, 200));
    monitor.disconnect();

    expect(out).toEqual(expect.objectContaining({ orphanErasures: 'disabled', orphanBacklog: 2 }));
    expect(seen).toContain('scan');
    expect(seen.filter((c) => !['scan', 'get', 'exists', 'select', 'client', 'info', 'time', 'xtrim'].includes(c))).toEqual([]);
    expect(await redis.exists('pool:not-an-id:x')).toBe(1);
  });

  it('armed: a deleted account\'s rows, keys and waiting job go; a key under a non-ObjectId id goes too; a live account keeps everything', async () => {
    await User.create({ ssoProvider: 'google', ssoId: 'sso-first', email: 'first@example.com' });
    await armOrphanSweep(ARM);
    const { live, gone } = await seed();

    await expect(sweepDeletedAccountOrphans()).resolves.toEqual({ count: 2, backlog: 0, failed: 0 });

    expect(await ServeEvent.countDocuments({ userId: gone })).toBe(0);
    expect(await redis.exists(...KEYS(gone))).toBe(0);
    expect(await redis.exists('pool:not-an-id:x')).toBe(0);
    expect(await jobOwners()).toEqual([live]);
    expect(await ServeEvent.countDocuments({ userId: live })).toBe(1);
    expect(await redis.exists(...KEYS(live))).toBe(5);
  });

  it('§F 8 forced: the exact count and set clear the non-ObjectId key in Redis only, then arming succeeds', async () => {
    const { gone } = await seed();
    await expect(armOrphanSweep(ARM)).rejects.toEqual(expect.objectContaining({ reason: 'orphans', orphans: 2 }));

    await expect(sweepDeletedAccountOrphans({ force: true, expectedOrphans: 2, expectedSet: orphanSetFingerprint([gone, 'not-an-id']) }))
      .resolves.toEqual({ count: 2, backlog: 0, failed: 0 });

    expect(await redis.exists('pool:not-an-id:x')).toBe(0);
    await expect(armOrphanSweep(ARM)).resolves.toEqual({ armed: true, v: 1 });
  });
});
