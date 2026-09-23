'use strict';

const mongoose = require('mongoose');
const { DOMAINS, BANDS } = require('../agents/runtime/knowledge/stateTaxonomy');
const { HOUR_BINS } = require('../agents/runtime/learning/feedbackLoop');

/**
 * The two learned artifacts of W4-011 (B6). ADR-0012 splits learning into two tracks and says
 * plainly that the separation "is the compliance boundary and must not be 'simplified' back
 * together", so they are two collections in one file rather than one convenient table:
 *
 *   TRACK A · `RewardEvent`    — per-user context-bucket aggregates. Provider-NEUTRAL by
 *                                construction: the row is addressed by {stateDomain, targetBand,
 *                                hourBin} and carries no track identity of any provider, so it
 *                                may legitimately learn from Spotify-served plays. This is where
 *                                personalization actually lives.
 *   TRACK B · `TrackPosterior` — per-RECORDING Beta posteriors, CC0 `mbid:` only, GLOBAL (no
 *                                userId). Gated fail-closed at the schema.
 *
 * ── WHY THE TRACK-B GATE IS A HOOK AND NOT ONLY A VALIDATOR ─────────────────────────────────
 *
 * ADR-0012 requires the CC0 rule to be "rejected by a schema-level validator (fail-closed)". A
 * Mongoose `validate` alone does not deliver that: it does not run on `findOneAndUpdate` /
 * `updateOne` / `updateMany` unless the CALLER remembers `runValidators: true` — and an upsert
 * is exactly how a feedback loop writes. A guard a caller disarms by forgetting an option is a
 * convention, not a containment. It is the same trap §0.2.2 already names for encryption
 * ("Mongoose setters do NOT run on findOneAndUpdate($set)"). So the rule is enforced THREE ways:
 * the path validator (document writes), a query pre-hook over every update verb (query writes),
 * and `feedbackLoop.isCc0Key` upstream. The hook also refuses an upsert whose recording it
 * cannot even identify — an unaddressable insert is the one case where "no key found" must not
 * mean "allowed".
 *
 * ── RETENTION: A STALENESS EVICTION, NOT A DATA-LOSS CLOCK ──────────────────────────────────
 *
 * `RewardEvent`'s TTL is keyed to `updatedAt`, not to a creation date, so a bucket a person
 * still listens in NEVER expires — every play pushes its own expiry out. What does expire is a
 * bucket nobody has visited for a year: learning about a context the person has left. That makes
 * the window both data-minimization (§0.4 S5) and correct behaviour.
 *
 * The window is 365 days rather than this repo's usual 90 because the two are answering
 * different questions. 90 days is right for SAMPLES (`BiometricLog`, `VitalSample`,
 * `MorningState`) — raw special-category readings, minimized aggressively, with the longest
 * reader being a 30-day baseline. A bucket is a slowly-accumulating count, and the sparse ones
 * are the informative ones: a person who trains on Saturday mornings visits
 * {movement, peak, morning} about 13 times in 90 days, which is not enough to outrun any prior.
 * A 90-day window here would not minimize data so much as guarantee the learner never learns.
 *
 * `TrackPosterior` deliberately has NO TTL and NO userId: it is a global CC0-corpus artifact on
 * the same footing as `AudioFeature` / `TrackEmbedding` (see `erasure.js`'s standing note on
 * why per-user erasure excludes those) — it is about a public-domain recording, not about a
 * person, and there is no personal association in it to erase.
 *
 * ── ZERO-KNOWLEDGE (§0.2.2, audit F3) ───────────────────────────────────────────────────────
 *
 * Nothing here is encrypted, and that is a decision rather than an omission. `rewardSum`/`count`
 * are outcome statistics, not physiological magnitudes. `stateDomain` is one of SIX coarse
 * domains — never one of the taxonomy's 34 clinical-sounding labels, which stay internal and
 * encrypted where they are stored at all (`MedicalProfile.stateVector`, `MorningState.stateId`).
 * ADR-0012 §1 authored this shape explicitly ("Bucket coordinates are coarse (ADR 0005: no
 * numeric vitals)"), and the coordinates must be queryable: they are the address of an upsert
 * under a unique index, and AES-GCM's per-call random IV makes an encrypted key unindexable.
 * `tests/rewardEvent.integration.test.js` pins the stored key set CLOSED so any field added
 * later has to be argued against this paragraph.
 *
 * ── S5 REGISTRATION (done in THIS PR) ───────────────────────────────────────────────────────
 *
 * `RewardEvent` is user-scoped and is registered in `services/privacy/erasure.js`,
 * `scripts/gdpr-delete.js`, `services/privacy/userDataExport.js`,
 * `services/privacy/wearableErasure.js` (all-or-nothing derived-aggregate rule, alongside
 * `MedicalProfile`/`MorningState`) and the Retention table in `docs/PRIVACY_DECLARATIONS.md`.
 * The completeness guards discover it automatically by the `userId` field below.
 */

