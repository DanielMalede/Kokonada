'use strict';

const mongoose = require('mongoose');

// Explicit, informed, versioned consent for processing special-category (GDPR Art.9)
// health/biometric data (audit H-9). The OS/OAuth read grants alone are NOT lawful Art.9
// consent — this collection is the record of it.
//
// APPEND-ONLY: a withdrawal is a NEW row (status: 'withdrawn'), never an in-place mutation of
// a granted row. The full grant→withdraw→re-grant history is therefore preserved, and the
// user's CURRENT state is the LATEST row (see `latestFor`) — never "any granted row", which
// would wrongly still read as consented after a withdrawal.
const consentRecordSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // Start with a single purpose; the enum makes adding future purposes an explicit, reviewed change.
  purpose: {
    type: String,
    enum: ['health_biometric_processing'],
    required: true,
  },
  // Bumped in services/privacy/consent.js (CURRENT_CONSENT_VERSION) whenever the consent text /
  // data categories materially change — a row at an older version reads as stale (re-prompt).
  consentVersion: { type: Number, required: true },
  // The special-category data categories the user consented to (e.g. heart_rate, hrv, spo2).
  dataCategories: { type: [String], default: [] },
  status: {
    type: String,
    enum: ['granted', 'withdrawn'],
    required: true,
  },
  grantedAt:   { type: Date },
  withdrawnAt: { type: Date },
  // Provenance for the Art.7 record of consent — where/how it was captured. Optional.
  appVersion: { type: String },
  locale:     { type: String },
}, {
  timestamps: true, // createdAt orders the append-only history so "latest" is deterministic
});

// The consent-status read path: newest row for a user+purpose. ObjectIds are monotonic only
// WITHIN a single process — across replicas (Railway can run more than one), two same-
// millisecond writes can sort either way on _id, so an _id tie-break alone is not reliable
// (resilience-audit finding). Instead: fetch the top-2 by createdAt; if they're genuinely
// tied on createdAt, fail CLOSED and prefer 'withdrawn' over 'granted' regardless of _id order
// — a rare same-millisecond race must never read as consented when a withdrawal also landed.
consentRecordSchema.index({ userId: 1, purpose: 1, consentVersion: 1 });

consentRecordSchema.statics.latestFor = async function (userId, purpose) {
  const top2 = await this.find({ userId, purpose }).sort({ createdAt: -1 }).limit(2).exec();
  if (!top2.length) return null;
  const [first, second] = top2;
  const tied = second && first.createdAt.getTime() === second.createdAt.getTime();
  if (tied) {
    const withdrawn = top2.find((r) => r.status === 'withdrawn');
    if (withdrawn) return withdrawn;
  }
  return first;
};

module.exports = mongoose.model('ConsentRecord', consentRecordSchema);
