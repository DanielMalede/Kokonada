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
//
// DEC-127 (record, then clean): before the one-off `apply`, `count` records the jobs queued on each UTC
// day and, with --accounts, how many of them and how many accounts belong to an account that no longer
// exists or whose health consent is withdrawn, and how many withdrawn accounts withdrew before the play
// of their latest kept job. Seeded on two days with a deleted, a withdrawn, a withdrawn-after-its-last-
// job, a withdrawn-twice, a re-granted and a live account.

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
  /^D day=(?:\d{4}-\d{2}-\d{2}|unknown) jobs=\d+ without-user=(?:\d+|n\/a) withdrawn=(?:\d+|n\/a)$/,
  /^A accounts=(?:\d+|n\/a) without-user=(?:\d+|n\/a) withdrawn=(?:\d+|n\/a) withdrawn-before-last-job=(?:\d+|n\/a)$/,
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

  /**
   * Every key with its value and whether it expires (a TTL counts down on its own). A job hash holds a
   * payload longer than 64 bytes, so Redis keeps it as a hash table, and a plain HGET can advance that
   * table's incremental rehash: its DUMP bytes then list the same fields in another order with nothing
   * written (measured on Redis 7.4). A hash is therefore compared by its fields and values; every other
   * key by its DUMP. That nothing was written is the command record's job.
   */
  async function snapshot() {
    const keys = (await redis.keys('*')).sort();
    const out = {};
    for (const key of keys) {
      const value = (await redis.type(key)) === 'hash'
        ? JSON.stringify(Object.entries(await redis.hgetall(key)).sort())
        : (await redis.dumpBuffer(key)).toString('hex');
      out[key] = [value, (await redis.pttl(key)) > 0 ? 'expires' : 'persists'];
    }
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
    // The --accounts path too (DEC-127), on a Mongo connection that records every command it sends.
    const mongo = await mongoose.createConnection(mongoUri, { monitorCommands: true, autoIndex: false, autoCreate: false }).asPromise();
    const mongoSent = new Set();
    mongo.getClient().on('commandStarted', (e) => mongoSent.add(e.commandName));

    try {
      await script.countRewardJobs(client, { db: mongo.db, env: {} });
    } finally {
      client.disconnect();
      await mongo.close();
    }

    // Redis's own read-only commands; nothing that can write, and no script (a Lua script can write).
    const READS = ['scan', 'zcard', 'llen', 'xlen', 'get', 'hget', 'xrange'];
    expect([...sent].sort()).toEqual(expect.arrayContaining(['scan', 'zcard', 'llen', 'xlen', 'get', 'hget', 'xrange']));
    expect([...sent].filter((c) => !READS.includes(c))).toEqual([]);
    expect(await snapshot()).toEqual(before);
    // Mongo: reads only; no insert, update, delete, index build or collection create.
    const MONGO_READS = ['find', 'getMore', 'killCursors', 'endSessions'];
    expect([...mongoSent]).toContain('find');
    expect([...mongoSent].filter((c) => !MONGO_READS.includes(c))).toEqual([]);
  });

  it('count --accounts reports the backlog in closed lines: counts only', async () => {
    await seedBacklog();

    const { code, lines } = await run(['count', '--accounts'], { MONGO_URI: mongoUri, RUN_WORKERS_IN_PROCESS: 'true' });

    expect(code).toBe(0);
    expect(lines[0]).toBe('reward-jobs count read-only counts-only');
    expect(tokens(lines, 'K')).toMatchObject({ 'job-hashes': '6', 'job-subkeys': '1' });
    expect(tokens(lines, 'S')).toEqual({ completed: '2', failed: '1', wait: '1', running: '0', delayed: '1', prioritized: '0', paused: '0' });
    expect(tokens(lines, 'E')).toMatchObject({ 'failed-events': '1', 'ever-added': '6' });
    expect(lines).toContain('A accounts=2 without-user=1 withdrawn=0 withdrawn-before-last-job=0');
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
    expect(lines).toContain('A accounts=n/a without-user=n/a withdrawn=n/a withdrawn-before-last-job=n/a');
    expect(lines).toContain('W workers-in-process=no');
  });

  // DEC-127 (record, then clean). Two UTC days; six accounts and one job that names no one.
  const DAY1 = Date.UTC(2026, 8, 30, 12); // 2026-09-30T12:00Z
  const DAY2 = Date.UTC(2026, 9, 1, 12); // 2026-10-01T12:00Z
  const HOUR = 3_600_000;
  const ACCOUNT = {
    deleted: 'dddddddddddddddddddddddd', // no User document any more
    withdrawn: 'eeeeeeeeeeeeeeeeeeeeeeee', // withdrew on day 1, then played again on day 2
    withdrawnAfter: 'ffffffffffffffffffffffff', // played on day 1, withdrew after it on day 2
    // withdrew, granted again, played on day 2, then withdrew again after that play: only the withdrawal
    // that stands is compared with the play, so this one did not play while withdrawn
    withdrawnTwice: '333333333333333333333333',
    regranted: '111111111111111111111111', // withdrew, then granted again, then played
    live: '222222222222222222222222', // granted, never withdrew
  };
  const PURPOSE = 'health_biometric_processing';
  const consentRow = (who, status, at) => ({
    userId: new mongoose.Types.ObjectId(ACCOUNT[who]), purpose: PURPOSE, consentVersion: 1, status,
    ...(status === 'granted' ? { grantedAt: new Date(at) } : { withdrawnAt: new Date(at) }),
    createdAt: new Date(at), updatedAt: new Date(at),
  });

  /** The record's seed: jobs on two days (and one hash with no timestamp), accounts and their consent history. */
  async function seedRecord(db) {
    const queue = new Queue(NAME, { connection: connect() });
    const job = (who, at, extra = {}) => queue.add(NAME, { ...payload(ACCOUNT[who]), at, ...extra }, { timestamp: at });
    await job('deleted', DAY1);
    await job('deleted', DAY2);
    await job('withdrawn', DAY1);
    await job('withdrawn', DAY2);
    await job('withdrawnAfter', DAY1);
    await job('withdrawnTwice', DAY2);
    await job('regranted', DAY2);
    await job('live', DAY1);
    await job('live', DAY2);
    await job('live', DAY2 + 60_000);
    await queue.add(NAME, { v: 1, at: DAY2 }, { timestamp: DAY2 }); // names no one
    await queue.close();
    // Job hashes with no timestamp, one past the year 9999 and one that is not a number: what a partial
    // write or removal, or a corrupt write, can leave. Each is counted on the `unknown` day.
    await redis.hset(`${P}900`, 'data', JSON.stringify({ ...payload(ACCOUNT.live), at: DAY1 }));
    await redis.hset(`${P}901`, 'data', JSON.stringify({ ...payload(ACCOUNT.live), at: DAY1 }), 'timestamp', String(Date.UTC(10000, 0, 1)));
    await redis.hset(`${P}902`, 'data', JSON.stringify({ ...payload(ACCOUNT.live), at: DAY1 }), 'timestamp', 'not-a-time');

    await db.collection('users').deleteMany({});
    await db.collection('consentrecords').deleteMany({});
    await db.collection('users').insertMany(['withdrawn', 'withdrawnAfter', 'withdrawnTwice', 'regranted', 'live']
      .map((who) => ({ _id: new mongoose.Types.ObjectId(ACCOUNT[who]), email: `${who}@example.com` })));
    await db.collection('consentrecords').insertMany([
      consentRow('withdrawn', 'granted', DAY1 - 48 * HOUR),
      consentRow('withdrawn', 'withdrawn', DAY1 + HOUR),
      consentRow('withdrawnAfter', 'granted', DAY1 - 48 * HOUR),
      consentRow('withdrawnAfter', 'withdrawn', DAY2 + HOUR),
      consentRow('withdrawnTwice', 'granted', DAY1 - 96 * HOUR),
      consentRow('withdrawnTwice', 'withdrawn', DAY1 - 72 * HOUR),
      consentRow('withdrawnTwice', 'granted', DAY1 - 48 * HOUR),
      consentRow('withdrawnTwice', 'withdrawn', DAY2 + 2 * HOUR),
      consentRow('regranted', 'granted', DAY1 - 72 * HOUR),
      consentRow('regranted', 'withdrawn', DAY1 - 48 * HOUR),
      consentRow('regranted', 'granted', DAY1 - 24 * HOUR),
      consentRow('live', 'granted', DAY1 - 48 * HOUR),
    ]);
  }

  it('DEC-127: count --accounts records, per UTC day, the jobs and those of a deleted or withdrawn account, and the accounts withdrawn before their last job', async () => {
    const recordUri = `${mem.getUri()}kokonada_j1_dec127`;
    const db = await mongoose.createConnection(recordUri).asPromise();
    try {
      await seedRecord(db);
    } finally {
      await db.close();
    }

    const { code, lines } = await run(['count', '--accounts'], { MONGO_URI: recordUri });

    expect(code).toBe(0);
    expect(lines.map((l) => l.split(' ')[0])).toEqual(['reward-jobs', 'K', 'S', 'E', 'D', 'D', 'D', 'A', 'W', 'RESULT']);
    expect(lines.filter((l) => l.startsWith('D '))).toEqual([
      'D day=2026-09-30 jobs=4 without-user=1 withdrawn=2',
      'D day=2026-10-01 jobs=7 without-user=1 withdrawn=2',
      'D day=unknown jobs=3 without-user=0 withdrawn=0',
    ]);
    expect(lines).toContain('A accounts=6 without-user=1 withdrawn=3 withdrawn-before-last-job=1');
    expect(tokens(lines, 'K')['job-hashes']).toBe('14'); // every job hash is on exactly one D line
    for (const line of lines) {
      expect(closed(line)).toBe(true);
      expect(line).not.toMatch(LEAK);
    }
  });

  it('DEC-127: count without --accounts records the jobs per day, reads no payload and says n/a for the accounts', async () => {
    const recordUri = `${mem.getUri()}kokonada_j1_dec127`;
    const db = await mongoose.createConnection(recordUri).asPromise();
    try {
      await seedRecord(db);
    } finally {
      await db.close();
    }
    const client = await openTestRedis(url);
    const fields = new Set();
    const send = client.sendCommand.bind(client);
    client.sendCommand = (command, ...rest) => {
      if (command.name.toLowerCase() === 'hget') fields.add(String(command.args[1]));
      return send(command, ...rest);
    };

    let lines;
    try {
      lines = await script.countRewardJobs(client, { env: {} });
    } finally {
      client.disconnect();
    }

    expect(lines.filter((l) => l.startsWith('D '))).toEqual([
      'D day=2026-09-30 jobs=4 without-user=n/a withdrawn=n/a',
      'D day=2026-10-01 jobs=7 without-user=n/a withdrawn=n/a',
      'D day=unknown jobs=3 without-user=n/a withdrawn=n/a',
    ]);
    expect(lines).toContain('A accounts=n/a without-user=n/a withdrawn=n/a withdrawn-before-last-job=n/a');
    expect([...fields]).toEqual(['timestamp']); // the payload (user id, health-derived values) is not read
    for (const line of lines) {
      expect(closed(line)).toBe(true);
      expect(line).not.toMatch(LEAK);
    }
  });

  it('apply empties completed and failed, deletes the leftover and the events stream, and leaves waiting and delayed jobs alone', async () => {
    const ids = await seedBacklog();
    const eventsBefore = await redis.xlen(`${P}events`);
    const waitingHash = await redis.hgetall(`${P}${ids.waiting}`); // by its fields: see snapshot()

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
    expect(await redis.hgetall(`${P}${ids.waiting}`)).toEqual(waitingHash);
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

// DEC-127: the record reads Mongo model-free (a loaded model builds its indexes on connect), so the
// collection names are written out, and must stay the models' own.
describe('rewardJobs — model-free, on the models\' own collections', () => {
  it('loads no Mongoose model, directly or through what it requires', () => {
    jest.isolateModules(() => {
      require('../scripts/rewardJobs');
      expect(require('mongoose').modelNames()).toEqual([]);
    });
  });

  it('reads the collections the User and ConsentRecord models write to', () => {
    jest.isolateModules(() => {
      const User = require('../app/models/User');
      const ConsentRecord = require('../app/models/ConsentRecord');
      expect(script.COLLECTIONS).toEqual({ users: User.collection.collectionName, consent: ConsentRecord.collection.collectionName });
    });
  });
});

describe('countRewardJobs — a read that fails is never a zero', () => {
  // Each read fails on its own: since DEC-127 the timestamp is read before the payload, so a fake that failed
  // every HGET would reject at the timestamp and pass even with the payload read back inside the try.
  it.each([['timestamp'], ['data']])('an HGET of %s that fails rejects, so main prints ERROR rather than a false count', async (failing) => {
    const redis = {
      scan: async () => ['0', ['bull:reward-ingest:1']],
      zcard: async () => 0, llen: async () => 0, xlen: async () => 0, xrange: async () => [], get: async () => '1',
      hget: async (_key, field) => {
        if (field === failing) throw new Error('Connection is closed.');
        return field === 'timestamp' ? String(Date.UTC(2026, 9, 1)) : JSON.stringify({ userId: 'aaaaaaaaaaaaaaaaaaaaaaaa', at: 1 });
      },
    };
    const db = { collection: () => ({ find: () => ({ toArray: async () => [] }) }) };
    await expect(script.countRewardJobs(redis, { db, env: {} })).rejects.toThrow('Connection is closed.');
  });
});
