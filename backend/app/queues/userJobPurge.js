'use strict';

// J1 (BE-074) — erases one account's jobs from the job queue.
//
// A BullMQ job is a copy of its payload in an unencrypted Redis blob. The learning jobs carry the user
// id and values derived from the heart rate (services/learning/rewardDispatch.js), so account deletion
// and a health-consent withdrawal remove the account's jobs that have not run yet, plus any finished
// job the code before J1 kept. J2 (BE-087): so are the state-recompute jobs, which hold only the user id
// but, when they run, read the health data and write the resting baseline, the carried state estimate and
// the stored profile again; their worker also re-checks consent itself (workers/stateVector.worker.js). Every job is now deleted once it has run (queues/queue.js and
// workers/index.js), so after the one-off clean (scripts/rewardJobs.js) this normally finds nothing.
//
// Who calls it, and who must not (ADR-0015, pinned in tests/userJobPurge.guards.test.js):
//   services/privacy/erasure.js and scripts/gdpr-delete.js — account deletion;
//   services/privacy/consent.js — a withdrawal by a user who had granted health-data consent.
// Never a provider disconnect: unpairing a watch or disconnecting Spotify keeps the learned preferences.
//
// What it does not reach: a job a worker is running (BullMQ refuses to remove a locked job; it is
// counted as `inFlight`, and the queue deletes it once it has run, after its write has landed), and a
// job queued after the purge by a play that ends while the request is processed. Both are declared in
// docs/PRIVACY_DECLARATIONS.md.
//
// FAILS FAST, NEVER WAITS. It runs inside DELETE /api/auth/account and POST /api/consent/withdraw, and
// both report a failure rather than block on it. A new BullMQ queue never settles while Redis is down
// (its readiness check gives up only when its connection ends, and a default connection retries for
// ever), so this one has its own connection that does not retry and does not buffer, a connect
// timeout, an overall budget, and is closed after every call. It throws; the caller owns the token.

const { Queue } = require('bullmq');
const { QUEUES } = require('./definitions');
const { createConnection } = require('../config/redis');

/**
 * Every queue whose jobs carry a user's data, with how to read the owner from a job's payload. A new
 * producer that puts a user id in a job must register its queue here (or be listed, with its reason,
 * in tests/userJobPurge.guards.test.js).
 */
const USER_JOB_QUEUES = Object.freeze([
  Object.freeze({ name: QUEUES.REWARD_INGEST, ownerOf: (data) => data?.userId }),
  // J2 (DT-7): the owner from the payload, not the job id, so a job queued under the old id
  // (`state-vector-<userId>`, before the pseudonym) or under none is found too.
  Object.freeze({ name: QUEUES.STATE_VECTOR_RECOMPUTE, ownerOf: (data) => data?.userId }),
]);

/** Every registered queue at zero: the no-Redis answer, and the start of every count. */
const zeroByQueue = () => Object.fromEntries(USER_JOB_QUEUES.map((q) => [q.name, { removed: 0, inFlight: 0 }]));

// Every state a job can be removed from: all but running ('active'), which BullMQ locks.
const REMOVABLE_STATES = Object.freeze(['wait', 'paused', 'prioritized', 'delayed', 'waiting-children', 'completed', 'failed']);
const RUNNING_STATE = 'active';
const PAGE_SIZE = 500;

/** The whole call, connection included, ends within this. */
const PURGE_BUDGET_MS = 2500;
const CONNECT_TIMEOUT_MS = 1500;
const PURGE_CONNECTION = Object.freeze({
  enableOfflineQueue: false,
  retryStrategy: () => null,
  connectTimeout: CONNECT_TIMEOUT_MS,
  // ioredis disconnects politely (a half-close) and forces the socket shut only after this. A Redis
  // that has stopped reading never completes the polite part, so the default (2 s) would leave the
  // socket open long after the purge has reported.
  disconnectTimeout: 100,
});

function ownerId(userId) {
  const id = userId === null || userId === undefined ? '' : String(userId).trim();
  if (!id) throw new Error('refusing a job purge without a user id');
  return id;
}

