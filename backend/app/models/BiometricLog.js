const mongoose = require('mongoose');
const { encryptedNumber } = require('./encryptedField');

// Physiological readings are special-category health data — heartRate is stored
// AES-256-GCM encrypted at rest (transparent via getter/setter). Range validation
// is preserved by decrypting inside the validator. (audit F3)
const biometricLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  heartRate: encryptedNumber({ required: true, min: 0, max: 300 }), // bpm (encrypted)
  activity:  {
    type: String,
    enum: ['resting', 'walking', 'running', 'cycling', 'swimming', 'strength', 'unknown'],
    default: 'unknown',
  },
  source: {
    type: String,
    enum: ['garmin', 'apple_health', 'health_connect', 'suunto'],
    required: true,
  },
  recordedAt: { type: Date, required: true, default: Date.now },
}, {
  timestamps: false,
  toJSON:   { getters: true },
  toObject: { getters: true },
  // Capped at 100k docs per user in application logic to bound storage
});

biometricLogSchema.index({ userId: 1, recordedAt: -1 });

// Retention (T3.1): special-category health samples are kept only as long as the analytics
// window needs them, then Mongo expires them (data-minimization). The longest reader is the
// 30-day rolling RHR baseline (services/biosonic/baselines.js WINDOW_DAYS=30); retain 90 days
// — 3x headroom so recomputation after an app gap is never starved, matching the ServeEvent
// 90-day precedent — but special-category data never lingers indefinitely. Env-tunable.
// DEPLOY NOTE: creating this TTL index on the existing prod collection triggers a background
// index build — a human-gated Pause & Guide action (see PR body); the code ships regardless.
const RETENTION_DAYS = Number(process.env.BIOMETRIC_RETENTION_DAYS) || 90;
biometricLogSchema.index({ recordedAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 3600 });

module.exports = mongoose.model('BiometricLog', biometricLogSchema);
