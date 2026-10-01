'use strict';

// J1 (BE-074) — what the job queue keeps once a job has run, on a REAL Redis (the lane in
// tests/helpers/realRedis.js; run with REDIS_TEST_URL=redis://127.0.0.1:<port>/15).
//
// Why real: BullMQ decides what to keep inside its Lua finish script (moveToFinished-14.lua), from the
// job's own options or, when the job set none, the worker's. A fake cannot run that script, and the
// trap J1 has to avoid lives in it: a worker-level `removeOnComplete: true` is passed through
// unchanged and the script then reads `keepJobs.count` from a boolean. Only a real server shows it.
//
// Real: Redis, BullMQ, the app's producer (`dispatchReward` -> `queues/queue.enqueue`), the app's
// worker registry (`workers/index.startWorkers`) and the reward worker. Faked: the two Mongo
// repositories the worker writes through, by a small stateful store that records each write and can be
// told to reject with a driver error.

process.env.NODE_ENV = 'test';

jest.mock('../app/repositories/rewardRepo', () => {
  const store = { writes: [], failure: null };
  const write = (kind) => jest.fn(async (args) => {
    if (store.failure) throw store.failure;
    store.writes.push({ kind, userId: args.userId ?? null });
    return true;
  });
  return {
    __store: store,
    recordBucketReward: write('bucket'),
    recordTrackOutcome: write('posterior'),
    recordNoveltyOutcome: write('novelty'),
  };
});
jest.mock('../app/repositories/personalWeightsRepo', () => ({ applyUpdate: jest.fn(async () => true) }));

const { once } = require('events');
const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { QUEUES } = require('../app/queues/definitions');
const { enqueue, closeQueues } = require('../app/queues/queue');
const { startWorkers } = require('../app/workers');
const { dispatchReward } = require('../app/services/learning/rewardDispatch');
const rewardIngest = require('../app/workers/rewardIngest.worker');
const { __store: repo } = require('../app/repositories/rewardRepo');

jest.setTimeout(30000);

const AT = 1_700_000_000_000;
const USER_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const R = 'bull:reward-ingest:';

/** A play that earns a real reward (the fixture tests/rewardDispatch.test.js uses). */
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

/** The duplicate-key error a racing upsert gets from the driver; its message quotes the user and the band. */
const e11000 = () => Object.assign(
  new Error(`E11000 duplicate key error collection: kokonada.rewardevents index: userId_1_bucket.stateDomain_1_bucket.targetBand_1_bucket.hourBin_1 dup key: { userId: ObjectId('${USER_A}'), bucket.stateDomain: "stress", bucket.targetBand: "resting", bucket.hourBin: 3 }`),
  { name: 'MongoServerError', code: 11000 },
);

