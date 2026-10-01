'use strict';

// J1 (BE-074) — withdrawing health-data consent removes the user's learning jobs from the job queue,
// on REAL MongoDB (mongodb-memory-server) and a REAL Redis (the lane in tests/helpers/realRedis.js).
//
// Real: the consent router and controller, the withdrawal service with every erasure it runs (the
// session-health purge reaches the same real Redis through the app's own connectRedis client), the
// job purge, the reward producer (`dispatchReward`), BullMQ and both stores. Faked: the socket server
// only (there are no live sockets). No worker runs, so every job stays waiting: the state a withdrawal
// meets when the queue is backed up or the workers are down.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/sockets/index', () => ({ getIo: () => null }));

const express = require('express');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const { RewardEvent } = require('../app/models/RewardEvent');
const rewardRepo = require('../app/repositories/rewardRepo');
const { connectRedis, getRedis } = require('../app/config/redis');
const { closeQueues } = require('../app/queues/queue');
const { dispatchReward } = require('../app/services/learning/rewardDispatch');
const { recordConsent, withdrawConsent, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { signToken } = require('../app/utils/jwt');
const consentRouter = require('../app/routes/consent');

const app = express();
app.use(express.json());
app.use('/api/consent', consentRouter);

jest.setTimeout(120000);

const AT = 1_700_000_000_000;
const R = 'bull:reward-ingest:';
const BUCKET = { stateDomain: 'stress', targetBand: 'resting', hourBin: 3 };
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

describeRealRedis('POST /api/consent/withdraw and the job queue', (url) => {
  let mem;
  let redis;
  let lines;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: 'kokonada_j1_withdrawal' });
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url;
    jest.spyOn(console, 'log').mockImplementation(() => {}); // connectRedis prints "Redis connected"
    await connectRedis(); // the app's own client: the session-health purge and the token denylist use it
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await closeQueues();
    getRedis()?.disconnect();
    redis.disconnect();
    delete process.env.REDIS_URL;
    await mongoose.disconnect();
    await mem.stop();
  });
  beforeEach(async () => {
    await flushTestDb(redis);
    await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({}), RewardEvent.deleteMany({})]);
    lines = [];
    for (const level of ['log', 'info', 'warn', 'error']) {
      jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
    }
  });
  afterEach(() => jest.restoreAllMocks());

  const listener = (tag) => User.create({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  const grant = (user) => recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
  async function seedLearning(user) {
    await rewardRepo.recordBucketReward({ userId: user._id, bucket: BUCKET, reward: 0.5, at: new Date(AT) });
    expect((await dispatchReward({ userId: String(user._id), play: goodPlay(), atMs: AT })).dispatched).toBe(true);
  }
  /** The job ids in the queue whose payload names this user, read straight from Redis. */
  async function jobsOf(user) {
    const ids = [];
    for (const key of await redis.keys(`${R}*`)) {
      if (!/^bull:reward-ingest:\d+$/.test(key)) continue;
      if (JSON.parse(await redis.hget(key, 'data')).userId === String(user._id)) ids.push(key.slice(R.length));
    }
    return ids;
  }
  const withdrawOverHttp = (user) => request(app)
    .post('/api/consent/withdraw')
    .set('Authorization', `Bearer ${signToken({ userId: String(user._id) })}`)
    .send({ purpose: HEALTH_CONSENT_PURPOSE });
  const withdrawalLine = () => lines.find((l) => l.startsWith('[consent-withdrawal]'));

  it('A\'s waiting learning job is gone before the response, B\'s stays, and the line says learningJobs=1', async () => {
    const a = await listener('a');
    const b = await listener('b');
    await grant(a);
    await grant(b);
    await seedLearning(a);
    await seedLearning(b);

    const res = await withdrawOverHttp(a);

    // Read straight after the response: the purge ran before it was written.
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);
    expect(await jobsOf(a)).toEqual([]);
    expect(await jobsOf(b)).toHaveLength(1);
    expect(await RewardEvent.countDocuments({ userId: a._id })).toBe(0);
    expect(await RewardEvent.countDocuments({ userId: b._id })).toBe(1);
    expect(withdrawalLine()).toContain(' providerErasureFailures=0 learningJobs=1 learning=purged rewardEvents=1 ');
  });

  it('the job is already gone when the learned preferences are purged (jobs first)', async () => {
    const a = await listener('a');
    await grant(a);
    await seedLearning(a);
    const [jobId] = await jobsOf(a);
    const seen = [];
    const realDelete = RewardEvent.deleteMany.bind(RewardEvent);
    jest.spyOn(RewardEvent, 'deleteMany').mockImplementation(async (...args) => {
      seen.push(await redis.exists(`${R}${jobId}`));
      return realDelete(...args);
    });

    expect((await withdrawOverHttp(a)).status).toBe(200);

    expect(seen).toEqual([0]);
  });

  it('a mood-only listener (no grant on file) keeps their jobs, and the line says learningJobs=skipped', async () => {
    const m = await listener('mood');
    await seedLearning(m);

    expect((await withdrawOverHttp(m)).status).toBe(200);

    expect(await jobsOf(m)).toHaveLength(1);
    expect(await RewardEvent.countDocuments({ userId: m._id })).toBe(1);
    expect(withdrawalLine()).toContain(' learningJobs=skipped learning=skipped ');
  });

  it('with the job queue unreachable: learning-jobs is a failure, and the withdrawal and the learning purge both stand', async () => {
    const a = await listener('a');
    await grant(a);
    await seedLearning(a);
    process.env.REDIS_URL = 'redis://127.0.0.1:1';

    let out;
    try {
      out = await withdrawConsent(a._id, HEALTH_CONSENT_PURPOSE);
    } finally {
      process.env.REDIS_URL = url;
    }

    expect(out.erasureFailures).toEqual(['learning-jobs']);
    expect((await ConsentRecord.latestFor(a._id, HEALTH_CONSENT_PURPOSE)).status).toBe('withdrawn');
    expect(await RewardEvent.countDocuments({ userId: a._id })).toBe(0);
    expect(withdrawalLine()).toContain(' providerErasureFailures=0 learningJobs=failed learning=purged ');
    expect(await jobsOf(a)).toHaveLength(1); // it could not be reached: it runs, then the queue deletes it
  });
});
