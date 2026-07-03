'use strict';

const { MOOD_DESCRIPTORS, moodCoords } = require('../moodDescriptors');

// The biometric→sonic translation function. PURE — zero I/O, fully deterministic,
// every output finite and range-clamped for ANY input. This is the numeric layer
// that replaces prose-injected biometrics: targets computed here become hard
// constraints and score terms in the selector; the LLM keeps only semantic duties.
//
// Physiological state model (each dimension 0–1, from whatever inputs exist):
//   Recovery R — capacity for intensity (sleep vs baseline, HRV z, battery, readiness)
//   Stress   S — need for regulation (HRV suppression, resting-HR elevation)
//   Exertion E — current physical arousal (live HR + activity)
// plus a circadian wind-down phase from hour-of-day.

const VERSION = 'biosonic/v1';

// Stage-weighted sleep: deep and REM matter more than light for recovery.
const STAGE_WEIGHTS = { deep: 1.5, light: 1.0, rem: 1.2 };
// Default "full night" when no personal sleep baseline exists (~8h typical mix).
const DEFAULT_NIGHT = { deep: 90, light: 300, rem: 90 };
const HRV_FALLBACK = { median: 45, mad: 8 };
const MAD_SCALE = 1.4826;

// Locked walking/running cadence bands (entrainment beats intent for locomotion).
const CADENCE_BPM = { walking: 118, running: 162, cycling: 145 };
const ACTIVITY_EXERTION_FLOOR = { walking: 0.35, cycling: 0.5, swimming: 0.6, strength: 0.55, running: 0.65 };

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
const finite = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function _robustZ(x, median, mad, fallback) {
  const v = finite(x);
  const m = finite(median) ?? fallback?.median ?? null;
  if (v == null || m == null) return null;
  const spread = finite(mad) > 0 ? Number(mad) : (fallback?.mad ?? 3);
  return (v - m) / (MAD_SCALE * spread);
}

function _weightedSleep(night) {
  if (!night) return null;
  let total = 0;
  let any = false;
  for (const [stage, weight] of Object.entries(STAGE_WEIGHTS)) {
    const v = finite(night[stage]);
    if (v != null && v >= 0) { total += v * weight; any = true; }
  }
  return any ? total : null;
}

