'use strict';

// J1 (BE-074) — scripts/rewardJobs.js, the counted one-off clean of the learning jobs the code before J1
// kept in Redis, on a REAL Redis (the lane in tests/helpers/realRedis.js) and, for `--accounts`, a real
// MongoDB (mongodb-memory-server).
//
// The seed is the backlog that code left, made the way it made it: a queue and a worker with no removal
// option, so every finished job stays, a failed job keeps its driver message, and the events stream
// keeps that message too. Plus the leftovers `apply` must also clear (a job hash in no state, with a
// key of its own) and the jobs it must never touch (one waiting, one delayed).
//
// What is pinned: `count` sends Redis only reads and changes nothing; `apply` empties completed and
// failed, deletes the leftover, empties the events stream and leaves waiting and delayed jobs alone;
// every line is a closed token with counts, never an id, a band or a driver message.

process.env.NODE_ENV = 'test';

const IORedis = require('ioredis');
const { Queue, Worker } = require('bullmq');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const script = require('../scripts/rewardJobs');

jest.setTimeout(120000);

const NAME = 'reward-ingest';
const P = `bull:${NAME}:`;
const USER_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const USER_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const payload = (userId) => ({
  v: 1, userId, bucket: { stateDomain: 'stress', targetBand: 'resting', hourBin: 3 }, reward: 0.4, posterior: null, novelty: null, weightStep: null, at: 1_700_000_000_000,
});

// Nothing a line may carry: a user id, or a heart-rate band the music targeted.
const LEAK = /[0-9a-f]{24}|resting|active|peak/;
const GRAMMAR = [
  /^reward-jobs (?:count read-only|apply) counts-only$/,
  /^K keys=\d+ job-hashes=\d+ job-subkeys=\d+ structural=\d+$/,
  /^S completed=\d+ failed=\d+ wait=\d+ running=\d+ delayed=\d+ prioritized=\d+ paused=\d+$/,
  /^E events=\d+ failed-events=\d+ ever-added=\d+$/,
  /^A accounts=(?:\d+|n\/a) without-user=(?:\d+|n\/a)$/,
  /^W workers-in-process=(?:yes|no)$/,
  /^C cleaned-completed=\d+ cleaned-failed=\d+ orphan-hashes=\d+ events-trimmed=\d+$/,
  /^RESULT (?:zero|non-zero)$/,
];
const closed = (line) => GRAMMAR.some((g) => g.test(line));
const tokens = (lines, prefix) => Object.fromEntries(
  lines.find((l) => l.startsWith(`${prefix} `)).slice(prefix.length + 1).split(' ').map((t) => t.split('=')),
);

