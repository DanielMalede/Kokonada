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

  // NF-A (the privacy-page re-check): the serving lane queues a recompute for any account whose baseline
  // is not cached, whatever its consent. Cases 4 and 5 run that job to the end and show the gate keeps it
  // from reading or writing any health data. The job is promoted instead of waiting out its 5 seconds.
  describe('NF-A: a playlist for an account without a current grant', () => {
    const IORedis = require('ioredis');
    const { Queue } = require('bullmq');
    const MorningState = require('../app/models/MorningState');
    const baselinesService = require('../app/services/biosonic/baselines');
    const { buildTargets } = require('../app/services/generation/targetsBuilder');

    const logged = () => ['log', 'info', 'warn', 'error'].flatMap((level) => console[level].mock.calls.map((c) => c.map(String).join(' ')));
    async function promoteAndRun(jobId) {
      const connection = new IORedis(url, { maxRetriesPerRequest: null });
      const queue = new Queue(QUEUES.STATE_VECTOR_RECOMPUTE, { connection, skipMetasUpdate: true });
      try {
        await (await queue.getJob(jobId)).promote();
        const deadline = Date.now() + 30_000;
        while (await redis.exists(`${S}${jobId}`)) {
          if (Date.now() > deadline) throw new Error('the promoted job never ran');
          await new Promise((r) => setTimeout(r, 50));
        }
      } finally {
        await queue.close();
        connection.disconnect();
      }
    }
    /** The playlist, then its one queued recompute run to the end; what the job did is returned. */
    async function playlistThenJob(user) {
      baselinesService._resetRefreshCooldown();
      for (const level of ['log', 'info', 'warn', 'error']) console[level].mockClear();
      const compute = jest.spyOn(baselinesService, 'computeBaselines');

      const targets = await buildTargets({ userId: String(user._id), moodKey: 'calm' });
      expect(targets).toEqual(expect.objectContaining({ hourOfDay: expect.any(Number) }));

      // The serving lane queues the refresh without awaiting it (baselines._scheduleRefresh), so it lands
      // a moment after buildTargets returns.
      const deadline = Date.now() + 10_000;
      while ((await redis.zcard(`${S}delayed`)) === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 100)); // and nothing else is still landing
      const delayed = await redis.zrange(`${S}delayed`, 0, -1);
      expect(delayed).toHaveLength(1);
      expect(JSON.parse(await redis.hget(`${S}${delayed[0]}`, 'data'))).toEqual({ userId: String(user._id) });
      await promoteAndRun(delayed[0]);
      return { compute, lines: logged() };
    }
    function expectNothingRead(user, { compute, lines }) {
      expect(compute).not.toHaveBeenCalled();
      expect(lines.filter((l) => l.startsWith('[biometric-access]'))).toEqual([]);
      expect(lines.filter((l) => l.startsWith('[stateVector]'))).toEqual([]);
      return Promise.all([
        expect(redis.exists(`bio:baseline:${user._id}`)).resolves.toBe(0),
        expect(MorningState.countDocuments({ userId: user._id })).resolves.toBe(0),
      ]);
    }

    it('4. never granted: the playlist queues one job, which runs and writes no health data', async () => {
      const user = await User.create({ ssoProvider: 'google', ssoId: 'sso-nfa-never', email: 'nfa-never@example.com' });
      expect(await ConsentRecord.countDocuments({ userId: user._id })).toBe(0);
      expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);

      const run = await playlistThenJob(user);

      expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
      await expectNothingRead(user, run);
    });

    it('5. granted, then withdrawn: the playlist that follows leaves the profile count as the withdrawal left it', async () => {
      const user = await User.create({ ssoProvider: 'google', ssoId: 'sso-nfa-withdrawn', email: 'nfa-withdrawn@example.com' });
      await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date() });
      await MedicalProfile.create({ userId: user._id, fitnessLevel: 'active' });
      await withdrawConsent(user._id, HEALTH_CONSENT_PURPOSE);
      const afterWithdrawal = await MedicalProfile.countDocuments({ userId: user._id });

      const run = await playlistThenJob(user);

      expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(afterWithdrawal);
      await expectNothingRead(user, run);
    });
  });
});
