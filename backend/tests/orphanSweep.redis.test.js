'use strict';

// J2 (BE-094; Plan B T9) — the daily sweep of deleted accounts' data on a REAL Redis (the lane in
// tests/helpers/realRedis.js) and a REAL MongoDB (mongodb-memory-server).
//
// What only a real Redis shows: the discovery SCAN over the real keyspace, the job purge inside the cascade
// removing a deleted account's WAITING job from a real BullMQ queue, and the strict purge. A key whose id
// cannot be an ObjectId sits next to a real orphan: it is purged as keys only, and the run goes on.
// The same sweep with a stateful in-memory Redis is orphanSweep.integration.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.ORPHAN_SWEEP_DISABLED;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { connectRedis, getRedis } = require('../app/config/redis');
const User = require('../app/models/User');
const ServeEvent = require('../app/models/ServeEvent');
const { QUEUES } = require('../app/queues/definitions');
const { enqueue, closeQueues } = require('../app/queues/queue');
const { sweepDeletedAccountOrphans } = require('../app/services/privacy/orphanSweep');

jest.setTimeout(120000);

const R = `bull:${QUEUES.REWARD_INGEST}:`;
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
    await Promise.all([User.deleteMany({}), ServeEvent.deleteMany({})]);
  });

  async function jobOwners() {
    const owners = [];
    for (const key of await redis.keys(`${R}*`)) {
      if (/^bull:reward-ingest:\d+$/.test(key)) owners.push(JSON.parse(await redis.hget(key, 'data')).userId);
    }
    return owners.sort();
  }

  it('a deleted account\'s rows, keys and waiting job go; a key under a non-ObjectId id goes too; a live account keeps everything', async () => {
    const live = await User.create({ ssoProvider: 'google', ssoId: 'sso-live', email: 'live@example.com' });
    const gone = String(new mongoose.Types.ObjectId());
    for (const id of [String(live._id), gone]) {
      await ServeEvent.collection.insertOne({ userId: new mongoose.Types.ObjectId(id), seeded: true });
      for (const key of KEYS(id)) await redis.set(key, 'x');
      await expect(enqueue(QUEUES.REWARD_INGEST, payload(id))).resolves.toEqual({ queued: true });
    }
    await redis.set('ledger:guest:served', 'x');

    const out = await sweepDeletedAccountOrphans();

    expect(out).toEqual(expect.objectContaining({ erased: 2, failed: 0, backlog: 0 }));
    expect(await ServeEvent.countDocuments({ userId: gone })).toBe(0);
    expect(await redis.exists(...KEYS(gone))).toBe(0);
    expect(await redis.exists('ledger:guest:served')).toBe(0);
    expect(await jobOwners()).toEqual([String(live._id)]);
    expect(await ServeEvent.countDocuments({ userId: live._id })).toBe(1);
    expect(await redis.exists(...KEYS(String(live._id)))).toBe(5);
  });
});
