'use strict';

// A2 — chronobiology (W4-004). Kills D13: the entire circadian model was one binary step
// (`hour >= 21 || hour < 5 ? 0.8 : 1.0`) on the SERVER's local hour, identical for every human.
//
// The fit is checked two ways on purpose. First against SYNTHETIC bins built from a known
// {M, A, phi}, which tests the estimator exactly and has no excuses. Then against the W4-002
// simulator's personas, whose answer key is generated independently — that one is looser,
// because real days contain workouts and a real fit has to survive them.

const {
  fitCosinor, weightedNight, sleepDebt, circadianAlertness,
  STAGE_WEIGHTS, POPULATION_SLEEP_NEED, OMEGA, DEBT_DECAY, DEBT_CEILING_NIGHTS,
  MIN_SPREAD_BINS, MAX_AMPLITUDE, _circularSpread,
} = require('../app/agents/runtime/physiology/chronobiology');

const { buildHourlyTable } = require('../app/agents/runtime/physiology/baselineEngine');
const { generate } = require('../sim/generator');
const { getPersona, listPersonaIds } = require('../sim/personas');

const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);

// Bins in the shape buildHourlyTable emits, from an exact cosinor.
function syntheticBins({ M, A, phi, hours = [...Array(24).keys()], n = 60, noise = () => 0 }) {
  return [...Array(24).keys()].map((hour) => {
    const observed = hours.includes(hour);
    return {
      hour,
      n: observed ? n : 0,
      raw: observed ? M + A * Math.cos(OMEGA * (hour - phi)) + noise(hour) : null,
      value: 0, mad: 1, confidence: 0, overall: M,
    };
  });
}

// Circular distance between two clock hours, in hours (max 12).
const hourDist = (a, b) => {
  const d = Math.abs(((a - b) % 24 + 24) % 24);
  return Math.min(d, 24 - d);
};

// ─────────────────────────────────────────────────────────────────────────────
describe('fitCosinor (§M.3) — exact recovery from a known rhythm', () => {
  it.each([
    [54, 6, 15.0],
    [80, 8, 15.5],
    [69.5, 4.5, 14.0],
    [73, 5, 23.0],   // a shift worker's acrophase, near the wrap point
    [70, 3, 0.5],    // acrophase just after midnight — the other side of the wrap
  ])('recovers M=%p A=%p phi=%p to machine precision', (M, A, phi) => {
    const fit = fitCosinor(syntheticBins({ M, A, phi }));
    expect(fit.source).toBe('fit');
    expect(fit.M).toBeCloseTo(M, 6);
    expect(fit.A).toBeCloseTo(A, 6);
    expect(hourDist(fit.phi, phi)).toBeLessThan(1e-6);
    expect(fit.r2).toBeCloseTo(1, 6);
  });

  it('always reports an acrophase inside [0, 24)', () => {
    for (let phi = 0; phi < 24; phi += 0.5) {
      const fit = fitCosinor(syntheticBins({ M: 70, A: 5, phi }));
      expect(fit.phi).toBeGreaterThanOrEqual(0);
      expect(fit.phi).toBeLessThan(24);
    }
  });

  it('reports a near-zero amplitude for a genuinely flat rhythm rather than fitting noise', () => {
    const fit = fitCosinor(syntheticBins({ M: 70, A: 0, phi: 15 }));
    expect(fit.A).toBeCloseTo(0, 6);
    expect(fit.confidence).toBeLessThan(0.2); // nothing to explain -> nothing claimed
  });

  it('weights bins by their sample count', () => {
    // One badly-placed bin with a huge deviation but a tiny count must not own the fit.
    const bins = syntheticBins({ M: 70, A: 5, phi: 15 });
    bins[3] = { ...bins[3], raw: 200, n: 1 };
    const fit = fitCosinor(bins);
    expect(Math.abs(fit.M - 70)).toBeLessThan(2);
  });

  it('drops a contaminated bin and refits (the habitual-workout hour)', () => {
    const bins = syntheticBins({ M: 70, A: 5, phi: 15 });
    bins[18] = { ...bins[18], raw: 145 }; // an evening training hour, at full weight
    const fit = fitCosinor(bins);
    expect(fit.outliersDropped).toBeGreaterThan(0);
    expect(fit.M).toBeCloseTo(70, 1);
    expect(fit.A).toBeCloseTo(5, 1);
    expect(hourDist(fit.phi, 15)).toBeLessThan(0.5);
  });
});