const REWARD_EVENT_VERSION = 1;

/** Beta(1,1) — the uniform prior. See `rewardRepo` for why it is seeded, not defaulted. */
const PRIOR = Object.freeze({ alpha: 1, beta: 1 });

/** Anchored so a composite key such as `…:mbid:…` cannot pass (the tripwire's counter-example). */
const CC0_KEY_RE = /^mbid:/;

// ── Track A ─────────────────────────────────────────────────────────────────────────────────

/**
 * W4-013's novelty posterior. `_id: false` because it is a value on the bucket, not a document
 * with an identity, and an `_id` here would appear in the closed key set as noise.
 */
const noveltyPosteriorSchema = new mongoose.Schema({
  alpha: { type: Number, required: true, min: 0 },
  beta:  { type: Number, required: true, min: 0 },
}, { _id: false });

const rewardEventSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // The address. Enums come from the taxonomy itself, so a bucket can never name a domain or a
  // band the state model does not have (the D11 / W4-D42 "second disagreeing table" class).
  bucket: {
    stateDomain: { type: String, enum: DOMAINS, required: true },
    targetBand:  { type: String, enum: BANDS,   required: true },
    hourBin:     { type: Number, required: true, min: 0, max: HOUR_BINS - 1 },
  },

  // Sum and count rather than a running mean: a mean cannot be updated by one atomic `$inc`,
  // and two concurrent playback events updating a mean would lose one of them.
  rewardSum: { type: Number, default: 0 },
  count:     { type: Number, default: 0, min: 0 },

  // W4-013 (B5) · the novelty bandit's Beta posterior for THIS bucket: how well did serving music
  // the listener had never heard actually go, here, at this hour, in this state.
  //
  // It rides on the bucket row rather than in a collection of its own because it has the same
  // address, the same lifetime and the same privacy story as the aggregate beside it. A separate
  // collection keyed by {userId, stateDomain, targetBand, hourBin} would be a second table
  // holding the counterpart of a row that already exists — the D11 / W4-D42 class — and would
  // need all five §0.4 S5 surfaces re-registered to say exactly what this one already says.
  //
  // Absent by default (`default: undefined`), which is what makes "this bucket has never taught
  // the bandit anything" distinguishable from "the bandit has learned it is a 50/50". The
  // controller reads the first as ABSTAIN, and that is the dormancy invariant's foundation.
  //
  // It does NOT widen the row's disclosure: two counters about a DECISION (serve novelty or not)
  // in a coarse context, with no recording, provider or vital anywhere in them — the same class
  // of outcome statistic as `rewardSum`/`count`, argued against the closed-key paragraph above.
  novelty: { type: noveltyPosteriorSchema, default: undefined },

  updatedAt: { type: Date, required: true },

  v: { type: Number, default: REWARD_EVENT_VERSION },
}, {
  timestamps: false,
  // `v` below is this project's explicit schema-version field (S15). Mongoose's own `__v`
  // optimistic-concurrency key is dead weight on a document only ever touched by atomic
  // operators, and it would break the closed-key-set pin that keeps this row auditable.
  versionKey: false,
});

