'use strict';

const mongoose = require('mongoose');
const { encryptedNumber, bindEncryptedAadOnUpdate } = require('./encryptedField');

// Per-metric physiological time series (W4-004, A1).
//
// WHY THIS COLLECTION EXISTS (D1). `MedicalProfile` stores exactly ONE scalar per metric —
// the latest aggregate — so `hrv` is a number with no history, no spread and no trend. But
// `translate()` scores stress as a robust z against `baselines.hrvMedian/hrvMAD`, and
// `computeBaselines()` only ever returned `{rhrMedian, rhrMAD}`: every user in production is
// therefore scored against the population constant `{45, 8}`. A median and a MAD cannot be
// recovered from a scalar; they need the samples. This collection is those samples.
//
// It is deliberately NOT a second BiometricLog. BiometricLog is heart rate only, one row per
// reading, at socket cadence (up to 1/min/user); VitalSample is the low-rate metrics a wearable
// reports a handful of times a day — HRV, device-computed resting HR, respiration, SpO2, body
// battery, stress level. Merging them would either force a metric discriminator onto the hot
// HR path or bloat this one with millions of rows. The metric vocabulary is intentionally the
// SUPERSET of what consent v1 collects: the dormant Garmin S2S lanes (respiration, SpO2, body
// battery, stress level — §0.2.3) have a place to land the day consent v2 ships, and until then
// simply no writer produces them. A schema is not data collection.
//
// SPECIAL-CATEGORY (GDPR Art. 9). `value` is AES-256-GCM encrypted at rest, AAD-bound to the
// owning userId, exactly like BiometricLog.heartRate (audit F3). Consequences that are easy to
// get wrong, so they are stated here:
//   - Range validation must decrypt first — see the pre-validate hook below. A per-FIELD
//     min/max (the `encryptedNumber` option) cannot express "25-150 for restingHeartRate but
//     0-100 for spO2" on one shared path, so the check is metric-aware and lives on the doc.
//   - AAD binds to `this.userId`, read off the document at SET time. Construct with `userId`
//     FIRST (`{ userId, metric, value, ... }`) — Mongoose applies object keys in order, and a
//     `value` assigned before `userId` exists is encrypted unbound. Both behaviours are pinned
//     in tests/vitalSample.integration.test.js so this comment cannot quietly become false.
//   - Reads must NOT use `.lean()` where the plaintext is wanted: lean skips getters and hands
//     back ciphertext.
//
// ERASURE (§0.4 S5). Registered in the SAME task that introduces it, in all five places:
// services/privacy/erasure.js, scripts/gdpr-delete.js, services/privacy/userDataExport.js,
// services/privacy/wearableErasure.js (source-scoped, wearable-derived) and the retention note
// below. tests/shadow.qa4.crypto.test.js discovers every model carrying a `userId` field and
// fails if the cascade misses one — this model went red there before it went green.

// Bumped when the stored shape changes (S15). Present on every row so a migration can tell
// generations apart without guessing from field presence.
const VITAL_SAMPLE_VERSION = 1;

// The metric vocabulary. Kept byte-identical to the runtime telemetry DTO's METRICS minus
// `heartRate` (which lives in BiometricLog); the equality is pinned in the test suite rather
// than trusted, because a silent divergence here is a silently-dropped metric.
const VITAL_METRICS = Object.freeze([
  'hrv',
  'restingHeartRate',
  'respirationRate',
  'spO2',
  'bodyBattery',
  'stressLevel',
]);

const VITAL_SOURCES = Object.freeze(['garmin', 'apple_health', 'health_connect', 'suunto']);

// Physiological admissibility per metric — the outer envelope of "a body could report this",
// not a normality band. Deliberately generous at both ends: the job here is to keep a unit
// error or a sensor fault out of a median, not to decide what is healthy.
//   hrv               RMSSD in ms. 1-400 brackets the clinical range at both extremes.
//   restingHeartRate  bpm. 25 (elite bradycardia) to 150 (tachycardic at rest).
//   respirationRate   breaths/min. 3-60 spans apnoeic to severe tachypnoea.
//   spO2              %. 50-100 — below 50 no consumer pulse oximeter reports meaningfully.
//   bodyBattery       Garmin's 0-100 index.
//   stressLevel       Garmin's 0-100 index; the API also emits -1/-2 sentinels for
//                     "unmeasurable", which the adapter must drop rather than store (D16).
const METRIC_RANGES = Object.freeze({
  hrv:              Object.freeze({ min: 1,  max: 400 }),
  restingHeartRate: Object.freeze({ min: 25, max: 150 }),
  respirationRate:  Object.freeze({ min: 3,  max: 60 }),
  spO2:             Object.freeze({ min: 50, max: 100 }),
  bodyBattery:      Object.freeze({ min: 0,  max: 100 }),
  stressLevel:      Object.freeze({ min: 0,  max: 100 }),
});

const vitalSampleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  metric: { type: String, enum: VITAL_METRICS, required: true },
  value:  encryptedNumber({ required: true }), // range is metric-aware — see the hook below
  recordedAt: { type: Date, required: true },
  source: { type: String, enum: VITAL_SOURCES, required: true },

  // D13: the hour a reading belongs to is the SUBJECT's hour, not the server's. Optional and
  // additive — every shipped client predates this field, so absence means "fall back to the
  // server hour" rather than "reject". JS convention (UTC minus local, inverted), same band as
  // the telemetry DTO: [-840, +720] covers UTC-14:00 through UTC+14:00.
  tzOffsetMinutes: { type: Number, default: null, min: -840, max: 720 },

  v: { type: Number, default: VITAL_SAMPLE_VERSION },
}, {
  timestamps: false,
  toJSON:   { getters: true },
  toObject: { getters: true },
});

// Metric-aware range validation. The stored value is ciphertext, so this reads through the
// getter (which decrypts) — a tampered blob reads as null, becomes NaN here, and is rejected
// rather than persisted. Runs on save() AND insertMany(), which is the path the ingest lanes
// use.
//
// SYNCHRONOUS, no `next` parameter, on purpose: Mongoose 9 invokes document pre-hooks with no
// callback argument, so the classic `function (next) { … next(); }` style throws
// "next is not a function" on EVERY write. That is not a hypothetical — it is what this hook
// did in its first draft, and the round-trip suite (R9) is what caught it.
vitalSampleSchema.pre('validate', function enforceMetricRange() {
  const range = METRIC_RANGES[this.metric];
  if (!range) return; // unknown metric — the enum validator owns that error
  const n = Number(this.value); // getter decrypts
  if (!Number.isFinite(n)) {
    this.invalidate('value', `vital value for ${this.metric} is not a finite number`);
  } else if (n < range.min || n > range.max) {
    this.invalidate('value', `vital value for ${this.metric} outside [${range.min}, ${range.max}]`);
  }
});

// The one read pattern the baseline engine uses: "this user's samples of THIS metric over a
// window, in time order". Compound and ordered so the window scan is a range seek, not a
// collection scan the moment a user has a year of rows.
vitalSampleSchema.index({ userId: 1, metric: 1, recordedAt: -1 });

// Retention (T3.1, §0.4 S5). Longest reader is the 30-day chronic baseline window; retain 90
// days — the same 3x headroom, and the same 90-day figure, as BiometricLog and ServeEvent, so
// there is ONE retention story for special-category data rather than three. Env-tunable.
// DEPLOY NOTE: creating this TTL index on a prod collection is a background index build —
// a Pause & Guide action for Daniel (HITL), never performed by an agent. The code ships
// regardless; Mongoose builds indexes automatically in dev/test.
const RETENTION_DAYS = Number(process.env.VITAL_SAMPLE_RETENTION_DAYS) || 90;
vitalSampleSchema.index({ recordedAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 3600 });

// Every encrypted leaf of this schema needs the W4-D76 pipeline refusal: an aggregation-pipeline
// update runs server-side, so no setter fires and the value would be stored as plaintext.
// Registered before `mongoose.model()` so the hook exists on every query.
vitalSampleSchema.plugin(bindEncryptedAadOnUpdate);

const VitalSample = mongoose.model('VitalSample', vitalSampleSchema);

VitalSample.VITAL_METRICS = VITAL_METRICS;
VitalSample.VITAL_SOURCES = VITAL_SOURCES;
VitalSample.METRIC_RANGES = METRIC_RANGES;
VitalSample.VITAL_SAMPLE_VERSION = VITAL_SAMPLE_VERSION;

module.exports = VitalSample;
