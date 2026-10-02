'use strict';

// J2 (BE-084; Plan B T3, DT-3 E1) — the state-recompute queue's event log keeps only about its last 100
// entries, on a REAL Redis (the lane in tests/helpers/realRedis.js).
//
// Why real: BullMQ keeps the bound in Redis, not in the code that adds jobs. A Queue writes it to the
// queue's meta hash when it is built (`opts.maxLenEvents`, unless `skipMetasUpdate` is set), and every
// Lua script that appends to the log reads it there and trims with `MAXLEN ~` (getOrSetMaxEvents.lua,
// trimEvents.lua). The trim is approximate: Redis drops whole stream nodes of 100 entries, so the log
// holds about 100 to 200. Only a real server runs those scripts.
//
// Real: Redis, BullMQ, the app's producer (`queues/queue.enqueue`) and worker registry
// (`workers/index.startWorkers`). The processor is a stand-in that only returns: the recompute needs
// MongoDB, and what it computes does not change what the log keeps.

process.env.NODE_ENV = 'test';

const IORedis = require('ioredis');
const { Queue } = require('bullmq');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { QUEUES } = require('../app/queues/definitions');
const { enqueue, closeQueues, QUEUE_EVENTS_MAX_LEN } = require('../app/queues/queue');
const { startWorkers } = require('../app/workers');

jest.setTimeout(60000);

const STATE = QUEUES.STATE_VECTOR_RECOMPUTE;
const META = `bull:${STATE}:meta`;
const EVENTS = `bull:${STATE}:events`;
const hex = (i) => i.toString(16).padStart(24, '0');

/** Stream ids are `<ms>-<seq>`; compares two of them numerically. */
const after = (a, b) => {
  const [am, as] = a.split('-').map(BigInt);
  const [bm, bs] = b.split('-').map(BigInt);
  return am > bm || (am === bm && as > bs);
};

async function until(check, what) {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('QUEUE_EVENTS_MAX_LEN', () => {
  it('bounds the state-recompute log at 100, and no other queue\'s', () => {
    expect(QUEUE_EVENTS_MAX_LEN).toEqual({ [STATE]: 100 });
    expect(Object.isFrozen(QUEUE_EVENTS_MAX_LEN)).toBe(true);
  });
});

describeRealRedis('J2 E1: the state-recompute event log is bounded', (url) => {
  let redis;
  const opened = [];
  let workers = [];
  const connect = () => {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    opened.push(connection);
    return connection;
  };

  beforeAll(async () => {
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url; // the app's producer and workers connect here
  });
  beforeEach(() => flushTestDb(redis));
  afterEach(async () => {
    for (const worker of workers) {
      await worker.close();
      worker.opts.connection.disconnect(); // BullMQ never closes a connection it was handed
    }
    workers = [];
    await closeQueues();
    while (opened.length) opened.pop().disconnect();
  });
  afterAll(() => {
    redis?.disconnect();
    delete process.env.REDIS_URL;
  });

  it('after the first enqueue, the queue\'s meta holds opts.maxLenEvents = 100', async () => {
    await expect(enqueue(STATE, { userId: hex(1) }, { delay: 60_000 })).resolves.toEqual({ queued: true });

    expect(await redis.hget(META, 'opts.maxLenEvents')).toBe('100');
  });

  it('every other queue keeps BullMQ\'s default of 10000', async () => {
    await expect(enqueue(QUEUES.FEATURE_HYDRATION, { tracks: [] })).resolves.toEqual({ queued: true });

    expect(await redis.hget(`bull:${QUEUES.FEATURE_HYDRATION}:meta`, 'opts.maxLenEvents')).toBe('10000');
  });

  it('after 300 jobs are queued and run, the log holds at most 200 entries and the oldest are gone', async () => {
    workers = startWorkers({ [STATE]: async () => ({ done: true }) });
    let finished = 0;
    workers[0].on('completed', () => { finished += 1; });

    await enqueue(STATE, { userId: hex(0) });
    const [[first]] = await redis.xrange(EVENTS, '-', '+', 'COUNT', 1);
    for (let i = 1; i < 300; i += 1) await enqueue(STATE, { userId: hex(i) });
    await until(() => finished === 300, 'the 300 jobs to run');

    const held = await redis.xlen(EVENTS);
    expect(held).toBeGreaterThan(0);
    expect(held).toBeLessThanOrEqual(200);
    const [[oldest]] = await redis.xrange(EVENTS, '-', '+', 'COUNT', 1);
    expect(after(oldest, first)).toBe(true);
    // Not vacuous: the 300 jobs wrote far more than 200 entries (each is added, waits, runs and finishes).
    const [[newest]] = await redis.xrevrange(EVENTS, '+', '-', 'COUNT', 1);
    expect(after(newest, first)).toBe(true);
  });

  // The premise of the structural guard (tests/queueMetaWriters.structural.test.js): a Queue built
  // without skipMetasUpdate rewrites the meta with its own options, and BullMQ's default is 10000.
  it('a Queue built with skipMetasUpdate leaves the bound alone; one built without it resets it to 10000', async () => {
    await enqueue(STATE, { userId: hex(1) }, { delay: 60_000 });
    expect(await redis.hget(META, 'opts.maxLenEvents')).toBe('100');

    const reader = new Queue(STATE, { connection: connect(), skipMetasUpdate: true });
    await reader.getJobCounts('delayed'); // one round trip after it is ready: its meta write, if any, came first
    await reader.close();
    expect(await redis.hget(META, 'opts.maxLenEvents')).toBe('100');

    const careless = new Queue(STATE, { connection: connect() });
    await careless.getJobCounts('delayed');
    await careless.close();
    expect(await redis.hget(META, 'opts.maxLenEvents')).toBe('10000');
  });
});