// The identity the upsert keys on — and the reason a burst of concurrent plays cannot fork one
// bucket into two rows that each know half the truth.
rewardEventSchema.index(
  { userId: 1, 'bucket.stateDomain': 1, 'bucket.targetBand': 1, 'bucket.hourBin': 1 },
  { unique: true },
);

// Staleness eviction — see the header. Env-tunable so an operator can shorten it without a
// code change (and so a shorter window is a deployment decision, not a redeploy).
const RETENTION_DAYS = Number(process.env.REWARD_EVENT_RETENTION_DAYS) || 365;
rewardEventSchema.index({ updatedAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 3600 });

// ── Track B ─────────────────────────────────────────────────────────────────────────────────

const CC0_MESSAGE = 'TrackPosterior accepts CC0 mbid: recordings only (ADR-0012 Track B)';

const trackPosteriorSchema = new mongoose.Schema({
  recordingKey: {
    type: String,
    required: true,
    unique: true,
    validate: { validator: (v) => CC0_KEY_RE.test(v), message: CC0_MESSAGE },
  },
  alpha: { type: Number, default: PRIOR.alpha, min: 0 },
  beta:  { type: Number, default: PRIOR.beta,  min: 0 },
  updatedAt: { type: Date, required: true },
  v: { type: Number, default: REWARD_EVENT_VERSION },
}, {
  timestamps: false,
  versionKey: false,
});

/**
 * Every string a query write could turn into a stored `recordingKey`, from either the filter or
 * the payload. `$eq`/`$in` are handled because a filter is not always a bare string; anything
 * else (a regex, a `$gt`) yields nothing and is treated as "cannot identify", which the caller
 * below refuses on insert.
 */
function _candidateKeys(node) {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(_candidateKeys);
  if (node && typeof node === 'object') {
    const out = [];
    if (typeof node.$eq === 'string') out.push(node.$eq);
    if (Array.isArray(node.$in)) out.push(..._candidateKeys(node.$in));
    return out;
  }
  return [];
}

// `async` + throw rather than a `next` callback: Mongoose 9 drives query middleware as
// promises, and a handler that declares `next` is simply called without one.
async function _guardQuery() {
  const filter = this.getFilter() ?? {};
  const update = this.getUpdate() ?? {};
  const payload = Array.isArray(update)
    ? {} // aggregation-pipeline updates cannot introduce a key without a $set stage we'd see below
    : { ...(update.$set ?? {}), ...(update.$setOnInsert ?? {}), ...update };

  const keys = [
    ..._candidateKeys(filter.recordingKey),
    ..._candidateKeys(payload.recordingKey),
  ];

  const offender = keys.find((k) => !CC0_KEY_RE.test(k));
  if (offender !== undefined) throw new Error(`${CC0_MESSAGE} — refused "${offender}"`);

  // Fail-closed on creation: an upsert that names no recording we can check would insert an
  // ungated row. Refusing is the only safe reading of "reject, not silently drop".
  const opts = this.getOptions?.() ?? {};
  if (opts.upsert && keys.length === 0) {
    throw new Error(`${CC0_MESSAGE} — refused an upsert that identifies no recording`);
  }
}

for (const verb of ['findOneAndUpdate', 'findOneAndReplace', 'updateOne', 'updateMany', 'replaceOne']) {
  trackPosteriorSchema.pre(verb, _guardQuery);
}

const RewardEvent = mongoose.model('RewardEvent', rewardEventSchema);
const TrackPosterior = mongoose.model('TrackPosterior', trackPosteriorSchema);

module.exports = {
  RewardEvent,
  TrackPosterior,
  REWARD_EVENT_VERSION,
  PRIOR,
  CC0_KEY_RE,
  CC0_MESSAGE,
  RETENTION_DAYS,
};
