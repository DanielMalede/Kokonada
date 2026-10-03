'use strict';

// J2 (BE-087; Plan B T11) — the compliance-auditor's #verify, taken literally, on a REAL Redis (the lane in
// tests/helpers/realRedis.js), a REAL BullMQ Worker and a REAL MongoDB. SLOW: each case waits out the real
// 60-second delay a health-data sync queues its state recompute with.
//
//   1. A sync, then the account deleted within 60 s: 70 s later no MedicalProfile and no bio: key exists
//      for that id.
//   2. The same with the health-data consent withdrawn instead.
//   3. The same deletion while the job queue cannot be reached (the purge fails): the job survives, runs,
//      and the gate refuses it.
//
// Real: Redis, BullMQ, the app's worker registry and the state-recompute worker, the ingest path, the
// deletion controller and cascade, the withdrawal, the app's Redis client, MongoDB.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
delete process.env.WAVE4_AFFECT_DISABLED;

jest.mock('../app/sockets/index', () => ({ getIo: () => null }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { connectRedis, getRedis } = require('../app/config/redis');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const MedicalProfile = require('../app/models/MedicalProfile');
const { QUEUES } = require('../app/queues/definitions');
const { closeQueues } = require('../app/queues/queue');
const { startWorkers } = require('../app/workers');
const stateVector = require('../app/workers/stateVector.worker');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const { deleteAccount } = require('../app/controllers/authController');
const { withdrawConsent, HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION } = require('../app/services/privacy/consent');

jest.setTimeout(180000);

const WAIT_MS = 70_000;
const S = `bull:${QUEUES.STATE_VECTOR_RECOMPUTE}:`;

describeRealRedis('J2 T11: the #verify, literally (slow)', (url) => {
  let mem;
  let redis;
  let workers = [];

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri(), { dbName: 'kokonada_j2_acceptance' });
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url;
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
    await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({}), MedicalProfile.deleteMany({})]);
    for (const level of ['log', 'info', 'warn', 'error']) jest.spyOn(console, level).mockImplementation(() => {});
    workers = startWorkers({ [QUEUES.STATE_VECTOR_RECOMPUTE]: stateVector.process });
  });
  afterEach(async () => {
    for (const worker of workers) {
      await worker.close();
      worker.opts.connection.disconnect();
    }
    workers = [];
    jest.restoreAllMocks();
  });

  async function grantedUserWithSync() {
    const user = await User.create({ ssoProvider: 'google', ssoId: `sso-acc-${Date.now()}`, email: `acc-${Date.now()}@example.com` });
    await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date() });
    await persistMetrics(user._id, [{ metric: 'restingHeartRate', value: 58, unit: 'bpm', recordedAt: new Date(Date.now() - 3600_000), source: 'health_connect' }]);
    expect(await redis.zcard(`${S}delayed`)).toBe(1); // the recompute is queued, 60 s out
    return user;
  }
  const leftovers = async (id) => ({
    profiles: await MedicalProfile.countDocuments({ userId: id }),
    keys: await redis.exists(`bio:baseline:${id}`, `bio:affect:${id}`),
  });
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  const wait = () => new Promise((r) => setTimeout(r, WAIT_MS));

  it('1. deleted within 60 s: after 70 s nothing is left under the id', async () => {
    const user = await grantedUserWithSync();
    await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());
    await wait();
    expect(await leftovers(user._id)).toEqual({ profiles: 0, keys: 0 });
  });

  it('2. consent withdrawn within 60 s: after 70 s nothing is left under the id', async () => {
    const user = await grantedUserWithSync();
    await withdrawConsent(user._id, HEALTH_CONSENT_PURPOSE);
    await wait();
    expect(await leftovers(user._id)).toEqual({ profiles: 0, keys: 0 });
  });

  it('3. deleted while the job queue cannot be reached: the job survives, runs, is refused, and nothing is left', async () => {
    const user = await grantedUserWithSync();
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    try {
      await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());
    } finally {
      process.env.REDIS_URL = url;
    }
    expect(await redis.zcard(`${S}delayed`)).toBe(1); // the purge did not reach it
    await wait();
    expect(await leftovers(user._id)).toEqual({ profiles: 0, keys: 0 });
  });
});
