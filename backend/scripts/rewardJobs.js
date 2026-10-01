'use strict';

// J1 (BE-074) — the counted one-off clean of the learning jobs the code before J1 kept in Redis.
//
// Before J1 nothing deleted a reward-ingest job once it had run, so every finished job kept its payload
// (the user id and values derived from the heart rate) and every failure kept its driver message, in
// the job hash and in the queue's events stream. J1's removal options act on a job as it finishes;
// the jobs kept before the deploy stay until this runs once, after the deploy is complete.
//
// Run it inside the backend container, from the app directory: the private REDIS_URL resolves only
// there (`railway ssh`).
//   node scripts/rewardJobs.js count [--accounts]   read-only: the backlog, in counts
//   node scripts/rewardJobs.js apply                 clean it, then count again
// Exit 0: done (read the RESULT line). Exit 1: a usage error or a failure (one ERROR line).
//
// OUTPUT IS COUNTS ONLY, in closed lines: never a job id, a user id, a band or a driver message.
//   K  the keys under bull:reward-ingest:, split into job hashes, their sub-keys and the queue's own
//   S  jobs per state; `running` is BullMQ's `active`
//   E  entries in the events stream, how many record a failure (a reason that, before J1, could quote
//      a user), and how many jobs were ever added (the id counter)
//   A  with --accounts: how many accounts the job payloads name, and how many of those no longer exist
//   W  whether this service runs the workers (RUN_WORKERS_IN_PROCESS): with it off, jobs wait for ever
//   C  apply only: what it removed
//   RESULT  zero when no job and no failure record is left
//
// `count` sends Redis only reads (SCAN, ZCARD, LLEN, XLEN, GET, HGET, XRANGE) on a plain client: a
// BullMQ queue writes its meta key when it is created. `--accounts` reads Mongo on a model-free
// connection (no index build, no collection created), as scripts/sessionHealthCount.js does.
// `apply` removes finished jobs (BullMQ's clean of completed and failed), job hashes in no state at
// all, and the events stream. It never touches a waiting, running or delayed job.

const IORedis = require('ioredis');
const mongoose = require('mongoose');
const { Queue } = require('bullmq');
const { assertDbName } = require('../app/config/db');
const { QUEUES } = require('../app/queues/definitions');

const NAME = QUEUES.REWARD_INGEST;
const PREFIX = `bull:${NAME}:`;
const JOB_HASH = new RegExp(`^${PREFIX}(\\d+)$`);
const JOB_SUBKEY = new RegExp(`^${PREFIX}(\\d+):`);
const USAGE = 'usage: node scripts/rewardJobs.js count [--accounts] | apply';

// An error's class name, or 'Error': never its message (a driver message can quote values).
const errorType = (e) => (typeof e?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : 'Error');

async function scanKeys(redis) {
  const seen = new Set();
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 1000);
    cursor = next;
    for (const key of batch) seen.add(key);
  } while (cursor !== '0');
  const all = [...seen];
  return { all, jobHashes: all.filter((k) => JOB_HASH.test(k)), jobSubkeys: all.filter((k) => JOB_SUBKEY.test(k)) };
}

async function countFailedEvents(redis) {
  let failed = 0;
  let start = '-';
  for (;;) {
    const batch = await redis.xrange(`${PREFIX}events`, start, '+', 'COUNT', 1000);
    for (const [, fields] of batch) {
      if (fields[fields.indexOf('event') + 1] === 'failed') failed += 1;
    }
    if (batch.length < 1000) return failed;
    start = `(${batch[batch.length - 1][0]}`;
  }
}

/** The accounts the job payloads name, and how many of them have no User document any more. */
async function countAccounts(redis, db, jobHashes) {
  const owners = new Set();
  for (const key of jobHashes) {
    let owner = null;
    try {
      owner = JSON.parse(await redis.hget(key, 'data'))?.userId ?? null;
    } catch {
      owner = null; // an unreadable payload names no one
    }
    if (typeof owner === 'string' && owner) owners.add(owner);
  }
  const ids = [...owners].filter((id) => /^[0-9a-fA-F]{24}$/.test(id)).map((id) => new mongoose.Types.ObjectId(id));
  let existing = 0;
  for (let i = 0; i < ids.length; i += 500) {
    existing += await db.collection('users').countDocuments({ _id: { $in: ids.slice(i, i + 500) } });
  }
  return { accounts: owners.size, withoutUser: owners.size - existing };
}

