'use strict';

const mongoose = require('mongoose');
const { encryptedNumber } = require('./encryptedField');

// Per-user, per-day consolidated nightly analysis (W4-012, A6). One row per LOCAL day — the
// `dailyAnalysis.consolidate()` pure-core output, persisted so `/api/pulse/state` and later
// consumers have real morning-readiness history to read instead of recomputing it live.
//
// WHY A NEW COLLECTION AND NOT MORE MedicalProfile FIELDS. MedicalProfile is a single per-user
// AGGREGATE — one row, latest value only (the same limitation D1 exists to name for baselines).
// A change-point detector and a sleep-debt accumulator both need HISTORY: `dailyAnalysis` reads
// back several nights of this collection's own `night` field to reconstruct the multi-night
// sleep-debt input the mission's A2 spec calls for ("persist nightly values into VitalSample-
// adjacent storage or MorningState later" — this collection is that "later").
//
// ENCRYPTION (audit F3, §0.2.2). Every field that carries or is derived from a MAGNITUDE of a
// physiological reading is encrypted — the cosinor's M/A/phi are literally bpm and a clock hour;
// the CUSUM cPlus/cMinus are z-score-scaled deviations of real vitals; sleepDebt's debt/need/
// ceiling are minutes of sleep. Fields that describe CONFIDENCE IN or the CATEGORY of an estimate (not its
// physiological magnitude) stay plain, mirroring `MedicalProfile.stateVector` — `stateId` is
// encrypted, `stateConfidence` is not.
//
// ERASURE (§0.4 S5). Registered in THIS PR, in all five places: services/privacy/erasure.js,
// scripts/gdpr-delete.js, services/privacy/userDataExport.js, services/privacy/wearableErasure.js
// (bundled with MedicalProfile's all-or-nothing derived-aggregate treatment — see that file) and
// docs/PRIVACY_DECLARATIONS.md's Retention table. tests/shadow.qa4.crypto.test.js discovers this
// model by its `userId` field and fails the build if any of the first three are missed.

const MORNING_STATE_VERSION = 1;

const nightSchema = new mongoose.Schema({
  deep:  encryptedNumber({ default: null }), // minutes
  light: encryptedNumber({ default: null }),
  rem:   encryptedNumber({ default: null }),
}, { _id: false });

const cusumBranchSchema = new mongoose.Schema({
  cPlus:  encryptedNumber({ default: null }),
  cMinus: encryptedNumber({ default: null }),
  flagged:   { type: Boolean, default: false },
  direction: { type: String, enum: ['up', 'down', null], default: null },
  referenceDays: { type: Number, default: 0 },
}, { _id: false });

const morningStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  // The local-day bucket this row represents (UTC midnight of the day index — same convention as
  // `baselineEngine.localDayIndex`, so a day here always means the same day everywhere else in
  // the engine stack). Also the TTL field (below): retention and identity share one clock.
  date: { type: Date, required: true },

  readiness:           encryptedNumber({ default: null, min: 0, max: 1 }),
  readinessConfidence: { type: Number, default: null, min: 0, max: 1 },

  // Field names match `chronobiology.sleepDebt()`'s own return shape exactly ({debt, ratio,
  // need, ceiling, nights, confidence}) — the worker passes that object straight to $set with
  // no translation layer, so a schema field renamed here without renaming there would silently
  // stop persisting (Mongoose strict mode drops unknown keys rather than erroring).
  sleepDebt: {
    debt:       encryptedNumber({ default: null }), // minutes owed
    ratio:      encryptedNumber({ default: null, min: 0, max: 1 }),
    need:       encryptedNumber({ default: null }), // minutes
    ceiling:    encryptedNumber({ default: null }), // minutes — the debt cap (§M.6 D_max)
    nights:     { type: Number, default: 0 },
    confidence: { type: Number, default: null, min: 0, max: 1 },
  },

  // This night's raw weighted-stage minutes — the input `dailyAnalysis` reads back as tomorrow's
  // "prior night" so the sleep-debt accumulator has real multi-night history to consume.
  night: { type: nightSchema, default: null },

  cosinor: {
    M:          encryptedNumber({ default: null }), // bpm — the rhythm-adjusted mean
    A:          encryptedNumber({ default: null }), // bpm — amplitude
    phi:        encryptedNumber({ default: null }), // hour-of-day — acrophase
    confidence: { type: Number, default: null, min: 0, max: 1 },
    source:     { type: String, default: null },    // 'fit' | 'prior'
  },

  cusum: {
    rhr: { type: cusumBranchSchema, default: () => ({}) },
    hrv: { type: cusumBranchSchema, default: () => ({}) },
  },

  v: { type: Number, default: MORNING_STATE_VERSION },
}, {
  timestamps: false,
  toJSON:   { getters: true },
  toObject: { getters: true },
});

// One row per user per local day — the identity `dailyAnalysis.worker`'s upsert keys on.
morningStateSchema.index({ userId: 1, date: 1 }, { unique: true });

// Retention (§0.4 S5): the same 90-day, one-retention-story convention as BiometricLog /
// VitalSample / ServeEvent. Env-tunable so an operator can shorten it without a code change.
const RETENTION_DAYS = Number(process.env.MORNING_STATE_RETENTION_DAYS) || 90;
morningStateSchema.index({ date: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 3600 });

const MorningState = mongoose.model('MorningState', morningStateSchema);

MorningState.MORNING_STATE_VERSION = MORNING_STATE_VERSION;

module.exports = MorningState;
