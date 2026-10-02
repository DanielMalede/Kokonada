'use strict';

// OPS-100 (J2 Plan B T13; the ops094 resilience review §6) — a schedule queued by the code before J1 keeps
// no finished job, on a REAL Redis (the lane in tests/helpers/realRedis.js).
//
// What deletes these jobs is not obvious, and nothing tested it. A schedule's chain is extended by the
// worker from the RUNNING job's own options (worker.js moveToActive -> Repeat.updateRepeatableJob), so a
// chain started before J1 carries the old options, with no removal, for as long as it runs; J1's boot-time
// re-add with the new defaults is dropped as a duplicate of the existing next run. The only thing that
// deletes such a job once it has run is the worker's own fallback, `{count: 0}` (workers/index.js), which
// BullMQ's finish script applies when a job set nothing itself (moveToFinished-14.lua).
//
// Real: Redis, BullMQ, the legacy producer (a plain Queue with no default options, as before J1) and the
// app's worker registry (`workers/index.startWorkers`). The processor is a stand-in that succeeds and fails
// in turn, so both finish paths run; the session-trim job itself needs MongoDB.

process.env.NODE_ENV = 'test';

const IORedis = require('ioredis');
const { Queue } = require('bullmq');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { QUEUES } = require('../app/queues/definitions');
const { startWorkers } = require('../app/workers');

jest.setTimeout(60000);

const NAME = QUEUES.SESSION_TRIM; // one of the four scheduled queues
const P = `bull:${NAME}:`;
const RUNS_EACH = 3;

async function until(check, what) {
  const deadline = Date.now() + 30_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describeRealRedis('OPS-100: a schedule queued before J1 keeps no finished job', (url) => {
  let redis;
  const opened = [];
  const closers = [];
  let workers = [];
  const connect = () => {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    opened.push(connection);
    return connection;
  };

  beforeAll(async () => {
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url; // the app's workers connect here
  });
  beforeEach(() => flushTestDb(redis));
  afterEach(async () => {
    for (const worker of workers) {
      await worker.close();
      worker.opts.connection.disconnect(); // BullMQ never closes a connection it was handed
    }
    workers = [];
    while (closers.length) await closers.pop()();
    while (opened.length) opened.pop().disconnect();
  });
  afterAll(() => {
    redis?.disconnect();
    delete process.env.REDIS_URL;
  });

  it('a legacy add({repeat:{every}}) with no removal options, run by J1\'s workers: completed=0 failed=0 schedulers=1 and one next run', async () => {
    const legacy = new Queue(NAME, { connection: connect() }); // the producer before J1: no defaultJobOptions
    closers.push(() => legacy.close());
    await legacy.add(NAME, { legacy: true }, { repeat: { every: 150 } });

    const seen = { completed: 0, failed: 0, removalAsked: [], chained: [] };
    let runs = 0;
    workers = startWorkers({
      [NAME]: async (job) => {
        runs += 1;
        seen.removalAsked.push([job.opts.removeOnComplete, job.opts.removeOnFail]);
        seen.chained.push(Boolean(job.repeatJobKey));
        if (runs % 2 === 0) throw new Error('a failing run');
        return {};
      },
    });
    const [worker] = workers;
    worker.on('completed', () => { seen.completed += 1; });
    worker.on('failed', () => { seen.failed += 1; });

    await until(() => seen.completed >= RUNS_EACH && seen.failed >= RUNS_EACH, `${RUNS_EACH} runs of each kind`);
    await worker.close(); // waits for a running job; the next run, created when this one started, stays queued

    const reader = new Queue(NAME, { connection: connect(), skipMetasUpdate: true });
    closers.push(() => reader.close());
    const counts = await reader.getJobCounts('completed', 'failed', 'delayed', 'wait', 'active', 'prioritized', 'paused', 'waiting-children');

    // Not vacuous: every run was one link of the legacy chain, and none asked for its own removal.
    expect(seen.chained.every(Boolean)).toBe(true);
    expect(seen.removalAsked.every(([onComplete, onFail]) => onComplete === undefined && onFail === undefined)).toBe(true);
    expect({ completed: counts.completed, failed: counts.failed }).toEqual({ completed: 0, failed: 0 });
    expect(await redis.zcard(`${P}repeat`)).toBe(1);
    const next = counts.delayed + counts.wait + counts.active + counts.prioritized + counts.paused + counts['waiting-children'];
    expect(next).toBe(1);
    // …and no finished job's hash is left behind: the only job hash is the next run's.
    const jobHashes = [];
    for (const key of await redis.keys(`${P}repeat:*`)) {
      if ((await redis.type(key)) === 'hash' && (await redis.hexists(key, 'timestamp'))) jobHashes.push(key);
    }
    expect(jobHashes).toHaveLength(1);
  });
});