describeRealRedis('J1 — the job queue keeps no job that has run', (url) => {
  let redis;
  const opened = [];

  /** A plain BullMQ connection of the test's own, closed in afterEach. */
  const connect = () => {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    opened.push(connection);
    return connection;
  };
  let workers = [];
  const closers = [];

  beforeAll(async () => {
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url; // the app's producer and workers connect here
  });
  beforeEach(async () => {
    await flushTestDb(redis);
    repo.writes.length = 0;
    repo.failure = null;
    jest.spyOn(console, 'warn').mockImplementation(() => {}); // the [feedback] telemetry line
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const worker of workers) {
      await worker.close();
      worker.opts.connection.disconnect(); // BullMQ never closes a connection it was handed
    }
    workers = [];
    while (closers.length) await closers.pop()();
    await closeQueues();
    while (opened.length) opened.pop().disconnect();
  });
  afterAll(() => {
    redis.disconnect();
    delete process.env.REDIS_URL;
  });

  const startRewardWorker = () => {
    workers = startWorkers({ [QUEUES.REWARD_INGEST]: rewardIngest.process });
    return workers[0];
  };
  const jobKeys = async () => (await redis.keys(`${R}*`)).filter((k) => /^bull:reward-ingest:\d+(?::|$)/.test(k));

  it('(a) a reward job that ran leaves no job hash and nothing in `completed`', async () => {
    const worker = startRewardWorker();
    const completed = once(worker, 'completed');

    const out = await dispatchReward({ userId: USER_A, play: goodPlay(), atMs: AT });
    const [job] = await completed;

    expect(out.dispatched).toBe(true);
    expect(repo.writes.some((w) => w.kind === 'bucket' && w.userId === USER_A)).toBe(true); // it really ran
    expect(await redis.exists(`${R}${job.id}`)).toBe(0);
    expect(await jobKeys()).toEqual([]);
    expect(await redis.zcard(`${R}completed`)).toBe(0);
  });

  it('(b) a reward job whose write fails leaves no job hash and nothing in `failed`', async () => {
    repo.failure = e11000();
    const worker = startRewardWorker();
    const failed = once(worker, 'failed');

    await dispatchReward({ userId: USER_A, play: goodPlay(), atMs: AT });
    const [job] = await failed;

    expect(await redis.exists(`${R}${job.id}`)).toBe(0);
    expect(await jobKeys()).toEqual([]);
    expect(await redis.zcard(`${R}failed`)).toBe(0);
  });

  // The rolling deploy: a job queued by the code before J1 carries no removal option, so only the
  // worker's own setting can delete it. This is the case a worker-level `true` breaks.
  it('(c) a job added with no options at all (the old producer) is deleted by the worker setting', async () => {
    const oldProducer = new Queue(QUEUES.REWARD_INGEST, { connection: connect() });
    closers.push(() => oldProducer.close());
    const worker = startRewardWorker();
    const completed = once(worker, 'completed');

    const added = await oldProducer.add(QUEUES.REWARD_INGEST, {
      v: 1, userId: USER_A, bucket: { stateDomain: 'stress', targetBand: 'resting', hourBin: 3 }, reward: 0.4, posterior: null, novelty: null, weightStep: null, at: AT,
    });
    const [job] = await completed;

    expect(added.opts.removeOnComplete).toBeUndefined(); // the job itself asked for nothing
    expect(job.id).toBe(added.id);
    expect(await redis.exists(`${R}${job.id}`)).toBe(0);
    expect(await redis.zcard(`${R}completed`)).toBe(0);
  });

  // T3. Deleting the failed job does not delete its reason: BullMQ XADDs it to the events stream in the
  // same script (moveToFinished-14.lua), and that stream keeps about 10,000 entries.
  it('(T3) a failed reward job leaves no user id, band or driver text in the events stream', async () => {
    repo.failure = e11000();
    const worker = startRewardWorker();
    const failed = once(worker, 'failed');

    await dispatchReward({ userId: USER_A, play: goodPlay(), atMs: AT });
    await failed;

    const entries = await redis.xrange(`${R}events`, '-', '+');
    const field = (fields, name) => fields[fields.indexOf(name) + 1];
    const failures = entries.filter(([, fields]) => field(fields, 'event') === 'failed');
    expect(failures).toHaveLength(1);
    expect(field(failures[0][1], 'failedReason')).toBe('reward-ingest write failed (MongoServerError)');
    const stream = JSON.stringify(entries);
    for (const leak of [USER_A, 'resting', 'stress', 'E11000', 'dup key']) expect(stream).not.toContain(leak);
  });

  // Every other queue: a job a producer adds carries the queue's defaults, so it is deleted even by a
  // worker that sets nothing (here a bare BullMQ worker, so only the job's own options can act).
  it.each([
    ['succeeded', async () => ({ ok: true }), 'completed'],
    ['failed', async () => { throw new Error('hydration failed'); }, 'failed'],
  ])('(d) a feature-hydration job that %s is deleted by the queue defaults alone', async (_how, processor, set) => {
    const bare = new Worker(QUEUES.FEATURE_HYDRATION, processor, { connection: connect() });
    closers.push(() => bare.close());
    const finished = once(bare, set);

    const out = await enqueue(QUEUES.FEATURE_HYDRATION, { tracks: [] });
    const [job] = await finished;

    expect(out).toEqual({ queued: true });
    expect(await redis.exists(`bull:${QUEUES.FEATURE_HYDRATION}:${job.id}`)).toBe(0);
    expect(await redis.zcard(`bull:${QUEUES.FEATURE_HYDRATION}:${set}`)).toBe(0);
  });
});
