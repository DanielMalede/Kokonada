'use strict';

// A1 — personal baselines (W4-004). Kills D1 (no HRV baseline ever computed), D2 (every batch
// row labelled 'unknown', so workouts and sleep were pooled into "resting"), D14 (fixed anchors
// for everyone) and D15 (the MIN_SAMPLES=10 all-or-nothing cliff).
//
// The engine is PURE, so almost everything here is a direct call — no Mongo, no clock, no
// mocks. Where the claim is "this recovers the truth", the truth comes from the W4-002
// simulator's answer key (`run.truth`), which is generated independently of the estimator.

const {
  median, mad, quantile, shrink, fuse, localHour,
  dailySeries, estimateRestingHeartRate, buildHourlyTable, estimateMetricBaseline,
  estimateHrMax, karvonenZones, computeBaselineBlob,
  POPULATION, BASELINE_BLOB_VERSION,
} = require('../app/agents/runtime/physiology/baselineEngine');

const { generate } = require('../sim/generator');
const { getPersona, listPersonaIds, karvonenZones: simZones } = require('../sim/personas');

const T0 = Date.UTC(2026, 6, 1, 0, 0, 0); // fixed epoch — no test reads the clock
const DAY = 86400000;

// sim truth.samples -> the engine's HR sample shape.
function hrSamplesFrom(run, { forceUnknown = false } = {}) {
  return run.truth.samples.map((s) => ({
    value: s.hr,
    activity: forceUnknown ? 'unknown' : s.activity,
    recordedAt: s.tMs,
    source: 'garmin',
    tzOffsetMinutes: run.meta.tzOffsetMinutes,
  }));
}

// sim truth.daily -> VitalSample-shaped rows (what W4-004's wiring half will persist).
function vitalSamplesFrom(run, metrics = ['hrv']) {
  const out = [];
  for (const d of run.truth.daily) {
    const atMs = run.meta.startAtMs + d.dayIndex * DAY + 7 * 3600000;
    if (metrics.includes('hrv')) {
      out.push({ metric: 'hrv', value: d.hrv, recordedAt: atMs, source: 'garmin', tzOffsetMinutes: run.meta.tzOffsetMinutes });
    }
    if (metrics.includes('restingHeartRate')) {
      out.push({ metric: 'restingHeartRate', value: d.restingHeartRate, recordedAt: atMs, source: 'garmin', tzOffsetMinutes: run.meta.tzOffsetMinutes });
    }
  }
  return out;
}

const runFor = (personaId, days = 30, seed = 'w4-004') =>
  generate({ persona: personaId, seed: `${seed}:${personaId}`, startAt: T0, days, sampleIntervalSec: 60 });