/** The K, S, E, A, W and RESULT lines. Read-only. */
async function countRewardJobs(redis, { db = null, env = process.env } = {}) {
  const { all, jobHashes, jobSubkeys } = await scanKeys(redis);
  const states = {
    completed: await redis.zcard(`${PREFIX}completed`),
    failed: await redis.zcard(`${PREFIX}failed`),
    wait: await redis.llen(`${PREFIX}wait`),
    running: await redis.llen(`${PREFIX}active`),
    delayed: await redis.zcard(`${PREFIX}delayed`),
    prioritized: await redis.zcard(`${PREFIX}prioritized`),
    paused: await redis.llen(`${PREFIX}paused`),
  };
  const events = await redis.xlen(`${PREFIX}events`);
  const failedEvents = await countFailedEvents(redis);
  const everAdded = Number(await redis.get(`${PREFIX}id`)) || 0;

  const lines = [
    `K keys=${all.length} job-hashes=${jobHashes.length} job-subkeys=${jobSubkeys.length} structural=${all.length - jobHashes.length - jobSubkeys.length}`,
    `S ${Object.entries(states).map(([state, n]) => `${state}=${n}`).join(' ')}`,
    `E events=${events} failed-events=${failedEvents} ever-added=${everAdded}`,
  ];
  if (db) {
    const { accounts, withoutUser } = await countAccounts(redis, db, jobHashes);
    lines.push(`A accounts=${accounts} without-user=${withoutUser}`);
  } else {
    lines.push('A accounts=n/a without-user=n/a');
  }
  lines.push(`W workers-in-process=${env.RUN_WORKERS_IN_PROCESS === 'true' ? 'yes' : 'no'}`);
  const zero = jobHashes.length === 0 && jobSubkeys.length === 0 && failedEvents === 0
    && Object.values(states).every((n) => n === 0);
  lines.push(`RESULT ${zero ? 'zero' : 'non-zero'}`);
  return lines;
}

/** Removes the finished jobs, the job hashes in no state, and the events stream. Returns the counts. */
async function applyRewardJobs(redis) {
  const connection = redis.duplicate();
  connection.on('error', () => {});
  const queue = new Queue(NAME, { connection, skipMetasUpdate: true });
  queue.on('error', () => {});
  try {
    const cleanedCompleted = (await queue.clean(0, 0, 'completed')).length;
    const cleanedFailed = (await queue.clean(0, 0, 'failed')).length;

    // Leftovers: listed first, then each checked by BullMQ itself, so only a job in no state at all is
    // deleted (a job added after the listing is not in it; a listed job that is waiting or running is
    // not 'unknown'). Its sub-keys (a log, a lock) go with it.
    const { jobHashes, jobSubkeys } = await scanKeys(redis);
    const ids = new Set([...jobHashes, ...jobSubkeys].map((k) => (k.match(JOB_HASH) ?? k.match(JOB_SUBKEY))[1]));
    let orphanHashes = 0;
    for (const id of ids) {
      if ((await queue.getJobState(id)) !== 'unknown') continue;
      await redis.del(`${PREFIX}${id}`, ...jobSubkeys.filter((k) => k.startsWith(`${PREFIX}${id}:`)));
      orphanHashes += 1;
    }

    // Last: BullMQ's clean adds its own `cleaned` entries, and those go too.
    const eventsTrimmed = await redis.xtrim(`${PREFIX}events`, 'MAXLEN', 0);
    return { cleanedCompleted, cleanedFailed, orphanHashes, eventsTrimmed };
  } finally {
    await queue.close().catch(() => {});
    connection.disconnect();
  }
}

async function main({ argv = process.argv.slice(2), env = process.env, out = (line) => console.log(line) } = {}) {
  const [mode, ...flags] = argv;
  const accounts = flags.includes('--accounts');
  const valid = (mode === 'count' && flags.every((f) => f === '--accounts')) || (mode === 'apply' && flags.length === 0);
  if (!valid) {
    out(USAGE);
    return 1;
  }
  if (!env.REDIS_URL) {
    out('ERROR REDIS_URL is not set: run it inside the backend container (railway ssh)');
    return 1;
  }
  if (accounts && !env.MONGO_URI) {
    out('ERROR MONGO_URI is not set: --accounts needs it');
    return 1;
  }

  // The script's own silent client: no retries and no offline queue, so an unreachable Redis fails fast.
  const redis = new IORedis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 10000,
    retryStrategy: () => null,
  });
  redis.on('error', () => {});
  try {
    await redis.connect();
  } catch (e) {
    // No retries, so a failed connect has already ended the client. Disconnecting it again would arm
    // ioredis's 2 s close timer on a socket that has already closed, and nothing would clear it.
    out(`ERROR could not connect to Redis (${errorType(e)})`);
    return 1;
  }

  let conn = null;
  try {
    if (accounts) {
      try {
        conn = await mongoose.createConnection(env.MONGO_URI, {
          serverSelectionTimeoutMS: 15000, autoIndex: false, autoCreate: false, readPreference: 'primary',
        }).asPromise();
      } catch (e) {
        out(`ERROR could not connect to MongoDB (${errorType(e)})`);
        return 1;
      }
      try {
        assertDbName(conn.name);
      } catch {
        out('ERROR the connected database is not the expected one (MONGO_DB_NAME check)');
        return 1;
      }
    }
    const lines = [mode === 'apply' ? 'reward-jobs apply counts-only' : 'reward-jobs count read-only counts-only'];
    if (mode === 'apply') {
      const c = await applyRewardJobs(redis);
      lines.push(`C cleaned-completed=${c.cleanedCompleted} cleaned-failed=${c.cleanedFailed} orphan-hashes=${c.orphanHashes} events-trimmed=${c.eventsTrimmed}`);
    }
    lines.push(...await countRewardJobs(redis, { db: conn?.db ?? null, env }));
    lines.forEach((line) => out(line));
    return 0;
  } catch (e) {
    out(`ERROR the ${mode} failed (${errorType(e)})`);
    return 1;
  } finally {
    redis.disconnect();
    if (conn) await conn.close().catch(() => {});
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code), (e) => {
    console.log(`ERROR ${errorType(e)}`);
    process.exit(1);
  });
}

module.exports = { USAGE, countRewardJobs, applyRewardJobs, main };
