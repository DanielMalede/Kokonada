'use strict';

// J2 (BE-084, BE-087) — the state-recompute job's contract: what names a job, and how it is queued.
//
// THE JOB ID (DT-1). BullMQ writes a job's id into the queue's event log (`bull:state-vector-recompute:events`)
// on every step of its life, and the failed-job log line prints it. It used to be `state-vector-<userId>`,
// so that log held every user id that ever had a recompute. It is now a keyed pseudonym: `sv-` plus the
// first 22 base64url characters (132 bits) of an HMAC-SHA256 of the user id under a subkey HKDF derives
// from ENCRYPTION_KEY for this one purpose (utils/encryption.keyedPseudonym).
//   • Deterministic, so a burst of syncs for one user still coalesces into ONE job, on every replica:
//     BullMQ refuses a second job with an id that is still queued.
//   • Not the user id, and not an unkeyed hash of it: ObjectIds are enumerable, so an unkeyed hash links
//     back for anyone with the database. The server, which holds the key, can link it back.
//   • base64url: no `:` (BullMQ forbids it in a custom id), never an integer (BullMQ refuses those too),
//     and never a run of 24 hex characters, so a count that looks for user ids in the log reads 0.
// Without ENCRYPTION_KEY it throws, inside each producer's own try, so nothing is queued.

const { keyedPseudonym } = require('../utils/encryption');
const { QUEUES } = require('./definitions');
const { createConnection } = require('../config/redis');

const STATE_JOB_ID_INFO = 'kokonada:job-id:state-vector-recompute:v1';

// THE RESULT (DT-2). BullMQ writes a finished job's return value into the event log next to its id, so a
// result that varied with what the job found (refused, refreshed, undone) would record a per-pseudonym
// consent trace. Every job returns this same constant.
const STATE_JOB_RESULT = Object.freeze({ done: true });

/** `sv-` + 22 base64url characters: the job id for this user's state recompute. */
function stateVectorJobId(userId) {
  return `sv-${keyedPseudonym(STATE_JOB_ID_INFO, String(userId)).slice(0, 22)}`;
}

/** The options both producers queue the job with: its id, its delay, and deletion once it has run. */
function stateVectorJobOptions(userId, delay) {
  return { jobId: stateVectorJobId(userId), delay, removeOnComplete: true, removeOnFail: true };
}

// THE EVENT LOG'S TIME BOUND (DT-3 T-a). The log names every job by its pseudonym, and the server can link
// that back to the account. BullMQ bounds it by count only (QUEUE_EVENTS_MAX_LEN in queue.js, about 100 to
// 200 entries), so the daily `sessionTrim` job also deletes every entry more than 24 hours old
// (`stateEvents=`): no entry is kept more than 2 days while that job runs. An entry's id is
// `<ms>-<seq>` stamped by the REDIS SERVER's clock, so the cut comes from Redis TIME, never the app's
// clock, and the trim is exact (`XTRIM MINID`, needs Redis 6.2 or later).
const STATE_EVENTS_KEY = `bull:${QUEUES.STATE_VECTOR_RECOMPUTE}:events`;
const STATE_EVENTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Its own connection, as the job purge has (queues/userJobPurge.js): the log lives in the job queue's
// Redis, which the app's cache client may not be connected to (app/worker.js never connects it). It fails
// fast and never waits: no retry, no buffering, a connect timeout, closed after every call.
const TRIM_CONNECTION = Object.freeze({
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
  connectTimeout: 1500,
  disconnectTimeout: 100,
});

/**
 * Deletes every state-recompute event-log entry more than 24 hours old by the Redis server's clock.
 * Returns how many went. Without REDIS_URL nothing can have been queued (enqueue is a no-op): 0, and no
 * connection is opened. Throws when the job queue cannot be reached, so the daily job counts a failed step.
 */
async function trimStateEvents() {
  if (!process.env.REDIS_URL) return 0;
  const connection = createConnection(TRIM_CONNECTION);
  connection.on('error', () => {}); // a failure is reported through the rejection, never as an event
  try {
    await connection.connect();
    const [seconds, micros] = await connection.time();
    const cut = Number(seconds) * 1000 + Math.floor(Number(micros) / 1000) - STATE_EVENTS_MAX_AGE_MS;
    return await connection.xtrim(STATE_EVENTS_KEY, 'MINID', cut);
  } finally {
    connection.disconnect();
  }
}

module.exports = {
  STATE_JOB_ID_INFO,
  STATE_JOB_RESULT,
  STATE_EVENTS_KEY,
  STATE_EVENTS_MAX_AGE_MS,
  stateVectorJobId,
  stateVectorJobOptions,
  trimStateEvents,
};
