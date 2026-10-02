'use strict';

// J1 (BE-074) — erasing one account's jobs from the job queue (app/queues/userJobPurge.js).
//
// Two halves. The first runs on a REAL Redis (the lane in tests/helpers/realRedis.js): BullMQ lists
// and removes jobs with Lua scripts, a removal refuses a job whose lock a worker holds, and only a real
// server shows either. Its seed is the backlog the code before J1 left, made the way that code made it:
// a queue and a worker with no removal option, so finished jobs stay. The second half needs no Redis
// and runs on every `npm test`: what the purge does when the job queue cannot be reached, which is the
// case that decides whether an account deletion can hang.

process.env.NODE_ENV = 'test';

const net = require('net');
const { once } = require('events');
const IORedis = require('ioredis');
const mongoose = require('mongoose');
const { Queue, Worker } = require('bullmq');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { QUEUES } = require('../app/queues/definitions');
const { enqueue, closeQueues } = require('../app/queues/queue');
const { startWorkers } = require('../app/workers');
const {
  purgeUserJobs, countUserJobs, USER_JOB_QUEUES, PURGE_BUDGET_MS,
} = require('../app/queues/userJobPurge');

jest.setTimeout(30000);

const USER_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const NAME = QUEUES.REWARD_INGEST;
const R = `bull:${NAME}:`;
const payload = (userId) => ({
  v: 1, userId, bucket: { stateDomain: 'stress', targetBand: 'resting', hourBin: 3 }, reward: 0.4, posterior: null, novelty: null, weightStep: null, at: 1_700_000_000_000,
});

async function until(check, what) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('USER_JOB_QUEUES', () => {
  it('registers the learning jobs, owned by the job payload\'s userId', () => {
    expect(USER_JOB_QUEUES.map((q) => q.name)).toEqual([QUEUES.REWARD_INGEST]);
    const [reward] = USER_JOB_QUEUES;
    expect(reward.ownerOf({ userId: USER_A })).toBe(USER_A);
    expect(reward.ownerOf({})).toBeUndefined();
    expect(reward.ownerOf(null)).toBeUndefined();
    expect(Object.isFrozen(USER_JOB_QUEUES)).toBe(true);
  });

  it('keeps the purge within 3 seconds', () => {
    expect(PURGE_BUDGET_MS).toBeLessThanOrEqual(3000);
  });
});

describe('without REDIS_URL nothing can have been queued (enqueue is a no-op), so nothing is purged', () => {
  const saved = process.env.REDIS_URL;
  beforeEach(() => { delete process.env.REDIS_URL; });
  afterEach(() => { if (saved !== undefined) process.env.REDIS_URL = saved; });

  it('purge and count answer zero and open no connection', async () => {
    const before = process.getActiveResourcesInfo().filter((t) => t === 'TCPSocketWrap').length;

    await expect(purgeUserJobs(USER_A)).resolves.toEqual({ removed: 0, inFlight: 0 });
    await expect(countUserJobs(USER_A)).resolves.toEqual({ jobs: 0, inFlight: 0 });

    expect(process.getActiveResourcesInfo().filter((t) => t === 'TCPSocketWrap').length).toBe(before);
  });

  it.each([[''], ['   '], [null], [undefined]])('still refuses a blank user id (%p)', async (id) => {
    await expect(purgeUserJobs(id)).rejects.toThrow(/without a user id/);
    await expect(countUserJobs(id)).rejects.toThrow(/without a user id/);
  });
});