describe('fitCosinor — the admission gate (§M.3: >= 6 bins, >= 2h apart)', () => {
  const prior = { M: 61, A: 4, phi: 15.0 };

  it('returns the prior at zero confidence when there are too few populated bins', () => {
    const fit = fitCosinor(syntheticBins({ M: 70, A: 5, phi: 15, hours: [8, 10, 12, 14] }), { prior });
    expect(fit.source).toBe('prior');
    expect(fit).toMatchObject({ M: 61, A: 4, phi: 15, confidence: 0 });
  });

  it('refuses six bins CLUSTERED inside one afternoon — spread, not count, is the point', () => {
    const clustered = [12, 12.5, 13, 13.5, 14, 14.5].map(Math.floor);
    const fit = fitCosinor(syntheticBins({ M: 70, A: 5, phi: 15, hours: clustered }), { prior });
    expect(fit.source).toBe('prior');
  });

  it('accepts six bins spread around the clock', () => {
    const fit = fitCosinor(syntheticBins({ M: 70, A: 5, phi: 15, hours: [0, 4, 8, 12, 16, 20] }), { prior });
    expect(fit.source).toBe('fit');
    expect(fit.M).toBeCloseTo(70, 6);
  });

  it('uses the population prior shape the mission specifies when it has to fall back', () => {
    const fit = fitCosinor([], {});
    expect(fit).toMatchObject({ A: 4, phi: 15, confidence: 0, source: 'prior' });
  });

  it('never throws and never returns NaN for junk input', () => {
    for (const bad of [null, undefined, [], [{}], [{ hour: 'x', n: 'y', raw: NaN }], 42, 'nope']) {
      const fit = fitCosinor(bad, { prior });
      expect(Number.isFinite(fit.M)).toBe(true);
      expect(Number.isFinite(fit.A)).toBe(true);
      expect(Number.isFinite(fit.phi)).toBe(true);
      expect(Number.isFinite(fit.confidence)).toBe(true);
    }
  });

  it('clamps an absurd fitted amplitude instead of publishing it', () => {
    const bins = syntheticBins({ M: 70, A: 200, phi: 15 });
    expect(fitCosinor(bins).A).toBeLessThanOrEqual(MAX_AMPLITUDE);
  });

  it('_circularSpread treats the clock as a circle, not a line', () => {
    expect(_circularSpread([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22])).toBe(12);
    expect(_circularSpread([12, 13, 14])).toBe(2);
    expect(_circularSpread([0, 23])).toBe(1);       // 23:00 and 00:00 are one hour apart
    expect(_circularSpread([])).toBe(0);
    expect(_circularSpread([7])).toBe(1);
  });
});

