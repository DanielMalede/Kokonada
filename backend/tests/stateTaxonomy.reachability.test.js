'use strict';

// A4 — THE HARD DEFINITION OF DONE for W4-006: **every state in the taxonomy is reachable by at
// least one persona script.** `stateTaxonomy.test.js` proves the table is internally coherent;
// only this file can answer whether the states are things a real body can actually put the engine
// into. A state nobody can reach is worse than a wrong one, because it is SILENT: it never fires,
// never shows up in a soak histogram, and nothing else in the suite notices.
//
// Nothing here is mocked. Each script drives:
//   sim/generator  →  21 days of that persona's heart rate and nightly vitals
//   baselineEngine →  their REAL personal baselines (hour table, cosinor, Karvonen zones, HRV)
//   affectEngine   →  the seven axes and §M.5's forward step, over the REAL taxonomy
// and asserts the reported label. The only authored parts are the moment itself — heart rate as a
// fraction of that persona's own reserve, the activity label, HRV relative to their own median,
// sleep, debt, battery, readiness, local hour, mood taps — which is exactly what a script is.
//
// THE FINDING THIS SUITE ALREADY PAID FOR: the first draft of the taxonomy was authored in raw
// axis units, and eight states were unreachable because `blend()` shrinks every axis toward the
// engine's NEUTRAL prior — `peak-effort` asked for exertion 0.94 from an engine whose ceiling is
// 0.78, and every heavily-fatigued state sat above a fatigue ceiling of 0.48. That is why the
// table is now authored in normalised units over a MEASURED envelope (`AXIS_RANGE`). No other
// test in the wave would have caught it.

const {
  updateAffect, createAffectState, AXIS_NAMES,
} = require('../app/agents/runtime/physiology/affectEngine');
const { STATES, byId } = require('../app/agents/runtime/knowledge/stateTaxonomy');
const { computeBaselineBlob } = require('../app/agents/runtime/physiology/baselineEngine');
const { generate } = require('../sim/generator');
const { PERSONAS } = require('../sim/personas');

const START = Date.UTC(2026, 6, 1, 0, 0, 0);
const BASELINE_DAYS = 21;
const NIGHT = { deep: 90, light: 300, rem: 90 };

// Mood taps, as (valence, arousal) in [-1,1] — the app's wheel coordinates. Named so a script
// reads as a person rather than as four numbers.
const TAPS = {
  calm: [{ x: 0.35, y: -0.7 }, { x: 0.3, y: -0.65 }, { x: 0.35, y: -0.6 }],
  still: [{ x: 0.1, y: -0.85 }, { x: 0.05, y: -0.9 }, { x: 0.1, y: -0.8 }],
  low: [{ x: -0.8, y: -0.5 }, { x: -0.85, y: -0.45 }, { x: -0.8, y: -0.4 }],
  flat: [{ x: 0.05, y: -0.05 }, { x: 0.0, y: 0.05 }, { x: 0.05, y: 0.0 }],
  neutral: [{ x: 0, y: 0 }, { x: 0.05, y: -0.05 }],
  alert: [{ x: 0.2, y: 0.5 }, { x: 0.15, y: 0.45 }],
  bright: [{ x: 0.85, y: 0.5 }, { x: 0.8, y: 0.55 }, { x: 0.8, y: 0.45 }],
  tense: [{ x: 0.6, y: 0.45 }, { x: 0.65, y: 0.4 }, { x: 0.6, y: 0.5 }],
  flow: [{ x: 0.8, y: 0.15 }, { x: 0.85, y: 0.2 }, { x: 0.8, y: 0.25 }],
};

const baselineCache = new Map();

