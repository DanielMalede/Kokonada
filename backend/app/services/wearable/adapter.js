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

// ── consent-v2 capability flags (W4-004, §0.2.3) ────────────────────────────────
//
// This wave builds the engine ready for every metric a wearable can emit, and collects NONE of
// the new ones. `WAVE4_CONSENT_V2_METRICS` is a comma-separated allowlist, EMPTY by default, and
// it is the only thing that can turn a dormant lane on. Read at CALL time, not at module load, so
// the flag is a runtime switch rather than a deploy-order puzzle.
//
// Until consent v2 actually ships, flipping this on would widen Art.9 processing beyond the scope
// the user consented to — the flag exists so that day is a config change plus a consent record,
// not a code change under time pressure.
function consentV2Enabled(metric) {
  const raw = process.env.WAVE4_CONSENT_V2_METRICS;
  if (!raw) return false;
  return raw.split(',').map((s) => s.trim()).includes(metric);
}

// A timezone offset the device asserts about itself. Anything outside the real range of UTC
// offsets (UTC-14:00 .. UTC+12:00) is a corrupt or hostile value; we drop it and fall back to
// server hour rather than storing a number that would silently rotate a user's whole circadian
// table. Matches the VitalSample schema bounds and the telemetry DTO. (S6)
const TZ_MIN_MINUTES = -840;
const TZ_MAX_MINUTES = 720;

function sanitizeTzOffset(value) {
  if (value == null) return null; // Number(null) === 0, and 0 is a REAL offset (UTC)
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < TZ_MIN_MINUTES || n > TZ_MAX_MINUTES) return null;
  return Math.round(n);
}

// How far past the server's clock a reading may be stamped: a device clock a little fast, never a
// reading from the future. ONE definition (BE-206, architect R5) for every boundary that checks it: the
// Health Connect batch contract, and the store's future cap that the Garmin seam asks for
// (metricStore.persistMetrics `dropInFuture`).
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

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

// Own keys only (BE-070): a plain read also finds what every object inherits, so a device type of
// 'constructor' resolved to the Object function and '__proto__' to Object.prototype, and the socket
// lane stored that as the listener's activity.
function resolveActivity(source, rawType) {
  const map = ACTIVITY_MAP[source];
  return map && Object.hasOwn(map, rawType) ? map[rawType] : 'unknown';
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
    tzOffsetMinutes: sanitizeTzOffset(raw.tzOffsetMinutes),
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
    tzOffsetMinutes: sanitizeTzOffset(raw.tzOffsetMinutes),
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
    tzOffsetMinutes: sanitizeTzOffset(raw.tzOffsetMinutes),
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
      // Additive + optional (W4-004): the device knows its own UTC offset, the server only knows
      // its own. Without this every hour-of-day baseline is computed in the server's timezone,
      // which is D13 in a different costume. Absent stays null — the engines fall back to server
      // hour explicitly rather than pretending the user lives in UTC.
      tzOffsetMinutes: sanitizeTzOffset(raw.tzOffsetMinutes),
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
  // Garmin's 0-100 stress index. The API also emits -1 ("unmeasurable") and -2 ("off-wrist")
  // sentinels on the SAME series; the range is what keeps those out of the data. (D16)
  stressLevel:      [0, 100],
  steps:            [0, 200000],
  sleepDeep:        [0, 960],
  sleepLight:       [0, 960],
  sleepRem:         [0, 960],
};

// Metrics where 0 is a genuine reading rather than a missing one. `isPos` is the right default
// for a heart rate (0 bpm is not a measurement), and exactly wrong for a stress index or a step
// count on a rest day.
const ZERO_IS_VALID = new Set(['stressLevel', 'steps']);

function inRange(metric, value) {
  const r = RANGES[metric];
  return !r || (value >= r[0] && value <= r[1]);
}

