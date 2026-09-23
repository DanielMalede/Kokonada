'use strict';

// W4-006 / W4-D63 — THE STATE CORPUS: one authored moment per taxonomy state.
//
// These 34 scripts were written for `tests/stateTaxonomy.reachability.test.js`, which uses them to
// prove the hard Definition of Done of W4-006: every state in the taxonomy is something a real
// body can actually put the engine into. They lived inside that test file until W4-D63 needed the
// SAME corpus driven through the real production seams — and a corpus that exists in two copies is
// a corpus that will disagree with itself the first time a state is retuned, which would make the
// two lanes' numbers incomparable exactly when the comparison is the point.
//
// So the corpus is a first-class `sim/` artifact next to `personas.js`, and both lanes consume it:
//
//   tests/stateTaxonomy.reachability.test.js  → the PURE engine    (`updateAffect` directly)
//   tests/sim.stateCoverage.soak.test.js      → the REAL seams     (`liveStateAdapter`, `buildTargets`)
//
// Nothing here is a population constant. `hrFrac` is a fraction of THAT PERSONA'S heart-rate
// reserve (§M.7), so 0.7 is the same effort for the athlete and the older adult even though it is
// a different number of beats; `hrvRatio` is relative to their own median; the baseline blob is
// 21 real days of that persona through the real generator, folded by the real baseline engine.
//
// THE FINDING THIS CORPUS ALREADY PAID FOR: the first draft of the taxonomy was authored in raw
// axis units, and eight states were unreachable because `blend()` shrinks every axis toward the
// engine's NEUTRAL prior — `peak-effort` asked for exertion 0.94 from an engine whose ceiling is
// 0.78, and every heavily-fatigued state sat above a fatigue ceiling of 0.48. That is why the
// table is now authored in normalised units over a MEASURED envelope (`AXIS_RANGE`).

const { computeBaselineBlob } = require('../app/agents/runtime/physiology/baselineEngine');
const { generate } = require('./generator');
const { PERSONAS } = require('./personas');

/** The window the baseline blob is folded from. Fixed (S9): a corpus with a clock is not replayable. */
const BASELINE_START = Date.UTC(2026, 6, 1, 0, 0, 0);
const BASELINE_DAYS = 21;

/** The reference night the scripts scale against — deliberately `affectEngine.DEFAULT_NIGHT`. */
const NIGHT = Object.freeze({ deep: 90, light: 300, rem: 90 });

// Mood taps, as (valence, arousal) in [-1,1] — the app's wheel coordinates. Named so a script
// reads as a person rather than as four numbers.
const TAPS = Object.freeze({
  calm: [{ x: 0.35, y: -0.7 }, { x: 0.3, y: -0.65 }, { x: 0.35, y: -0.6 }],
  still: [{ x: 0.1, y: -0.85 }, { x: 0.05, y: -0.9 }, { x: 0.1, y: -0.8 }],
  low: [{ x: -0.8, y: -0.5 }, { x: -0.85, y: -0.45 }, { x: -0.8, y: -0.4 }],
  flat: [{ x: 0.05, y: -0.05 }, { x: 0.0, y: 0.05 }, { x: 0.05, y: 0.0 }],
  neutral: [{ x: 0, y: 0 }, { x: 0.05, y: -0.05 }],
  alert: [{ x: 0.2, y: 0.5 }, { x: 0.15, y: 0.45 }],
  bright: [{ x: 0.85, y: 0.5 }, { x: 0.8, y: 0.55 }, { x: 0.8, y: 0.45 }],
  tense: [{ x: 0.6, y: 0.45 }, { x: 0.65, y: 0.4 }, { x: 0.6, y: 0.5 }],
  flow: [{ x: 0.8, y: 0.15 }, { x: 0.85, y: 0.2 }, { x: 0.8, y: 0.25 }],
});

const baselineCache = new Map();

/**
 * 21 days of this persona through the real generator, folded into their real baseline blob.
 *
 * Memoised per persona because it is the expensive half of every script (21 simulated days at a
 * 5-minute cadence, then the full hour-table / cosinor / Karvonen / HRV fold) and there are only
 * six personas behind 34 scripts. The cache is keyed by persona alone, which is sound precisely
 * because nothing in it depends on the moment being scripted.
 */