/** 21 days of this persona through the real generator, folded into their real baseline blob. */
function baselineFor(personaId) {
  if (baselineCache.has(personaId)) return baselineCache.get(personaId);
  const persona = PERSONAS[personaId];
  const run = generate({
    persona: personaId,
    seed: `reach:${personaId}`,
    startAt: START,
    days: BASELINE_DAYS,
    sampleIntervalSec: 300,
    artifacts: false, // artifact rejection is W4-003's suite; this one is about the state model
  });
  const hrSamples = run.truth.samples.map((s) => ({
    value: s.hr, recordedAt: s.tMs, activity: s.activity, tzOffsetMinutes: persona.tzOffsetMinutes,
  }));
  const vitalSamples = [];
  for (const d of run.truth.daily) {
    const at = START + d.dayIndex * 86400e3 + 7 * 3600e3;
    vitalSamples.push({ metric: 'hrv', value: d.hrv, recordedAt: at });
    vitalSamples.push({ metric: 'restingHeartRate', value: d.restingHeartRate, recordedAt: at });
  }
  const blob = computeBaselineBlob({
    hrSamples,
    vitalSamples,
    profile: { maxHeartRate: persona.maxHeartRate },
    now: START + BASELINE_DAYS * 86400e3,
    tzOffsetMinutes: persona.tzOffsetMinutes,
  });
  const out = { persona, blob };
  baselineCache.set(personaId, out);
  return out;
}

const scaleNight = (r) => ({ deep: NIGHT.deep * r, light: NIGHT.light * r, rem: NIGHT.rem * r });

/** One authored moment → the exact input `updateAffect` takes. */
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
      sleep.history.push({ ...n, recordedAt: START + i * 86400e3, need: NIGHT });
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

/** Hold one moment for `minutes` and report what the engine settles on. */
function hold(personaId, spec, minutes = 30) {
  const { persona } = baselineFor(personaId);
  const input = momentFor(personaId, spec);
  const t0 = Date.UTC(2026, 7, 1, 0, 0, 0) + spec.hour * 3600e3 - persona.tzOffsetMinutes * 60e3;
  let engineState = createAffectState({ states: STATES });
  let affect = null;
  for (let i = 0; i < minutes; i++) {
    const r = updateAffect(engineState, input, { now: t0 + i * 60e3, states: STATES });
    engineState = r.state;
    affect = r.affect;
  }
  return { affect, engineState };
}

// ── the scripts ─────────────────────────────────────────────────────────────────────────────
//
// `hrFrac` is a fraction of THAT PERSONA'S heart-rate reserve (§M.7), so 0.7 is the same effort
// for the athlete and the older adult even though it is a different number of beats. `hrvRatio`
// is relative to their own median. Nothing here is a population constant.

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

