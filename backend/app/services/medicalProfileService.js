'use strict';

const MedicalProfile = require('../models/MedicalProfile');
const { encrypt } = require('../utils/encryption');

// ── Priority-ordered state classification rules ────────────────────────────────
//
// Each rule has:
//   status   — the human-readable state label
//   match(t) — returns { matched: boolean, full: boolean }
//              `full` is true when every condition for the rule is present and
//              true; false when only some conditions could be evaluated.
//
// Rules are evaluated in order; the first match wins.

const RULES = [
  // Priority 1 — High-Stress / Pre-Panic
  {
    status: 'High-Stress / Pre-Panic',
    match(t) {
      const lowHrv         = t.hrv != null && t.hrv < 20;
      const highHrHighResp = t.heartRate != null && t.restingHeartRate != null
        && t.respirationRate != null
        && t.heartRate > t.restingHeartRate * 1.6
        && t.respirationRate > 20;

      if (lowHrv)         return { matched: true,  full: true };
      if (highHrHighResp) return { matched: true,  full: true };
      return { matched: false, full: false };
    },
  },

  // Priority 2 — Peak Athletic Performance
  {
    status: 'Peak Athletic Performance',
    match(t) {
      if (t.heartRate == null || t.restingHeartRate == null) return { matched: false, full: false };
      const highHr    = t.heartRate > t.restingHeartRate * 1.5;
      const highSteps = t.stepsPerMinute != null && t.stepsPerMinute > 140;
      const goodSpO2  = t.spO2 != null && t.spO2 >= 95;

      if (highHr && highSteps && goodSpO2) return { matched: true, full: true };
      if (highHr && (highSteps || goodSpO2)) return { matched: true, full: false };
      return { matched: false, full: false };
    },
  },

  // Priority 3 — Intense Workout
  {
    status: 'Intense Workout',
    match(t) {
      if (t.heartRate == null || t.restingHeartRate == null) return { matched: false, full: false };
      const highHr   = t.heartRate > t.restingHeartRate * 1.4;
      const moving   = (t.stepsPerMinute != null && t.stepsPerMinute > 100)
                    || (t.gpsVelocityKmh  != null && t.gpsVelocityKmh  > 8);

      if (highHr && moving) return { matched: true, full: true };
      if (highHr)           return { matched: true, full: false };
      return { matched: false, full: false };
    },
  },

  // Priority 4 — Active Recovery
  {
    status: 'Active Recovery',
    match(t) {
      if (t.heartRate == null || t.restingHeartRate == null) return { matched: false, full: false };
      // Critically low body battery means exhaustion, not recovery — let priority 5 handle it
      if (t.bodyBattery != null && t.bodyBattery < 25) return { matched: false, full: false };

      const moderateHr    = t.heartRate > t.restingHeartRate * 1.1
                         && t.heartRate <= t.restingHeartRate * 1.4;
      const moderateSteps = t.stepsPerMinute != null
                         && t.stepsPerMinute >= 50
                         && t.stepsPerMinute <= 100;

      // Both conditions required — moderate HR alone could be morning calm or focus state
      if (moderateHr && moderateSteps) return { matched: true, full: true };
      return { matched: false, full: false };
    },
  },

  // Priority 5 — Exhausted Commute
  {
    status: 'Exhausted Commute',
    match(t) {
      const criticalBattery = t.bodyBattery != null && t.bodyBattery < 25;
      const lowReadinessLowSteps = t.dailyReadiness != null && t.dailyReadiness < 30
                                && t.stepsPerMinute != null && t.stepsPerMinute < 80;

      if (criticalBattery)        return { matched: true, full: true };
      if (lowReadinessLowSteps)   return { matched: true, full: true };
      return { matched: false, full: false };
    },
  },

  // Priority 6 — Screen-Off / Background Listening
  {
    status: 'Screen-Off / Background Listening',
    match(t) {
      // Both Pillar 5 device context signals must be explicitly confirmed
      if (t.screenOn !== false || t.bluetoothAudioConnected !== true) {
        return { matched: false, full: false };
      }
      const windingDown = t.timeOfDay === 'evening' || t.timeOfDay === 'night';
      const stationary  = t.stepsPerMinute == null || t.stepsPerMinute < 30;

      if (windingDown && stationary) return { matched: true, full: true };
      // BT headphones + locked screen is passive listening even without time/steps data
      return { matched: true, full: false };
    },
  },

  // Priority 7 — Deep Focus / Flow State
  {
    status: 'Deep Focus / Flow State',
    match(t) {
      if (t.heartRate == null || t.restingHeartRate == null) return { matched: false, full: false };
      // Screen explicitly off means phone is pocketed — not an active focus session
      if (t.screenOn === false) return { matched: false, full: false };
      const lowHr          = t.heartRate < t.restingHeartRate * 1.1;
      const lowMovement    = t.accelerometerVariance != null && t.accelerometerVariance < 0.1;
      const daytime        = t.timeOfDay === 'morning' || t.timeOfDay === 'afternoon';
      // Truly stationary (< 10 steps/min) is resting/meditative, not focused work
      const notStationary  = t.stepsPerMinute == null || t.stepsPerMinute >= 10;
      // Screen confirmed on boosts confidence — active screen use signals intentional focus
      const screenConfirmed = t.screenOn === true;

      if (lowHr && lowMovement && daytime && notStationary && screenConfirmed) return { matched: true, full: true };
      if (lowHr && (lowMovement || daytime) && notStationary) return { matched: true, full: false };
      return { matched: false, full: false };
    },
  },

  // Priority 8 — Morning Activation
  {
    status: 'Morning Activation',
    match(t) {
      const morning    = t.timeOfDay === 'morning';
      const goodEnergy = t.bodyBattery != null && t.bodyBattery >= 60;

      if (morning && goodEnergy) return { matched: true,  full: true };
      if (morning)               return { matched: true,  full: false };
      return { matched: false, full: false };
    },
  },

  // Priority 9 — Resting / Meditative
  {
    status: 'Resting / Meditative',
    match(t) {
      if (t.heartRate == null || t.restingHeartRate == null) return { matched: false, full: false };
      const veryLowHr   = t.heartRate <= t.restingHeartRate * 1.05;
      const veryLowMove = t.stepsPerMinute != null && t.stepsPerMinute < 30;

      if (veryLowHr && veryLowMove) return { matched: true,  full: true };
      if (veryLowHr)                return { matched: true,  full: false };
      return { matched: false, full: false };
    },
  },
];

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Pure deterministic classifier — no I/O, no DB calls.
 * Evaluates each rule in priority order and returns the first match.
 *
 * @param {object} telemetry - Any subset of pillar fields from the wearable
 * @returns {{ status: string, confidence: number }}
 */
