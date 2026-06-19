const mongoose = require('mongoose');

// No PII stored here — only userId reference + physiological readings.
const biometricLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  heartRate: { type: Number, required: true, min: 0, max: 300 }, // bpm
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
  // Capped at 100k docs per user in application logic to bound storage
});

biometricLogSchema.index({ userId: 1, recordedAt: -1 });

module.exports = mongoose.model('BiometricLog', biometricLogSchema);