async function until(check, what) {
  const deadline = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('rewardJobs main — refusals that need no server', () => {
  const run = async (argv, env) => {
    const lines = [];
    const code = await script.main({ argv, env, out: (l) => lines.push(l) });
    return { code, lines };
  };

  it.each([[[]], [['bogus']], [['count', '--everything']], [['apply', '--accounts']]])('%p: prints the usage and exits 1', async (argv) => {
    const { code, lines } = await run(argv, { REDIS_URL: 'redis://127.0.0.1:1' });
    expect(code).toBe(1);
    expect(lines).toEqual([script.USAGE]);
  });

  it('without REDIS_URL: one ERROR line, exit 1', async () => {
    const { code, lines } = await run(['count'], {});
    expect(code).toBe(1);
    expect(lines).toEqual(['ERROR REDIS_URL is not set: run it inside the backend container (railway ssh)']);
  });

  it('--accounts without MONGO_URI: one ERROR line, exit 1', async () => {
    const { code, lines } = await run(['count', '--accounts'], { REDIS_URL: 'redis://127.0.0.1:1' });
    expect(code).toBe(1);
    expect(lines).toEqual(['ERROR MONGO_URI is not set: --accounts needs it']);
  });

  it('an unreachable Redis: one closed ERROR line, exit 1, fast', async () => {
    const t0 = Date.now();
    const { code, lines } = await run(['count'], { REDIS_URL: 'redis://127.0.0.1:1' });
    expect(code).toBe(1);
    expect(lines).toEqual(['ERROR could not connect to Redis (Error)']);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describeRealRedis('scripts/rewardJobs.js on the backlog the code before J1 left', (url) => {
  let redis;
  let mem;
  let mongoUri;
  let users;
  const opened = [];
  const connect = () => {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    opened.push(connection);
    return connection;
  };

  beforeAll(async () => {
    redis = await openTestRedis(url);
    mem = await MongoMemoryServer.create();
    mongoUri = `${mem.getUri()}kokonada_j1_script`;
    users = await mongoose.createConnection(mongoUri).asPromise();
    await users.collection('users').insertOne({ _id: new mongoose.Types.ObjectId(USER_A), email: 'a@example.com' }); // B was deleted
  });
  afterAll(async () => {
    redis?.disconnect();
    await users?.close();
    await mem?.stop();
  });
  beforeEach(() => flushTestDb(redis));
  afterEach(() => { while (opened.length) opened.pop().disconnect(); });

  /** Two completed, one failed (its driver message names A and the band), a leftover hash, one waiting, one delayed. */
  async function seedBacklog({ unfinished = true } = {}) {
    const queue = new Queue(NAME, { connection: connect() });
    await queue.add(NAME, payload(USER_A));
    await queue.add(NAME, payload(USER_B));
    await queue.add(NAME, { ...payload(USER_A), fail: true });
    const leftover = await queue.add(NAME, payload(USER_B));
    const worker = new Worker(NAME, async (job) => {
      if (job.data.fail) throw new Error(`E11000 duplicate key dup key: { userId: ObjectId('${USER_A}'), bucket.targetBand: "resting" }`);
      return { bucket: true };
    }, { connection: connect() });
    await until(async () => {
      const counts = await queue.getJobCounts('completed', 'failed');
      return counts.completed === 3 && counts.failed === 1;
    }, 'the seeded jobs to finish');
    await worker.close();
    // A job hash in no state, with a key of its own: what a partial removal leaves behind.
    await redis.zrem(`${P}completed`, leftover.id);
    await redis.rpush(`${P}${leftover.id}:logs`, 'kept');
    const ids = { leftover: leftover.id };
    if (unfinished) {
      ids.waiting = (await queue.add(NAME, payload(USER_A))).id;
      ids.delayed = (await queue.add(NAME, payload(USER_B), { delay: 3_600_000 })).id;
    }
    await queue.close();
    return ids;
  }

  /** Every key with its serialised value and whether it expires (a TTL counts down on its own). */
  async function snapshot() {
    const keys = (await redis.keys('*')).sort();
    const out = {};
    for (const key of keys) out[key] = [(await redis.dumpBuffer(key)).toString('hex'), (await redis.pttl(key)) > 0 ? 'expires' : 'persists'];
    return out;
  }
  const run = async (argv, env = {}) => {
    const lines = [];
    const code = await script.main({ argv, env: { REDIS_URL: url, ...env }, out: (l) => lines.push(l) });
    return { code, lines };
  };

  it('count sends Redis nothing but reads, and changes nothing', async () => {
    await seedBacklog();
    const before = await snapshot();
    const client = await openTestRedis(url);
    const sent = new Set();
    const send = client.sendCommand.bind(client);
    client.sendCommand = (command, ...rest) => { sent.add(command.name.toLowerCase()); return send(command, ...rest); };

    try {
      await script.countRewardJobs(client, { env: {} });
    } finally {
      client.disconnect();
    }

    // Redis's own read-only commands; nothing that can write, and no script (a Lua script can write).
    const READS = ['scan', 'zcard', 'llen', 'xlen', 'get', 'hget', 'xrange'];
    expect([...sent].sort()).toEqual(expect.arrayContaining(['scan', 'zcard', 'llen', 'xlen', 'get', 'xrange']));
    expect([...sent].filter((c) => !READS.includes(c))).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it('count --accounts reports the backlog in closed lines: counts only', async () => {
    await seedBacklog();

    const { code, lines } = await run(['count', '--accounts'], { MONGO_URI: mongoUri, RUN_WORKERS_IN_PROCESS: 'true' });

    expect(code).toBe(0);
    expect(lines[0]).toBe('reward-jobs count read-only counts-only');
    expect(tokens(lines, 'K')).toMatchObject({ 'job-hashes': '6', 'job-subkeys': '1' });
    expect(tokens(lines, 'S')).toEqual({ completed: '2', failed: '1', wait: '1', running: '0', delayed: '1', prioritized: '0', paused: '0' });
    expect(tokens(lines, 'E')).toMatchObject({ 'failed-events': '1', 'ever-added': '6' });
    expect(lines).toContain('A accounts=2 without-user=1');
    expect(lines).toContain('W workers-in-process=yes');
    expect(lines[lines.length - 1]).toBe('RESULT non-zero');
    for (const line of lines) {
      expect(closed(line)).toBe(true);
      expect(line).not.toMatch(LEAK);
    }
  });

  it('count without --accounts says n/a and never reads Mongo', async () => {
    await seedBacklog();

    const { code, lines } = await run(['count']);

    expect(code).toBe(0);
    expect(lines).toContain('A accounts=n/a without-user=n/a');
    expect(lines).toContain('W workers-in-process=no');
  });

  it('apply empties completed and failed, deletes the leftover and the events stream, and leaves waiting and delayed jobs alone', async () => {
    const ids = await seedBacklog();
    const eventsBefore = await redis.xlen(`${P}events`);
    const waitingHash = await redis.dumpBuffer(`${P}${ids.waiting}`);

    const { code, lines } = await run(['apply']);

    expect(code).toBe(0);
    expect(lines[0]).toBe('reward-jobs apply counts-only');
    // BullMQ's clean adds one `cleaned` entry per call (cleanJobsInSet-3.lua); the stream is emptied after.
    expect(lines).toContain(`C cleaned-completed=2 cleaned-failed=1 orphan-hashes=1 events-trimmed=${eventsBefore + 2}`);
    expect(tokens(lines, 'S')).toEqual({ completed: '0', failed: '0', wait: '1', running: '0', delayed: '1', prioritized: '0', paused: '0' });
    expect(tokens(lines, 'K')).toMatchObject({ 'job-hashes': '2', 'job-subkeys': '0' });
    expect(tokens(lines, 'E')).toMatchObject({ events: '0', 'failed-events': '0' });
    expect(lines[lines.length - 1]).toBe('RESULT non-zero'); // the two unfinished jobs are still data
    expect(await redis.lrange(`${P}wait`, 0, -1)).toEqual([ids.waiting]);
    expect(await redis.zscore(`${P}delayed`, ids.delayed)).not.toBeNull();
    expect((await redis.dumpBuffer(`${P}${ids.waiting}`)).equals(waitingHash)).toBe(true);
    expect(await redis.exists(`${P}${ids.leftover}`, `${P}${ids.leftover}:logs`)).toBe(0);
    for (const line of lines) {
      expect(closed(line)).toBe(true);
      expect(line).not.toMatch(LEAK);
    }
  });

  it('apply on a backlog of finished jobs only ends at zero, with only structural keys left', async () => {
    await seedBacklog({ unfinished: false });

    const { code, lines } = await run(['apply']);

    expect(code).toBe(0);
    expect(tokens(lines, 'K')).toMatchObject({ 'job-hashes': '0', 'job-subkeys': '0' });
    expect(lines[lines.length - 1]).toBe('RESULT zero');
    expect((await redis.keys(`${P}*`)).filter((k) => /^bull:reward-ingest:\d+/.test(k))).toEqual([]);
    expect(JSON.stringify(await redis.xrange(`${P}events`, '-', '+'))).not.toContain(USER_A);
  });

  it('a second apply finds nothing more to clean', async () => {
    await seedBacklog({ unfinished: false });
    await run(['apply']);

    const { lines } = await run(['apply']);

    expect(lines).toContain('C cleaned-completed=0 cleaned-failed=0 orphan-hashes=0 events-trimmed=2'); // its own two `cleaned` entries
    expect(tokens(lines, 'E')).toMatchObject({ events: '0' });
    expect(lines[lines.length - 1]).toBe('RESULT zero');
  });
});