function computeStateVector(telemetry) {
  const t = telemetry || {};

  for (const rule of RULES) {
    const { matched, full } = rule.match(t);
    if (matched) {
      return { status: rule.status, confidence: full ? 1.0 : 0.7 };
    }
  }

  return { status: 'Neutral', confidence: 0.5 };
}

/**
 * Computes the state vector from live telemetry and upserts it into the
 * user's MedicalProfile document.
 *
 * @param {string} userId    - MongoDB ObjectId string
 * @param {object} telemetry - Raw pillar fields from the wearable adapter
 * @returns {Promise<MedicalProfile>}
 */
async function upsertStateVector(userId, telemetry) {
  const { status, confidence } = computeStateVector(telemetry);

  // The state label reveals the user's inferred emotional/physiological state, so
  // it is encrypted at rest. Encrypt explicitly here because setters do not run on
  // findOneAndUpdate($set). Read it back via decrypt(doc.stateVector.status). (audit F3)
  return MedicalProfile.findOneAndUpdate(
    { userId },
    {
      $set: {
        stateVector: { status: encrypt(status), confidence, computedAt: new Date() },
      },
    },
    { upsert: true, new: true }
  );
}

// ── Backfill aggregation ────────────────────────────────────────────────────────

// MedicalProfile scalar fields that summarise a baseline. Raw `heartRate` is
// deliberately excluded — it is high-frequency time-series data stored per-row in
// BiometricLog, not a single profile baseline.
const PROFILE_SCALAR_METRICS = [
  'restingHeartRate', 'hrv', 'respirationRate', 'spO2',
  'sleepDeep', 'sleepLight', 'sleepRem',
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Collapse a batch of normalized health-store metrics into the scalar baselines
 * stored on MedicalProfile. Uses the median per metric so a single workout HR
 * spike or a dropped reading cannot skew the user's resting baseline.
 *
 * @param {Array<{ metric: string, value: number }>} metrics
 * @returns {Object} subset of { restingHeartRate, hrv, respirationRate, spO2 }
 */
function aggregateProfileMetrics(metrics) {
  const buckets = {};
  for (const { metric, value } of metrics || []) {
    if (!PROFILE_SCALAR_METRICS.includes(metric)) continue;
    if (!Number.isFinite(value)) continue;
    (buckets[metric] ||= []).push(value);
  }

  const out = {};
  for (const metric of PROFILE_SCALAR_METRICS) {
    if (buckets[metric]?.length) out[metric] = Math.round(median(buckets[metric]));
  }
  return out;
}

module.exports = { computeStateVector, upsertStateVector, aggregateProfileMetrics };