// ─────────────────────────────────────────────────────────────────────────────
describe('robust primitives', () => {
  it('median and mad match hand-computed values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1); // deviations 2,1,0,1,97 -> median 1
  });

  it('median/mad return null on an empty or all-non-finite input rather than 0 or NaN', () => {
    for (const bad of [[], null, undefined, [NaN, Infinity, null, 'x']]) {
      expect(median(bad)).toBeNull();
      expect(mad(bad)).toBeNull();
    }
  });

  it('quantile interpolates between order statistics and clamps q', () => {
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 10], 0.1)).toBeCloseTo(1, 10);
    expect(quantile([1, 2, 3], -5)).toBe(1);   // clamped, never NaN
    expect(quantile([1, 2, 3], 99)).toBe(3);
  });

  it('quantile ignores non-finite entries instead of sorting them into the middle', () => {
    expect(quantile([1, NaN, 2, null, 3], 0.5)).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('shrinkage (§M.4) — the MIN_SAMPLES cliff replacement (D15)', () => {
  it('is exactly (n*xbar + k*mu0)/(n+k)', () => {
    expect(shrink({ n: 20, mean: 50, k: 20, prior: 60 }).value).toBeCloseTo(55, 10);
    expect(shrink({ n: 0, mean: 50, k: 20, prior: 60 }).value).toBe(60);   // no data -> prior
    expect(shrink({ n: 0, mean: 50, k: 20, prior: 60 }).confidence).toBe(0);
  });

  it('confidence is n/(n+k) and rises monotonically with n — no cliff anywhere', () => {
    let prev = -1;
    for (let n = 0; n <= 200; n++) {
      const c = shrink({ n, mean: 50, k: 20, prior: 60 }).confidence;
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
      prev = c;
    }
    expect(shrink({ n: 20, mean: 50, k: 20, prior: 60 }).confidence).toBeCloseTo(0.5, 10);
  });

  it('moves toward the sample mean monotonically as evidence accumulates', () => {
    let prev = 60;
    for (let n = 1; n <= 100; n++) {
      const v = shrink({ n, mean: 50, k: 20, prior: 60 }).value;
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      expect(v).toBeGreaterThanOrEqual(50);
      prev = v;
    }
  });

  it('is guarded against a zero/negative k and a non-finite mean', () => {
    expect(shrink({ n: 5, mean: 50, k: 0, prior: 60 }).value).toBe(50);
    expect(shrink({ n: 5, mean: NaN, k: 10, prior: 60 }).value).toBe(60);
    expect(shrink({ n: -3, mean: 50, k: 10, prior: 60 }).value).toBe(60);
  });
});

describe('precision-weighted fusion — the generalisation shrink() is a special case of', () => {
  it('reduces EXACTLY to §M.4 when there is one source at the prior scale', () => {
    const prior = { value: 60, scale: 5, k: 20 };
    const fused = fuse([{ value: 50, scale: 5, n: 20, reliability: 1 }], prior);
    expect(fused.value).toBeCloseTo(55, 9);
    expect(fused.confidence).toBeCloseTo(0.5, 9);
  });

  it('weights a tighter source more than a looser one', () => {
    const prior = { value: 0, scale: 10, k: 0.0001 };
    const f = fuse([
      { value: 10, scale: 1, n: 10, reliability: 1 },   // tight
      { value: 20, scale: 10, n: 10, reliability: 1 },  // loose
    ], prior);
    expect(f.value).toBeGreaterThan(10);
    expect(f.value).toBeLessThan(11); // the loose source barely moves it
  });

  it('discounts a source by its reliability as if it had fewer samples', () => {
    const prior = { value: 60, scale: 5, k: 20 };
    const full = fuse([{ value: 50, scale: 5, n: 20, reliability: 1 }], prior).value;
    const half = fuse([{ value: 50, scale: 5, n: 20, reliability: 0.5 }], prior).value;
    expect(half).toBeGreaterThan(full);                       // pulled back toward the prior
    expect(half).toBeCloseTo(fuse([{ value: 50, scale: 5, n: 10, reliability: 1 }], prior).value, 9);
  });

  it('returns the prior at zero confidence when every source is empty or invalid', () => {
    const prior = { value: 62, scale: 5, k: 20 };
    for (const sources of [[], [{ value: 50, scale: 5, n: 0 }], [{ value: NaN, scale: 5, n: 10 }]]) {
      const f = fuse(sources, prior);
      expect(f.value).toBe(62);
      expect(f.confidence).toBe(0);
    }
  });

  it('never divides by a zero scale (S8)', () => {
    const f = fuse([{ value: 50, scale: 0, n: 10, reliability: 1 }], { value: 60, scale: 5, k: 20 });
    expect(Number.isFinite(f.value)).toBe(true);
    expect(Number.isFinite(f.confidence)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('localHour (D13 — the subject\'s hour, not the server\'s)', () => {
  it('maps UTC midnight to hour 0 at offset 0 and shifts with the offset', () => {
    expect(localHour(Date.UTC(2026, 0, 1, 0, 0, 0), 0)).toBeCloseTo(0, 9);
    expect(localHour(Date.UTC(2026, 0, 1, 0, 0, 0), 120)).toBeCloseTo(2, 9);   // UTC+2
    expect(localHour(Date.UTC(2026, 0, 1, 0, 0, 0), -300)).toBeCloseTo(19, 9); // UTC-5
  });

  it('always returns a value in [0, 24)', () => {
    for (const tz of [-840, -300, 0, 330, 720]) {
      for (let h = 0; h < 48; h++) {
        const v = localHour(Date.UTC(2026, 0, 1) + h * 3600000, tz);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(24);
      }
    }
  });

  it('falls back to the server hour on a missing/invalid offset rather than producing NaN', () => {
    for (const bad of [null, undefined, NaN, 'x', 99999]) {
      const v = localHour(Date.UTC(2026, 0, 1, 5), bad);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('dailySeries — one value per local day (the autocorrelation fix)', () => {
  it('collapses a day of highly-correlated samples into ONE observation', () => {
    const samples = [];
    for (let i = 0; i < 1440; i++) samples.push({ value: 60, recordedAt: T0 + i * 60000 });
    const series = dailySeries(samples, { reduce: (vs) => median(vs), tzOffsetMinutes: 0 });
    expect(series).toHaveLength(1);
    expect(series[0].value).toBe(60);
    expect(series[0].n).toBe(1440);
  });

  it('splits on the LOCAL day boundary, not the UTC one', () => {
    // 23:30 UTC on day 1 is 01:30 local at UTC+2 -> already the next local day.
    const samples = [
      { value: 60, recordedAt: Date.UTC(2026, 0, 1, 21, 0) },  // 23:00 local
      { value: 70, recordedAt: Date.UTC(2026, 0, 1, 23, 30) }, // 01:30 local, next day
    ];
    expect(dailySeries(samples, { reduce: median, tzOffsetMinutes: 120 })).toHaveLength(2);
    expect(dailySeries(samples, { reduce: median, tzOffsetMinutes: 0 })).toHaveLength(1);
  });

  it('returns [] for empty input and drops non-finite values', () => {
    expect(dailySeries([], { reduce: median })).toEqual([]);
    const s = dailySeries(
      [{ value: NaN, recordedAt: T0 }, { value: 60, recordedAt: T0 }],
      { reduce: median, tzOffsetMinutes: 0 },
    );
    expect(s).toHaveLength(1);
    expect(s[0].value).toBe(60);
    expect(s[0].n).toBe(1);
  });

  it('is emitted in ascending day order', () => {
    const samples = [
      { value: 1, recordedAt: T0 + 3 * DAY },
      { value: 2, recordedAt: T0 },
      { value: 3, recordedAt: T0 + DAY },
    ];
    const series = dailySeries(samples, { reduce: median, tzOffsetMinutes: 0 });
    expect(series.map((d) => d.value)).toEqual([2, 3, 1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('estimateRestingHeartRate — persona kill-shots (D2)', () => {
  it.each(listPersonaIds())(
    '%s: lands within 3 bpm of persona truth even when EVERY row is labelled unknown',
    (personaId) => {
      const run = runFor(personaId);
      const rhr = estimateRestingHeartRate({
        hrSamples: hrSamplesFrom(run, { forceUnknown: true }),
        now: run.meta.endAtMs,
        tzOffsetMinutes: run.meta.tzOffsetMinutes,
      });
      expect(Math.abs(rhr.value - run.truth.restingHeartRate)).toBeLessThanOrEqual(3);
      expect(rhr.confidence).toBeGreaterThan(0.5);
    },
  );

  it.each(listPersonaIds())('%s: true activity labels do not make it worse', (personaId) => {
    const run = runFor(personaId);
    const labelled = estimateRestingHeartRate({
      hrSamples: hrSamplesFrom(run),
      now: run.meta.endAtMs,
      tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    expect(Math.abs(labelled.value - run.truth.restingHeartRate)).toBeLessThanOrEqual(3);
  });

  it('the OLD pooled-median estimator is materially worse on the same data (the D2 control)', () => {
    // What baselines.js does today: median of every row whose activity is resting|unknown.
    const run = runFor('stressedProfessional');
    const samples = hrSamplesFrom(run, { forceUnknown: true });
    const old = median(samples.map((s) => s.value));
    const now = estimateRestingHeartRate({
      hrSamples: samples, now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    }).value;
    const truth = run.truth.restingHeartRate;
    expect(Math.abs(old - truth)).toBeGreaterThan(Math.abs(now - truth) + 3);
  });

  it('a night-shift worker is not scored against a day-worker\'s clock', () => {
    // The shift-worker persona peaks at 23:00, so its 00:00-06:00 window is its ACTIVE
    // period. A fixed nocturnal window alone reads that as "resting" and biases high; the
    // per-day trough is what rescues it.
    //
    // A/B'd through ONE function rather than asserted: feeding only the 00:00-06:00 samples
    // makes each day's whole-day pool identical to its nocturnal pool, so `min(night, day)`
    // collapses to exactly the nocturnal-window estimator. Same code path, two designs.
    const nocturnalOnly = (run) => estimateRestingHeartRate({
      hrSamples: hrSamplesFrom(run, { forceUnknown: true })
        .filter((s) => localHour(s.recordedAt, run.meta.tzOffsetMinutes) < 6),
      now: run.meta.endAtMs,
      tzOffsetMinutes: run.meta.tzOffsetMinutes,
    }).value;
    const bothTroughs = (run) => estimateRestingHeartRate({
      hrSamples: hrSamplesFrom(run, { forceUnknown: true }),
      now: run.meta.endAtMs,
      tzOffsetMinutes: run.meta.tzOffsetMinutes,
    }).value;

    // It costs a day-active user NOTHING: for them the whole-day trough IS the nocturnal one.
    for (const id of ['athlete', 'sedentary', 'olderAdult', 'stressedProfessional']) {
      const dayWorker = runFor(id);
      expect(bothTroughs(dayWorker)).toBeCloseTo(nocturnalOnly(dayWorker), 9);
    }

    // ...and it is strictly better for the one persona whose clock is shifted.
    const run = runFor('shiftWorker');
    const truth = run.truth.restingHeartRate;
    expect(Math.abs(bothTroughs(run) - truth)).toBeLessThan(Math.abs(nocturnalOnly(run) - truth));
    expect(Math.abs(bothTroughs(run) - truth)).toBeLessThanOrEqual(3);
  });

  it('prefers the device-reported RHR series when one exists', () => {
    const run = runFor('sedentary', 14);
    const withDevice = estimateRestingHeartRate({
      hrSamples: hrSamplesFrom(run, { forceUnknown: true }),
      deviceRestingHeartRate: vitalSamplesFrom(run, ['restingHeartRate'])
        .map((v) => ({ value: v.value, recordedAt: v.recordedAt })),
      now: run.meta.endAtMs,
      tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    expect(withDevice.sources.device.n).toBe(14);
    expect(Math.abs(withDevice.value - run.truth.restingHeartRate)).toBeLessThanOrEqual(3);
    const withoutDevice = estimateRestingHeartRate({
      hrSamples: hrSamplesFrom(run, { forceUnknown: true }),
      now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    expect(withDevice.confidence).toBeGreaterThanOrEqual(withoutDevice.confidence);
    expect(withDevice.se).toBeLessThan(withoutDevice.se); // strictly more information
  });

  it('works from the device series ALONE, with no heart-rate stream at all', () => {
    const run = runFor('sedentary', 14);
    const est = estimateRestingHeartRate({
      hrSamples: [],
      deviceRestingHeartRate: vitalSamplesFrom(run, ['restingHeartRate'])
        .map((v) => ({ value: v.value, recordedAt: v.recordedAt })),
      now: run.meta.endAtMs,
      tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    expect(est.sources.trough.n).toBe(0);
    expect(Math.abs(est.value - run.truth.restingHeartRate)).toBeLessThanOrEqual(3);
  });

  it('degrades smoothly from population prior to personal estimate — no cliff (D15)', () => {
    const run = runFor('athlete', 20);
    const all = hrSamplesFrom(run, { forceUnknown: true });
    const truth = run.truth.restingHeartRate;
    let prevErr = Math.abs(POPULATION.restingHeartRate.value - truth);
    const errs = [];
    for (const days of [0, 1, 2, 3, 5, 8, 12, 20]) {
      const cut = run.meta.startAtMs + days * DAY;
      const est = estimateRestingHeartRate({
        hrSamples: all.filter((s) => s.recordedAt < cut),
        now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
      });
      expect(Number.isFinite(est.value)).toBe(true);
      errs.push(Math.abs(est.value - truth));
    }
    expect(errs[0]).toBeCloseTo(prevErr, 6);          // zero data -> exactly the prior
    expect(errs[errs.length - 1]).toBeLessThan(3);    // full data -> personal
    expect(errs[errs.length - 1]).toBeLessThan(errs[0]);
  });

  it('never returns NaN/Infinity for degenerate input (S8)', () => {
    const degenerate = [
      [],
      [{ value: 60, recordedAt: T0 }],
      [{ value: 60, recordedAt: T0 }, { value: 60, recordedAt: T0 + 1000 }], // zero variance
      [{ value: NaN, recordedAt: T0 }, { value: Infinity, recordedAt: T0 }],
      [{ value: 60, recordedAt: NaN }],
      null,
    ];
    for (const hrSamples of degenerate) {
      const r = estimateRestingHeartRate({ hrSamples, now: T0 + DAY, tzOffsetMinutes: 0 });
      expect(Number.isFinite(r.value)).toBe(true);
      expect(Number.isFinite(r.mad)).toBe(true);
      expect(r.mad).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('rhrMAD stays a WITHIN-day resting spread, not a shrinking standard error', () => {
    // translate() z-scores the CURRENT heart rate against rhrMAD, so it must not collapse
    // toward 0 as evidence accumulates — that would saturate stress for everyone.
    const short = runFor('sedentary', 3);
    const long = runFor('sedentary', 30);
    const m = (run) => estimateRestingHeartRate({
      hrSamples: hrSamplesFrom(run, { forceUnknown: true }),
      now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    }).mad;
    expect(m(long)).toBeGreaterThan(1.5);
    expect(Math.abs(m(long) - m(short))).toBeLessThan(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildHourlyTable — 24 personal hour bins with shrinkage (§M.4)', () => {
  it('returns exactly 24 bins, in hour order, all finite', () => {
    const run = runFor('sedentary', 7);
    const t = buildHourlyTable({
      hrSamples: hrSamplesFrom(run), tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    expect(t).toHaveLength(24);
    t.forEach((bin, h) => {
      expect(bin.hour).toBe(h);
      expect(Number.isFinite(bin.value)).toBe(true);
      expect(Number.isFinite(bin.mad)).toBe(true);
      expect(bin.mad).toBeGreaterThan(0);
      expect(bin.confidence).toBeGreaterThanOrEqual(0);
      expect(bin.confidence).toBeLessThanOrEqual(1);
    });
  });

  it('an unobserved bin equals the overall baseline exactly (shrinkage, not a hole)', () => {
    const samples = [];
    for (let i = 0; i < 600; i++) {
      samples.push({ value: 70, recordedAt: T0 + 10 * 3600000 + i * 60000 }); // 10:00-20:00 only
    }
    const t = buildHourlyTable({ hrSamples: samples, tzOffsetMinutes: 0 });
    expect(t[3].n).toBe(0);
    expect(t[3].value).toBeCloseTo(t[3].overall, 9);
    expect(t[3].raw).toBeNull();       // no observation to report, and none invented
    expect(t[3].confidence).toBe(0);
    expect(t[12].n).toBeGreaterThan(0);
    expect(t[12].raw).toBeCloseTo(70, 6);
  });

  it('recovers the persona rhythm: the trough bin sits below the peak bin', () => {
    for (const id of listPersonaIds()) {
      const run = runFor(id, 21);
      const t = buildHourlyTable({
        hrSamples: hrSamplesFrom(run), tzOffsetMinutes: run.meta.tzOffsetMinutes,
      });
      const observed = t.filter((b) => b.n > 0);
      const lo = Math.min(...observed.map((b) => b.value));
      const hi = Math.max(...observed.map((b) => b.value));
      const p = getPersona(id);
      expect(hi - lo).toBeGreaterThan(p.cosinor.amplitude); // a real swing, not flat
    }
  });

  it('a lone outlier cannot move a bin the way a mean would', () => {
    const samples = [];
    for (let i = 0; i < 59; i++) samples.push({ value: 60, recordedAt: T0 + 8 * 3600000 + i * 60000 });
    samples.push({ value: 400, recordedAt: T0 + 8 * 3600000 + 59 * 60000 }); // absurd artifact
    const t = buildHourlyTable({ hrSamples: samples, tzOffsetMinutes: 0 });
    const mean = samples.reduce((a, s) => a + s.value, 0) / samples.length;
    expect(t[8].raw).toBe(60);            // the median did not move at all
    expect(mean).toBeGreaterThan(65);     // ...while a mean would have moved a lot
  });

  it('is empty-safe: no samples -> every bin is the population prior at zero confidence', () => {
    const t = buildHourlyTable({ hrSamples: [], tzOffsetMinutes: 0 });
    expect(t).toHaveLength(24);
    for (const bin of t) {
      expect(bin.value).toBeCloseTo(POPULATION.hourlyHeartRate.value, 9);
      expect(bin.confidence).toBe(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('estimateMetricBaseline — HRV and friends (D1)', () => {
  it('produces a REAL personal HRV median/MAD from sim vitals', () => {
    const run = runFor('athlete', 30);
    const est = estimateMetricBaseline({
      metric: 'hrv', samples: vitalSamplesFrom(run), now: run.meta.endAtMs, tzOffsetMinutes: 0,
    });
    const p = getPersona('athlete');
    expect(est.n).toBe(30);
    expect(Math.abs(est.median - p.hrv.median)).toBeLessThan(8);
    expect(est.mad).toBeGreaterThan(0);
    // The whole point of D1: this must NOT be the population constant.
    expect(Math.abs(est.median - POPULATION.hrv.value)).toBeGreaterThan(10);
    expect(est.confidence).toBeGreaterThan(0.6);
  });

  it('exposes acute (7d) vs chronic (30d) and a signed robust trend', () => {
    const run = generate({
      persona: 'sedentary', seed: 'w4-004:drift', startAt: T0, days: 30, sampleIntervalSec: 300,
      drift: { metric: 'hrv', startDay: 20, perDayBpm: -1.5 },
    });
    const est = estimateMetricBaseline({
      metric: 'hrv', samples: vitalSamplesFrom(run), now: run.meta.endAtMs, tzOffsetMinutes: 0,
    });
    expect(est.acute).toBeLessThan(est.chronic);
    expect(est.trend).toBeLessThan(0);
    expect(Number.isFinite(est.ewma)).toBe(true);
  });

  it('a stationary series has a trend near zero and a finite ewma', () => {
    const samples = [];
    for (let d = 0; d < 30; d++) {
      samples.push({ metric: 'hrv', value: 50 + (d % 2 ? 1 : -1), recordedAt: T0 + d * DAY });
    }
    const est = estimateMetricBaseline({ metric: 'hrv', samples, now: T0 + 30 * DAY, tzOffsetMinutes: 0 });
    expect(Math.abs(est.trend)).toBeLessThan(1);
  });

  it('falls back to the population prior with zero confidence when there are no samples', () => {
    for (const metric of ['hrv', 'restingHeartRate', 'spO2']) {
      const est = estimateMetricBaseline({ metric, samples: [], now: T0, tzOffsetMinutes: 0 });
      expect(est.median).toBeCloseTo(POPULATION[metric].value, 9);
      expect(est.confidence).toBe(0);
      expect(est.n).toBe(0);
      expect(Number.isFinite(est.mad)).toBe(true);
    }
  });

  it('clamps the trend instead of exploding on a zero-variance chronic window', () => {
    const samples = [];
    for (let d = 0; d < 30; d++) samples.push({ metric: 'hrv', value: 50, recordedAt: T0 + d * DAY });
    samples.push({ metric: 'hrv', value: 5, recordedAt: T0 + 30 * DAY });
    const est = estimateMetricBaseline({ metric: 'hrv', samples, now: T0 + 31 * DAY, tzOffsetMinutes: 0 });
    expect(Number.isFinite(est.trend)).toBe(true);
    expect(Math.abs(est.trend)).toBeLessThanOrEqual(6);
  });

  it('ignores rows of other metrics', () => {
    const samples = [
      { metric: 'hrv', value: 50, recordedAt: T0 },
      { metric: 'spO2', value: 97, recordedAt: T0 },
    ];
    expect(estimateMetricBaseline({ metric: 'hrv', samples, now: T0 + DAY, tzOffsetMinutes: 0 }).n).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('estimateHrMax + Karvonen zones (§M.7, §M.8)', () => {
  it('prefers a user-provided maximum and marks it as such', () => {
    const est = estimateHrMax({ provided: 188, hrSamples: [], restingHeartRate: 55 });
    expect(est.value).toBe(188);
    expect(est.source).toBe('provided');
    expect(est.confidence).toBeGreaterThan(0.5);
  });

  it('measures from high-exertion samples when they reach a plausible maximum', () => {
    const run = runFor('athlete', 30);
    const est = estimateHrMax({
      provided: null, hrSamples: hrSamplesFrom(run), restingHeartRate: run.truth.restingHeartRate,
    });
    expect(est.source).toBe('measured');
    expect(est.value).toBeGreaterThanOrEqual(160);
    expect(Math.abs(est.value - getPersona('athlete').maxHeartRate)).toBeLessThan(25);
  });

  it('falls back to the population default (never an age formula — no DOB is stored)', () => {
    const est = estimateHrMax({ provided: null, hrSamples: [], restingHeartRate: 60 });
    expect(est.source).toBe('default');
    expect(est.value).toBe(POPULATION.maxHeartRate.value);
    expect(est.confidence).toBeLessThan(0.4);
  });

  it('refuses a "measured" maximum below the 160 bpm plausibility floor', () => {
    const hrSamples = [];
    for (let i = 0; i < 500; i++) {
      hrSamples.push({ value: 120, activity: 'running', recordedAt: T0 + i * 60000 });
    }
    expect(estimateHrMax({ provided: null, hrSamples, restingHeartRate: 60 }).source).toBe('default');
  });

  it('produces five ordered, finite zones matching the simulator\'s independent implementation', () => {
    for (const id of listPersonaIds()) {
      const p = getPersona(id);
      const z = karvonenZones(p.restingHeartRate, p.maxHeartRate);
      const truth = simZones(p);
      expect(z.zones).toHaveLength(5);
      z.zones.forEach((zone, i) => {
        expect(zone.minBpm).toBeCloseTo(truth.lower[i], 6);
        expect(zone.maxBpm).toBeCloseTo(truth.upper[i], 6);
        expect(zone.maxBpm).toBeGreaterThan(zone.minBpm);
      });
      for (let i = 1; i < 5; i++) expect(z.zones[i].minBpm).toBeGreaterThan(z.zones[i - 1].minBpm);
    }
  });

  it('stays ordered and finite when HRmax is at or below RHR (the S8 degenerate body)', () => {
    for (const [rhr, hrMax] of [[60, 60], [60, 40], [60, NaN], [NaN, 190]]) {
      const z = karvonenZones(rhr, hrMax);
      expect(Number.isFinite(z.hrr)).toBe(true);
      expect(z.hrr).toBeGreaterThan(0);
      for (const zone of z.zones) {
        expect(Number.isFinite(zone.minBpm)).toBe(true);
        expect(Number.isFinite(zone.maxBpm)).toBe(true);
        expect(zone.maxBpm).toBeGreaterThan(zone.minBpm);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('computeBaselineBlob — the superset contract (§0.2.5)', () => {
  const run = runFor('sedentary', 30);
  const blob = () => computeBaselineBlob({
    hrSamples: hrSamplesFrom(run, { forceUnknown: true }),
    vitalSamples: vitalSamplesFrom(run, ['hrv', 'restingHeartRate']),
    profile: { maxHeartRate: null },
    now: run.meta.endAtMs,
    tzOffsetMinutes: run.meta.tzOffsetMinutes,
  });

  it('keeps EVERY legacy key with its old semantics', () => {
    const b = blob();
    for (const key of ['rhrMedian', 'rhrMAD', 'sampleCount', 'computedAt']) {
      expect(b).toHaveProperty(key);
    }
    expect(Number.isFinite(b.rhrMedian)).toBe(true);
    expect(b.rhrMAD).toBeGreaterThan(0);
    expect(b.sampleCount).toBeGreaterThan(0);
    expect(typeof b.computedAt).toBe('string');
    expect(new Date(b.computedAt).getTime()).toBe(run.meta.endAtMs); // derived from `now`, not the clock
  });

  it('adds the superset keys D1/D13/D14 need', () => {
    const b = blob();
    expect(b.v).toBe(BASELINE_BLOB_VERSION);
    expect(Number.isFinite(b.hrvMedian)).toBe(true);
    expect(b.hrvMAD).toBeGreaterThan(0);
    expect(b.hourly).toHaveLength(24);
    expect(b.cosinor).toEqual(expect.objectContaining({
      M: expect.any(Number), A: expect.any(Number), phi: expect.any(Number),
    }));
    expect(b.zones.zones).toHaveLength(5);
    expect(Number.isFinite(b.maxHeartRate)).toBe(true);
    expect(b.acute).toEqual(expect.objectContaining({ rhr: expect.any(Number), hrv: expect.any(Number) }));
    expect(b.confidence).toBeGreaterThan(0);
    expect(b.confidence).toBeLessThanOrEqual(1);
  });

  it('carries NO raw sample and no per-reading detail (zero-knowledge, §0.2.2)', () => {
    const json = JSON.stringify(blob());
    expect(json).not.toMatch(/"samples"|"readings"|"recordedAt"/);
    expect(JSON.stringify(blob()).length).toBeLessThan(6000); // derived stats only, bounded
  });

  it('is DETERMINISTIC and clock-free: same inputs, byte-identical output (S9)', () => {
    expect(JSON.stringify(blob())).toBe(JSON.stringify(blob()));
  });

  it('the module never calls Date.now() or Math.random() (S9 grep guard)', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../app/agents/runtime/physiology/baselineEngine.js'), 'utf8',
    );
    const code = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/Date\.now\s*\(/);
    expect(code).not.toMatch(/Math\.random\s*\(/);
    expect(code).not.toMatch(/new Date\s*\(\s*\)/);
  });

  it('survives a completely empty user without throwing, and says so via confidence', () => {
    const b = computeBaselineBlob({
      hrSamples: [], vitalSamples: [], profile: {}, now: T0, tzOffsetMinutes: 0,
    });
    expect(b.rhrMedian).toBeCloseTo(POPULATION.restingHeartRate.value, 9);
    expect(b.hrvMedian).toBeCloseTo(POPULATION.hrv.value, 9);
    expect(b.sampleCount).toBe(0);
    expect(b.confidence).toBe(0);
    expect(JSON.parse(JSON.stringify(b))).toBeDefined(); // fully serialisable, no NaN
    expect(JSON.stringify(b)).not.toContain('null,null');
  });

  it('never emits a NaN anywhere in the blob, for any of the personas', () => {
    for (const id of listPersonaIds()) {
      const r = runFor(id, 10);
      const b = computeBaselineBlob({
        hrSamples: hrSamplesFrom(r, { forceUnknown: true }),
        vitalSamples: vitalSamplesFrom(r),
        profile: {}, now: r.meta.endAtMs, tzOffsetMinutes: r.meta.tzOffsetMinutes,
      });
      const walk = (o, p = '') => {
        if (typeof o === 'number') expect(Number.isFinite(o) ? true : p).toBe(true);
        else if (Array.isArray(o)) o.forEach((x, i) => walk(x, `${p}[${i}]`));
        else if (o && typeof o === 'object') for (const [k, val] of Object.entries(o)) walk(val, `${p}.${k}`);
      };
      walk(b);
    }
  });

  it('holdout personas (different noise family) are estimated just as well — no circularity', () => {
    const { listHoldoutIds } = require('../sim/personas');
    for (const id of listHoldoutIds()) {
      const r = runFor(id, 30);
      const b = computeBaselineBlob({
        hrSamples: hrSamplesFrom(r, { forceUnknown: true }),
        vitalSamples: vitalSamplesFrom(r),
        profile: {}, now: r.meta.endAtMs, tzOffsetMinutes: r.meta.tzOffsetMinutes,
      });
      expect(Math.abs(b.rhrMedian - r.truth.restingHeartRate)).toBeLessThanOrEqual(3);
    }
  });

  it('runs a 30-day user inside the ingest budget', () => {
    const samples = hrSamplesFrom(run, { forceUnknown: true });
    const started = process.hrtime.bigint();
    computeBaselineBlob({
      hrSamples: samples, vitalSamples: vitalSamplesFrom(run), profile: {},
      now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(samples.length).toBeGreaterThan(40000);
    expect(ms).toBeLessThan(2000); // generous: this is a worker-side job, not a request path
  });
});
