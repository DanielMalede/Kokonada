'use strict';

const { RewardEvent, TrackPosterior, PRIOR, REWARD_EVENT_VERSION } = require('../models/RewardEvent');
const { DOMAINS, BANDS } = require('../agents/runtime/knowledge/stateTaxonomy');
const { HOUR_BINS, isCc0Key } = require('../agents/runtime/learning/feedbackLoop');

/**
 * The two canonical writers for W4-011's learned artifacts. Both are ATOMIC single-statement
 * upserts, and both return a boolean rather than a document: a caller in the playback path wants
 * to know "did this teach anything", not to hold a row.
 *
 * ── WHY THE PRIOR IS SEEDED HERE INSTEAD OF DEFAULTED ON THE SCHEMA ─────────────────────────
 *
 * A Beta posterior's prior has to be present on the very first observation, and neither obvious
 * mechanism delivers that under an upsert:
 *
 *   `default: 1` on the path      — Mongoose's setDefaultsOnInsert deliberately SKIPS a path the
 *                                   update already touches, so an insert driven by `$inc` lands
 *                                   Beta(1, 0): one success, zero possible failures. Every
 *                                   Thompson draw against that row returns ~1.0, so the first
 *                                   recording that ever succeeds becomes permanently unbeatable.
 *   `$setOnInsert: {alpha: 1}`    — MongoDB refuses two update operators on one path ("would
 *                                   create a conflict at 'alpha'"), so it cannot coexist with
 *                                   the `$inc` that carries the observation.
 *
 * An aggregation-pipeline update expresses it exactly and atomically: `alpha` becomes
 * `ifNull(alpha, PRIOR.alpha) + delta`, which is the prior on insert and the accumulator on
 * update, in one round trip and with no read-modify-write race. `updateOne` (not
 * `findOneAndUpdate`) because nothing here needs the document back.
 *
 * ── FAIL-CLOSED, TWICE ──────────────────────────────────────────────────────────────────────
 *
 * Every argument is validated here BEFORE Mongo is touched — a bucket the engine could not
 * resolve, a non-finite reward, a non-CC0 recording key. The model's own schema hook is the
 * second line and the one that actually holds the ADR-0012 boundary; this layer exists so the
 * common case never depends on an exception, and so a refusal costs no round trip.
 */

function _isBucket(bucket) {
  return !!bucket
    && DOMAINS.includes(bucket.stateDomain)
    && BANDS.includes(bucket.targetBand)
    && Number.isInteger(bucket.hourBin)
    && bucket.hourBin >= 0
    && bucket.hourBin < HOUR_BINS;
}

/**
 * Track A. Adds one observation to a user's context bucket, creating it on first sight.
 * Returns true when the aggregate moved.
 */
async function recordBucketReward({ userId, bucket, reward, at } = {}) {
  if (!userId || !_isBucket(bucket)) return false;
  if (typeof reward !== 'number' || !Number.isFinite(reward)) return false;
  const when = at instanceof Date && !Number.isNaN(at.valueOf()) ? at : null;
  if (!when) return false;

  await RewardEvent.updateOne(
    {
      userId,
      'bucket.stateDomain': bucket.stateDomain,
      'bucket.targetBand': bucket.targetBand,
      'bucket.hourBin': bucket.hourBin,
    },
    {
      $inc: { rewardSum: reward, count: 1 },
      $set: { updatedAt: when },
      $setOnInsert: { bucket, v: REWARD_EVENT_VERSION },
    },
    { upsert: true },
  );
  return true;
}

/**
 * Track B. Applies one Beta observation to a CC0 recording's posterior, seeding the uniform
 * prior on first sight. Returns true when the posterior moved.
 */
async function recordTrackOutcome({ recordingKey, delta, at } = {}) {
  if (!isCc0Key(recordingKey)) return false;
  const a = Number(delta?.alpha) || 0;
  const b = Number(delta?.beta) || 0;
  if (!(a > 0) && !(b > 0)) return false; // an exactly-neutral outcome is not evidence
  const when = at instanceof Date && !Number.isNaN(at.valueOf()) ? at : null;
  if (!when) return false;

  await TrackPosterior.updateOne(
    { recordingKey },
    [{
      $set: {
        alpha: { $add: [{ $ifNull: ['$alpha', PRIOR.alpha] }, a] },
        beta: { $add: [{ $ifNull: ['$beta', PRIOR.beta] }, b] },
        updatedAt: when,
        v: { $ifNull: ['$v', REWARD_EVENT_VERSION] },
      },
    }],
    { upsert: true, updatePipeline: true },
  );
  return true;
}

module.exports = { recordBucketReward, recordTrackOutcome, _isBucket };