function baselineFor(personaId) {
  if (baselineCache.has(personaId)) return baselineCache.get(personaId);
  const persona = PERSONAS[personaId];
  if (!persona) throw new RangeError(`sim/stateScripts: unknown persona '${personaId}'`);
  const run = generate({
    persona: personaId,
    seed: `reach:${personaId}`,
    startAt: BASELINE_START,
    days: BASELINE_DAYS,
    sampleIntervalSec: 300,
    artifacts: false, // artifact rejection is W4-003's suite; this corpus is about the state model
  });
  const hrSamples = run.truth.samples.map((s) => ({
    value: s.hr, recordedAt: s.tMs, activity: s.activity, tzOffsetMinutes: persona.tzOffsetMinutes,
  }));
  const vitalSamples = [];
  for (const d of run.truth.daily) {
    const at = BASELINE_START + d.dayIndex * 86400e3 + 7 * 3600e3;
    vitalSamples.push({ metric: 'hrv', value: d.hrv, recordedAt: at });
    vitalSamples.push({ metric: 'restingHeartRate', value: d.restingHeartRate, recordedAt: at });
  }
  const blob = computeBaselineBlob({
    hrSamples,
    vitalSamples,
    profile: { maxHeartRate: persona.maxHeartRate },
    now: BASELINE_START + BASELINE_DAYS * 86400e3,
    tzOffsetMinutes: persona.tzOffsetMinutes,
  });
  const out = { persona, blob };
  baselineCache.set(personaId, out);
  return out;
}

const scaleNight = (r) => ({ deep: NIGHT.deep * r, light: NIGHT.light * r, rem: NIGHT.rem * r });

/**
 * One authored moment → the exact input `updateAffect` takes.
 *
 * This is the FULL evidence bundle — live reading, baselines, HRV/battery/readiness, last night's
 * sleep, twelve nights of sleep history and the mood tap. No production lane supplies all of it,
 * which is the measurement W4-D63 exists to make: `sim/stateCoverage.js` compares what a lane
 * forwards against what a state requires. A lane driver takes this bundle and passes on only the
 * fields its own seam actually carries.
 */
function momentFor(personaId, spec) {
  const { persona, blob } = baselineFor(personaId);
  const heartRate = spec.hrFrac == null
    ? null
    : Math.round(blob.zones.restingHeartRate + spec.hrFrac * blob.zones.hrr);

  const sleep = {};
  if (spec.sleepRatio != null) { sleep.lastNight = scaleNight(spec.sleepRatio); sleep.baseline = NIGHT; }
  if (spec.debt != null) {
    sleep.history = [];
    for (let i = 0; i < 12; i++) {
      const n = scaleNight(spec.debt);
      sleep.history.push({ ...n, recordedAt: BASELINE_START + i * 86400e3, need: NIGHT });
    }
  }

  return {
    live: { heartRate, activity: spec.activity ?? null, confidence: 1, degraded: spec.degraded ?? null },
    baselines: blob,
    state: {
      hrv: spec.hrvRatio == null ? null : blob.hrvMedian * spec.hrvRatio,
      bodyBattery: spec.battery ?? null,
      dailyReadiness: spec.readiness ?? null,
    },
    sleep,
    taps: spec.taps ? TAPS[spec.taps] : null,
    tzOffsetMinutes: persona.tzOffsetMinutes,
  };
}

/**
 * The wall-clock instant a script's `hour` means for its own persona — the same arithmetic every
 * driver needs, so it is derived once here rather than re-implemented per lane.
 */
function startOfScript(personaId, spec, day = Date.UTC(2026, 7, 1, 0, 0, 0)) {
  const { persona } = baselineFor(personaId);
  return day + spec.hour * 3600e3 - persona.tzOffsetMinutes * 60e3;
}

// ── the scripts ─────────────────────────────────────────────────────────────────────────────