// Emit one canonical record per entry of a Garmin {offsetSeconds: value} map,
// dropping (and counting via `drop`) physiologically implausible values. Entries are read in
// time order, and one whose offset is not a number cannot be placed in time, so it is skipped.
//
// `perMinute` (F10) keeps only the FIRST admissible reading of each minute of the summary's
// timeline. Garmin samples heart rate every 15 seconds while the live lane stores at most one
// reading a minute; the kept record is always a real reading, its own value at its own time,
// never an average or a synthesised point. Every out-of-range reading is still counted.
function fromOffsetMap(map, startSec, metric, unit, out, drop, tzOffsetMinutes = null, { perMinute = false } = {}) {
  const admits = ZERO_IS_VALID.has(metric)
    ? (v) => Number.isFinite(v) && v >= 0
    : isPos;
  const entries = Object.entries(map || {})
    .map(([offset, raw]) => [Number(offset), raw])
    .filter(([offset]) => Number.isFinite(offset))
    .sort((a, b) => a[0] - b[0]);
  const minutesKept = new Set();
  for (const [offset, raw] of entries) {
    const value = Number(raw);
    if (!admits(value)) continue;
    if (!inRange(metric, value)) { drop.count += 1; continue; }
    if (perMinute) {
      const minute = Math.floor(offset / 60);
      if (minutesKept.has(minute)) continue;
      minutesKept.add(minute);
    }
    out.push({
      metric, value, unit, recordedAt: SECONDS(startSec + offset), source: 'garmin', tzOffsetMinutes,
    });
  }
}

// A night, or a night's HRV window, ends at start + durationInSeconds. A duration that is
// missing, not a positive number, or longer than a day is not the end of a night.
const MAX_WINDOW_SECONDS = 24 * 60 * 60;

function windowEndSec(startSec, durationSec) {
  const d = Number(durationSec);
  return Number.isFinite(d) && d > 0 && d <= MAX_WINDOW_SECONDS ? startSec + d : null;
}

// Where the duration is silent, the night's own timeline says where it ends: the latest segment
// end in Garmin's sleepLevelsMap ({ deep|light|rem|awake: [{ startTimeInSeconds, endTimeInSeconds }] }),
// within a day of the start.
function lastSleepLevelEndSec(startSec, levels) {
  let last = null;
  for (const segments of Object.values(levels || {})) {
    if (!Array.isArray(segments)) continue;
    for (const segment of segments) {
      const end = Number(segment?.endTimeInSeconds);
      if (end > startSec && end <= startSec + MAX_WINDOW_SECONDS && (last === null || end > last)) last = end;
    }
  }
  return last;
}

// Where a night-type summary ends, or null when it carries no end: a sleeps summary by its duration, else
// by its sleep timeline; an hrv summary by its duration. The normaliser below stamps a night there, and at
// its start when this is null (the webhook lane's fallback, BE-217).
function garminNightEndSec(type, s) {
  const start = s?.startTimeInSeconds;
  if (!Number.isFinite(start)) return null;
  if (type === 'sleeps') return windowEndSec(start, s.durationInSeconds) ?? lastSleepLevelEndSec(start, s.sleepLevelsMap);
  if (type === 'hrv') return windowEndSec(start, s.durationInSeconds);
  return null;
}

// Garmin computes HRV as RMSSD; `lastNightAvg` is the night's mean of its 5-minute RMSSD values.
// VitalSample keeps the method so it is never pooled with Apple's SDNN.
const GARMIN_HRV_METHOD = 'rmssd';

/**
 * Normalize one Garmin Health API summary into canonical metric records.
 * @param {'sleeps'|'dailies'|'hrv'|'stressDetails'|'respiration'|'pulseox'} type
 * @param {object} s  the summary object
 * @returns {Array<{metric,value,unit,recordedAt,source,tzOffsetMinutes,hrvMethod?}>}  (empty for unknown types)
 */
