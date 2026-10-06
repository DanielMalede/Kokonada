'use strict';

// J2 (BE-087, BE-084; Plan B T5) — the state-recompute job through a REAL BullMQ Worker on a REAL Redis (the
// lane in tests/helpers/realRedis.js) and a REAL MongoDB (mongodb-memory-server, test commands on).
//
// What only a real queue shows: the value BullMQ stores and logs for a finished job, the reason it logs for
// a failed one (moveToFinished-14.lua writes both into the event log next to the job id), and a re-run of a
// job whose account was deleted after an earlier run was killed. The same logic with a stateful in-memory
// Redis is stateVectorFence.integration.test.js.
//
// Real: Redis, BullMQ, the app's worker registry and the state-recompute worker, the app's own Redis client
// (config/redis.connectRedis), MongoDB, the gate.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.WAVE4_AFFECT_DISABLED;

const { once } = require('events');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { connectRedis, getRedis } = require('../app/config/redis');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const MedicalProfile = require('../app/models/MedicalProfile');
const { QUEUES } = require('../app/queues/definitions');
const { enqueue, closeQueues } = require('../app/queues/queue');
const { startWorkers } = require('../app/workers');
const stateVector = require('../app/workers/stateVector.worker');
const { stateVectorJobOptions, STATE_JOB_RESULT } = require('../app/queues/stateVectorJob');
const { HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION } = require('../app/services/privacy/consent');

jest.setTimeout(120000);

const DB = 'kokonada_j2_state_worker';
const S = `bull:${QUEUES.STATE_VECTOR_RECOMPUTE}:`;
const field = (fields, name) => fields[fields.indexOf(name) + 1];

describeRealRedis('J2 T5: the state-recompute job on a real queue', (url) => {
  let mem;
  let redis;
  let workers = [];

  beforeAll(async () => {
    mem = await MongoMemoryServer.create({ instance: { args: ['--setParameter', 'enableTestCommands=1'] } });
    await mongoose.connect(mem.getUri(), { dbName: DB });
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
    await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({}), MedicalProfile.deleteMany({})]);
  });
  afterEach(async () => {
    for (const worker of workers) {
      await worker.close();
      worker.opts.connection.disconnect();
    }
    workers = [];
    await mongoose.connection.db.admin().command({ configureFailPoint: 'failCommand', mode: 'off' });
  });

  const startStateWorker = () => {
    workers = startWorkers({ [QUEUES.STATE_VECTOR_RECOMPUTE]: stateVector.process });
    return workers[0];
  };

  it('a re-run for an account deleted after a killed run removes the profile and both keys; the stored result is the constant', async () => {
    const gone = new mongoose.Types.ObjectId();
    await MedicalProfile.create({ userId: gone });
    await redis.set(`bio:baseline:${gone}`, 'x');
    await redis.set(`bio:affect:${gone}`, 'x');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const worker = startStateWorker();
    const completed = once(worker, 'completed');

    await enqueue(QUEUES.STATE_VECTOR_RECOMPUTE, { userId: String(gone) }, stateVectorJobOptions(gone, 0));
    const [, returned] = await completed;

    expect(returned).toEqual(STATE_JOB_RESULT);
    expect(await MedicalProfile.countDocuments({ userId: gone })).toBe(0);
    expect(await redis.exists(`bio:baseline:${gone}`, `bio:affect:${gone}`)).toBe(0);
    expect(warn.mock.calls.map((c) => c.join(' '))).toContain('[stateVector] compensating-undo reason=user_missing outcome=undone');
    const entries = await redis.xrange(`${S}events`, '-', '+');
    const done = entries.filter(([, f]) => field(f, 'event') === 'completed');
    expect(done).toHaveLength(1);
    expect(field(done[0][1], 'returnvalue')).toBe(JSON.stringify(STATE_JOB_RESULT));
    expect(JSON.stringify(entries)).not.toMatch(/[0-9a-fA-F]{24}/);
  });

  it('a failed job leaves its reason as the error\'s type only, and no 24-hex anywhere in the event log', async () => {
    const user = await User.create({ ssoProvider: 'google', ssoId: 'sso-sv-fail', email: 'sv-fail@example.com' });
    await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date() });
    await mongoose.connection.db.admin().command({
      configureFailPoint: 'failCommand',
      mode: 'alwaysOn',
      data: { failCommands: ['findAndModify'], errorCode: 2, namespace: `${DB}.medicalprofiles` },
    });
    const worker = startStateWorker();
    const failed = once(worker, 'failed');

    await enqueue(QUEUES.STATE_VECTOR_RECOMPUTE, { userId: String(user._id) }, stateVectorJobOptions(user._id, 0));
    const [, err] = await failed;

    expect(err.message).toBe('state-vector recompute failed (MongoServerError)');
    const entries = await redis.xrange(`${S}events`, '-', '+');
    const failures = entries.filter(([, f]) => field(f, 'event') === 'failed');
    expect(failures).toHaveLength(1);
    expect(field(failures[0][1], 'failedReason')).toBe('state-vector recompute failed (MongoServerError)');
    expect(JSON.stringify(entries)).not.toMatch(/[0-9a-fA-F]{24}/);
    expect(await redis.zcard(`${S}failed`)).toBe(0); // deleted once it has run (J1)
  });
});
