'use strict';

// A6 — daily analysis (W4-012). PURE core: nightly per-user consolidation math — CUSUM
// change-point detection (§M.13) on daily RHR/HRV residuals, and a readiness composite built
// from the SAME recovery/fatigue axes affectEngine already computes (reuse, not a third
// disagreeing algorithm — the D11/W4-D42 one-definition-rule precedent).
//
// No Mongo, no clock, no mocks for the change-point/readiness math — same discipline as
// baselineEngine/chronobiology (S9). Ground truth for the drift-detection claims comes from the
// simulator's own answer key (`run.truth`) and its purpose-built `drift` option (sim/generator.js
// `_buildDaily`, "Injected monotone drift for change-point work (W4-012)").
//
// CUSUM inputs are the DEVICE-REPORTED daily VitalSample series (`restingHeartRate`/`hrv`), not
// a re-derivation from raw per-minute samples: the simulator's `drift` option is injected into
// `run.truth.daily` (the device-summary ground truth), exactly mirroring how
// `baselineEngine.estimateMetricBaseline` already treats `restingHeartRate` as a VitalSample
// metric rather than a trough-of-raw-samples estimate.

const {
  changePointDetect, readinessComposite, consolidate,
  REFERENCE_DAYS, RECENT_DAYS, CUSUM_K, CUSUM_THRESHOLD, MIN_REFERENCE_DAYS,
} = require('../app/agents/runtime/physiology/dailyAnalysis');

const { dailySeries, median, computeBaselineBlob, localDayIndex } = require('../app/agents/runtime/physiology/baselineEngine');
const { generate } = require('../sim/generator');

const T0 = Date.UTC(2026, 6, 1, 0, 0, 0);
const DAY = 86400000;

function hrSamplesFrom(run) {
  return run.truth.samples.map((s) => ({
    value: s.hr, activity: s.activity, recordedAt: s.tMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
  }));
}

function vitalSamplesFrom(run, metrics = ['hrv']) {
  const out = [];
  for (const d of run.truth.daily) {
    const atMs = run.meta.startAtMs + d.dayIndex * DAY + 7 * 3600000;
    if (metrics.includes('hrv')) {
      out.push({ metric: 'hrv', value: d.hrv, recordedAt: atMs, tzOffsetMinutes: run.meta.tzOffsetMinutes });
    }
    if (metrics.includes('restingHeartRate')) {
      out.push({ metric: 'restingHeartRate', value: d.restingHeartRate, recordedAt: atMs, tzOffsetMinutes: run.meta.tzOffsetMinutes });
    }
  }
  return out;
}

const WINDOW_DAYS = REFERENCE_DAYS + RECENT_DAYS; // the full window changePointDetect scans

