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
// (HR, resting HR, HRV, sleep stages). Each raw sample is tagged with a canonical
// snake_case `type` on the device; this normalizer maps it to the internal field
// name used by BiometricLog / MedicalProfile.
//
// GDPR Art.9 (audit follow-up): the three special categories — spo2 / respiratory_rate /
// body_battery — are DELIBERATELY absent from this map. They are NOT in the mobile
// HEALTH_CONNECT_DATA_CATEGORIES, no shipped client sends them, and Health Connect never
// reads them; they may only be processed via the (v2-consent-gated) Garmin server-to-server
// lane (normalizeGarminSummaries + garminIngest). Dropping them here is the leak-source fix —
// healthStore.ingestBatch's consent-version gate is the defense-in-depth backstop.
//
// @typedef {Object} NormalizedMetric
// @property {string} metric     - heartRate|restingHeartRate|hrv|sleepDeep|sleepLight|sleepRem
// @property {number} value
// @property {string} unit
// @property {Date}   recordedAt
// @property {string} source     - apple_health|health_connect

// type → { metric, unit }. Unrecognised types are dropped (platforms add types).
const HEALTH_METRIC_MAP = {
  heart_rate:         { metric: 'heartRate',        unit: 'bpm' },
  resting_heart_rate: { metric: 'restingHeartRate', unit: 'bpm' },
  hrv:                { metric: 'hrv',              unit: 'ms' },
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
    const value = Number(raw.value);
    if (!Number.isFinite(value)) continue; // drop NaN/garbage

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

// Physiological plausibility bounds per canonical metric. Out-of-range values are
// DROPPED (never clamped — a clamp would fabricate a reading the wearer never had)
// and counted, so a burst of corrupt or hostile data is visible in the logs rather
// than silently poisoning the medical profile. Sleep-stage durations are in MINUTES
// (0–16 h). A metric with no entry here is unbounded and passes through. (audit T2.2)
const RANGES = {
  heartRate:        [20, 260],
  restingHeartRate: [20, 260],
  hrv:              [0, 500],
  spO2:             [50, 100],
  respirationRate:  [4, 60],
  bodyBattery:      [0, 100],
  sleepDeep:        [0, 960],
  sleepLight:       [0, 960],
  sleepRem:         [0, 960],
};

function inRange(metric, value) {
  const r = RANGES[metric];
  return !r || (value >= r[0] && value <= r[1]);
}

// Emit one canonical record per entry of a Garmin {offsetSeconds: value} map,
// dropping (and counting via `drop`) physiologically implausible values.
function fromOffsetMap(map, startSec, metric, unit, out, drop) {
  for (const [offset, raw] of Object.entries(map || {})) {
    const value = Number(raw);
    if (!isPos(value)) continue;
    if (!inRange(metric, value)) { drop.count += 1; continue; }
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
  const drop = { count: 0 };
  // Push a single-value metric, dropping (and counting) an out-of-range reading.
  const add = (metric, value, unit) => {
    if (!inRange(metric, value)) { drop.count += 1; return; }
    out.push({ metric, value, unit, recordedAt: at, source: 'garmin' });
  };

  switch (type) {
    case 'sleeps': {
      const push = (metric, secs) => { const m = Math.round(Number(secs) / 60); if (isPos(m)) add(metric, m, 'min'); };
      push('sleepDeep', s.deepSleepDurationInSeconds);
      push('sleepLight', s.lightSleepDurationInSeconds);
      push('sleepRem', s.remSleepInSeconds ?? s.remSleepDurationInSeconds);
      break;
    }
    case 'dailies': {
      const rhr = Number(s.restingHeartRateInBeatsPerMinute);
      if (isPos(rhr)) add('restingHeartRate', rhr, 'bpm');
      fromOffsetMap(s.timeOffsetHeartRateSamples, start, 'heartRate', 'bpm', out, drop);
      break;
    }
    case 'hrv': {
      const v = Number(s.lastNightAvg);
      if (isPos(v)) add('hrv', v, 'ms');
      break;
    }
    case 'respiration':
      fromOffsetMap(s.timeOffsetEpochToBreaths, start, 'respirationRate', 'brpm', out, drop);
      break;
    case 'pulseox':
      fromOffsetMap(s.timeOffsetSpo2Values, start, 'spO2', '%', out, drop);
      break;
    case 'stressDetails':
      fromOffsetMap(s.timeOffsetBodyBatteryValues, start, 'bodyBattery', 'score', out, drop);
      break;
    default:
      return []; // unhandled type — skip (Garmin pushes many types)
  }
  if (drop.count > 0) {
    console.warn(`[garmin] dropped ${drop.count} out-of-range ${type} value(s)`);
  }
  return out;
}

module.exports = { normalize, normalizeHealthStoreSamples, normalizeGarminSummaries };