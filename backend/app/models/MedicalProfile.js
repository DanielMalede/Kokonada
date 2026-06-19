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

  // ── Pillar 1: Cardiovascular & Nervous System ────────────────────────────────
  hrv: { type: Number, default: null }, // Heart Rate Variability in ms (higher = better recovery)

  // ── Pillar 2: Respiratory Metrics ────────────────────────────────────────────
  respirationRate: { type: Number, default: null }, // breaths per minute
  spO2:            { type: Number, default: null }, // blood oxygen %, 0–100

  // ── Pillar 3: Kinematics & Motion ────────────────────────────────────────────
  stepsPerMinute:        { type: Number, default: null },
  accelerometerVariance: { type: Number, default: null }, // unitless variance
  gpsVelocityKmh:        { type: Number, default: null }, // km/h

  // ── Pillar 4: Sleep & Recovery State ─────────────────────────────────────────
  sleepStages: {
    rem:   { type: Number, default: null }, // minutes in REM
    deep:  { type: Number, default: null }, // minutes in Deep Sleep
    light: { type: Number, default: null }, // minutes in Light Sleep
  },
  dailyReadiness: { type: Number, default: null }, // 0–100 (Garmin/Whoop readiness score)
  bodyBattery:    { type: Number, default: null }, // 0–100 (Garmin Body Battery)

  // ── Pillar 5: Temporal & Device Context ──────────────────────────────────────
  bluetoothAudioConnected: { type: Boolean, default: null },
  screenOn:                { type: Boolean, default: null },
  timeOfDay: {
    type: String,
    enum: ['morning', 'afternoon', 'evening', 'night', null],
    default: null,
  },

  // ── State Vector ─────────────────────────────────────────────────────────────
  // Consolidated output of the physiological classifier — fed to the AI engine.
  stateVector: {
    status:      { type: String, default: null }, // e.g. "Peak Athletic Performance"
    confidence:  { type: Number, default: null }, // 0–1
    computedAt:  { type: Date,   default: null },
  },

  // How many biometric readings the AI used to build this profile
  sampleCount: { type: Number, default: 0 },

  lastAnalyzed: { type: Date, default: null },
}, {
  timestamps: true,
});

module.exports = mongoose.model('MedicalProfile', medicalProfileSchema);