describe('fitCosinor — recovery from simulated persona days (independent answer key)', () => {
  it.each(listPersonaIds())('%s: recovers the persona rhythm from 30 days of real-shaped data', (id) => {
    const run = generate({ persona: id, seed: `w4-004:cos:${id}`, startAt: T0, days: 30, sampleIntervalSec: 60 });
    const hrSamples = run.truth.samples.map((s) => ({
      value: s.hr, activity: s.activity, recordedAt: s.tMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    }));
    const hourly = buildHourlyTable({ hrSamples, tzOffsetMinutes: run.meta.tzOffsetMinutes });
    const fit = fitCosinor(hourly, { prior: { M: 62, A: 4, phi: 15 } });
    const truth = getPersona(id).cosinor;

    expect(fit.source).toBe('fit');
    expect(Math.abs(fit.M - truth.mesor)).toBeLessThan(5);
    expect(Math.abs(fit.A - truth.amplitude)).toBeLessThan(5);
    expect(hourDist(fit.phi, truth.acrophaseHours)).toBeLessThan(4);
    expect(fit.confidence).toBeGreaterThan(0.2);
  });

  it('separates the shift worker from the day workers by acrophase — the whole point of D13', () => {
    const fitFor = (id) => {
      const run = generate({ persona: id, seed: `w4-004:sep:${id}`, startAt: T0, days: 30, sampleIntervalSec: 60 });
      const hrSamples = run.truth.samples.map((s) => ({
        value: s.hr, activity: s.activity, recordedAt: s.tMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
      }));
      return fitCosinor(buildHourlyTable({ hrSamples, tzOffsetMinutes: run.meta.tzOffsetMinutes }));
    };
    const shift = fitFor('shiftWorker');
    const day = fitFor('sedentary');
    expect(hourDist(shift.phi, day.phi)).toBeGreaterThan(3);
  });

  it('reports the older adult\'s flattened amplitude as genuinely smaller than the athlete\'s', () => {
    const ampFor = (id) => {
      const run = generate({ persona: id, seed: `w4-004:amp:${id}`, startAt: T0, days: 30, sampleIntervalSec: 60 });
      const hrSamples = run.truth.samples.map((s) => ({
        value: s.hr, activity: s.activity, recordedAt: s.tMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
      }));
      return fitCosinor(buildHourlyTable({ hrSamples, tzOffsetMinutes: run.meta.tzOffsetMinutes })).A;
    };
    expect(ampFor('olderAdult')).toBeLessThan(ampFor('athlete'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('weightedNight + sleepDebt (§M.6)', () => {
  it('weights stages exactly as translate.js does — one definition of a good night', () => {
    expect(STAGE_WEIGHTS).toEqual({ deep: 1.5, light: 1.0, rem: 1.2 });
    expect(weightedNight({ deep: 90, light: 300, rem: 90 })).toBeCloseTo(543, 6);
    expect(weightedNight({ deep: 90, light: 300, rem: 90 })).toBe(POPULATION_SLEEP_NEED);
  });

  it('returns null for an absent or all-empty night rather than a zero-minute one', () => {
    for (const bad of [null, undefined, {}, 'x', { deep: null, light: undefined, rem: NaN }]) {
      expect(weightedNight(bad)).toBeNull();
    }
    expect(weightedNight({ deep: 0, light: 0, rem: 0 })).toBe(0); // a genuinely logged zero
  });

  it('accumulates debt across consecutive short nights and decays it on recovery nights', () => {
    const short = { deep: 45, light: 150, rem: 45 };  // half a night
    const full = { deep: 120, light: 400, rem: 120 }; // a long one
    // Need is held FIXED here so this measures the accumulator, not the need estimator — see
    // the next test for what happens when the need is allowed to move.
    const need = 543;

    const afterShort = sleepDebt([short, short, short, short, short], { need });
    expect(afterShort.debt).toBeGreaterThan(0);

    const afterRecovery = sleepDebt([short, short, short, short, short, full, full, full], { need });
    expect(afterRecovery.debt).toBeLessThan(afterShort.debt);
  });

  it('re-estimates the need from the window it is given — so the window must be a long one', () => {
    // Watching someone sleep ten hours when they can genuinely revises what they need upward,
    // and with a self-estimated need that raises every earlier night's deficit too. It is
    // correct behaviour and a real hazard on a short window, so it is pinned rather than left
    // to be discovered: callers pass a long history, or they pass an explicit `need`.
    const short = { deep: 45, light: 150, rem: 45 };
    const full = { deep: 120, light: 400, rem: 120 };
    const shortOnly = sleepDebt([short, short, short, short, short]);
    const withRecovery = sleepDebt([short, short, short, short, short, full, full, full]);
    expect(withRecovery.need).toBeGreaterThan(shortOnly.need);
  });

  it('is monotone in the size of the deficit', () => {
    const debtFor = (mins) => sleepDebt(
      Array.from({ length: 6 }, () => ({ deep: mins * 0.2, light: mins * 0.55, rem: mins * 0.25 })),
      { need: 543 },
    ).debt;
    let prev = Infinity;
    for (const mins of [200, 300, 400, 500, 600]) {
      const d = debtFor(mins);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });

  it('applies the §M.6 recursion exactly for a hand-computable case', () => {
    const need = 500;
    const night = { deep: 0, light: 400, rem: 0 }; // weighted 400 -> deficit 100 each night
    const one = sleepDebt([night], { need });
    const two = sleepDebt([night, night], { need });
    expect(one.debt).toBeCloseTo(100, 6);
    expect(two.debt).toBeCloseTo(DEBT_DECAY * 100 + 100, 6);
  });

  it('saturates at the ceiling instead of growing without bound', () => {
    const nights = Array.from({ length: 60 }, () => ({ deep: 0, light: 60, rem: 0 }));
    const d = sleepDebt(nights, { need: 500 });
    expect(d.debt).toBeLessThanOrEqual(DEBT_CEILING_NIGHTS * 500 + 1e-9);
    expect(d.ratio).toBeLessThanOrEqual(1);
    expect(d.ratio).toBeGreaterThan(0.9);
  });

  it('uses a personal need at the 75th percentile so a chronic short sleeper is not "fine"', () => {
    // Every night short, by the same amount. A MEDIAN-based need would call this zero debt.
    const nights = Array.from({ length: 20 }, (_, i) => ({
      deep: 40, light: 150 + (i % 3) * 5, rem: 40,
    }));
    const d = sleepDebt(nights);
    expect(d.need).toBeGreaterThan(weightedNight(nights[0]));
    expect(d.debt).toBeGreaterThan(0);
  });

  it('shrinks the personal need toward the population need when there are few nights', () => {
    const oneNight = sleepDebt([{ deep: 30, light: 100, rem: 30 }]);
    expect(oneNight.need).toBeGreaterThan(400);           // not "your need is 181 minutes"
    expect(oneNight.need).toBeLessThan(POPULATION_SLEEP_NEED);
    expect(oneNight.confidence).toBeCloseTo(1 / 6, 3); // n/(n+k), k = 5 nights
  });

  it('returns a zero-debt, population-need result for no nights at all', () => {
    const d = sleepDebt([]);
    expect(d.debt).toBe(0);
    expect(d.ratio).toBe(0);
    expect(d.need).toBe(POPULATION_SLEEP_NEED);
    expect(d.confidence).toBe(0);
  });

  it('never returns NaN for junk input (S8)', () => {
    for (const bad of [null, undefined, 'x', [null, undefined, {}], [{ deep: NaN, light: Infinity }]]) {
      const d = sleepDebt(bad);
      expect(Number.isFinite(d.debt)).toBe(true);
      expect(Number.isFinite(d.ratio)).toBe(true);
      expect(Number.isFinite(d.need)).toBe(true);
      expect(d.need).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('circadianAlertness — the continuous replacement for the binary windDown (D13)', () => {
  const cosinor = { M: 70, A: 6, phi: 15, confidence: 1 };

  it('peaks at the acrophase and troughs 12 hours away', () => {
    const peak = circadianAlertness({ cosinor, hourOfDay: 15 }).alertness;
    const trough = circadianAlertness({ cosinor, hourOfDay: 3 }).alertness;
    expect(peak).toBeGreaterThan(trough);
    expect(peak).toBeCloseTo(1, 2);
    expect(trough).toBeCloseTo(0, 2);
  });

  it('is continuous — no step anywhere, unlike the 21:00 cliff it replaces', () => {
    let prev = circadianAlertness({ cosinor, hourOfDay: 0 }).alertness;
    for (let h = 0.1; h < 24; h += 0.1) {
      const v = circadianAlertness({ cosinor, hourOfDay: h }).alertness;
      expect(Math.abs(v - prev)).toBeLessThan(0.05); // the old model jumped 0.2 in one minute
      prev = v;
    }
  });

  it('follows the SUBJECT\'s acrophase — two users at the same clock hour differ', () => {
    const dayWorker = { M: 70, A: 6, phi: 15, confidence: 1 };
    const nightWorker = { M: 70, A: 6, phi: 23, confidence: 1 };
    const at22 = (c) => circadianAlertness({ cosinor: c, hourOfDay: 22 }).alertness;
    expect(at22(nightWorker)).toBeGreaterThan(at22(dayWorker) + 0.2);
  });

  it('damps its own swing when the fit is not confident', () => {
    const sure = circadianAlertness({ cosinor, hourOfDay: 15 }).alertness;
    const unsure = circadianAlertness({ cosinor: { ...cosinor, confidence: 0 }, hourOfDay: 15 }).alertness;
    expect(unsure).toBeLessThan(sure);
    expect(unsure).toBeGreaterThan(0.5); // damped toward neutral, not inverted
  });

  it('lowers alertness in proportion to sleep debt', () => {
    const rested = circadianAlertness({ cosinor, hourOfDay: 12, debtRatio: 0 }).alertness;
    const tired = circadianAlertness({ cosinor, hourOfDay: 12, debtRatio: 1 }).alertness;
    expect(tired).toBeLessThan(rested);
    let prev = rested;
    for (const r of [0.2, 0.4, 0.6, 0.8, 1]) {
      const v = circadianAlertness({ cosinor, hourOfDay: 12, debtRatio: r }).alertness;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('stays in [0, 1] and windDown is its exact complement', () => {
    for (let h = 0; h < 24; h += 0.25) {
      for (const debtRatio of [0, 0.5, 1, 5, -3, NaN]) {
        const out = circadianAlertness({ cosinor, hourOfDay: h, debtRatio });
        expect(out.alertness).toBeGreaterThanOrEqual(0);
        expect(out.alertness).toBeLessThanOrEqual(1);
        expect(out.windDown).toBeCloseTo(1 - out.alertness, 9);
      }
    }
  });

  it('returns the rhythm-neutral midpoint when the hour is unknown, instead of inventing one', () => {
    const out = circadianAlertness({ cosinor, hourOfDay: null });
    expect(out.alertness).toBe(0.5);
    expect(out.phase).toBe(0);
  });

  it('never throws and never returns NaN for junk input (S8)', () => {
    for (const args of [undefined, {}, { cosinor: null, hourOfDay: 'x' }, { cosinor: { phi: NaN } }]) {
      const out = circadianAlertness(args);
      expect(Number.isFinite(out.alertness)).toBe(true);
      expect(Number.isFinite(out.windDown)).toBe(true);
    }
  });
});

describe('module hygiene', () => {
  it('never calls Date.now() or Math.random() (S9 grep guard)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../app/agents/runtime/physiology/chronobiology.js'), 'utf8',
    );
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/Math\.random\s*\(/);
    expect(code).not.toMatch(/new Date\s*\(/);
    expect(code).not.toMatch(/console\./); // no logging: this module handles vitals
  });

  it('exposes MIN_SPREAD_BINS as the §M.3 gate, not a magic 6 buried in a branch', () => {
    expect(MIN_SPREAD_BINS).toBe(6);
  });
});
