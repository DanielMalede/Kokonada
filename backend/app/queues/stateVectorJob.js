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

module.exports = {
  STATE_JOB_ID_INFO, STATE_JOB_RESULT, stateVectorJobId, stateVectorJobOptions,
};
