/**
 * Unified biometric adapter.
 * All wearable sources normalize their data into this schema before
 * touching the database or the AI engine.
 *
 * @typedef {Object} NormalizedReading
 * @property {number}  heartRate   - bpm
 * @property {string}  activity    - resting|walking|running|cycling|swimming|strength|unknown
 * @property {Date}    recordedAt
 * @property {string}  source      - garmin|apple_health|suunto
 */

const ACTIVITY_MAP = {
  // Garmin activity type IDs
  garmin: {
    0:   'resting',
    1:   'running',
    2:   'cycling',
    5:   'swimming',
    6:   'walking',
    13:  'strength',
  },
  // Apple HealthKit workout type identifiers
  apple_health: {
    HKWorkoutActivityTypeRunning:              'running',
    HKWorkoutActivityTypeCycling:              'cycling',
    HKWorkoutActivityTypeSwimming:             'swimming',
    HKWorkoutActivityTypeWalking:              'walking',
    HKWorkoutActivityTypeTraditionalStrengthTraining: 'strength',
  },
  // Suunto sport type strings
  suunto: {
    RUNNING:    'running',
    CYCLING:    'cycling',
    SWIMMING:   'swimming',
    WALKING:    'walking',
    GYM:        'strength',
  },
};

function resolveActivity(source, rawType) {
  return ACTIVITY_MAP[source]?.[rawType] ?? 'unknown';
}

/**
 * Normalize a Garmin heart rate sample.
 * @param {{ heartRate: number, activityType: number, startTimeLocal: string }} raw
 */
function fromGarmin(raw) {
  return {
    heartRate:  raw.heartRate,
    activity:   resolveActivity('garmin', raw.activityType),
    recordedAt: new Date(raw.startTimeLocal),
    source:     'garmin',
  };
}

/**
 * Normalize an Apple HealthKit sample pushed from the mobile app.
 * @param {{ value: number, workoutType: string, startDate: string }} raw
 */
function fromAppleHealth(raw) {
  return {
    heartRate:  raw.value,
    activity:   resolveActivity('apple_health', raw.workoutType ?? null),
    recordedAt: new Date(raw.startDate),
    source:     'apple_health',
  };
}

/**
 * Normalize a Suunto webhook payload.
 * @param {{ hr: number, sport: string, timestamp: string }} raw
 */
function fromSuunto(raw) {
  return {
    heartRate:  raw.hr,
    activity:   resolveActivity('suunto', raw.sport ?? null),
    recordedAt: new Date(raw.timestamp),
    source:     'suunto',
  };
}

function normalize(source, raw) {
  switch (source) {
    case 'garmin':       return fromGarmin(raw);
    case 'apple_health': return fromAppleHealth(raw);
    case 'suunto':       return fromSuunto(raw);
    default: throw new Error(`Unknown wearable source: ${source}`);
  }
}

// ── Multi-metric health-store normalizer (HealthKit / Health Connect) ───────────
//
// The mobile companion app reads Garmin-synced data from the on-device OS health
// store and pushes it here for the medical-profile backfill. Unlike the live HR
// adapters above (single bpm reading), these batches carry several metric types
// (HR, resting HR, HRV, respiration, SpO2). Each raw sample is tagged with a
// canonical snake_case `type` on the device; this normalizer maps it to the
// internal field name used by BiometricLog / MedicalProfile, owning the
// platform-specific quirks (e.g. HealthKit reports SpO2 as a 0–1 fraction while
// Health Connect reports a 0–100 percentage).
//
// @typedef {Object} NormalizedMetric
// @property {string} metric     - heartRate|restingHeartRate|hrv|respirationRate|spO2
// @property {number} value
// @property {string} unit
// @property {Date}   recordedAt
// @property {string} source     - apple_health|health_connect

// type → { metric, unit }. Unrecognised types are dropped (platforms add types).
const HEALTH_METRIC_MAP = {
  heart_rate:         { metric: 'heartRate',        unit: 'bpm' },
  resting_heart_rate: { metric: 'restingHeartRate', unit: 'bpm' },
  hrv:                { metric: 'hrv',              unit: 'ms' },
  respiratory_rate:   { metric: 'respirationRate',  unit: 'brpm' },
  spo2:               { metric: 'spO2',             unit: '%' },
  // Sleep stage durations (minutes per session) → MedicalProfile.sleepStages.*
  sleep_deep:         { metric: 'sleepDeep',        unit: 'min' },
  sleep_light:        { metric: 'sleepLight',       unit: 'min' },
  sleep_rem:          { metric: 'sleepRem',         unit: 'min' },
};

const HEALTH_PLATFORM_SOURCE = {
  healthkit:       'apple_health',
  health_connect:  'health_connect',
};

/**
 * Normalize a batch of OS health-store samples pushed from the mobile app.
 * @param {'healthkit'|'health_connect'} platform
 * @param {Array<{ type: string, value: number, startDate: string, endDate?: string }>} samples
 * @returns {NormalizedMetric[]} recognised, valid samples only
 */
function normalizeHealthStoreSamples(platform, samples) {
  const source = HEALTH_PLATFORM_SOURCE[platform];
  if (!source) throw new Error(`Unknown health platform: ${platform}`);
  if (!Array.isArray(samples)) return [];

  const out = [];
  for (const raw of samples) {
    const mapping = HEALTH_METRIC_MAP[raw?.type];
    if (!mapping) continue; // unrecognised metric type

    if (raw.value == null) continue; // Number(null) === 0 — reject before coercing
    const num = Number(raw.value);
    if (!Number.isFinite(num)) continue; // drop NaN/garbage

    // SpO2 unit reconciliation: HealthKit → 0–1 fraction; Health Connect → percentage.
    const value = mapping.metric === 'spO2'
      ? Math.round(platform === 'healthkit' ? num * 100 : num)
      : num;

    out.push({
      metric:     mapping.metric,
      value,
      unit:       mapping.unit,
      recordedAt: new Date(raw.endDate || raw.startDate),
      source,
    });
  }
  return out;
}

module.exports = { normalize, normalizeHealthStoreSamples };