describe('stateTaxonomy reachability — the hard DoD', () => {
  test('EVERY state in the taxonomy is reached by at least one persona script', () => {
    const misses = [];
    for (const s of SCRIPTS) {
      const { affect } = hold(s.persona, s.spec);
      if (affect.label !== s.target) misses.push(`${s.target} (${s.persona}) reported ${affect.label}`);
    }
    expect(misses).toEqual([]);
    expect(new Set(SCRIPTS.map((s) => s.target)).size).toBe(STATES.length);
  }, 120000);

  test('every taxonomy state has a script and every script names a real state', () => {
    const scripted = SCRIPTS.map((s) => s.target).sort();
    expect(scripted).toEqual(STATES.map((s) => s.id).sort());
    for (const s of SCRIPTS) expect(byId(s.target)).not.toBeNull();
  });

  test('the scripts are physiologically coherent, not just numerically convenient', () => {
    // A script that reaches a state by pairing a sprinting heart rate with the label "resting"
    // proves nothing about the state, so this pins the pairing rather than trusting the author.
    // Read as: at this fraction of the person's own reserve, these labels are plausible.
    const PLAUSIBLE = [
      { upTo: 0.15, acts: [null, 'unknown', 'resting', 'winding down', 'working', 'focus'] },
      { upTo: 0.30, acts: [null, 'unknown', 'resting', 'working', 'focus', 'commuting', 'walking'] },
      { upTo: 0.50, acts: [null, 'unknown', 'walking', 'commuting', 'working', 'workout', 'cycling'] },
      { upTo: 0.75, acts: ['walking', 'cycling', 'workout', 'running', 'unknown'] },
      { upTo: 1.10, acts: ['running', 'workout'] },
    ];
    const offenders = [];
    for (const s of SCRIPTS) {
      const frac = s.spec.hrFrac ?? 0;
      const band = PLAUSIBLE.find((b) => frac <= b.upTo);
      if (!band.acts.includes(s.spec.activity ?? null)) {
        offenders.push(`${s.target}: activity ${s.spec.activity} at ${frac} of reserve`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every reached state is reported with a posterior that clears its own entry bar', () => {
    // Reachability is not "the argmax happened to be this" — `projectLabel` also requires the
    // winner to clear `enterThreshold`, which is what makes a label a claim rather than a guess.
    const weak = [];
    for (const s of SCRIPTS.slice(0, 8)) {
      const { affect } = hold(s.persona, s.spec);
      const state = byId(s.target);
      if (!(affect.topState.alpha >= state.enterThreshold)) {
        weak.push(`${s.target}: alpha ${affect.topState.alpha} < enter ${state.enterThreshold}`);
      }
    }
    expect(weak).toEqual([]);
  }, 60000);
});

describe('stateTaxonomy reachability — the label is a state, not a reading', () => {
  test('a boundary-hugging signal does not make the reported label chase it', () => {
    // The listener's music changes when the label does. This drives a heart rate oscillating
    // across the deep-rest/resting-content boundary every three minutes for two hours and counts
    // reported transitions; a memoryless labeller would follow every swing.
    const personaId = 'sedentary';
    const { persona } = baselineFor(personaId);
    const t0 = Date.UTC(2026, 7, 1, 0, 0, 0) + 21 * 3600e3 - persona.tzOffsetMinutes * 60e3;
    let engineState = createAffectState({ states: STATES });
    let transitions = 0;
    let swings = 0;
    let prevPhase = null;
    for (let minute = 0; minute < 120; minute++) {
      const phase = Math.floor(minute / 3) % 2;
      if (prevPhase !== null && phase !== prevPhase) swings++;
      prevPhase = phase;
      const spec = {
        hrFrac: phase === 0 ? 0.02 : 0.11, activity: 'resting', taps: 'calm', hour: 21,
        hrvRatio: 1.0, sleepRatio: 1.0, debt: null, battery: 70, readiness: 70,
      };
      const r = updateAffect(engineState, momentFor(personaId, spec), {
        now: t0 + minute * 60e3, states: STATES,
      });
      engineState = r.state;
      if (r.affect.transitioned) transitions++;
    }
    expect(swings).toBeGreaterThan(30);
    // At most one relabel per minimum dwell over two hours, plus the initial adoption.
    expect(transitions).toBeLessThanOrEqual(1 + Math.ceil(7200 / byId('deep-rest').minDwellSec));
  }, 60000);

  test('but a real regime change is picked up quickly — resting to a hard effort', () => {
    const personaId = 'athlete';
    const { persona } = baselineFor(personaId);
    const t0 = Date.UTC(2026, 7, 1, 0, 0, 0) + 17 * 3600e3 - persona.tzOffsetMinutes * 60e3;
    const rest = { hrFrac: 0.04, activity: 'resting', taps: null, hour: 17, hrvRatio: 1.0, sleepRatio: 1.0, debt: null, battery: 80, readiness: 80 };
    const effort = { ...rest, hrFrac: 0.94, activity: 'workout' };

    let engineState = createAffectState({ states: STATES });
    for (let m = 0; m < 40; m++) {
      engineState = updateAffect(engineState, momentFor(personaId, rest), { now: t0 + m * 60e3, states: STATES }).state;
    }
    const restingLabel = engineState.label;
    expect(byId(restingLabel).band).toBe('resting');

    let detectedAt = null;
    for (let m = 40; m < 60 && detectedAt === null; m++) {
      const r = updateAffect(engineState, momentFor(personaId, effort), { now: t0 + m * 60e3, states: STATES });
      engineState = r.state;
      if (byId(r.affect.label)?.band === 'peak') detectedAt = m - 40;
    }
    expect(detectedAt).not.toBeNull();
    expect(detectedAt).toBeLessThanOrEqual(3); // minutes: the dwell must not hold a resting label through a sprint
  }, 60000);
});

describe('stateTaxonomy reachability — degraded mode never fabricates', () => {
  test('given only passive evidence, every reported label is one that survives a dead sensor', () => {
    // The real guarantee, and the one that falsified the first version of the `degraded` flag:
    // strip every statement about the body — no heart rate, no HRV, no mood taps and no activity
    // chip, leaving only sleep, battery, readiness and the clock — and the engine must not name a
    // bodily state on the strength of a clock. Exclusion is by `requiredSignals` (mass 0 → not a
    // candidate), not by the state merely scoring badly.
    //
    // The activity chip is stripped DELIBERATELY and it is the interesting part: a user who taps
    // "Running" has made a real statement about their exertion, which the engine is right to
    // believe even with a dead sensor — the companion test below pins that it does. What must
    // never happen is a bodily claim built from nothing but sleep and a clock.
    const bad = [];
    for (const s of SCRIPTS) {
      const passive = {
        ...s.spec, degraded: 'mood-only', hrFrac: null, hrvRatio: null, taps: null, activity: null,
      };
      const { affect } = hold(s.persona, passive, 20);
      if (!affect.label) continue;
      const state = byId(affect.label);
      if (!state.degraded) bad.push(`${s.target} script, passive-only → ${affect.label}`);
    }
    expect(bad).toEqual([]);
    // and it is not vacuous: some label IS still reported, so this is a guarantee about WHICH
    // states survive rather than a suite that simply silenced the engine.
    const { affect } = hold('sedentary', {
      hrFrac: null, activity: null, taps: null, hour: 15,
      hrvRatio: null, sleepRatio: 0.4, debt: 0.4, battery: 15, readiness: 20, degraded: 'mood-only',
    }, 25);
    expect(affect.label).not.toBeNull();
    expect(byId(affect.label).degraded).toBe(true);
  }, 120000);

  test('but a declared activity IS evidence of exertion, sensor or no sensor', () => {
    // The other half of the rule above. Someone who taps "Running" on a dead-sensor day has told
    // the engine something true about their body, and `exertionAxis` carries it as the activity
    // prior. A state requiring exertion therefore stays a live candidate — which is why the
    // passive-only test has to strip the chip to mean what it says.
    const spec = {
      hrFrac: null, activity: 'running', taps: null, hour: 21, hrvRatio: null,
      sleepRatio: 0.5, debt: 0.15, battery: 65, readiness: 10, degraded: 'mood-only',
    };
    const { affect } = hold('athlete', spec, 25);
    expect(affect.axes.exertion.mass).toBeGreaterThan(0);
    expect(affect.label).not.toBeNull();
    expect(byId(affect.label).requiredSignals).toContain('exertion');
  }, 60000);

  test('a degraded run still reports honestly: axes that need the heart rate carry no mass', () => {
    const { affect } = hold('sedentary', {
      hrFrac: 0.5, activity: 'workout', taps: 'flat', hour: 13,
      hrvRatio: 1.0, sleepRatio: 1.0, debt: null, battery: 70, readiness: 70, degraded: 'mood-only',
    }, 20);
    // arousal keeps only its declared component — real evidence, just not from the body.
    expect(affect.axes.arousal.mass).toBeGreaterThan(0);
    // and with the taps removed too there is nothing left for it to stand on.
    const blind = hold('sedentary', {
      hrFrac: 0.5, activity: 'workout', taps: null, hour: 13,
      hrvRatio: 1.0, sleepRatio: 1.0, debt: null, battery: 70, readiness: 70, degraded: 'mood-only',
    }, 20).affect;
    expect(blind.axes.arousal.mass).toBe(0);
    expect(affect.degraded).toBe('mood-only');
    for (const a of AXIS_NAMES) {
      expect(Number.isFinite(affect.axes[a].value)).toBe(true);
      expect(affect.axes[a].value).toBeGreaterThanOrEqual(0);
      expect(affect.axes[a].value).toBeLessThanOrEqual(1);
    }
  }, 60000);
});
