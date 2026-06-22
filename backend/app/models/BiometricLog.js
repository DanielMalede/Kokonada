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
    enum: ['garmin', 'apple_health', 'suunto'],
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

module.exports = mongoose.model('BiometricLog', biometricLogSchema);
