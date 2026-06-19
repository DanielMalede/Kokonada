const mongoose = require('mongoose');

const hrZoneSchema = new mongoose.Schema({
  label: { type: String }, // "easy", "fat-burn", "aerobic", "anaerobic", "max"
  minBpm: { type: Number },
  maxBpm: { type: Number },
  percentOfMax: { type: String }, // e.g. "60-70%"
}, { _id: false });

const activityBaselineSchema = new mongoose.Schema({
  activity: { type: String, enum: ['resting', 'walking', 'running', 'cycling', 'swimming', 'strength'] },
  avgHR: { type: Number },
  sampleCount: { type: Number, default: 0 },
}, { _id: false });

// One document per user — established by AI during Phase 3 initialization.
// No DOB stored (privacy). Max HR is either measured or provided by the user temporarily.
const medicalProfileSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
  },

  restingHeartRate: { type: Number, default: null }, // bpm, established from biometric history
  maxHeartRate:     { type: Number, default: null }, // bpm, measured or user-provided

  hrZones: {
    zone1: { type: hrZoneSchema, default: null }, // 50-60% — recovery
    zone2: { type: hrZoneSchema, default: null }, // 60-70% — fat burn
    zone3: { type: hrZoneSchema, default: null }, // 70-80% — aerobic / cardio
    zone4: { type: hrZoneSchema, default: null }, // 80-90% — anaerobic
    zone5: { type: hrZoneSchema, default: null }, // 90-100% — max effort
  },

  activityBaselines: { type: [activityBaselineSchema], default: [] },

  fitnessLevel: {
    type: String,
    enum: ['sedentary', 'moderate', 'active', 'athletic', null],
    default: null,
  },

  // How many biometric readings the AI used to build this profile
  sampleCount: { type: Number, default: 0 },

  lastAnalyzed: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MedicalProfile', medicalProfileSchema);