function translate({ live = {}, baselines = {}, sleep = {}, state = {}, hourOfDay = null, moodKey = null } = {}) {
  const heartRate = finite(live?.heartRate);
  const activity = String(live?.activity ?? '').toLowerCase() || null;

  // ── Derived dimensions ────────────────────────────────────────────────────
  const sleepActual = _weightedSleep(sleep?.lastNight);
  // A weighted baseline of 0 (all-zero/falsy stages, e.g. {deep:false,light:0,rem:0})
  // is not a real sleep "need": using it makes sleepActual/sleepNeed a 0/0 → NaN that
  // silently poisons R and therefore energyCeiling/bpmCenter/energyFloor. Fall back to
  // the default night, and guard the division. (QA4 Q1 — NaN-poisoning kill.)
  const baselineNeed = _weightedSleep(sleep?.baseline);
  const sleepNeed = baselineNeed > 0 ? baselineNeed : _weightedSleep(DEFAULT_NIGHT);
  const sleepScore = (sleepActual != null && sleepNeed > 0) ? clamp01(sleepActual / sleepNeed) : null;

  const hrvZ = _robustZ(state?.hrv, baselines?.hrvMedian, baselines?.hrvMAD, HRV_FALLBACK);
  const hrvScore = hrvZ != null ? clamp01(0.5 + 0.2 * hrvZ) : null;
  const batteryScore = finite(state?.bodyBattery) != null ? clamp01(state.bodyBattery / 100) : null;
  const readinessScore = finite(state?.dailyReadiness) != null ? clamp01(state.dailyReadiness / 100) : null;

  const recoveryParts = [sleepScore, hrvScore, batteryScore, readinessScore].filter(v => v != null);
  const R = mean(recoveryParts) ?? 0.6; // neutral default when the body is a stranger

  const hrvSuppression = hrvZ != null ? clamp01(0.4 * -hrvZ) : null;
  const restingElevation = (heartRate != null && (activity === 'resting' || activity === 'unknown' || activity == null))
    ? (() => { const z = _robustZ(heartRate, baselines?.rhrMedian, baselines?.rhrMAD, null); return z != null ? clamp01(0.25 * z) : null; })()
    : null;
  const stressParts = [hrvSuppression, restingElevation].filter(v => v != null);
  const S = mean(stressParts) ?? 0.2;

  const hrExertion = heartRate != null ? clamp01((heartRate - 60) / 100) : null;
  const E = Math.max(hrExertion ?? 0, ACTIVITY_EXERTION_FLOOR[activity] ?? 0, hrExertion == null && !activity ? 0.35 : 0);

  const windDown = Number.isFinite(hourOfDay) && (hourOfDay >= 21 || hourOfDay < 5) ? 0.8 : 1;

  // ── Targets ───────────────────────────────────────────────────────────────
  // Recovery gates energy: a wrecked body cannot be served bangers; the mood is
  // honored in valence/genre while intensity is capped physiologically.
  const energyCeiling = round3(Math.min(0.95, Math.max(0.2, (0.35 + 0.6 * R) * windDown)));

  const desc = MOOD_DESCRIPTORS[moodKey];
  const moodEnergy = desc ? desc.energy_floor : moodCoords(moodKey).energy;
  const intentEnergy = Math.min(moodEnergy, energyCeiling);
  const energyFloor = round3(Math.max(0, Math.min(intentEnergy * 0.5, energyCeiling - 0.05)));

  // BPM entrainment (iso-principle): locomotion cadence-locks; otherwise blend
  // the intent anchor with where the body actually is, and drift from there.
  let bpmCenter;
  if (CADENCE_BPM[activity] != null) {
    bpmCenter = CADENCE_BPM[activity];
  } else {
    const intentBpm = 70 + intentEnergy * 90;
    const physioBpm = 60 + E * 100;
    bpmCenter = Math.round(0.55 * intentBpm + 0.45 * physioBpm);
  }
  bpmCenter = Math.min(260, Math.max(30, bpmCenter));

  // Stress narrows the window (predictability regulates) and biases texture.
  const bpmWidth = S >= 0.6 ? 8 : S >= 0.35 ? 14 : 20;
  const acousticnessBias = round3(Math.min(0.4, (S >= 0.6 ? 0.3 : S >= 0.35 ? 0.15 : 0) + (windDown < 1 ? 0.1 : 0)));
  const instrumentalBias = S >= 0.6 ? 0.2 : 0;

  const moodValence = desc ? desc.valence_hint : moodCoords(moodKey).valence;
  const valenceTarget = round3(S >= 0.6 ? Math.max(moodValence, 0.6) : S >= 0.35 ? Math.max(moodValence, 0.5) : moodValence);

  const tempoBand = bpmCenter < 100 ? 'resting' : bpmCenter <= 135 ? 'active' : 'peak';

  // Confidence: one step down per missing input group; never below 0.3.
  const groups = [
    finite(baselines?.rhrMedian) != null || finite(baselines?.hrvMedian) != null,
    sleepScore != null,
    heartRate != null,
    hrvScore != null || batteryScore != null || readinessScore != null,
  ];
  const confidence = Math.max(0.3, Math.round((1 - 0.15 * groups.filter(g => !g).length) * 100) / 100);

  return {
    version: VERSION,
    bpmCenter,
    bpmWidth,
    energyFloor,
    energyCeiling,
    valenceTarget,
    acousticnessBias,
    instrumentalBias,
    tempoBand,
    confidence,
    state: { recovery: round3(R), stress: round3(S), exertion: round3(E) },
  };
}

module.exports = { translate, VERSION };