function normalizeGarminSummaries(type, s) {
  if (!s || !Number.isFinite(s.startTimeInSeconds)) return [];
  const start = s.startTimeInSeconds;
  const at = SECONDS(start);
  const out = [];
  const drop = { count: 0 };
  // Garmin stamps every summary with the wearer's own UTC offset for that summary — the one
  // authoritative timezone signal on this lane. Seconds on the wire, minutes everywhere here.
  const tz = Number.isFinite(s.startTimeOffsetInSeconds)
    ? sanitizeTzOffset(Math.round(s.startTimeOffsetInSeconds / 60))
    : null;
  // Push a single-value metric, dropping (and counting) an out-of-range reading. `stamp` overrides
  // fields of the record, such as a recordedAt for a metric that belongs to the end of a night.
  const add = (metric, value, unit, stamp = {}) => {
    if (!inRange(metric, value)) { drop.count += 1; return; }
    out.push({ metric, value, unit, recordedAt: at, source: 'garmin', tzOffsetMinutes: tz, ...stamp });
  };

  switch (type) {
    case 'sleeps': {
      // A night belongs to the moment it ENDS: computeLastNightSleep files nights under the UTC
      // date of recordedAt, and the Health Connect lane already stamps sleep at endDate. Stamped
      // at its start, a night that began before UTC midnight was filed under the day before.
      const end = SECONDS(garminNightEndSec('sleeps', s) ?? start);
      const push = (metric, secs) => {
        const m = Math.round(Number(secs) / 60);
        if (isPos(m)) add(metric, m, 'min', { recordedAt: end });
      };
      push('sleepDeep', s.deepSleepDurationInSeconds);
      push('sleepLight', s.lightSleepDurationInSeconds);
      push('sleepRem', s.remSleepInSeconds ?? s.remSleepDurationInSeconds);
      break;
    }
    case 'dailies': {
      const rhr = Number(s.restingHeartRateInBeatsPerMinute);
      if (isPos(rhr)) add('restingHeartRate', rhr, 'bpm');
      fromOffsetMap(s.timeOffsetHeartRateSamples, start, 'heartRate', 'bpm', out, drop, tz, { perMinute: true });
      // Dormant (consent v2): steps are an activity signal the affect engine's exertion axis
      // would use as a prior. Normalized here so the lane is proven, OFF until consented.
      if (consentV2Enabled('steps')) {
        const steps = Number(s.steps);
        if (Number.isFinite(steps) && steps >= 0) add('steps', steps, 'count');
      }
      break;
    }
    case 'hrv': {
      // The night's HRV, stamped where its window ends (as the night itself is) and named by the
      // statistic Garmin computes.
      const v = Number(s.lastNightAvg);
      const end = SECONDS(garminNightEndSec('hrv', s) ?? start);
      if (isPos(v)) add('hrv', v, 'ms', { recordedAt: end, hrvMethod: GARMIN_HRV_METHOD });
      break;
    }
    case 'respiration':
      fromOffsetMap(s.timeOffsetEpochToBreaths, start, 'respirationRate', 'brpm', out, drop, tz);
      break;
    case 'pulseox':
      fromOffsetMap(s.timeOffsetSpo2Values, start, 'spO2', '%', out, drop, tz);
      break;
    case 'stressDetails':
      fromOffsetMap(s.timeOffsetBodyBatteryValues, start, 'bodyBattery', 'score', out, drop, tz);
      // D16: the SAME payload carries Garmin's own stress index and this adapter read only the
      // body-battery half of it, discarding a directly-measured stress signal the whole affect
      // engine has to infer from HRV instead. Normalized now, dormant until consent v2.
      if (consentV2Enabled('stressLevel')) {
        fromOffsetMap(s.timeOffsetStressLevelValues, start, 'stressLevel', 'score', out, drop, tz);
      }
      break;
    default:
      return []; // unhandled type — skip (Garmin pushes many types)
  }
  if (drop.count > 0) {
    console.warn(`[garmin] dropped ${drop.count} out-of-range ${type} value(s)`);
  }
  // RA-2 of #275: a finite number of seconds can still lie past the 8.64e12 s a Date can hold, and then the
  // record's time is an Invalid Date, which no filter can compare and Mongo cannot cast. A summary whose start
  // or end a Date cannot hold yields nothing, and a reading whose own time it cannot hold is left out.
  return out.filter((m) => Number.isFinite(m.recordedAt.getTime()));
}

module.exports = {
  normalize, normalizeHealthStoreSamples, normalizeGarminSummaries,
  // shared with metricStore so the capability gate has ONE definition, not two that drift; the offset band
  // also sets how far the store reads around a Garmin night (RA-1 of #275)
  consentV2Enabled, sanitizeTzOffset, TZ_MIN_MINUTES, TZ_MAX_MINUTES,
  // where a Garmin night ends, the one definition the normaliser stamps a night by
  garminNightEndSec,
  // shared with the Health Connect contract and the store's future cap
  MAX_FUTURE_SKEW_MS,
};