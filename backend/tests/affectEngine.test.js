'use strict';

// A3 — the affect engine (W4-005), evidence-axes half.
//
// What this suite is defending, in order of how badly it hurt:
//
//  D3  a workout read as maximal stress. `translate` computed `restingElevation` from any
//      reading it could not prove was exercise, so a 165 bpm run scored z≈17 → S=1.0. W4-001
//      bought time with a flat `heartRate < 110` ceiling; that constant is wrong for an athlete
//      (RHR 48, so 110 is a brisk walk) AND for an older adult (HRmax 155, so 110 is zone 3).
//      The structural fix is here: the rest gate is a SOFT function of Karvonen exertion, which
//      is personal by construction.
//  D-fabrication  every axis must be able to say "I don't know". An axis with no evidence
//      returns its neutral prior at mass 0, and mass 0 is what the HMM reads as "this axis
//      constrains nothing" — never as "this axis says 0.5".
//  §0.2.4  regulator, not mirror: physiology NEVER writes valence. There is no vital sign that
//      says a person is sad, and inferring one is how you get an engine that amplifies what it
//      finds. Valence is declared-only, and this suite pins it.
//
// The engine is PURE and clock-free (S9), so almost everything below is a direct call. Where a
// claim is "this recovers the truth", the truth is the W4-002 simulator's answer key, which is
// generated independently of the estimator.

const fc = require('fast-check');

const {
  AFFECT_ENGINE_VERSION,
  robustZ, rise, squash, blend, hourBinFor,
  fuseDeclared,
  arousalAxis, stressAxis, recoveryAxis, exertionAxis, fatigueAxis, alertnessAxis,
  computeAxes,
  AXIS_PRIOR_MASS, Z_SCALE, NEUTRAL, ACTIVITY_EXERTION_PRIOR, ACTIVITY_PRIOR_MASS,
  REST_GATE_OPEN, REST_GATE_CLOSE, BIN_PRIOR_MASS, HRMAX_SOURCE_RELIABILITY, RECOVERY_WEIGHTS,
} = require('../app/agents/runtime/physiology/affectEngine');

const { computeBaselineBlob, karvonenZones } = require('../app/agents/runtime/physiology/baselineEngine');
const { sleepDebt } = require('../app/agents/runtime/physiology/chronobiology');
const { generate } = require('../sim/generator');
const { getPersona } = require('../sim/personas');

const T0 = Date.UTC(2026, 6, 1, 0, 0, 0); // fixed epoch — no test reads the clock
const DAY = 86400000;

// A deliberately ordinary baseline blob: RHR 60, hour bins flat at 70 ± 5 MAD, HRV 45 ± 8,
// HRmax 190 provided. Used wherever the point is the AXIS, not the baseline.
function blobFixture(over = {}) {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour, value: 70, raw: 70, mad: 5, n: 600, nEff: 10, confidence: 0.5, overall: 70,
  }));
  return {
    v: 1,
    rhrMedian: 60, rhrMAD: 3, sampleCount: 3000,
    hrvMedian: 45, hrvMAD: 8,
    hourly,
    cosinor: { M: 65, A: 5, phi: 15, confidence: 0.6, r2: 0.8, bins: 24, spread: 24, source: 'fit' },
    zones: karvonenZones(60, 190),
    maxHeartRate: 190,
    maxHeartRateSource: 'provided',
    acute: { rhr: 60, hrv: 45 }, chronic: { rhr: 60, hrv: 45 }, trend: { rhr: 0, hrv: 0 },
    confidence: 0.8,
    coverage: { rhrDays: 30, hrvDays: 30, hourlyBins: 24, rhrConfidence: 0.9, hrvConfidence: 0.9, cosinorConfidence: 0.6 },
    ...over,
  };
}

