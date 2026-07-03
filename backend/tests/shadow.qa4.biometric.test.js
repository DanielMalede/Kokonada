'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// QA4 — AGENT Q1: BIOMETRIC VALIDATION (physiologist-adversary)
// Mandate: break translate() biosonic math, physiological bounds, and the
// zero-knowledge boundary. Hostile fuzz + boundary matrices + golden vectors.
// Verdict for translate(): DEFENDED — every output stays finite and range-clamped
// for arbitrary garbage; pinned as a permanent regression guard.
// ─────────────────────────────────────────────────────────────────────────────

const { translate } = require('../app/services/biosonic/translate');
const {
  bandFromHeartRate,
  syntheticBioMoodKey,
  moodCoords,
} = require('../app/services/moodDescriptors');

// Deterministic PRNG (mulberry32) so a failing fuzz seed is reproducible.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOSTILE_SCALARS = [
  NaN, Infinity, -Infinity, -0, 0, null, undefined, '', '42', 'abc',
  1e308, -1e308, 1e-308, {}, [], [1, 2], true, false, () => 0,
];
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

function assertTargetsSane(t) {
  const nums = [t.bpmCenter, t.bpmWidth, t.energyFloor, t.energyCeiling,
    t.valenceTarget, t.acousticnessBias, t.instrumentalBias, t.confidence,
    t.state.recovery, t.state.stress, t.state.exertion];
  for (const n of nums) expect(Number.isFinite(n)).toBe(true);
  expect(t.bpmCenter).toBeGreaterThanOrEqual(30);
  expect(t.bpmCenter).toBeLessThanOrEqual(260);
  expect(t.bpmWidth).toBeGreaterThan(0);
  expect(t.energyFloor).toBeGreaterThanOrEqual(0);
  expect(t.energyFloor).toBeLessThanOrEqual(t.energyCeiling);
  expect(t.energyCeiling).toBeGreaterThanOrEqual(0.2);
  expect(t.energyCeiling).toBeLessThanOrEqual(0.95);
  expect(t.valenceTarget).toBeGreaterThanOrEqual(0);
  expect(t.valenceTarget).toBeLessThanOrEqual(1);
  expect(t.acousticnessBias).toBeGreaterThanOrEqual(0);
  expect(t.acousticnessBias).toBeLessThanOrEqual(0.4);
  expect(['resting', 'active', 'peak']).toContain(t.tempoBand);
  expect(t.confidence).toBeGreaterThanOrEqual(0.3);
  expect(t.confidence).toBeLessThanOrEqual(1);
  for (const s of [t.state.recovery, t.state.stress, t.state.exertion]) {
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  }
}

describe('Q1 — translate() structured fuzz (1000 rounds, seed 0xA11)', () => {
  it('emits finite, range-clamped targets for ANY garbage input', () => {
    const rng = mulberry32(0xa11);
    const activities = [undefined, null, 'walking', 'running', 'cycling', 'resting',
      'unknown', 'strength', 'swimming', 'GARBAGE', 42, {}];
    const moodKeys = [null, 'focus', 'intense', 'calm', 'bio:peak:running',
      'bio:garbage:x', 'not-a-mood', {}, 7];
    for (let i = 0; i < 1000; i++) {
      const input = {
        live: { heartRate: pick(rng, HOSTILE_SCALARS), activity: pick(rng, activities) },
        baselines: {
          rhrMedian: pick(rng, HOSTILE_SCALARS), rhrMAD: pick(rng, HOSTILE_SCALARS),
          hrvMedian: pick(rng, HOSTILE_SCALARS), hrvMAD: pick(rng, HOSTILE_SCALARS),
        },
        sleep: {
          lastNight: { deep: pick(rng, HOSTILE_SCALARS), light: pick(rng, HOSTILE_SCALARS), rem: pick(rng, HOSTILE_SCALARS) },
          baseline: { deep: pick(rng, HOSTILE_SCALARS), light: pick(rng, HOSTILE_SCALARS), rem: pick(rng, HOSTILE_SCALARS) },
        },
        state: {
          hrv: pick(rng, HOSTILE_SCALARS), bodyBattery: pick(rng, HOSTILE_SCALARS),
          dailyReadiness: pick(rng, HOSTILE_SCALARS),
        },
        hourOfDay: pick(rng, HOSTILE_SCALARS),
        moodKey: pick(rng, moodKeys),
      };
      assertTargetsSane(translate(input));
    }
  });

  it('survives an entirely empty / undefined call', () => {
    assertTargetsSane(translate());
    assertTargetsSane(translate({}));
    assertTargetsSane(translate({ live: null, baselines: null, sleep: null, state: null }));
  });
});

describe('Q1 — bandFromHeartRate boundary matrix', () => {
  it.each([
    [-1, null], [0, null], [29, 'resting'], [30, 'resting'], [89, 'resting'],
    [90, 'active'], [119, 'active'], [120, 'peak'], [220, 'peak'], [999, 'peak'],
    [NaN, null], [Infinity, null], ['abc', null], [null, null],
  ])('hr=%p → %p', (hr, expected) => {
    expect(bandFromHeartRate(hr)).toBe(expected);
  });
});

