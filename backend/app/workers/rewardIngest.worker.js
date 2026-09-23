'use strict';

const rewardRepo = require('../repositories/rewardRepo');
const personalWeightsRepo = require('../repositories/personalWeightsRepo');

/**
 * W4-011 · the write side of the feedback loop.
 *
 * Deliberately thin. The judgement already happened in the socket process (see
 * `services/learning/rewardDispatch` for why it has to), and `rewardRepo` already validates every
 * argument fail-closed before touching Mongo — a bucket the taxonomy does not contain, a
 * non-finite reward, a recording key that is not CC0. Re-stating those rules here would create a
 * second, drifting copy of the ADR-0012 boundary; the repository (and behind it the schema's own
 * query pre-hook) is the one place that decision lives.
 *
 * What this file owns is the ONE thing the queue erases: the boundary between a JSON payload and
 * a domain call. `at` crosses BullMQ as a number and has to become a `Date` again, and a payload
 * with a bad clock must write nothing rather than stamp a row with `Invalid Date`.
 *
 * Track A and Track B are written independently on purpose. ADR-0012 keeps them in separate
 * collections precisely so one can exist without the other: a play with no resolvable state still
 * teaches a CC0 recording's posterior, and a play of a Spotify recording still teaches the user's
 * context bucket.
 */
async function process(job) {
  const { userId, bucket = null, reward = null, posterior = null, novelty = null, weightStep = null, at = null } = job?.data ?? {};

  const when = typeof at === 'number' && Number.isFinite(at) ? new Date(at) : null;
  if (!when || Number.isNaN(when.valueOf())) return { bucket: false, posterior: false, novelty: false, weights: false };

  const bucketWritten = bucket
    ? await rewardRepo.recordBucketReward({ userId, bucket, reward, at: when })
    : false;

  const posteriorWritten = posterior
    ? await rewardRepo.recordTrackOutcome({
      recordingKey: posterior.recordingKey,
      delta: { alpha: posterior.alpha, beta: posterior.beta },
      at: when,
    })
    : false;

  // W4-013 (B5). A third independent write, for the same reason Track A and Track B are
  // independent: a play can teach the novelty bandit without producing a usable Beta delta for a
  // recording, and vice versa. It shares Track A's bucket address, so a job with no bucket has
  // nowhere to file it and `recordNoveltyOutcome` refuses it fail-closed.
  const noveltyWritten = novelty
    ? await rewardRepo.recordNoveltyOutcome({ userId, bucket, delta: novelty, at: when })
    : false;

  // W4-013 (B7). A FOURTH independent write, and the only one addressed by the user alone —
  // it carries no bucket and no recording, so it is the one write a play can produce when the
  // taxonomy could not name a state. `applyUpdate` validates the step fail-closed and does the
  // decay-then-step-then-clamp in a single aggregation pipeline, so nothing here re-states it.
  const weightsWritten = weightStep
    ? await personalWeightsRepo.applyUpdate({ userId, step: weightStep, at: when })
    : false;

  return { bucket: bucketWritten, posterior: posteriorWritten, novelty: noveltyWritten, weights: weightsWritten };
}

module.exports = { process };
