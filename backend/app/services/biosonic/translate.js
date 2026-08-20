'use strict';

const { MOOD_DESCRIPTORS, moodCoords } = require('../moodDescriptors');
// The lowest spread any robust z-score here may divide by. One definition, shared with the engine
// that produces most of these baselines — see _robustZ. (No cycle: baselineEngine imports only
// chronobiology, and neither imports this file.)
const { MIN_SPREAD } = require('../../agents/runtime/physiology/baselineEngine');

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
// Above this, an UNLABELLED heart rate is exertion, not stress at rest (D3). ~110 bpm is
// the low edge of Zone 2 for a typical adult (roughly 60% of a 190 HRmax) — sustained rates
// above it are not produced by sitting still, whatever the missing activity label claims.
// Personal Karvonen zones replace this fixed anchor in W4-004/005.
const UNLABELLED_RESTING_HR_CEILING = 110;
// Comfort bias under stress: at most +0.1 valence, reached at S≈0.67. A bias, never a floor —
// VISION §6 makes the engine a REGULATOR, not a mirror, and forcing a distressed listener into
// cheerful music is exactly the mirror failure (it also breaks the iso-principle: you meet the
// state first, then move it). Structural down-regulation is the trajectory, added in W4-006.
const COMFORT_BIAS_MAX = 0.1;
const COMFORT_BIAS_SLOPE = 0.15;
// Confidence: one step down per missing input group. 4 groups × 0.175 lands exactly on the
// 0.3 floor, so a cold start is genuinely represented as "no idea" and biosonicBand can reach
// its widest tolerance. The old 0.15 step bottomed out at 0.4 — the floor was unreachable and
// a total stranger was served with the same band width as a half-known user. (D14)
const CONFIDENCE_STEP = 0.175;
const CONFIDENCE_FLOOR = 0.3;

// Locked walking/running cadence bands (entrainment beats intent for locomotion).
const CADENCE_BPM = { walking: 118, running: 162, cycling: 145 };

/**
 * The coarse tempo class of a band centre. Exported because W4-008's trajectory planner needs the
 * SAME three cut points to pick a default arc when the regulator has not published one, and a
 * second copy of `< 100 / <= 135` in another module is exactly the trigger/key divergence D11
 * was: one table, two readings of it.
 */
function tempoBandOf(bpmCenter) {
  return bpmCenter < 100 ? 'resting' : bpmCenter <= 135 ? 'active' : 'peak';
}

const ACTIVITY_EXERTION_FLOOR = {
  walking: 0.35, cycling: 0.5, swimming: 0.6, strength: 0.55, running: 0.65,
  workout: 0.7, commuting: 0.3, working: 0.25, focus: 0.3, resting: 0, 'winding down': 0,
};
// Activity → energy intent. The app's PRIMARY input is the activity chip (running/workout/
// resting/…), not the mood wheel — so the activity drives the energy target and, for an
// explicit exertion, lifts the passive recovery/wind-down cap (product decision: intent wins).
const ACTIVITY_ENERGY = {
  running: 0.85, workout: 0.9, cycling: 0.75, strength: 0.85, swimming: 0.7,
  walking: 0.5, commuting: 0.45, working: 0.4, focus: 0.5,
  resting: 0.15, 'winding down': 0.15,
};