describe('Q1 — degenerate baseline statistics (robust-z must not explode)', () => {
  it('MAD = 0 (constant HR series) does not NaN-poison downstream', () => {
    const t = translate({
      live: { heartRate: 70, activity: 'resting' },
      baselines: { rhrMedian: 60, rhrMAD: 0, hrvMedian: 45, hrvMAD: 0 },
      state: { hrv: 50 },
    });
    assertTargetsSane(t);
  });
  it('negative and sub-epsilon MAD are treated as fallback spread', () => {
    for (const mad of [-5, 1e-12, -0]) {
      assertTargetsSane(translate({
        live: { heartRate: 72, activity: 'resting' },
        baselines: { rhrMedian: 60, rhrMAD: mad, hrvMedian: 45, hrvMAD: mad },
        state: { hrv: 40 },
      }));
    }
  });
  it('median = null with a MAD present (the Number(null)===0 gotcha) yields no score, not a 0-anchored one', () => {
    assertTargetsSane(translate({
      live: { heartRate: 72, activity: 'resting' },
      baselines: { rhrMedian: null, rhrMAD: 5 },
      state: { hrv: 40 },
    }));
  });
});

describe('Q1 — circadian wind-down boundaries', () => {
  it.each([[-1, 1], [0, 0.8], [4.999, 0.8], [5, 1], [20.999, 1], [21, 0.8], [23.999, 0.8], [24, 1], [NaN, 1]])(
    'hourOfDay=%p folds wind-down consistently',
    (hour) => {
      const t = translate({ live: { heartRate: 80 }, hourOfDay: hour, moodKey: 'energize' });
      assertTargetsSane(t);
    },
  );
  it('late-night wind-down lowers the energy ceiling vs midday for the same body', () => {
    const base = { live: { heartRate: 80 }, moodKey: 'energize', state: { bodyBattery: 90, dailyReadiness: 90 } };
    const midday = translate({ ...base, hourOfDay: 13 });
    const night = translate({ ...base, hourOfDay: 23 });
    expect(night.energyCeiling).toBeLessThan(midday.energyCeiling);
  });
});

describe('Q1 — golden vectors: recovery gates energy (a wrecked body gets no bangers)', () => {
  const wrecked = translate({
    live: { heartRate: 95, activity: 'walking' },
    baselines: { rhrMedian: 55, rhrMAD: 4, hrvMedian: 60, hrvMAD: 10 },
    sleep: { lastNight: { deep: 20, light: 120, rem: 20 }, baseline: { deep: 90, light: 300, rem: 90 } },
    state: { hrv: 25, bodyBattery: 15, dailyReadiness: 20 },
    hourOfDay: 23, moodKey: 'energize',
  });
  const rested = translate({
    live: { heartRate: 62, activity: 'resting' },
    baselines: { rhrMedian: 55, rhrMAD: 4, hrvMedian: 60, hrvMAD: 10 },
    sleep: { lastNight: { deep: 100, light: 320, rem: 95 }, baseline: { deep: 90, light: 300, rem: 90 } },
    state: { hrv: 75, bodyBattery: 95, dailyReadiness: 92 },
    hourOfDay: 10, moodKey: 'energize',
  });

  it('the wrecked body is capped below the rested body even on an energize tap', () => {
    expect(wrecked.energyCeiling).toBeLessThan(rested.energyCeiling);
    expect(wrecked.state.recovery).toBeLessThan(rested.state.recovery);
  });
  it('cadence-locks locomotion regardless of intent', () => {
    expect(translate({ live: { activity: 'running' }, moodKey: 'calm' }).bpmCenter).toBe(162);
    expect(translate({ live: { activity: 'walking' }, moodKey: 'intense' }).bpmCenter).toBe(118);
    expect(translate({ live: { activity: 'cycling' }, moodKey: 'calm' }).bpmCenter).toBe(145);
  });
});

describe('Q1 — zero-knowledge: synthetic bio identity is deterministic & biometric-only', () => {
  it('same physiological state → same bio moodKey (no LLM, no randomness)', () => {
    expect(syntheticBioMoodKey(130, 'Running')).toBe('bio:peak:running');
    expect(syntheticBioMoodKey(130, 'Running')).toBe('bio:peak:running');
    expect(syntheticBioMoodKey(75, null)).toBe('bio:resting:unknown');
  });
  it('no usable HR → null (never fabricated)', () => {
    expect(syntheticBioMoodKey(0, 'running')).toBeNull();
    expect(syntheticBioMoodKey(NaN, 'running')).toBeNull();
  });
  it('moodCoords always lands inside the unit square for any key', () => {
    for (const k of ['focus', 'intense', 'bio:peak:x', 'bio:junk:y', 'nonsense', null, {}, 7]) {
      const c = moodCoords(k);
      expect(c.energy).toBeGreaterThanOrEqual(0);
      expect(c.energy).toBeLessThanOrEqual(1);
      expect(c.valence).toBeGreaterThanOrEqual(0);
      expect(c.valence).toBeLessThanOrEqual(1);
    }
  });
});