const SCRIPTS = [
  { target: 'deep-rest', persona: 'athlete', spec: { hrFrac: 0, activity: 'unknown', taps: 'still', hour: 22, hrvRatio: 1.3, sleepRatio: 0.9, debt: 1, battery: null, readiness: 30 } },
  { target: 'meditative', persona: 'shiftWorker', spec: { hrFrac: 0.06, activity: 'winding down', taps: 'still', hour: 17, hrvRatio: 0.95, sleepRatio: 1.2, debt: 1, battery: 8, readiness: null } },
  { target: 'resting-content', persona: 'shiftWorker', spec: { hrFrac: 0.06, activity: 'resting', taps: 'low', hour: 21, hrvRatio: 0.8, sleepRatio: 1.2, debt: 1, battery: 45, readiness: 30 } },
  { target: 'drowsy-low-battery', persona: 'shiftWorker', spec: { hrFrac: 0.06, activity: 'resting', taps: null, hour: 21, hrvRatio: 0.5, sleepRatio: 0.5, debt: 0.35, battery: 8, readiness: 30 } },
  { target: 'post-exertion-recovery', persona: 'olderAdult', spec: { hrFrac: 0.24, activity: 'resting', taps: null, hour: 11, hrvRatio: 1.3, sleepRatio: null, debt: 0.55, battery: 65, readiness: 30 } },
  { target: 'sleep-onset-wind-down', persona: 'olderAdult', spec: { hrFrac: 0.03, activity: 'unknown', taps: 'calm', hour: 1, hrvRatio: 0.8, sleepRatio: 0.5, debt: null, battery: null, readiness: 50 } },

  { target: 'acute-stress', persona: 'athlete', spec: { hrFrac: 0.28, activity: null, taps: 'calm', hour: 9, hrvRatio: 0.65, sleepRatio: null, debt: 1, battery: 8, readiness: 30 } },
  { target: 'simmering-tension', persona: 'shiftWorker', spec: { hrFrac: 0.06, activity: 'unknown', taps: 'calm', hour: 7, hrvRatio: 0.5, sleepRatio: 1.2, debt: 0.55, battery: 25, readiness: 88 } },
  { target: 'anxious-restless', persona: 'olderAdult', spec: { hrFrac: 0.36, activity: 'working', taps: 'bright', hour: 23, hrvRatio: 0.65, sleepRatio: 0.5, debt: null, battery: 96, readiness: 70 } },
  { target: 'overload-needs-downshift', persona: 'shiftWorker', spec: { hrFrac: 0.36, activity: 'walking', taps: 'alert', hour: 17, hrvRatio: 0.35, sleepRatio: null, debt: 0.35, battery: 45, readiness: 10 } },
  { target: 'recovering-from-stress', persona: 'athlete', spec: { hrFrac: 0.1, activity: 'unknown', taps: 'low', hour: 9, hrvRatio: 0.95, sleepRatio: 0.7, debt: 0.55, battery: 96, readiness: 10 } },

  { target: 'deep-focus', persona: 'shiftWorker', spec: { hrFrac: 0.1, activity: null, taps: 'calm', hour: 2, hrvRatio: null, sleepRatio: 0.7, debt: null, battery: 65, readiness: 10 } },
  { target: 'light-focus', persona: 'athlete', spec: { hrFrac: 0.06, activity: 'resting', taps: null, hour: 21, hrvRatio: 0.95, sleepRatio: null, debt: 1, battery: 65, readiness: 30 } },
  { target: 'creative-flow', persona: 'stressedProfessional', spec: { hrFrac: 0.08, activity: 'focus', taps: 'tense', hour: 17, hrvRatio: 1.3, sleepRatio: 0.9, debt: 0.15, battery: 25, readiness: 88 } },
  { target: 'mental-fatigue', persona: 'stressedProfessional', spec: { hrFrac: 0.1, activity: 'unknown', taps: null, hour: 15, hrvRatio: null, sleepRatio: 0.3, debt: 0.35, battery: null, readiness: 10 } },
  { target: 'restless-distracted', persona: 'shiftWorker', spec: { hrFrac: 0.36, activity: 'walking', taps: 'neutral', hour: 19, hrvRatio: 0.8, sleepRatio: 0.7, debt: 0.35, battery: 65, readiness: 50 } },

  { target: 'warmup', persona: 'shiftWorker', spec: { hrFrac: 0.44, activity: 'cycling', taps: 'flat', hour: 9, hrvRatio: 1.3, sleepRatio: 1.2, debt: null, battery: null, readiness: 70 } },
  { target: 'steady-cardio', persona: 'stressedProfessional', spec: { hrFrac: 0.7, activity: 'running', taps: 'flat', hour: 9, hrvRatio: 1.1, sleepRatio: 0.3, debt: 0.35, battery: 8, readiness: 88 } },
  { target: 'peak-effort', persona: 'athlete', spec: { hrFrac: 0.94, activity: 'workout', taps: 'tense', hour: 13, hrvRatio: 0.8, sleepRatio: null, debt: 0.15, battery: null, readiness: 70 } },
  { target: 'intervals', persona: 'athlete', spec: { hrFrac: 0.78, activity: 'running', taps: 'bright', hour: 17, hrvRatio: 0.95, sleepRatio: null, debt: 0.55, battery: null, readiness: 70 } },
  { target: 'cooldown', persona: 'olderAdult', spec: { hrFrac: 0.34, activity: 'walking', taps: 'alert', hour: 9, hrvRatio: null, sleepRatio: 0.3, debt: 0.35, battery: null, readiness: 50 } },
  { target: 'obligated-workout-low-recovery', persona: 'athlete', spec: { hrFrac: 0.55, activity: 'running', taps: null, hour: 21, hrvRatio: null, sleepRatio: 0.5, debt: 0.15, battery: 65, readiness: 10 } },
  { target: 'casual-walk', persona: 'stressedProfessional', spec: { hrFrac: 0.38, activity: 'walking', taps: 'flat', hour: 9, hrvRatio: 1.1, sleepRatio: 0.7, debt: 1, battery: 8, readiness: 88 } },
  { target: 'commute-active', persona: 'sedentary', spec: { hrFrac: 0.38, activity: 'commuting', taps: 'flat', hour: 8, hrvRatio: 0.65, sleepRatio: 0.7, debt: null, battery: 25, readiness: 30 } },

  { target: 'morning-activation', persona: 'sedentary', spec: { hrFrac: 0.24, activity: 'commuting', taps: null, hour: 10, hrvRatio: 0.95, sleepRatio: 1.05, debt: 1, battery: 65, readiness: 88 } },
  { target: 'morning-sluggish', persona: 'sedentary', spec: { hrFrac: 0.03, activity: null, taps: 'calm', hour: 9, hrvRatio: 0.8, sleepRatio: null, debt: 0.55, battery: 85, readiness: 30 } },
  { target: 'afternoon-dip', persona: 'sedentary', spec: { hrFrac: 0.16, activity: null, taps: 'low', hour: 16, hrvRatio: null, sleepRatio: null, debt: 0.55, battery: 85, readiness: 30 } },
  { target: 'evening-unwind', persona: 'sedentary', spec: { hrFrac: -0.06, activity: null, taps: 'flat', hour: 22, hrvRatio: 0.8, sleepRatio: 0.7, debt: 0.8, battery: 25, readiness: 30 } },
  { target: 'night-owl-alert', persona: 'shiftWorker', spec: { hrFrac: 0.08, activity: 'working', taps: 'neutral', hour: 23, hrvRatio: 1.1, sleepRatio: 1.05, debt: 0.8, battery: 85, readiness: 50 } },
  { target: 'pre-sleep', persona: 'olderAdult', spec: { hrFrac: -0.06, activity: null, taps: 'flat', hour: 21, hrvRatio: 0.95, sleepRatio: 0.5, debt: 0.55, battery: 85, readiness: 70 } },

  { target: 'energized-positive', persona: 'stressedProfessional', spec: { hrFrac: 0.16, activity: null, taps: 'bright', hour: 5, hrvRatio: 0.95, sleepRatio: 0.3, debt: null, battery: 65, readiness: 10 } },
  { target: 'low-mood-low-energy', persona: 'olderAdult', spec: { hrFrac: 0.1, activity: null, taps: 'low', hour: 5, hrvRatio: 0.95, sleepRatio: 0.9, debt: 0.15, battery: 65, readiness: 70 } },
  { target: 'tense-but-positive', persona: 'shiftWorker', spec: { hrFrac: 0.12, activity: null, taps: 'bright', hour: 5, hrvRatio: 0.65, sleepRatio: 0.3, debt: 1, battery: 25, readiness: 70 } },
  { target: 'neutral-baseline', persona: 'athlete', spec: { hrFrac: 0.03, activity: 'unknown', taps: 'flat', hour: 11, hrvRatio: 1.3, sleepRatio: 0.5, debt: null, battery: 85, readiness: null } },
];

/** The script authored for one state, or null. One script per state is pinned by the reachability suite. */
function scriptFor(target) {
  return SCRIPTS.find((s) => s.target === target) || null;
}

module.exports = {
  BASELINE_START, BASELINE_DAYS, NIGHT, TAPS, SCRIPTS,
  baselineFor, momentFor, scriptFor, startOfScript,
};