// The F1 rule: the purge is best-effort and reported, so it must FAIL — fast, with nothing left open —
// rather than wait. BullMQ alone would wait for ever: a new queue's readiness check only gives up when
// its connection ends, and a default connection retries for ever.
describe('when the job queue cannot be reached, the purge fails within 3 s and leaves no socket open', () => {
  const saved = process.env.REDIS_URL;
  afterEach(() => { if (saved === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = saved; });

  const openSockets = () => process.getActiveResourcesInfo().filter((t) => t === 'TCPSocketWrap').length;
  const settle = () => new Promise((r) => setTimeout(r, 300));
  // The error comes from Node's own realm (net), so jest's sandboxed `Error` is not its constructor.
  const isError = (e) => Object.prototype.toString.call(e) === '[object Error]';
  const timed = async (fn) => {
    const t0 = Date.now();
    const err = await fn().then(() => null, (e) => e);
    return { err, ms: Date.now() - t0 };
  };

  it('nothing listening on the port: purge and count reject at once', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    const before = openSockets();

    const purge = await timed(() => purgeUserJobs(USER_A));
    const count = await timed(() => countUserJobs(USER_A));
    await settle();

    expect(isError(purge.err)).toBe(true);
    expect(isError(count.err)).toBe(true);
    // At once, not at the budget: a connection that retried would end only when the 2.5 s budget fired.
    expect(purge.ms).toBeLessThan(PURGE_BUDGET_MS - 500);
    expect(count.ms).toBeLessThan(PURGE_BUDGET_MS - 500);
    expect(openSockets()).toBeLessThanOrEqual(before);
  });

  // A frozen Redis: it accepts the connection, then neither reads nor answers. ioredis closes politely
  // (half-close, then a forced close only after `disconnectTimeout`, 2 s by default), and a peer that
  // never reads never completes the polite part, so the purge's socket must be forced closed soon after.
  it('a server that accepts the connection and never reads or answers: the budget ends it, and the purge\'s socket is closed', async () => {
    const accepted = new Set(); // the server's own end of each connection: the test's, not the purge's
    const server = net.createServer((socket) => { accepted.add(socket); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    process.env.REDIS_URL = `redis://127.0.0.1:${server.address().port}`;
    try {
      const before = openSockets();

      const { err, ms } = await timed(() => purgeUserJobs(USER_A));
      await settle();

      expect(err?.name).toBe('JobPurgeTimeoutError');
      expect(ms).toBeGreaterThanOrEqual(PURGE_BUDGET_MS - 50);
      expect(ms).toBeLessThanOrEqual(3000);
      expect(accepted.size).toBe(1); // it did connect
      expect(openSockets() - accepted.size).toBeLessThanOrEqual(before); // and its own socket is gone
    } finally {
      for (const socket of accepted) socket.destroy();
      server.close();
    }
  });
});

describeRealRedis('purgeUserJobs and countUserJobs on the job queue', (url) => {
  let redis;
  const opened = [];
  let workers = [];
  let release = () => {};

  const connect = () => {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    opened.push(connection);
    return connection;
  };

  beforeAll(async () => {
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url;
  });
  beforeEach(() => flushTestDb(redis));
  afterEach(async () => {
    // A test that failed before releasing its gate leaves a running job, and close() would wait on it
    // until the hook timed out and leaked the worker's sockets.
    release();
    release = () => {};
    for (const worker of workers) {
      await worker.close();
      worker.opts.connection.disconnect();
    }
    workers = [];
    await closeQueues();
    while (opened.length) opened.pop().disconnect();
  });
  afterAll(() => {
    redis?.disconnect();
    delete process.env.REDIS_URL;
  });

  /** The backlog the code before J1 left for A and B, in every state, plus three jobs naming no one. */
  async function seedBacklog() {
    const queue = new Queue(NAME, { connection: connect() });
    const ids = { A: {}, B: {}, ownerless: [] };
    for (const [who, userId] of [['A', USER_A], ['B', USER_B]]) {
      ids[who].completed = (await queue.add(NAME, { ...payload(userId), seed: 'ok' })).id;
      ids[who].failed = (await queue.add(NAME, { ...payload(userId), seed: 'fail' })).id;
    }
    const worker = new Worker(NAME, async (job) => {
      if (job.data.seed === 'fail') throw new Error('kept by the old code');
      return {};
    }, { connection: connect() });
    await until(async () => {
      const counts = await queue.getJobCounts('completed', 'failed');
      return counts.completed === 2 && counts.failed === 2;
    }, 'the seeded jobs to finish');
    await worker.close();

    for (const [who, userId] of [['A', USER_A], ['B', USER_B]]) {
      ids[who].waiting = (await queue.add(NAME, payload(userId))).id;
      ids[who].delayed = (await queue.add(NAME, payload(userId), { delay: 3_600_000 })).id;
      ids[who].prioritized = (await queue.add(NAME, payload(userId), { priority: 5 })).id;
    }
    ids.ownerless.push((await queue.add(NAME, { v: 1, at: 1 })).id);
    ids.ownerless.push((await queue.add(NAME, payload(''))).id);
    ids.ownerless.push((await queue.add(NAME, payload(null))).id);
    await queue.close();
    return ids;
  }

  /** Where a job is, read straight from Redis: its hash, and every state set or list that holds it. */
  async function where(id) {
    const [hash, wait, active, delayed, prioritized, completed, failed] = await Promise.all([
      redis.exists(`${R}${id}`),
      redis.lpos(`${R}wait`, id),
      redis.lpos(`${R}active`, id),
      redis.zscore(`${R}delayed`, id),
      redis.zscore(`${R}prioritized`, id),
      redis.zscore(`${R}completed`, id),
      redis.zscore(`${R}failed`, id),
    ]);
    const states = Object.entries({ wait, active, delayed, prioritized, completed, failed })
      .filter(([, v]) => v !== null).map(([k]) => k);
    return { hash, states };
  }
  const STATE_OF = { completed: 'completed', failed: 'failed', waiting: 'wait', delayed: 'delayed', prioritized: 'prioritized' };

  it('removes every job of the account, in every state but running, and no one else\'s', async () => {
    const ids = await seedBacklog();

    const out = await purgeUserJobs(USER_A);

    expect(out).toEqual({ removed: 5, inFlight: 0 });
    for (const id of Object.values(ids.A)) expect(await where(id)).toEqual({ hash: 0, states: [] });
    for (const [kind, id] of Object.entries(ids.B)) expect(await where(id)).toEqual({ hash: 1, states: [STATE_OF[kind]] });
    for (const id of ids.ownerless) expect((await where(id)).hash).toBe(1);
    expect(await redis.keys(`${R}*:*`)).toEqual([]); // no job sub-key left behind either
  });

  it('accepts the account id as an ObjectId (the deletion passes req.user._id)', async () => {
    const ids = await seedBacklog();

    expect(await purgeUserJobs(new mongoose.Types.ObjectId(USER_A))).toEqual({ removed: 5, inFlight: 0 });
    expect((await where(ids.B.waiting)).hash).toBe(1);
  });

  it('a second purge finds nothing (idempotent)', async () => {
    await seedBacklog();
    await purgeUserJobs(USER_A);

    expect(await purgeUserJobs(USER_A)).toEqual({ removed: 0, inFlight: 0 });
  });

  it('a running job is counted as in flight and left alone; once it has run, the queue deletes it', async () => {
    const gate = new Promise((resolve) => { release = resolve; });
    workers = startWorkers({ [NAME]: async () => { await gate; return {}; } });
    const active = once(workers[0], 'active');
    await enqueue(NAME, payload(USER_A), { removeOnComplete: true, removeOnFail: true });
    const [job] = await active;

    const out = await purgeUserJobs(USER_A);

    expect(out).toEqual({ removed: 0, inFlight: 1 });
    expect(await where(job.id)).toEqual({ hash: 1, states: ['active'] });
    const completed = once(workers[0], 'completed');
    release();
    await completed;
    expect(await where(job.id)).toEqual({ hash: 0, states: [] });
  });

  // The race the purge must survive: a job it listed as waiting is taken by a worker before it is removed.
  // BullMQ refuses to remove a locked job (removeJob-2.lua returns 0), and the purge counts it in flight.
  it('a job a worker takes between the listing and the removal is counted in flight and left to run', async () => {
    const gate = new Promise((resolve) => { release = resolve; });
    await enqueue(NAME, payload(USER_A), { removeOnComplete: true, removeOnFail: true });
    const [jobId] = await redis.lrange(`${R}wait`, 0, -1);
    const realRemove = Queue.prototype.remove;
    const spy = jest.spyOn(Queue.prototype, 'remove').mockImplementationOnce(async function takenFirst(...args) {
      workers = startWorkers({ [NAME]: async () => { await gate; return {}; } });
      await once(workers[0], 'active');
      return realRemove.apply(this, args);
    });

    let out;
    try {
      out = await purgeUserJobs(USER_A);
    } finally {
      spy.mockRestore();
    }

    expect(out).toEqual({ removed: 0, inFlight: 1 });
    expect(await where(jobId)).toEqual({ hash: 1, states: ['active'] });
    const completed = once(workers[0], 'completed');
    release();
    await completed;
    expect(await where(jobId)).toEqual({ hash: 0, states: [] });
  });

  it.each([[''], ['   '], [null], [undefined]])('refuses a blank user id (%p) and removes nothing', async (id) => {
    const ids = await seedBacklog();
    const before = (await redis.keys(`${R}*`)).sort();

    await expect(purgeUserJobs(id)).rejects.toThrow(/without a user id/);

    expect((await redis.keys(`${R}*`)).sort()).toEqual(before);
    expect((await where(ids.A.waiting)).hash).toBe(1);
  });

  it('never matches a job that names no user, whatever id is asked for', async () => {
    const ids = await seedBacklog();

    for (const id of ['undefined', 'null', '0', 'aaaaaaaaaaaaaaaaaaaaaaab']) {
      expect(await purgeUserJobs(id)).toEqual({ removed: 0, inFlight: 0 });
    }

    for (const id of ids.ownerless) expect((await where(id)).hash).toBe(1);
  });

  it('countUserJobs counts the same jobs and removes nothing', async () => {
    const ids = await seedBacklog();
    const before = (await redis.keys(`${R}*`)).sort();

    expect(await countUserJobs(USER_A)).toEqual({ jobs: 5, inFlight: 0 });
    expect(await countUserJobs(USER_B)).toEqual({ jobs: 5, inFlight: 0 });

    expect((await redis.keys(`${R}*`)).sort()).toEqual(before);
    expect((await where(ids.A.completed)).hash).toBe(1);
  });

  it('reads the queue in pages: an account with more jobs than one page is purged in full', async () => {
    const queue = new Queue(NAME, { connection: connect() });
    await queue.addBulk(Array.from({ length: 1203 }, (_, i) => ({ name: NAME, data: payload(i % 3 === 0 ? USER_B : USER_A) })));
    await queue.close();

    expect(await purgeUserJobs(USER_A)).toEqual({ removed: 802, inFlight: 0 });

    expect(await redis.llen(`${R}wait`)).toBe(401);
  });

  it('removes the account\'s jobs from a paused queue too', async () => {
    const queue = new Queue(NAME, { connection: connect() });
    await queue.pause();
    const a = (await queue.add(NAME, payload(USER_A))).id;
    const b = (await queue.add(NAME, payload(USER_B))).id;
    await queue.close();
    expect(await redis.lpos(`${R}paused`, a)).not.toBeNull();

    expect(await purgeUserJobs(USER_A)).toEqual({ removed: 1, inFlight: 0 });

    expect(await redis.exists(`${R}${a}`)).toBe(0);
    expect(await redis.lpos(`${R}paused`, b)).not.toBeNull();
  });
});
