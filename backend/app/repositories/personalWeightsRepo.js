'use strict';

const { PersonalWeights, PERSONAL_WEIGHTS_VERSION } = require('../models/PersonalWeights');
const {
  PERSONAL_TERMS, DELTA_LIMIT, SHRINK_PER_WEEK, SHRINK_WEEK_MS,
} = require('../agents/runtime/learning/personalization');

/**
 * W4-013 (B7) · the canonical reader and writer for a listener's scoring overlay.
 *
 * ── WHY THE WRITE IS AN AGGREGATION PIPELINE AND NOT A `$inc` ───────────────────────────────
 *
 * `$inc` would express "add this step" perfectly and nothing else. The update this row needs is
 * three operations that must be ONE:
 *
 *   1. DECAY the stored δ forward from `updatedAt` to now (§M.15's shrink-to-global, applied
 *      continuously — see `personalization`'s header for why there is no weekly job),
 *   2. ADD the step,
 *   3. CLAMP the result into the trust region.
 *
 * Split across a read and a write, two concurrent plays each read the same stale `updatedAt`,
 * each decay from it, and one of the two updates is silently lost — the classic read-modify-write
 * race, on a row that a single playlist can touch fifty times. An aggregation-pipeline update
 * expresses all three atomically, in one round trip, against whatever the document holds AT THE
 * MOMENT OF THE WRITE. It is the same instrument `rewardRepo` reaches for, for the same class of
 * reason: an update whose new value depends on the old one cannot be a two-step conversation.
 *
 * The clamp being IN the pipeline (rather than only in the engine that computed the step) is the
 * containment that survives a future caller who forgets the engine: whatever anybody writes, the
 * row cannot leave `[-0.4, +0.4]`. The schema cannot do this job — see `PersonalWeights`'s header
 * on why a Mongoose validator on a pipeline-written path is a guarantee that never runs.
 *
 * ── FAIL-CLOSED BEFORE THE ROUND TRIP ───────────────────────────────────────────────────────
 *
 * Every argument is checked here before Mongo is touched, the `rewardRepo` posture: a step that
 * is entirely zero is not evidence and must not stamp `updatedAt` (which would push the TTL out
 * and reset the decay clock for a write that changed nothing), and a non-finite component is a
 * bug upstream, not an instruction.
 */

/** ms→week factor, as an aggregation expression: `0.98 ^ max(0, (at − updatedAt)/week)`. */
function _decayFactor(atMs) {
  return {
    $pow: [
      SHRINK_PER_WEEK,
      {
        // `$max` with 0 is the backwards-clock guard the engine's `decay` also applies: a row
        // stamped in the future must never AMPLIFY a δ.
        $max: [0, {
          $divide: [
            { $subtract: [atMs, { $ifNull: [{ $toLong: '$updatedAt' }, atMs] }] },
            SHRINK_WEEK_MS,
          ],
        }],
      },
    ],
  };
}

/** `clamp(stored·factor + step, ±DELTA_LIMIT)` for one term, as an aggregation expression. */
function _termExpr(term, stepValue) {
  return {
    $max: [-DELTA_LIMIT, {
      $min: [DELTA_LIMIT, {
        $add: [
          { $multiply: [{ $ifNull: [`$deltas.${term}`, 0] }, '$_decay'] },
          stepValue,
        ],
      }],
    }],
  };
}

function _usableStep(step) {
  if (!step || typeof step !== 'object') return null;
  const out = {};
  let moved = false;
  for (const term of PERSONAL_TERMS) {
    const v = step[term];
    if (v === undefined || v === null) { out[term] = 0; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) return null; // a bug upstream, not a step
    out[term] = v;
    if (v !== 0) moved = true;
  }
  return moved ? out : null;
}

/**
 * Apply one observation to a listener's overlay, creating it on first sight.
 * Returns true when the row moved.
 */
async function applyUpdate({ userId, step, at } = {}) {
  if (!userId) return false;
  const s = _usableStep(step);
  if (!s) return false;
  const when = at instanceof Date && !Number.isNaN(at.valueOf()) ? at : null;
  if (!when) return false;

  const atMs = when.valueOf();
  const deltas = {};
  for (const term of PERSONAL_TERMS) deltas[term] = _termExpr(term, s[term]);

  await PersonalWeights.updateOne(
    { userId },
    [
      // Bound once, referenced four times. A `$let` around the whole `$set` would work too; a
      // scratch field reads better and is removed in the same pipeline, so it never reaches the
      // stored document (pinned by the closed-key-set test).
      { $set: { _decay: _decayFactor(atMs) } },
      {
        $set: {
          deltas,
          updates: { $add: [{ $ifNull: ['$updates', 0] }, 1] },
          updatedAt: when,
          v: { $ifNull: ['$v', PERSONAL_WEIGHTS_VERSION] },
        },
      },
      { $unset: '_decay' },
    ],
    { upsert: true, updatePipeline: true },
  );
  return true;
}

/**
 * The serving-path read: this listener's stored overlay, or NULL.
 *
 * NULL is a real answer and the common one — it means cold start, and `personalization.overlay`
 * turns it into the caller's own global weights BY IDENTITY, which is what makes the dormancy
 * invariant a property of the maths rather than of a flag. Deliberately NOT defaulted to a zero
 * vector: a caller handed `{taste: 0, …}` could not tell "never learned" from "learned it is
 * exactly average", and only the first of those is allowed to skip the overlay entirely.
 *
 * Returns the row as the engine wants it — `{deltas, updatedAt, updates}` — because `updatedAt`
 * is not metadata here: it is the origin of the decay every reader applies.
 *
 * Does not swallow its own errors, the `rewardRepo.readNoveltyPosterior` posture: the caller on
 * the serving path already owns the "a learner must never take generation down" wrapper, and a
 * second silent catch here would hide a broken query from both of them.
 */
async function readWeights({ userId } = {}) {
  if (!userId) return null;

  const row = await PersonalWeights
    .findOne({ userId }, { deltas: 1, updatedAt: 1, updates: 1, _id: 0 })
    .lean();
  if (!row || !row.deltas) return null;

  const deltas = {};
  for (const term of PERSONAL_TERMS) {
    const v = row.deltas[term];
    deltas[term] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
  return { deltas, updatedAt: row.updatedAt ?? null, updates: row.updates ?? 0 };
}

module.exports = { applyUpdate, readWeights };