// ─────────────────────────────────────────────────────────────────────────────
describe('changePointDetect — §M.13 CUSUM', () => {
  it('flags an injected 10-day RHR drift within <=4 days of its onset', () => {
    const driftStartDay = REFERENCE_DAYS + 2; // inside the recent/test window
    const run = generate({
      persona: 'sedentary', seed: 'w4-012:rhr-drift', startAt: T0, days: WINDOW_DAYS, sampleIntervalSec: 300,
      drift: { metric: 'restingHeartRate', startDay: driftStartDay, perDayBpm: 1.0 },
    });
    const series = dailySeries(vitalSamplesFrom(run, ['restingHeartRate']), { reduce: median, tzOffsetMinutes: run.meta.tzOffsetMinutes });
    const result = changePointDetect(series);
    const expectedDriftDay = localDayIndex(run.meta.startAtMs, run.meta.tzOffsetMinutes) + driftStartDay;

    expect(result.flagged).toBe(true);
    expect(result.direction).toBe('up');
    expect(result.day).not.toBeNull();
    expect(result.day - expectedDriftDay).toBeLessThanOrEqual(4);
    expect(result.day - expectedDriftDay).toBeGreaterThanOrEqual(0);
  });

  // The mission's own DoD ("10-day RHR drift flagged within <=4 days") names RHR specifically;
  // HRV is noisier (population MAD 8 vs RHR's 3), so the CUSUM correctly takes a little longer
  // to clear the threshold on the identical -1.5/day slope. <=6 days is still fast detection —
  // the point of this pin is DIRECTION correctness and that detection happens at all, not the
  // exact day count, which the RHR test above already holds to the literal DoD number.
  it('flags a downward HRV drift with direction "down"', () => {
    const driftStartDay = REFERENCE_DAYS + 2;
    const run = generate({
      persona: 'sedentary', seed: 'w4-012:hrv-drift', startAt: T0, days: WINDOW_DAYS, sampleIntervalSec: 300,
      drift: { metric: 'hrv', startDay: driftStartDay, perDayBpm: -1.5 },
    });
    const series = dailySeries(vitalSamplesFrom(run, ['hrv']), { reduce: median, tzOffsetMinutes: run.meta.tzOffsetMinutes });
    const result = changePointDetect(series);
    const expectedDriftDay = localDayIndex(run.meta.startAtMs, run.meta.tzOffsetMinutes) + driftStartDay;

    expect(result.flagged).toBe(true);
    expect(result.direction).toBe('down');
    expect(result.day - expectedDriftDay).toBeLessThanOrEqual(6);
  });

  it('does NOT flag stationary AR(1) noise (no injected drift)', () => {
    const run = generate({
      persona: 'sedentary', seed: 'w4-012:stationary', startAt: T0, days: WINDOW_DAYS, sampleIntervalSec: 300,
    });
    const series = dailySeries(vitalSamplesFrom(run, ['restingHeartRate']), { reduce: median, tzOffsetMinutes: run.meta.tzOffsetMinutes });
    const result = changePointDetect(series);

    expect(result.flagged).toBe(false);
    expect(result.direction).toBeNull();
  });

  it('never flags with insufficient reference history, and never throws', () => {
    const short = [{ day: 0, value: 60 }, { day: 1, value: 62 }, { day: 2, value: 200 }];
    const result = changePointDetect(short);
    expect(result.flagged).toBe(false);
    expect(result.insufficientReference).toBe(true);
  });

  it('is finite and never throws on empty, null-ish or hostile input (S8)', () => {
    for (const input of [[], null, undefined, [{ day: NaN, value: 60 }], [{ day: 0, value: null }]]) {
      const result = changePointDetect(input);
      expect(result.flagged).toBe(false);
      expect(Number.isFinite(result.cPlus)).toBe(true);
      expect(Number.isFinite(result.cMinus)).toBe(true);
    }
  });

  it('the module never calls Date.now() or Math.random() (S9 grep guard)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../app/agents/runtime/physiology/dailyAnalysis'), 'utf8');
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/Math\.random\(\)/);
  });

  it('exports the §M.13 constants so tests pin the derivation, not a copy', () => {
    expect(CUSUM_K).toBe(0.5);
    expect(CUSUM_THRESHOLD).toBe(4);
    expect(MIN_REFERENCE_DAYS).toBeGreaterThanOrEqual(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('readinessComposite', () => {
  it('is high when recovery is high and fatigue is low', () => {
    const r = readinessComposite({
      recovery: { value: 0.9, mass: 0.8 },
      fatigue: { value: 0.1, mass: 0.8 },
    });
    expect(r.value).toBeGreaterThan(0.7);
    expect(r.mass).toBeGreaterThan(0);
  });

  it('is low when recovery is low and fatigue is high', () => {
    const r = readinessComposite({
      recovery: { value: 0.1, mass: 0.8 },
      fatigue: { value: 0.9, mass: 0.8 },
    });
    expect(r.value).toBeLessThan(0.3);
  });

  it('degrades to the neutral midpoint with zero mass when both axes are unevidenced', () => {
    const r = readinessComposite({ recovery: { value: 0.5, mass: 0 }, fatigue: { value: 0.5, mass: 0 } });
    expect(r.value).toBeCloseTo(0.5, 1);
    expect(r.mass).toBe(0);
  });

  it('never throws or returns NaN on missing/malformed axes', () => {
    for (const input of [{}, { recovery: null, fatigue: undefined }, { recovery: {}, fatigue: {} }]) {
      const r = readinessComposite(input);
      expect(Number.isFinite(r.value)).toBe(true);
      expect(Number.isFinite(r.mass)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('consolidate — the composed nightly output', () => {
  it('produces a well-shaped, bounded MorningState payload from a real persona replay', () => {
    const run = generate({
      persona: 'stressedProfessional', seed: 'w4-012:consolidate', startAt: T0, days: WINDOW_DAYS, sampleIntervalSec: 300,
    });
    const baselines = computeBaselineBlob({
      hrSamples: hrSamplesFrom(run), vitalSamples: vitalSamplesFrom(run, ['hrv']),
      now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    const priorNights = run.truth.daily.slice(0, -1).map((d) => ({ deep: d.sleep.deepMin, light: d.sleep.lightMin, rem: d.sleep.remMin }));
    const lastNight = run.truth.daily[run.truth.daily.length - 1].sleep;

    const out = consolidate({
      vitalSamples: vitalSamplesFrom(run, ['hrv', 'restingHeartRate']),
      priorNights,
      profile: {
        lastNightSleep: { deep: lastNight.deepMin, light: lastNight.lightMin, rem: lastNight.remMin },
        hrv: run.truth.daily[run.truth.daily.length - 1].hrv,
      },
      baselines,
      now: run.meta.endAtMs,
      tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });

    expect(out.readiness.value).toBeGreaterThanOrEqual(0);
    expect(out.readiness.value).toBeLessThanOrEqual(1);
    expect(out.readiness.confidence).toBeGreaterThanOrEqual(0);
    expect(out.sleepDebt.nights).toBeGreaterThan(0);
    expect(out.sleepDebt.ratio).toBeGreaterThanOrEqual(0);
    expect(out.sleepDebt.ratio).toBeLessThanOrEqual(1);
    expect(out.cusum.rhr).toHaveProperty('flagged');
    expect(out.cusum.hrv).toHaveProperty('flagged');
    // no injected drift in this run — a stationary series should not falsely flag
    expect(out.cusum.rhr.flagged).toBe(false);
  });

  it('carries zero raw samples / per-reading detail (zero-knowledge, §0.2.2)', () => {
    const run = generate({ persona: 'athlete', seed: 'w4-012:zk', startAt: T0, days: WINDOW_DAYS, sampleIntervalSec: 300 });
    const baselines = computeBaselineBlob({
      hrSamples: hrSamplesFrom(run), vitalSamples: vitalSamplesFrom(run, ['hrv']),
      now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    const out = consolidate({
      vitalSamples: vitalSamplesFrom(run, ['hrv', 'restingHeartRate']), priorNights: [],
      profile: {}, baselines, now: run.meta.endAtMs, tzOffsetMinutes: run.meta.tzOffsetMinutes,
    });
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/"recordedAt"/);
    expect(json).not.toMatch(/"activity"/);
  });

  it('never throws on a cold-start user with no history at all', () => {
    const out = consolidate({
      vitalSamples: [], priorNights: [], profile: {}, baselines: {}, now: T0, tzOffsetMinutes: 0,
    });
    expect(Number.isFinite(out.readiness.value)).toBe(true);
    expect(out.cusum.rhr.flagged).toBe(false);
    expect(out.cusum.hrv.flagged).toBe(false);
  });
});
