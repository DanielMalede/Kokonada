'use strict';

const mongoose = require('mongoose');
const { PERSONAL_TERMS, DELTA_LIMIT } = require('../agents/runtime/learning/personalization');

/**
 * W4-013 (B7) · the third and last learned artifact of this wave: a per-listener overlay on the
 * five scoring weights `selection/score.js` otherwise reads out of the environment for everyone.
 *
 * The row holds §M.15's `δ` and nothing else — four signed numbers in `[-0.4, +0.4]` saying how
 * much this person's ranking should lean on their own affinity, on biosonic fit, on the mood
 * genre allow-list and on proven rotation, relative to the deployment default. The weights
 * themselves are never stored: they are `w_global · (1 + δ)`, so a change to the global table
 * moves every listener with it instead of leaving a population frozen against a table that no
 * longer exists.
 *
 * ── WHY THIS IS A COLLECTION AND B5's POSTERIOR WAS NOT ─────────────────────────────────────
 *
 * W4-013's other half deliberately hung its Beta posterior off the existing `RewardEvent` bucket
 * row, because it shared that row's address, lifetime and privacy story exactly. This one shares
 * none of them: it is addressed by the USER alone (there are no bucket coordinates in a scoring
 * weight), and it is read once per GENERATION rather than once per play. Folding it into
 * `RewardEvent` would mean either duplicating the same four numbers across every bucket a
 * listener has — with no rule for which copy wins — or picking an arbitrary bucket to be the
 * home of a user-level fact. §0.4 S5 names `PersonalWeights` as a new collection for exactly
 * this reason, and the price is paid in full below.
 *
 * ── RETENTION: A STALENESS EVICTION, AND ALSO THE COLD START ────────────────────────────────
 *
 * The TTL is keyed to `updatedAt`, so a listener who keeps playing never expires — every
 * observation pushes their expiry out. What expires is an overlay nobody has reinforced for a
 * year, and expiry is not a loss: a missing row means cold start, which means global weights,
 * which is precisely where §M.15's shrink-to-global was taking that row anyway. 365 days matches
 * `RewardEvent` for the same reason it was chosen there — this is a slowly-accumulating statistic
 * whose sparse cases are the informative ones, not a raw sample stream to be minimized to 90 days.
 *
 * ── ZERO-KNOWLEDGE (§0.2.2) ─────────────────────────────────────────────────────────────────
 *
 * Nothing here is encrypted, and that is a decision rather than an omission, argued on the same
 * footing as `RewardEvent`'s: `deltas` are four MUSIC-RANKING coefficients. They are not
 * physiological magnitudes, they carry no vital, no state label and no track identity of any
 * provider, and they cannot be inverted into one — δ is a residual of the scorer's own output,
 * bounded to ±0.4 and shared by every play a listener has ever made. The integration suite pins
 * the stored key set CLOSED so any field added later has to be argued against this paragraph.
 *
 * ── WHERE THE ±0.4 BOUND IS ACTUALLY ENFORCED ───────────────────────────────────────────────
 *
 * NOT here, and the absence is deliberate rather than an oversight. A Mongoose `min`/`max` on the
 * paths below would not run: this row is only ever written by an aggregation-PIPELINE update (see
 * `personalWeightsRepo` for why the decay makes that necessary), and pipeline updates apply no
 * schema validators at all — the same trap §0.2.2 names for encryption setters and `RewardEvent`'s
 * header names for its CC0 gate. A validator that never executes is worse than none, because it
 * reads like a guarantee. The bound is enforced in the two places that DO execute: the update
 * pipeline's own `$min`/`$max`, and `personalization._sane` on every read.
 *
 * ── S5 REGISTRATION (done in THIS PR) ───────────────────────────────────────────────────────
 *
 * User-scoped, and registered in `services/privacy/erasure.js`, `scripts/gdpr-delete.js`,
 * `services/privacy/userDataExport.js`, the Retention table in `docs/PRIVACY_DECLARATIONS.md`,
 * and `services/privacy/wearableErasure.js` — there as a DELIBERATE EXCLUSION with the same
 * reasoning `RewardEvent` carries, since a scoring weight is not wearable-derived. The
 * completeness guards discover it automatically by the `userId` field below.
 */

const PERSONAL_WEIGHTS_VERSION = 1;

/** Each learnable term starts at 0 — no opinion, i.e. exactly the global weight. */
const deltasSchema = new mongoose.Schema(
  Object.fromEntries(PERSONAL_TERMS.map((d) => [d, { type: Number, default: 0 }])),
  { _id: false },
);

const personalWeightsSchema = new mongoose.Schema({
  // The whole address. One row per listener; the unique index below is what stops a burst of
  // concurrent plays from forking a person into two overlays that each know half their taste.
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },

  deltas: { type: deltasSchema, required: true, default: () => ({}) },

  // How many observations this overlay rests on. Not used by the maths — §M.15 has no confidence
  // term — but a dark-launched learner whose telemetry cannot say "this listener has 3 plays
  // behind their overlay" cannot be evaluated at all.
  updates: { type: Number, default: 0, min: 0 },

  updatedAt: { type: Date, required: true },

  v: { type: Number, default: PERSONAL_WEIGHTS_VERSION },
}, {
  timestamps: false,
  // `v` above is this project's explicit schema-version field (S15). Mongoose's own `__v` is dead
  // weight on a document only ever written by an update pipeline, and it would break the
  // closed-key-set pin that keeps this row auditable.
  versionKey: false,
});

// Staleness eviction — see the header. Env-tunable so shortening it is a deployment decision
// rather than a redeploy (the `RewardEvent` convention).
const RETENTION_DAYS = Number(process.env.PERSONAL_WEIGHTS_RETENTION_DAYS) || 365;
personalWeightsSchema.index({ updatedAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 3600 });

const PersonalWeights = mongoose.model('PersonalWeights', personalWeightsSchema);

module.exports = {
  PersonalWeights,
  PERSONAL_WEIGHTS_VERSION,
  RETENTION_DAYS,
  DELTA_LIMIT,
};