const finiteIn01 = (x) => Number.isFinite(x) && x >= 0 && x <= 1;

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — primitives', () => {
  test('version is pinned so a persisted affect blob can be migrated', () => {
    expect(typeof AFFECT_ENGINE_VERSION).toBe('string');
    expect(AFFECT_ENGINE_VERSION).toMatch(/^affect\//);
  });

  describe('robustZ', () => {
    test('is the MAD-scaled deviation, matching translate.js `_robustZ`', () => {
      // (80 - 70) / (5 * 1.4826) = 1.349...
      expect(robustZ(80, 70, 5)).toBeCloseTo(10 / (5 * 1.4826), 6);
    });

    test('abstains (null) rather than inventing a z when either side is missing', () => {
      expect(robustZ(null, 70, 5)).toBeNull();
      expect(robustZ(80, null, 5)).toBeNull();
      expect(robustZ(undefined, 70, 5)).toBeNull();
      expect(robustZ(NaN, 70, 5)).toBeNull();
      expect(robustZ('nonsense', 70, 5)).toBeNull();
    });

    test('S8: a zero, negative or missing MAD cannot produce Infinity or NaN', () => {
      for (const bad of [0, -4, null, undefined, NaN, Infinity]) {
        const z = robustZ(80, 70, bad, { minSigma: 2 });
        expect(Number.isFinite(z)).toBe(true);
      }
      // The floor is a real floor, not a fudge: with minSigma 2 the z is exactly 10/2.
      expect(robustZ(80, 70, 0, { minSigma: 2 })).toBeCloseTo(5, 6);
    });

    test('minSigma only ever WIDENS the denominator — a real spread is never narrowed', () => {
      // MAD 5 -> sigma 7.41, well above minSigma 2, so the floor must not bind.
      expect(robustZ(80, 70, 5, { minSigma: 2 })).toBeCloseTo(10 / (5 * 1.4826), 6);
    });
  });

  describe('rise / squash', () => {
    test('rise is one-sided: at or below baseline is exactly 0', () => {
      expect(rise(0, Z_SCALE)).toBe(0);
      expect(rise(-3, Z_SCALE)).toBe(0);
      expect(rise(-0.0001, Z_SCALE)).toBe(0);
    });

    test('rise is tanh(z/k), monotone and saturating below 1', () => {
      expect(rise(2, 2)).toBeCloseTo(Math.tanh(1), 6);
      expect(rise(4, 2)).toBeCloseTo(Math.tanh(2), 6);
      expect(rise(4, 2)).toBeGreaterThan(rise(2, 2));
      expect(rise(1e6, 2)).toBeLessThanOrEqual(1);
    });

    test('squash is two-sided and centred on 0.5 — baseline means "typical", not "aroused"', () => {
      expect(squash(0, 2)).toBeCloseTo(0.5, 9);
      expect(squash(2, 2)).toBeCloseTo(0.5 + 0.5 * Math.tanh(1), 6);
      expect(squash(-2, 2)).toBeCloseTo(0.5 - 0.5 * Math.tanh(1), 6);
      expect(squash(2, 2) + squash(-2, 2)).toBeCloseTo(1, 9);
    });

    test('both return the neutral element for a null z rather than throwing', () => {
      expect(rise(null, 2)).toBe(0);
      expect(squash(null, 2)).toBe(0.5);
    });
  });

  describe('blend — the missing-data mass mechanism', () => {
    test('with no parts it returns the neutral prior at mass 0 (abstention, not a claim)', () => {
      const out = blend([], { neutral: 0.2 });
      expect(out.value).toBeCloseTo(0.2, 6);
      expect(out.mass).toBe(0);
      expect(out.evidence).toBe(0);
    });

    test('is exactly the precision-weighted mean (Sum m*v + k*neutral) / (Sum m + k)', () => {
      const out = blend([{ value: 0.9, mass: 1 }], { neutral: 0.2, priorMass: 0.35 });
      expect(out.value).toBeCloseTo((1 * 0.9 + 0.35 * 0.2) / 1.35, 3);
      expect(out.mass).toBeCloseTo(1 / 1.35, 3);
      expect(out.evidence).toBeCloseTo(1, 6);
    });

    test('mass rises toward (never reaches) 1 as evidence accumulates', () => {
      const one = blend([{ value: 0.9, mass: 1 }], { neutral: 0.2 });
      const two = blend([{ value: 0.9, mass: 1 }, { value: 0.9, mass: 1 }], { neutral: 0.2 });
      expect(two.mass).toBeGreaterThan(one.mass);
      expect(two.mass).toBeLessThan(1);
      // and more evidence for the same claim moves the value closer to it
      expect(two.value).toBeGreaterThan(one.value);
    });

    test('zero-mass and non-finite parts are dropped, not counted as evidence for 0', () => {
      const out = blend(
        [{ value: 0.9, mass: 0 }, { value: NaN, mass: 1 }, { value: 0.4, mass: null }],
        { neutral: 0.2 },
      );
      expect(out.mass).toBe(0);
      expect(out.value).toBeCloseTo(0.2, 6);
    });

    test('names the parts that carried weight, for the telemetry line and for debugging', () => {
      const out = blend(
        [{ name: 'hrv', value: 0.8, mass: 1 }, { name: 'restingElevation', value: 0, mass: 0 }],
        { neutral: 0.2 },
      );
      expect(out.parts.map((p) => p.name)).toEqual(['hrv']);
    });
  });

  describe('hourBinFor', () => {
    test('picks the local hour bin', () => {
      const blob = blobFixture();
      blob.hourly[7] = { ...blob.hourly[7], value: 99, mad: 4, n: 100, confidence: 0.7 };
      expect(hourBinFor(blob, 7).value).toBe(99);
      expect(hourBinFor(blob, 7.9).value).toBe(99); // fractional hours floor into the bin
      expect(hourBinFor(blob, 31).value).toBe(99);  // and wrap
    });

    test('OLD-SHAPE BLOB COMPAT: a cached pre-W4-004 blob has no `hourly` and must not crash', () => {
      const legacy = { rhrMedian: 58, rhrMAD: 4, sampleCount: 100, computedAt: '2026-01-01T00:00:00.000Z' };
      const bin = hourBinFor(legacy, 9);
      expect(bin).not.toBeNull();
      expect(bin.value).toBe(58);
      expect(bin.mad).toBe(4);
      // ...but it is honest that this is not an hour-of-day baseline at all.
      expect(bin.confidence).toBe(0);
      expect(bin.source).toBe('rhr-fallback');
    });

    test('a blob with neither hourly nor an RHR abstains rather than returning a fake bin', () => {
      expect(hourBinFor({}, 9)).toBeNull();
      expect(hourBinFor(null, 9)).toBeNull();
    });

    test('an unusable hour abstains rather than defaulting to bin 0', () => {
      expect(hourBinFor(blobFixture(), null)).toBeNull();
      expect(hourBinFor(blobFixture(), NaN)).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — declared mood fusion (ALL taps, not just the last)', () => {
  test('no taps is abstention, not a neutral claim', () => {
    const d = fuseDeclared([]);
    expect(d.n).toBe(0);
    expect(d.mass).toBe(0);
    expect(d.valence).toBe(0.5);
    expect(d.arousal).toBe(0.5);
  });

  test('maps the emotion wheel correctly: x = valence, y = arousal, both -1..1 -> 0..1 (D5)', () => {
    const d = fuseDeclared([{ x: 1, y: -1 }]);
    expect(d.valence).toBeCloseTo(1, 6);
    expect(d.arousal).toBeCloseTo(0, 6);
  });

  test('uses the CENTROID of every tap — the last tap does not win', () => {
    const d = fuseDeclared([{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }]);
    // centroid x = 1/3 -> valence (1/3 + 1)/2 = 0.667
    expect(d.valence).toBeCloseTo(2 / 3, 3);
  });

  test('dispersion is the RMS distance from the centroid — coherent taps disperse to 0', () => {
    expect(fuseDeclared([{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]).dispersion).toBeCloseTo(0, 6);
    expect(fuseDeclared([{ x: -1, y: -1 }, { x: 1, y: 1 }]).dispersion).toBeGreaterThan(1);
  });

  test('confidence rises with COUNT and falls with DISPERSION — ambivalence is not evidence', () => {
    const coherent3 = fuseDeclared([{ x: 0.6, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.55, y: 0.45 }]);
    const coherent1 = fuseDeclared([{ x: 0.6, y: 0.4 }]);
    const scattered3 = fuseDeclared([{ x: -1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]);
    expect(coherent3.mass).toBeGreaterThan(coherent1.mass);
    expect(scattered3.mass).toBeLessThan(coherent3.mass);
  });

  test('garbage taps are dropped; a fully-garbage array is abstention, not NaN', () => {
    const d = fuseDeclared([{ x: 'a', y: 1 }, null, undefined, { x: NaN, y: NaN }, 7]);
    expect(d.n).toBe(0);
    expect(d.mass).toBe(0);
    expect(finiteIn01(d.valence)).toBe(true);
  });

  test('out-of-range taps are clamped to the wheel, never extrapolated', () => {
    const d = fuseDeclared([{ x: 40, y: -40 }]);
    expect(d.valence).toBe(1);
    expect(d.arousal).toBe(0);
  });

  test('a non-array is abstention', () => {
    for (const bad of [null, undefined, 'taps', 42, {}]) {
      expect(fuseDeclared(bad).mass).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — arousal axis', () => {
  const blob = blobFixture();

  test('at the personal hour baseline, arousal is 0.5 — "typical for you at this hour"', () => {
    const a = arousalAxis({ heartRate: 70, bin: hourBinFor(blob, 10), readingConfidence: 1 });
    expect(a.value).toBeCloseTo(0.5, 2);
    expect(a.mass).toBeGreaterThan(0);
  });

  test('is relative to the HOUR bin, not to a global constant — the same HR reads differently', () => {
    const nocturnal = blobFixture();
    nocturnal.hourly[3] = { ...nocturnal.hourly[3], value: 55, mad: 4 };
    nocturnal.hourly[18] = { ...nocturnal.hourly[18], value: 82, mad: 6 };
    const at3 = arousalAxis({ heartRate: 78, bin: hourBinFor(nocturnal, 3), readingConfidence: 1 });
    const at18 = arousalAxis({ heartRate: 78, bin: hourBinFor(nocturnal, 18), readingConfidence: 1 });
    expect(at3.value).toBeGreaterThan(at18.value);
  });

  test('no heart rate is abstention at mass 0 — never a fabricated 0.5 claim', () => {
    const a = arousalAxis({ heartRate: null, bin: hourBinFor(blob, 10), readingConfidence: 1 });
    expect(a.mass).toBe(0);
    expect(a.value).toBe(NEUTRAL.arousal);
  });

  test('a low-confidence reading carries proportionally less mass', () => {
    const sure = arousalAxis({ heartRate: 95, bin: hourBinFor(blob, 10), readingConfidence: 1 });
    const unsure = arousalAxis({ heartRate: 95, bin: hourBinFor(blob, 10), readingConfidence: 0.2 });
    expect(unsure.mass).toBeLessThan(sure.mass);
    expect(unsure.value).toBeLessThan(sure.value); // and is shrunk further toward neutral
  });

  test('an unobserved hour bin still carries the shrunk personal level, at reduced mass', () => {
    const sparse = blobFixture();
    sparse.hourly[4] = { hour: 4, value: 70, raw: null, mad: 6, n: 0, nEff: 0, confidence: 0, overall: 70 };
    const a = arousalAxis({ heartRate: 95, bin: hourBinFor(sparse, 4), readingConfidence: 1 });
    expect(a.mass).toBeGreaterThan(0);
    expect(a.mass).toBeCloseTo(BIN_PRIOR_MASS / (BIN_PRIOR_MASS + AXIS_PRIOR_MASS), 2);
  });

  test('declared arousal fuses in by confidence weight, and alone can move the axis', () => {
    const declared = fuseDeclared([{ x: 0, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0.9 }]);
    const physOnly = arousalAxis({ heartRate: 70, bin: hourBinFor(blob, 10), readingConfidence: 1 });
    const fused = arousalAxis({ heartRate: 70, bin: hourBinFor(blob, 10), readingConfidence: 1, declared });
    expect(fused.value).toBeGreaterThan(physOnly.value);
    expect(fused.parts.map((p) => p.name)).toContain('declared');

    const declaredOnly = arousalAxis({ heartRate: null, bin: null, readingConfidence: 0, declared });
    expect(declaredOnly.mass).toBeGreaterThan(0);
    expect(declaredOnly.value).toBeGreaterThan(0.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — exertion axis (Karvonen, M.8)', () => {
  const blob = blobFixture(); // RHR 60, HRmax 190 provided -> HRR 130

  test('is exactly (HR - RHR) / (HRmax - RHR), replacing translate\'s (HR - 60)/100', () => {
    const e = exertionAxis({ heartRate: 125, zones: blob.zones, hrMaxSource: 'provided', readingConfidence: 1 });
    // measured 65/130 = 0.5; with no activity part and the neutral prior it shrinks slightly
    expect(e.parts.find((p) => p.name === 'measured').value).toBeCloseTo(0.5, 6);
  });

  test('S8: a degenerate body (HRmax <= RHR) yields a finite, clamped exertion', () => {
    const degenerate = karvonenZones(190, 190);
    for (const hr of [40, 190, 240]) {
      const e = exertionAxis({ heartRate: hr, zones: degenerate, readingConfidence: 1 });
      expect(finiteIn01(e.value)).toBe(true);
    }
  });

  test('below RHR clamps to 0 and above HRmax clamps to 1 — never negative, never > 1', () => {
    expect(exertionAxis({ heartRate: 35, zones: blob.zones, readingConfidence: 1 })
      .parts.find((p) => p.name === 'measured').value).toBe(0);
    expect(exertionAxis({ heartRate: 240, zones: blob.zones, readingConfidence: 1 })
      .parts.find((p) => p.name === 'measured').value).toBe(1);
  });

  test('THE ACTIVITY FLOOR IS A PRIOR, NOT AN OVERRIDE: a workout chip at rest does not force peak', () => {
    const resting = exertionAxis({
      heartRate: 65, zones: blob.zones, hrMaxSource: 'provided', activity: 'workout', readingConfidence: 1,
    });
    // translate.js would have returned ACTIVITY_EXERTION_FLOOR.workout outright.
    expect(resting.value).toBeLessThan(ACTIVITY_EXERTION_PRIOR.workout);
    expect(resting.value).toBeGreaterThan(0.1); // but the stated intent is not discarded either
  });

  test('...and a genuine workout HR is barely dragged by that same prior', () => {
    const withChip = exertionAxis({
      heartRate: 165, zones: blob.zones, hrMaxSource: 'provided', activity: 'workout', readingConfidence: 1,
    });
    const without = exertionAxis({
      heartRate: 165, zones: blob.zones, hrMaxSource: 'provided', readingConfidence: 1,
    });
    expect(Math.abs(withChip.value - without.value)).toBeLessThan(0.1);
  });

  test('with no reading at all the activity chip IS the estimate, at its own honest mass', () => {
    const e = exertionAxis({ heartRate: null, zones: blob.zones, activity: 'running' });
    expect(e.mass).toBeGreaterThan(0);
    expect(e.mass).toBeCloseTo(ACTIVITY_PRIOR_MASS / (ACTIVITY_PRIOR_MASS + AXIS_PRIOR_MASS), 2);
    // Most of the way to the stated intent, but never all of the way — a chip is a claim about
    // what someone is about to do, and this engine has not seen them do it yet.
    expect(e.value).toBeGreaterThan(NEUTRAL.exertion);
    expect(e.value).toBeLessThan(ACTIVITY_EXERTION_PRIOR.running);
  });

  test('an ESTIMATED HRmax discounts the measurement — a guessed ceiling is a guessed exertion', () => {
    const provided = exertionAxis({ heartRate: 150, zones: blob.zones, hrMaxSource: 'provided', readingConfidence: 1 });
    const guessed = exertionAxis({ heartRate: 150, zones: blob.zones, hrMaxSource: 'default', readingConfidence: 1 });
    expect(guessed.mass).toBeLessThan(provided.mass);
    expect(HRMAX_SOURCE_RELIABILITY.default).toBeLessThan(HRMAX_SOURCE_RELIABILITY.provided);
  });

  test('nothing at all is abstention at mass 0', () => {
    const e = exertionAxis({});
    expect(e.mass).toBe(0);
    expect(e.value).toBe(NEUTRAL.exertion);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — stress axis (D3 dies structurally here)', () => {
  const blob = blobFixture();
  const bin = hourBinFor(blob, 14);

  test('at baseline HRV and baseline HR, stress is near its resting default', () => {
    const s = stressAxis({ heartRate: 70, hrv: 45, bin, baselines: blob, exertion: 0.08, activity: 'resting' });
    expect(s.value).toBeLessThan(0.3);
  });

  test('HRV suppression raises stress', () => {
    const calm = stressAxis({ heartRate: 70, hrv: 45, bin, baselines: blob, exertion: 0.08 });
    const suppressed = stressAxis({ heartRate: 70, hrv: 22, bin, baselines: blob, exertion: 0.08 });
    expect(suppressed.value).toBeGreaterThan(calm.value);
  });

  test('resting elevation raises stress when the body is genuinely at rest', () => {
    const flat = stressAxis({ heartRate: 70, hrv: 45, bin, baselines: blob, exertion: 0.08 });
    const elevated = stressAxis({ heartRate: 88, hrv: 45, bin, baselines: blob, exertion: 0.2 });
    expect(elevated.value).toBeGreaterThan(flat.value);
  });

  test('D3 KILL-SHOT: an exercise activity contributes ZERO resting-elevation mass', () => {
    const s = stressAxis({
      heartRate: 165, hrv: 45, bin, baselines: blob, exertion: 0.81, activity: 'running',
    });
    expect(s.parts.map((p) => p.name)).not.toContain('restingElevation');
    expect(s.value).toBeLessThan(0.35);
  });

  test('D3 KILL-SHOT: an UNLABELLED high-exertion reading is equally not read as stress', () => {
    // This is the exact D2 shape — every batch row arrives with activity 'unknown'.
    const s = stressAxis({
      heartRate: 165, hrv: 45, bin, baselines: blob, exertion: 0.81, activity: 'unknown',
    });
    expect(s.value).toBeLessThan(0.35);
  });

  test('THE REST GATE IS SOFT AND PERSONAL, not W4-001\'s flat 110 bpm ceiling', () => {
    // Same absolute HR, two bodies. For the athlete 110 bpm is a light jog; for the older
    // adult (HRmax 155) it is real work. A flat ceiling cannot tell them apart; exertion can.
    const athlete = blobFixture({ rhrMedian: 48, zones: karvonenZones(48, 190), maxHeartRate: 190 });
    const older = blobFixture({ rhrMedian: 65, zones: karvonenZones(65, 155), maxHeartRate: 155 });
    const eA = exertionAxis({ heartRate: 110, zones: athlete.zones, hrMaxSource: 'provided', readingConfidence: 1 });
    const eO = exertionAxis({ heartRate: 110, zones: older.zones, hrMaxSource: 'provided', readingConfidence: 1 });
    expect(eO.value).toBeGreaterThan(eA.value);

    // and the gate itself is continuous: fully open through ordinary life, fading to zero at
    // the bottom of Karvonen zone 1, no cliff anywhere.
    const masses = [0, 0.2, REST_GATE_OPEN, 0.42, REST_GATE_CLOSE, 0.7].map((E) => {
      const s = stressAxis({ heartRate: 88, hrv: null, bin, baselines: blob, exertion: E });
      const p = s.parts.find((q) => q.name === 'restingElevation');
      return p ? p.mass : 0;
    });
    for (let i = 1; i < masses.length; i++) expect(masses[i]).toBeLessThanOrEqual(masses[i - 1]);
    expect(masses[0]).toBeGreaterThan(0);
    expect(masses[2]).toBe(masses[0]); // fully open all the way to the walking threshold
    expect(masses[4]).toBe(0);         // fully shut at the zone-1 floor
    expect(masses[5]).toBe(0);
  });

  test('THE GATE IS NOT A MONOTONE FUNCTION OF HEART RATE — that was the defect, twice', () => {
    // W4-001's flat 110 bpm ceiling and this engine's own first cut (a 0.30 HRR ceiling) share
    // one bug: stress raises HR, HR raises the gate variable, and the gate then shuts on the
    // very elevation it exists to weigh. Pinned as a boundary: an ordinary agitated resting
    // heart rate must keep FULL resting-elevation mass.
    const agitatedButStill = exertionAxis({
      heartRate: 99, zones: blob.zones, hrMaxSource: 'provided', readingConfidence: 1,
    });
    expect(agitatedButStill.value).toBeLessThan(REST_GATE_OPEN);
    const s = stressAxis({
      heartRate: 99, hrv: null, bin, baselines: blob, exertion: agitatedButStill.value,
    });
    const p = s.parts.find((q) => q.name === 'restingElevation');
    expect(p).toBeTruthy();
    expect(p.mass).toBeCloseTo(1 * (BIN_PRIOR_MASS + (1 - BIN_PRIOR_MASS) * bin.confidence), 6);
  });

  test('the dormant Garmin stressLevel lane (D16) is wired but contributes nothing when absent', () => {
    const without = stressAxis({ heartRate: 70, hrv: 45, bin, baselines: blob, exertion: 0.08 });
    const with100 = stressAxis({ heartRate: 70, hrv: 45, bin, baselines: blob, exertion: 0.08, stressLevel: 100 });
    expect(without.parts.map((p) => p.name)).not.toContain('stressLevel');
    expect(with100.parts.map((p) => p.name)).toContain('stressLevel');
    expect(with100.value).toBeGreaterThan(without.value);
  });

  test('no evidence at all is the resting default at mass 0, never a stress claim', () => {
    const s = stressAxis({ baselines: blob });
    expect(s.mass).toBe(0);
    expect(s.value).toBe(NEUTRAL.stress);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — recovery axis', () => {
  const blob = blobFixture();

  test('generalises translate\'s unweighted mean with EXPLICIT, summing weights', () => {
    const total = Object.values(RECOVERY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  test('a well-slept, high-HRV, full-battery body scores high', () => {
    const r = recoveryAxis({
      sleep: { lastNight: { deep: 120, light: 300, rem: 110 }, baseline: { deep: 100, light: 300, rem: 100 } },
      hrv: 60, bodyBattery: 90, dailyReadiness: 85, baselines: blob,
    });
    expect(r.value).toBeGreaterThan(0.7);
  });

  test('a wrecked body scores low', () => {
    const r = recoveryAxis({
      sleep: { lastNight: { deep: 20, light: 120, rem: 25 }, baseline: { deep: 100, light: 300, rem: 100 } },
      hrv: 25, bodyBattery: 15, dailyReadiness: 20, baselines: blob,
    });
    expect(r.value).toBeLessThan(0.35);
  });

  test('each missing source removes exactly its own weight from the mass — nothing else', () => {
    const all = recoveryAxis({ hrv: 60, bodyBattery: 90, dailyReadiness: 85, baselines: blob });
    const noBattery = recoveryAxis({ hrv: 60, dailyReadiness: 85, baselines: blob });
    expect(all.evidence - noBattery.evidence).toBeCloseTo(RECOVERY_WEIGHTS.bodyBattery, 2);
  });

  test('D-fabrication: a stranger\'s body abstains at the neutral prior, mass 0', () => {
    const r = recoveryAxis({ baselines: blob });
    expect(r.mass).toBe(0);
    expect(r.value).toBe(NEUTRAL.recovery);
  });

  test('S8: an all-zero sleep night does not produce a 0/0 NaN (the QA4 Q1 kill, kept)', () => {
    const r = recoveryAxis({
      sleep: { lastNight: { deep: 0, light: 0, rem: 0 }, baseline: { deep: false, light: 0, rem: 0 } },
      baselines: blob,
    });
    expect(finiteIn01(r.value)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — fatigue and circadian alertness', () => {
  const blob = blobFixture();

  test('fatigue rises with sleep debt', () => {
    const rested = sleepDebt(Array.from({ length: 7 }, () => ({ deep: 110, light: 320, rem: 110 })));
    const deprived = sleepDebt(Array.from({ length: 7 }, () => ({ deep: 30, light: 150, rem: 40 })));
    expect(fatigueAxis({ debt: deprived, baselines: blob }).value)
      .toBeGreaterThan(fatigueAxis({ debt: rested, baselines: blob }).value);
  });

  test('fatigue rises with a multi-day HRV DOWNtrend, and not with an uptrend', () => {
    const down = fatigueAxis({ baselines: blobFixture({ trend: { rhr: 0, hrv: -3 } }) });
    const flat = fatigueAxis({ baselines: blobFixture({ trend: { rhr: 0, hrv: 0 } }) });
    const up = fatigueAxis({ baselines: blobFixture({ trend: { rhr: 0, hrv: 3 } }) });
    expect(down.value).toBeGreaterThan(flat.value);
    expect(up.value).toBeLessThanOrEqual(flat.value);
  });

  test('no debt history and no trend is abstention at mass 0', () => {
    const f = fatigueAxis({ baselines: { hourly: [] } });
    expect(f.mass).toBe(0);
    expect(f.value).toBe(NEUTRAL.fatigue);
  });

  test('alertness follows the PERSONAL acrophase — the shift worker is not assumed nocturnal', () => {
    const dayPerson = blobFixture({ cosinor: { M: 65, A: 6, phi: 15, confidence: 0.9 } });
    const nightPerson = blobFixture({ cosinor: { M: 73, A: 5, phi: 23, confidence: 0.9 } });
    const a15day = alertnessAxis({ baselines: dayPerson, hourOfDay: 15, debtRatio: 0 });
    const a15night = alertnessAxis({ baselines: nightPerson, hourOfDay: 15, debtRatio: 0 });
    const a23night = alertnessAxis({ baselines: nightPerson, hourOfDay: 23, debtRatio: 0 });
    expect(a15day.value).toBeGreaterThan(a15night.value);
    expect(a23night.value).toBeGreaterThan(a15night.value);
  });

  test('replaces the binary windDown with a continuous ramp — no 20:59 -> 21:00 step', () => {
    const blobC = blobFixture({ cosinor: { M: 65, A: 6, phi: 15, confidence: 0.9 } });
    const series = [19, 20, 21, 22, 23].map((h) => alertnessAxis({ baselines: blobC, hourOfDay: h }).value);
    for (let i = 1; i < series.length; i++) {
      expect(series[i]).toBeLessThan(series[i - 1]);
      expect(Math.abs(series[i] - series[i - 1])).toBeLessThan(0.25);
    }
  });

  test('an unknown hour abstains rather than inventing a phase', () => {
    const a = alertnessAxis({ baselines: blob, hourOfDay: null });
    expect(a.mass).toBe(0);
    expect(finiteIn01(a.value)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — computeAxes composition', () => {
  const blob = blobFixture();
  const base = { baselines: blob, now: T0 + 14 * 3600000, tzOffsetMinutes: 0 };

  test('emits exactly the six axes plus valence, all finite and clamped', () => {
    const ax = computeAxes({ ...base, live: { heartRate: 78, confidence: 0.9, activity: 'resting' } });
    expect(Object.keys(ax.axes).sort()).toEqual(
      ['arousal', 'circadianAlertness', 'exertion', 'fatigue', 'recovery', 'stress', 'valence'],
    );
    for (const [name, a] of Object.entries(ax.axes)) {
      expect(finiteIn01(a.value)).toBe(true);
      expect(finiteIn01(a.mass)).toBe(true);
      expect(typeof name).toBe('string');
    }
  });

  test('S9: `now` is a required PARAMETER — the engine never reads the clock', () => {
    expect(() => computeAxes({ baselines: blob, live: { heartRate: 70 } })).toThrow(/now/);
  });

  test('§0.2.4 REGULATOR NOT MIRROR: physiology can never write valence', () => {
    const calm = computeAxes({ ...base, live: { heartRate: 62, confidence: 1, activity: 'resting' } });
    const distressed = computeAxes({
      ...base,
      live: { heartRate: 95, confidence: 1, activity: 'resting' },
      state: { hrv: 18 },
    });
    expect(distressed.axes.stress.value).toBeGreaterThan(calm.axes.stress.value);
    // ...and yet valence has not moved a millimetre, because no vital sign says "sad".
    expect(distressed.axes.valence.value).toBe(calm.axes.valence.value);
    expect(distressed.axes.valence.mass).toBe(0);
  });

  test('valence moves only on a declared tap, and carries the tap\'s own confidence', () => {
    const ax = computeAxes({ ...base, live: { heartRate: 70, confidence: 1 }, taps: [{ x: -0.8, y: 0.2 }] });
    expect(ax.axes.valence.value).toBeLessThan(0.5);
    expect(ax.axes.valence.mass).toBeGreaterThan(0);
  });

  test('a total stranger yields every axis at mass 0 and a low overall confidence', () => {
    const ax = computeAxes({ baselines: {}, now: T0 });
    for (const a of Object.values(ax.axes)) expect(a.mass).toBe(0);
    expect(ax.confidence).toBeLessThan(0.2);
  });

  test('a degraded filter run is carried through, and never fabricates physiology', () => {
    const ax = computeAxes({
      ...base, live: { heartRate: 70, confidence: 0.1, activity: 'resting', degraded: 'mood-only' },
    });
    expect(ax.degraded).toBe('mood-only');
    expect(ax.axes.arousal.mass).toBe(0);
    // The heart rate is withheld from every axis that reads it...
    expect(ax.axes.exertion.parts.map((p) => p.name)).not.toContain('measured');
    expect(ax.axes.stress.parts.map((p) => p.name)).not.toContain('restingElevation');
    // ...but the ACTIVITY label is a different sensor (accelerometer, not PPG) and a declared
    // chip is not physiology at all, so neither is thrown away with the bathwater.
    expect(ax.axes.exertion.parts.map((p) => p.name)).toEqual(['activity']);
  });

  test('local hour comes from tzOffsetMinutes, not from the server hour', () => {
    const utcNoon = T0 + 12 * 3600000;
    const inUtc = computeAxes({ baselines: blob, now: utcNoon, tzOffsetMinutes: 0 });
    const inTokyo = computeAxes({ baselines: blob, now: utcNoon, tzOffsetMinutes: 540 });
    expect(inUtc.hourOfDay).toBeCloseTo(12, 3);
    expect(inTokyo.hourOfDay).toBeCloseTo(21, 3);
  });

  test('S15: emits a single-line telemetry string with NO numeric vital in it', () => {
    const ax = computeAxes({
      ...base,
      live: { heartRate: 163, confidence: 0.94, activity: 'running' },
      state: { hrv: 27, bodyBattery: 41, dailyReadiness: 38 },
    });
    expect(typeof ax.telemetry).toBe('string');
    for (const vital of ['163', '27', '41', '38']) {
      expect(ax.telemetry).not.toContain(vital);
    }
    expect(ax.telemetry).toMatch(/^\[affect\.axes\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — persona kill-shots (W4-002 answer key)', () => {
  // One 30-day run per persona, reused across the cases below.
  const runs = {};
  const blobs = {};
  for (const id of ['athlete', 'stressedProfessional', 'olderAdult']) {
    const run = generate({ persona: id, seed: `w4-005-${id}`, startAt: T0, days: 30, sampleIntervalSec: 300 });
    runs[id] = run;
    blobs[id] = computeBaselineBlob({
      hrSamples: run.truth.samples.map((s) => ({
        value: s.hr, activity: s.activity, recordedAt: s.tMs, source: 'garmin',
      })),
      vitalSamples: run.truth.daily.flatMap((d) => [
        { metric: 'hrv', value: d.hrv, recordedAt: run.meta.startAtMs + d.dayIndex * DAY + 25200000 },
        { metric: 'restingHeartRate', value: d.restingHeartRate, recordedAt: run.meta.startAtMs + d.dayIndex * DAY + 25200000 },
      ]),
      profile: { maxHeartRate: getPersona(id).maxHeartRate },
      now: T0 + 30 * DAY,
      tzOffsetMinutes: 0,
    });
  }

  // The single hottest sample inside a workout episode.
  function peakOfFirstWorkout(id) {
    const ep = runs[id].truth.episodes.find((e) => e.kind === 'workout');
    const inside = runs[id].truth.samples.filter((s) => s.tMs >= ep.startMs && s.tMs <= ep.endMs);
    return inside.reduce((a, b) => (b.hr > a.hr ? b : a));
  }

  test('WORKOUT: exertion is high and stress is NOT saturated (D3\'s structural fix)', () => {
    const s = peakOfFirstWorkout('athlete');
    const ax = computeAxes({
      baselines: blobs.athlete,
      live: { heartRate: s.hr, confidence: 0.95, activity: s.activity },
      state: { hrv: runs.athlete.truth.daily[0].hrv },
      now: s.tMs,
      tzOffsetMinutes: 0,
    });
    expect(ax.axes.exertion.value).toBeGreaterThan(0.6);
    expect(ax.axes.stress.value).toBeLessThan(0.45);
  });

  test('...and translate.js\'s old (HR-60)/100 exertion is measurably wrong for this athlete', () => {
    const s = peakOfFirstWorkout('athlete');
    const old = Math.min(1, Math.max(0, (s.hr - 60) / 100));
    const karvonen = Math.min(1, Math.max(0, (s.hr - blobs.athlete.zones.restingHeartRate) / blobs.athlete.zones.hrr));
    expect(Math.abs(old - karvonen)).toBeGreaterThan(0.05);
  });

  // A reading that is genuinely abnormal FOR THIS PERSON: HRV `sigmas` robust-sigmas below
  // their own median, at the peak of a stress episode. Constructed from the person's own
  // measured baseline rather than from an absolute number, which is the only non-circular way
  // to say "suppressed" about a body whose normal we did not choose.
  function suppressedStressReading(id, sigmas = 2) {
    const ep = runs[id].truth.episodes.find((e) => e.kind === 'stress');
    const peak = runs[id].truth.samples
      .filter((s) => s.tMs >= ep.startMs && s.tMs <= ep.endMs)
      .reduce((a, b) => (b.hr > a.hr ? b : a));
    const blob = blobs[id];
    return computeAxes({
      baselines: blob,
      live: { heartRate: peak.hr, confidence: 0.95, activity: peak.activity },
      state: { hrv: blob.hrvMedian - sigmas * blob.hrvMAD * 1.4826 },
      now: peak.tMs,
      tzOffsetMinutes: 0,
    });
  }

  test('STRESS EPISODE at rest with a genuinely suppressed HRV: stress high, exertion low', () => {
    const ax = suppressedStressReading('stressedProfessional');
    expect(ax.axes.stress.value).toBeGreaterThan(0.55);
    expect(ax.axes.exertion.value).toBeLessThan(0.35);
    // Both lines of evidence carried real weight — this is not one term doing all the work.
    const names = ax.axes.stress.parts.map((p) => p.name);
    expect(names).toContain('hrvSuppression');
    expect(names).toContain('restingElevation');
  });

  test('A PERSON WHOSE STRESS IS HABITUAL HAS IT ABSORBED INTO THEIR OWN BASELINE', () => {
    // Not a defect — the designed meaning of a personal baseline, pinned so nobody "fixes" it.
    // `stressedProfessional` has a stress episode on every weekday and, over a 30-day run, ZERO
    // unstressed days; its measured HRV median therefore IS the suppressed value. Asked "is
    // this unusual for you?", the honest answer is no, and this engine gives it.
    const run = runs.stressedProfessional;
    expect(run.truth.daily.filter((d) => !d.stressed).length).toBe(0);
    expect(blobs.stressedProfessional.hrvMedian)
      .toBeLessThan(getPersona('stressedProfessional').hrv.median);

    const ep = run.truth.episodes.find((e) => e.kind === 'stress');
    const peak = run.truth.samples
      .filter((s) => s.tMs >= ep.startMs && s.tMs <= ep.endMs)
      .reduce((a, b) => (b.hr > a.hr ? b : a));
    const day = run.truth.daily.find((d) => d.dayIndex === Math.floor((peak.tMs - T0) / DAY));
    const raw = computeAxes({
      baselines: blobs.stressedProfessional,
      live: { heartRate: peak.hr, confidence: 0.95, activity: peak.activity },
      state: { hrv: day.hrv },
      now: peak.tMs, tzOffsetMinutes: 0,
    });
    // The HRV term votes "normal" with near-full mass, and the elevation term still sees the
    // episode — so the axis lands moderate, not high.
    expect(raw.axes.stress.parts.find((p) => p.name === 'hrvSuppression').value).toBe(0);
    expect(raw.axes.stress.parts.find((p) => p.name === 'restingElevation').value)
      .toBeGreaterThan(0.5);
    expect(raw.axes.stress.value).toBeLessThan(suppressedStressReading('stressedProfessional').axes.stress.value);
    // Detecting that a person's NORMAL has drifted somewhere unhealthy is a different question,
    // asked on a different timescale: W4-012's CUSUM over chronic-vs-acute residuals (§M.13).
  });

  test('THE DISCRIMINATION THAT MATTERS: workout and stress land in different corners', () => {
    const w = peakOfFirstWorkout('athlete');
    const workout = computeAxes({
      baselines: blobs.athlete,
      live: { heartRate: w.hr, confidence: 0.95, activity: w.activity },
      now: w.tMs, tzOffsetMinutes: 0,
    });
    const stressed = suppressedStressReading('stressedProfessional');
    // Both have an elevated heart rate. Only one is a workout, and only one is stress —
    // and the OLD engine collapsed both onto "maximal stress, narrow window, forced cheer".
    expect(workout.axes.exertion.value - stressed.axes.exertion.value).toBeGreaterThan(0.3);
    expect(stressed.axes.stress.value - workout.axes.stress.value).toBeGreaterThan(0.15);
  });

  test('QUIET EVENING: the older adult at rest reads as neither stressed nor exerting', () => {
    const evening = runs.olderAdult.truth.samples
      .filter((s) => {
        const h = ((s.tMs - T0) / 3600000) % 24;
        return h >= 20 && h < 21 && s.activity !== 'walking';
      });
    const s = evening[Math.floor(evening.length / 2)];
    const ax = computeAxes({
      baselines: blobs.olderAdult,
      live: { heartRate: s.hr, confidence: 0.95, activity: s.activity },
      state: { hrv: runs.olderAdult.truth.daily[10].hrv, bodyBattery: 55 },
      now: s.tMs, tzOffsetMinutes: 0,
    });
    expect(ax.axes.stress.value).toBeLessThan(0.45);
    expect(ax.axes.exertion.value).toBeLessThan(0.35);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('affectEngine — fuzz: finite and clamped for ANY input (S8)', () => {
  const anyNumber = fc.oneof(
    fc.double({ noNaN: false }),
    fc.constantFrom(NaN, Infinity, -Infinity, 0, -0),
    fc.integer({ min: -1e9, max: 1e9 }),
  );
  const anyish = fc.oneof(anyNumber, fc.constantFrom(null, undefined, '', 'x', true, false));

  test('300 rounds: computeAxes never returns NaN, Infinity or an out-of-range axis', () => {
    fc.assert(
      fc.property(
        fc.record({
          hr: anyish, conf: anyish, act: fc.oneof(fc.constantFrom(null, 'resting', 'running', 'unknown', 'workout', '')),
          hrv: anyish, battery: anyish, readiness: anyish, stressLevel: anyish,
          deep: anyish, light: anyish, rem: anyish,
          rhrMedian: anyish, rhrMAD: anyish, hrvMedian: anyish, hrvMAD: anyish,
          hrMax: anyish, phi: anyish, amp: anyish, cosConf: anyish,
          tz: fc.integer({ min: -840, max: 720 }), nowOff: fc.integer({ min: -1e6, max: 1e6 }),
          tapX: anyish, tapY: anyish,
        }),
        (g) => {
          const out = computeAxes({
            baselines: {
              rhrMedian: g.rhrMedian, rhrMAD: g.rhrMAD, hrvMedian: g.hrvMedian, hrvMAD: g.hrvMAD,
              maxHeartRate: g.hrMax,
              cosinor: { M: g.rhrMedian, A: g.amp, phi: g.phi, confidence: g.cosConf },
              trend: { hrv: g.hrv, rhr: g.rhrMedian },
            },
            live: { heartRate: g.hr, confidence: g.conf, activity: g.act },
            state: { hrv: g.hrv, bodyBattery: g.battery, dailyReadiness: g.readiness, stressLevel: g.stressLevel },
            sleep: { lastNight: { deep: g.deep, light: g.light, rem: g.rem }, history: [{ deep: g.deep, light: g.light, rem: g.rem }] },
            taps: [{ x: g.tapX, y: g.tapY }],
            now: T0 + g.nowOff,
            tzOffsetMinutes: g.tz,
          });
          for (const a of Object.values(out.axes)) {
            if (!finiteIn01(a.value) || !finiteIn01(a.mass)) return false;
          }
          return finiteIn01(out.confidence) && Number.isFinite(out.hourOfDay);
        },
      ),
      { numRuns: 300, seed: 20260819 },
    );
  });

  test('300 rounds: blend stays inside the convex hull of its parts and the prior', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ value: fc.double({ min: 0, max: 1, noNaN: true }), mass: fc.double({ min: 0, max: 5, noNaN: true }) }), { maxLength: 6 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (parts, neutral) => {
          const out = blend(parts, { neutral });
          const used = parts.filter((p) => p.mass > 0).map((p) => p.value);
          const lo = Math.min(neutral, ...used);
          const hi = Math.max(neutral, ...used);
          return out.value >= lo - 1e-9 && out.value <= hi + 1e-9 && finiteIn01(out.mass);
        },
      ),
      { numRuns: 300, seed: 20260819 },
    );
  });

  test('300 rounds: an axis with strictly more evidence for a claim is never further from it', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.01, max: 3, noNaN: true }),
        fc.double({ min: 0.01, max: 3, noNaN: true }),
        (v, m1, extra) => {
          const a = blend([{ value: v, mass: m1 }], { neutral: 0.5 });
          const b = blend([{ value: v, mass: m1 + extra }], { neutral: 0.5 });
          return Math.abs(b.value - v) <= Math.abs(a.value - v) + 1e-9 && b.mass >= a.mass - 1e-9;
        },
      ),
      { numRuns: 300, seed: 20260819 },
    );
  });
});
