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

module.exports = { normalize };