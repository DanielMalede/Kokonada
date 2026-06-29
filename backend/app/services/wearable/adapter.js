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

// ── Garmin Health API summary normalizer (server-to-server push/backfill) ───────
//
// Garmin's cloud pushes (and backfills) health summaries to our webhook. Each
// summary type carries a different shape; this maps them to the SAME canonical
// metric records the rest of the pipeline consumes (aggregateProfileMetrics +
// BiometricLog), so storage/aggregation/dedupe are reused unchanged.
//
// Field names follow Garmin's documented Health API schema (developer-portal docs
// are gated). Tolerant of the known rem-sleep variant. VERIFY against the approved
// app's sandbox payloads before go-live.

const SECONDS = (s) => new Date(s * 1000);
const isPos = (v) => Number.isFinite(v) && v > 0;

// Emit one canonical record per entry of a Garmin {offsetSeconds: value} map.
function fromOffsetMap(map, startSec, metric, unit, out) {
  for (const [offset, raw] of Object.entries(map || {})) {
    const value = Number(raw);
    if (!isPos(value)) continue;
    out.push({ metric, value, unit, recordedAt: SECONDS(startSec + Number(offset)), source: 'garmin' });
  }
}

/**
 * Normalize one Garmin Health API summary into canonical metric records.
 * @param {'sleeps'|'dailies'|'hrv'|'stressDetails'|'respiration'|'pulseox'} type
 * @param {object} s  the summary object
 * @returns {Array<{metric,value,unit,recordedAt,source}>}  (empty for unknown types)
 */
function normalizeGarminSummaries(type, s) {
  if (!s || !Number.isFinite(s.startTimeInSeconds)) return [];
  const start = s.startTimeInSeconds;
  const at = SECONDS(start);
  const out = [];

  switch (type) {
    case 'sleeps': {
      const push = (metric, secs) => { const m = Math.round(Number(secs) / 60); if (isPos(m)) out.push({ metric, value: m, unit: 'min', recordedAt: at, source: 'garmin' }); };
      push('sleepDeep', s.deepSleepDurationInSeconds);
      push('sleepLight', s.lightSleepDurationInSeconds);
      push('sleepRem', s.remSleepInSeconds ?? s.remSleepDurationInSeconds);
      break;
    }
    case 'dailies': {
      if (isPos(Number(s.restingHeartRateInBeatsPerMinute))) {
        out.push({ metric: 'restingHeartRate', value: Number(s.restingHeartRateInBeatsPerMinute), unit: 'bpm', recordedAt: at, source: 'garmin' });
      }
      fromOffsetMap(s.timeOffsetHeartRateSamples, start, 'heartRate', 'bpm', out);
      break;
    }
    case 'hrv': {
      const v = Number(s.lastNightAvg);
      if (isPos(v)) out.push({ metric: 'hrv', value: v, unit: 'ms', recordedAt: at, source: 'garmin' });
      break;
    }
    case 'respiration':
      fromOffsetMap(s.timeOffsetEpochToBreaths, start, 'respirationRate', 'brpm', out);
      break;
    case 'pulseox':
      fromOffsetMap(s.timeOffsetSpo2Values, start, 'spO2', '%', out);
      break;
    case 'stressDetails':
      fromOffsetMap(s.timeOffsetBodyBatteryValues, start, 'bodyBattery', 'score', out);
      break;
    default:
      return []; // unhandled type — skip (Garmin pushes many types)
  }
  return out;
}

module.exports = { normalize, normalizeHealthStoreSamples, normalizeGarminSummaries };