function budgetSpent() {
  const err = new Error(`the job queue did not answer within ${PURGE_BUDGET_MS} ms`);
  err.name = 'JobPurgeTimeoutError';
  return err;
}

/** Opens the registered queues on one dedicated connection, runs `work`, and always closes both. */
async function withUserJobQueues(work) {
  const connection = createConnection(PURGE_CONNECTION);
  connection.on('error', () => {}); // a failure is reported through the rejection, never as an event
  const queues = USER_JOB_QUEUES.map((entry) => {
    const queue = new Queue(entry.name, { connection, skipMetasUpdate: true });
    queue.on('error', () => {});
    return { entry, queue };
  });
  let timer;
  const budget = new Promise((_, reject) => {
    timer = setTimeout(() => reject(budgetSpent()), PURGE_BUDGET_MS);
  });
  try {
    return await Promise.race([work(queues), budget]);
  } finally {
    clearTimeout(timer);
    // Disconnect first: it rejects anything still pending, so closing the queues cannot wait on it.
    // BullMQ never closes a connection it was handed, so this is the only place it is closed.
    connection.disconnect();
    await Promise.all(queues.map(({ queue }) => queue.close().catch(() => {})));
  }
}

/**
 * The account's jobs on one queue: the ids that can be removed, and the ids a worker is running.
 * Read page by page, newest first, BEFORE anything is removed, so removals cannot shift a page.
 * A job is the account's only when its payload names exactly that id; a job that names no one never
 * matches.
 */
async function findUserJobs({ entry, queue }, id) {
  const removable = new Set();
  const running = new Set();
  for (const state of [...REMOVABLE_STATES, RUNNING_STATE]) {
    for (let start = 0; ; start += PAGE_SIZE) {
      const page = await queue.getJobs([state], start, start + PAGE_SIZE - 1);
      for (const job of page) {
        // A job deleted between the listing and the read comes back empty.
        if (!job || entry.ownerOf(job.data) !== id) continue;
        (state === RUNNING_STATE ? running : removable).add(job.id);
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  // A job that moved to running while the earlier states were read is counted once, as running.
  for (const jobId of running) removable.delete(jobId);
  return { removable: [...removable], running: running.size };
}

/**
 * Removes the account's jobs that are not running. Returns `{removed, inFlight, byQueue}`: `inFlight`
 * counts the jobs a worker held, which run to the end and are then deleted by the queue; `byQueue` gives
 * the same two counts for each registered queue (J2, P13), so a caller can report each kind of job on its
 * own. Without REDIS_URL nothing can have been queued (enqueue is a no-op), so there is nothing to
 * remove. Throws on a blank id, on any Redis failure, and when the budget is spent.
 */
async function purgeUserJobs(userId) {
  const id = ownerId(userId);
  if (!process.env.REDIS_URL) return { removed: 0, inFlight: 0, byQueue: zeroByQueue() };
  return withUserJobQueues(async (queues) => {
    const byQueue = zeroByQueue();
    for (const registered of queues) {
      const counts = byQueue[registered.entry.name];
      const { removable, running } = await findUserJobs(registered, id);
      counts.inFlight += running;
      for (const jobId of removable) {
        // 0: a worker took the job after it was listed, so it holds the lock.
        if ((await registered.queue.remove(jobId)) === 1) counts.removed += 1;
        else counts.inFlight += 1;
      }
    }
    const total = (key) => Object.values(byQueue).reduce((n, c) => n + c[key], 0);
    return { removed: total('removed'), inFlight: total('inFlight'), byQueue };
  });
}

/** The same jobs, counted and left in place (the gdpr-delete dry run). */
async function countUserJobs(userId) {
  const id = ownerId(userId);
  if (!process.env.REDIS_URL) return { jobs: 0, inFlight: 0 };
  return withUserJobQueues(async (queues) => {
    let jobs = 0;
    let inFlight = 0;
    for (const registered of queues) {
      const found = await findUserJobs(registered, id);
      jobs += found.removable.length;
      inFlight += found.running;
    }
    return { jobs, inFlight };
  });
}

module.exports = { USER_JOB_QUEUES, PURGE_BUDGET_MS, purgeUserJobs, countUserJobs };
