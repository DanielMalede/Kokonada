'use strict';

// J1 (BE-074) — DELETE /api/auth/account removes the account's learning jobs from the job queue, on
// REAL MongoDB (mongodb-memory-server) and a REAL Redis (the lane in tests/helpers/realRedis.js).
//
// Real: the controller, the erasure cascade, the purge, the reward producer (`dispatchReward`), BullMQ
// and both stores. Faked: the socket server (there are no live sockets here) and the two sign-in SDKs
// the controller builds at load. No worker runs, so every job stays waiting: the state a deletion
// meets when the queue is backed up or the workers are down.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/sockets/index', () => ({ getIo: () => null }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const User = require('../app/models/User');
const { RewardEvent } = require('../app/models/RewardEvent');
const rewardRepo = require('../app/repositories/rewardRepo');
const { closeQueues } = require('../app/queues/queue');
const { dispatchReward } = require('../app/services/learning/rewardDispatch');
const { deleteAccount } = require('../app/controllers/authController');

jest.setTimeout(120000);

const AT = 1_700_000_000_000;
const R = 'bull:reward-ingest:';
const goodPlay = () => ({
  samples: Array.from({ length: 40 }, (_, i) => ({ atMs: AT - 240_000 + i * 6_000, value: 90 - i * 0.5 })),
  expectedSlope: 0,
  archetype: 'meet-then-lower',
  events: [{ type: 'complete', positionMs: 240_000 }],
  stateId: 'acute-stress',
  targetBand: 'resting',
  hourOfDay: 21,
  recordingKey: 'mbid:9f4a',
});
const BUCKET = { stateDomain: 'stress', targetBand: 'resting', hourBin: 3 };

describeRealRedis('DELETE /api/auth/account and the job queue', (url) => {
  let mem;
  let redis;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: 'kokonada_j1_deletion' });
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url;
  });
  afterAll(async () => {
    await closeQueues();
    redis.disconnect();
    delete process.env.REDIS_URL;
    await mongoose.disconnect();
    await mem.stop();
  });
  beforeEach(async () => {
    await flushTestDb(redis);
    await Promise.all([User.deleteMany({}), RewardEvent.deleteMany({})]);
    jest.spyOn(console, 'warn').mockImplementation(() => {}); // the [feedback] telemetry line
  });
  afterEach(() => jest.restoreAllMocks());

  const listener = (tag) => User.create({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  /** The job ids in the queue whose payload names this user, read straight from Redis. */
  async function jobsOf(user) {
    const ids = [];
    for (const key of await redis.keys(`${R}*`)) {
      if (!/^bull:reward-ingest:\d+$/.test(key)) continue;
      const data = JSON.parse(await redis.hget(key, 'data'));
      if (data.userId === String(user._id)) ids.push(key.slice(R.length));
    }
    return ids;
  }
  async function seedLearning(user) {
    await rewardRepo.recordBucketReward({ userId: user._id, bucket: BUCKET, reward: 0.5, at: new Date(AT) });
    expect((await dispatchReward({ userId: String(user._id), play: goodPlay(), atMs: AT })).dispatched).toBe(true);
  }
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

  it('A\'s waiting learning job is gone before the response, B\'s stays, and A\'s learning rows are gone', async () => {
    const a = await listener('a');
    const b = await listener('b');
    await seedLearning(a);
    await seedLearning(b);
    expect(await jobsOf(a)).toHaveLength(1);
    expect(await jobsOf(b)).toHaveLength(1);
    const reply = res();
    const next = jest.fn();

    await deleteAccount({ user: { _id: a._id }, auth: {} }, reply, next);

    expect(next).not.toHaveBeenCalled();
    expect(reply.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/permanently deleted/i) }));
    expect(await jobsOf(a)).toEqual([]);
    expect(await jobsOf(b)).toHaveLength(1);
    expect(await redis.lrange(`${R}wait`, 0, -1)).toEqual(await jobsOf(b));
    expect(await RewardEvent.countDocuments({ userId: a._id })).toBe(0);
    expect(await RewardEvent.countDocuments({ userId: b._id })).toBe(1);
    expect(await User.exists({ _id: a._id })).toBeNull();
  });

  it('the job is already gone when the learning rows are deleted (jobs first)', async () => {
    const a = await listener('a');
    await seedLearning(a);
    const [jobId] = await jobsOf(a);
    const seen = [];
    const realDelete = RewardEvent.deleteMany.bind(RewardEvent);
    jest.spyOn(RewardEvent, 'deleteMany').mockImplementation(async (...args) => {
      seen.push(await redis.exists(`${R}${jobId}`));
      return realDelete(...args);
    });

    await deleteAccount({ user: { _id: a._id }, auth: {} }, res(), jest.fn());

    expect(seen).toEqual([0]);
  });

  it('with the job queue unreachable, the account is still deleted and one fixed line is logged', async () => {
    const a = await listener('a');
    await seedLearning(a);
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const logged = [];
    jest.spyOn(console, 'error').mockImplementation((...args) => { logged.push(args.map(String).join(' ')); });
    const reply = res();

    try {
      await deleteAccount({ user: { _id: a._id }, auth: {} }, reply, jest.fn());
    } finally {
      process.env.REDIS_URL = url;
    }

    expect(reply.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/permanently deleted/i) }));
    expect(await User.exists({ _id: a._id })).toBeNull();
    expect(await RewardEvent.countDocuments({ userId: a._id })).toBe(0);
    expect(logged).toEqual(['[account-deletion] learning-jobs purge failed (Error)']);
    expect(await jobsOf(a)).toHaveLength(1); // the job could not be reached: it runs, then the queue deletes it
  });
});