// S11 escape hatch for the whole W4-D15 repair: set it to restore the pre-repair behaviour
// byte-for-byte, without a revert. It covers BOTH halves — the null/'' coercion and the MIN_SPREAD
// floor — because they are one behaviour from an operator's point of view: whether a degenerate or
// absent baseline makes the stress term abstain or saturate. Read per call, not at module load, so
// toggling it needs no process restart.
const ABSTENTION_FLAG = 'WAVE4_BASELINE_ABSTENTION_DISABLED';
const abstentionDisabled = () => Boolean(process.env[ABSTENTION_FLAG]);

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round3 = (x) => Math.round(x * 1000) / 1000;
// `Number(null)`, `Number('')`, `Number(false)` and `Number([])` are all 0, and 0 is finite — so
// the old guard (`Number.isFinite(Number(x)) ? Number(x) : null`) could not tell "nothing was
// measured" from "zero was measured". For a vital those are opposite claims, and the coercion
// always landed on the alarming one: a null resting-HR baseline became a resting pulse of ZERO,
// against which every human heart rate z-scores as maximal stress (D3/D4's exact target profile,
// re-created through a type coercion). A value is a measurement only if it is a finite number, or
// a non-blank string that parses to one. (W4-D15 — the same guard baselineEngine.js and
// chronobiology.js already carry; this is the copy on the serving path that never got it.)
const finite = (x) => {
  if (abstentionDisabled()) return Number.isFinite(Number(x)) ? Number(x) : null;
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// `fallback` is the term's ABSTENTION CONTRACT, not a convenience: pass a population prior to say
// "score this against the population when the person is unknown" (the HRV term does), or pass null
// to say "produce no score at all when the person is unknown" (the resting-elevation term does —
// scoring a stranger's resting HR against anything invented is what D3 exists to prevent, and
// `baselines.computeBaselines` deliberately returns a null median to request exactly that).
function _robustZ(x, median, mad, fallback) {
  const v = finite(x);
  const m = finite(median) ?? fallback?.median ?? null;
  if (v == null || m == null) return null;
  // The spread must clear MIN_SPREAD, not merely be positive. A MAD of 1e-12 is not a person whose
  // pulse never varies, it is numerical debris — and dividing by it explodes the z-score and hands
  // that user maximal stress, which is the same saturation W4-D15 fixed one argument over. The
  // engine has floored its own output at MIN_SPREAD since W4-004 for exactly this reason (its
  // comment names D3 by name); the floor belongs here too, because `translate` accepts baselines
  // the engine did not produce — pre-W4-004 cache blobs, the kill-switch legacy path, callers.
  // Imported rather than copied: a safety floor that exists twice is a safety floor that drifts.
  const observed = finite(mad);
  const floor = abstentionDisabled() ? Number.MIN_VALUE : MIN_SPREAD;
  const spread = observed != null && observed >= floor ? observed : (fallback?.mad ?? 3);
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
  // Resting elevation only means something when the body is actually AT REST. Every batch
  // HR row is written with activity 'unknown' (D2), so the old `unknown → treat as resting`
  // branch scored a 165 bpm workout as z≈17 → S=1.0 → maximal stress: narrow window, forced
  // acoustic/instrumental, forced-cheerful valence. An unlabelled reading is now only read
  // as resting while it stays BELOW the exertion cut — above it, exertion explains the HR and
  // stress is left to the HRV term rather than invented. (D3)
  const restingElevation = (heartRate != null && (
    activity === 'resting' ||
    ((activity === 'unknown' || activity == null) && heartRate < UNLABELLED_RESTING_HR_CEILING)
  ))
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
  const activityEnergy = activity != null ? (ACTIVITY_ENERGY[activity] ?? null) : null;
  const passiveCeiling = Math.min(0.95, Math.max(0.2, (0.35 + 0.6 * R) * windDown));
  // An explicit activity is a direct exertion intent — it LIFTS the passive recovery/wind-down
  // cap so a Workout/Run at 2am still serves energy (product decision: user intent wins).
  const energyCeiling = round3(activityEnergy != null ? Math.max(passiveCeiling, activityEnergy) : passiveCeiling);

  const desc = MOOD_DESCRIPTORS[moodKey];
  const moodEnergy = desc ? desc.energy_floor : moodCoords(moodKey).energy;
  // Activity is the PRIMARY input; when present it drives the energy target over a (possibly
  // stale) mood tap. Falls back to the mood tap only when no activity was chosen.
  const intentEnergy = Math.min(activityEnergy != null ? activityEnergy : moodEnergy, energyCeiling);
  const energyFloor = round3(Math.max(0, Math.min(intentEnergy * 0.5, energyCeiling - 0.05)));

  // BPM entrainment (iso-principle): locomotion cadence-locks; otherwise blend
  // the intent anchor with where the body actually is, and drift from there.
  // "Listen to your heart" / Live serves carry a synthetic bio:* moodKey — there the
  // HEART is the intent, so the tempo must entrain to the actual HR (iso-principle). The
  // watch's coarse activity usually defaults to 'resting'; the old 55/45 blend let that
  // low-energy default bury an elevated HR (hr=115 → resting music). On the biometric path
  // physio dominates so the tempo genuinely tracks the heart rate; a light intent nudge
  // keeps it musical. An explicit locomotion activity still cadence-locks either way.
  const biometricDriven = typeof moodKey === 'string' && moodKey.startsWith('bio:');
  let bpmCenter;
  if (CADENCE_BPM[activity] != null) {
    bpmCenter = CADENCE_BPM[activity];
  } else {
    const intentBpm = 70 + intentEnergy * 90;
    const physioBpm = 60 + E * 100;
    bpmCenter = biometricDriven
      ? Math.round(0.85 * physioBpm + 0.15 * intentBpm)
      : Math.round(0.55 * intentBpm + 0.45 * physioBpm);
  }
  bpmCenter = Math.min(260, Math.max(30, bpmCenter));

  // Stress narrows the window (predictability regulates) and biases texture.
  const bpmWidth = S >= 0.6 ? 8 : S >= 0.35 ? 14 : 20;
  const acousticnessBias = round3(Math.min(0.4, (S >= 0.6 ? 0.3 : S >= 0.35 ? 0.15 : 0) + (windDown < 1 ? 0.1 : 0)));
  const instrumentalBias = S >= 0.6 ? 0.2 : 0;

  // Stress adds a bounded comfort bias — it never OVERRIDES the felt state (D4). The old
  // Math.max(moodValence, 0.6) floor meant the more distressed the reading, the more forcibly
  // cheerful the music: the exact "mirror" behaviour VISION §6 forbids.
  const moodValence = desc ? desc.valence_hint : moodCoords(moodKey).valence;
  const valenceTarget = round3(clamp01(moodValence + Math.min(COMFORT_BIAS_MAX, COMFORT_BIAS_SLOPE * S)));

  const tempoBand = tempoBandOf(bpmCenter);

  // Intensity class for the un-relaxable texture gates (enforced, with env-tunable ceilings,
  // in biosonicBand). Derived from the explicit-activity energy intent only: a high-exertion
  // tap forbids acoustic timbre (kills the double-time acoustic-BPM artifact); a low-exertion
  // tap forbids club-danceable tracks (an orthogonal cross-check on a mis-read energy). Mid
  // activities and mood-only requests get no texture gate.
  const activityIntensity = activityEnergy == null ? null
    : activityEnergy >= 0.7 ? 'high'
    : activityEnergy <= 0.2 ? 'low'
    : null;

  // Confidence: one step down per missing input group; never below the floor. The step is
  // sized so ALL FOUR groups missing lands exactly on the floor (D14) — see CONFIDENCE_STEP.
  const groups = [
    finite(baselines?.rhrMedian) != null || finite(baselines?.hrvMedian) != null,
    sleepScore != null,
    heartRate != null,
    hrvScore != null || batteryScore != null || readinessScore != null,
  ];
  const missing = groups.filter(g => !g).length;
  const confidence = Math.max(
    CONFIDENCE_FLOOR,
    Math.round((1 - CONFIDENCE_STEP * missing) * 100) / 100,
  );

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
    // An explicit activity chip is a direct intent — the scorer lets the biosonic target
    // dominate the ranking so a high-affinity off-target track can't bury on-target ones.
    activityDriven: activityEnergy != null,
    // Intensity class for the texture gates: 'high' → acousticness ceiling, 'low' → danceability
    // ceiling, null → no texture gate (mid-exertion or mood-only).
    activityIntensity,
    // W4-007 (§M.10): is `bpmCenter` a STEP CADENCE rather than an ordinary tempo centre?
    // The scorer folds octaves by default, because half/double-time is a known beat-tracker
    // artefact and 87 and 174 are the same groove. Footfall, though, has no octave: an 81-bpm
    // track is not a 162-spm run. Only this function knows which of its two branches produced
    // the centre, so the distinction is published here rather than re-derived downstream.
    // `activityDriven` is deliberately NOT that predicate — it is true for 'resting' and
    // 'winding down' too, and a workout's centre is a physiology/intent blend with no
    // footfall in it. Additive key: the 13 legacy target keys are untouched (§0.2.5).
    cadenceLocked: CADENCE_BPM[activity] != null,
    state: { recovery: round3(R), stress: round3(S), exertion: round3(E) },
  };
}

// ACTIVITY_EXERTION_FLOOR is exported for the W4-005 affect engine, which reuses these exact
// numbers as a Bayesian PRIOR rather than as a floor (see affectEngine.exertionAxis). One table,
// two readings of it — a second copy would drift.
// HRV_FALLBACK is exported so the equality with the engine's own population prior
// (`POPULATION.hrv`) can be PINNED rather than left as a coincidence — `baselines.js` relies on it
// when it nulls an unknown user's HRV pair. `_finite` is exported for the same reason: the guard
// that separates "no measurement" from "a measurement of zero" is load-bearing enough to test
// directly, not only through its consequences. (W4-D15)
module.exports = {
  translate, tempoBandOf, VERSION, ACTIVITY_EXERTION_FLOOR, HRV_FALLBACK, ABSTENTION_FLAG, MIN_SPREAD,
  _finite: finite,
};
