'use strict';

/**
 * W4-003 — A0 signal integrity: the PURE core.
 *
 * Two modules under test, both new:
 *   · app/agents/runtime/_shared/dto/telemetry.js   — the runtime's zod contract
 *   · app/agents/runtime/ingestion/anomalyFilter.js — Hampel -> slew -> Kalman (§M.1/M.2)
 *
 * The filter is driven by the W4-002 synthetic personas rather than by hand-written
 * fixtures wherever a claim is statistical, because the generator is the only thing in
 * this repo that carries GROUND TRUTH: `run.truth.samples` is the physiology, and
 * `run.socket.events` is that same physiology after the artifact injector has had a go
 * at it. Recovering the first from the second is the entire job of this module, so that
 * is what gets asserted — not a mock's idea of a heart rate.
 *
 * Circularity guard (§R.10): the convergence claims are re-run against a HOLDOUT persona
 * whose noise family is student-t rather than the Ornstein-Uhlenbeck the constants were
 * derived from, so a filter tuned to its own test fixture cannot pass quietly.
 */

const fc = require('fast-check');

const { generate } = require('../sim/generator');
const { PERSONAS, HOLDOUT_PERSONAS } = require('../sim/personas');
const { HR_MIN, HR_MAX } = require('../app/services/wearable/hrRange');
const { measure, expectWithinBudget } = require('../jest/perfBudget');

const telemetry = require('../app/agents/runtime/_shared/dto/telemetry');
const filter = require('../app/agents/runtime/ingestion/anomalyFilter');

const {
  createFilterState,
  filterReading,
  summarizeFilterState,
  METRIC_CONFIGS,
  REJECT_REASONS,
  MEASUREMENT_R,
  Q_LEVEL,
  Q_ACCEL,
  SLEW_MAX_BPM_PER_SEC,
  HAMPEL_WINDOW,
  HAMPEL_SPAN_MS,
  HAMPEL_MIN_SAMPLES,
  HAMPEL_SIGMAS,
  MAD_TO_SIGMA,
  INNOVATION_GATE_SIGMAS,
  REJECT_CONFIDENCE_FACTOR,
  DEGRADED_CONFIDENCE,
  DEGRADED_RUN_MS,
  DEGRADED_MODE,
  FUTURE_TOLERANCE_MS,
  MAX_AGE_MS,
  RESEED_AFTER_CONSECUTIVE_REJECTS,
  FLATLINE_MIN_RUN,
  FLATLINE_SPAN_MS,
  ANOMALY_FILTER_VERSION,
} = filter;

// A fixed instant for every test that needs one. S9: the engine never reads the clock,
// so `now` is always ours to choose and every run is reproducible.
const NOW = Date.parse('2026-08-19T12:00:00.000Z');

/** Feed one heart-rate reading through the filter, threading state. */
function step(state, value, atMs, opts = {}) {
  return filterReading(state, { value, atMs, ...opts }, { now: opts.now ?? NOW });
}

/** Drive a whole series, returning every result plus the final state. */
function drive(readings, { now = NOW, state = createFilterState('heartRate') } = {}) {
  const results = [];
  let s = state;
  for (const r of readings) {
    const out = filterReading(s, r, { now });
    s = out.state;
    results.push(out.result);
  }
  return { results, state: s };
}

/**
 * A clean, evenly spaced series centred on `value` — the "nothing is wrong" fixture.
 *
 * Deliberately DITHERED by a repeating +/-0.5 bpm, because a bit-identical series is not a
 * clean signal, it is a stuck sensor: real HR at a live cadence never repeats the same
 * integer forty times running, and the filter is supposed to notice. `heldSeries` below is
 * the fixture for when that IS the thing under test.
 */
function flatSeries(value, { n = 20, stepMs = 5000, startMs = NOW - 20 * 60_000 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    value: value + ((i % 3) - 1) * 0.5,
    atMs: startMs + i * stepMs,
  }));
}

/** A bit-identical series — a stuck sensor, or an integer-quantised resting wrist. */
function heldSeries(value, { n = 20, stepMs = 5000, startMs = NOW - 20 * 60_000 } = {}) {
  return Array.from({ length: n }, (_, i) => ({ value, atMs: startMs + i * stepMs }));
}

/** Socket events -> filter readings, preserving emission order (and duplicates). */
function readingsFromRun(run) {
  return run.socket.events.map((e) => ({
    value: e.payload.raw.heartRate,
    atMs: e.atMs,
    activity: e.payload.raw.activityType,
  }));
}

function median(xs) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(xs, q) {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[idx];
}

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · telemetry DTO (_shared/dto/telemetry.js)', () => {
  const cleanFixture = () => ({
    v: telemetry.TELEMETRY_DTO_VERSION,
    userId: '507f1f77bcf86cd799439011',
    metric: 'heartRate',
    value: 72.4,
    trend: 0.0125,
    confidence: 0.83,
    activity: 'resting',
    source: 'garmin',
    recordedAt: new Date(NOW),
  });

  it('accepts a well-formed TelemetryClean and returns the parsed value', () => {
    const parsed = telemetry.TelemetryCleanSchema.parse(cleanFixture());
    expect(parsed.metric).toBe('heartRate');
    expect(parsed.value).toBeCloseTo(72.4, 6);
    expect(parsed.recordedAt).toBeInstanceOf(Date);
  });

  it('carries a schema version so a persisted DTO can be migrated later (S15)', () => {
    expect(telemetry.TELEMETRY_DTO_VERSION).toBe(1);
    const parsed = telemetry.TelemetryCleanSchema.parse(cleanFixture());
    expect(parsed.v).toBe(1);
    // The version is not optional — an unversioned blob must not slip through.
    const { v, ...rest } = cleanFixture();
    expect(v).toBe(1);
    expect(telemetry.TelemetryCleanSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ['a NaN value', { value: NaN }],
    ['an infinite value', { value: Infinity }],
    ['a string value', { value: '72' }],
    ['an unknown metric', { metric: 'vibes' }],
    ['an unknown source', { source: 'fitbit' }],
    ['an unknown activity', { activity: 'levitating' }],
    ['a confidence above 1', { confidence: 1.2 }],
    ['a negative confidence', { confidence: -0.1 }],
    ['a non-Date recordedAt', { recordedAt: '2026-08-19' }],
    ['an empty userId', { userId: '' }],
  ])('rejects %s', (_label, patch) => {
    const res = telemetry.TelemetryCleanSchema.safeParse({ ...cleanFixture(), ...patch });
    expect(res.success).toBe(false);
  });

  it('allows a null activity — an unlabelled reading is honest, a fabricated label is not', () => {
    const res = telemetry.TelemetryCleanSchema.safeParse({ ...cleanFixture(), activity: null });
    expect(res.success).toBe(true);
  });

  it('bounds tzOffsetMinutes to [-840, 720] on the raw ingest shape (S6)', () => {
    const raw = {
      v: telemetry.TELEMETRY_DTO_VERSION,
      userId: '507f1f77bcf86cd799439011',
      metric: 'heartRate',
      value: 72,
      source: 'garmin',
      recordedAt: new Date(NOW),
    };
    expect(telemetry.TelemetryRawSchema.safeParse({ ...raw, tzOffsetMinutes: -840 }).success).toBe(true);
    expect(telemetry.TelemetryRawSchema.safeParse({ ...raw, tzOffsetMinutes: 720 }).success).toBe(true);
    expect(telemetry.TelemetryRawSchema.safeParse({ ...raw, tzOffsetMinutes: -841 }).success).toBe(false);
    expect(telemetry.TelemetryRawSchema.safeParse({ ...raw, tzOffsetMinutes: 721 }).success).toBe(false);
    expect(telemetry.TelemetryRawSchema.safeParse({ ...raw, tzOffsetMinutes: 5.5 }).success).toBe(false);
    // Absent is fine — the field is additive and every shipped client predates it.
    expect(telemetry.TelemetryRawSchema.safeParse(raw).success).toBe(true);
    expect(telemetry.TZ_OFFSET_MIN).toBe(-840);
    expect(telemetry.TZ_OFFSET_MAX).toBe(720);
  });

  it('shares its activity/source vocabulary with BiometricLog — a drift guard, not a hope', () => {
    // The DTO deliberately does NOT import the mongoose model (a pure contract must not drag
    // a database driver into the runtime agents), so the two vocabularies are pinned equal here.
    const BiometricLog = require('../app/models/BiometricLog');
    const schemaActivities = BiometricLog.schema.path('activity').enumValues;
    const schemaSources = BiometricLog.schema.path('source').enumValues;
    expect([...telemetry.ACTIVITIES].sort()).toEqual([...schemaActivities].sort());
    expect([...telemetry.SOURCES].sort()).toEqual([...schemaSources].sort());
  });

  it('covers every metric W4-004 will write to VitalSample, so the contract does not need a v2 next task', () => {
    expect([...telemetry.METRICS].sort()).toEqual([
      'bodyBattery', 'heartRate', 'hrv', 'respirationRate',
      'restingHeartRate', 'spO2', 'stressLevel',
    ]);
  });

  it('toTelemetryClean assembles a filter result into a validated DTO', () => {
    const { results } = drive(flatSeries(70));
    const last = results[results.length - 1];
    const dto = telemetry.toTelemetryClean({
      userId: '507f1f77bcf86cd799439011',
      metric: 'heartRate',
      source: 'garmin',
      activity: 'resting',
      recordedAt: new Date(NOW),
    }, last);
    expect(dto.v).toBe(telemetry.TELEMETRY_DTO_VERSION);
    expect(dto.value).toBeCloseTo(last.level, 6);
    expect(dto.trend).toBeCloseTo(last.trend, 6);
    expect(dto.confidence).toBeCloseTo(last.confidence, 6);
  });

  it('toTelemetryClean throws rather than emitting an invalid DTO', () => {
    expect(() => telemetry.toTelemetryClean({
      userId: '507f1f77bcf86cd799439011',
      metric: 'heartRate',
      source: 'fitbit',
      activity: 'resting',
      recordedAt: new Date(NOW),
    }, { level: 70, trend: 0, confidence: 0.5 })).toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · anomalyFilter — contract, purity and required parameters', () => {
  it('is versioned and exposes a closed reject vocabulary', () => {
    expect(ANOMALY_FILTER_VERSION).toBe(1);
    expect([...REJECT_REASONS].sort()).toEqual([
      'future-timestamp', 'hampel', 'innovation', 'non-monotonic-time',
      'not-a-number', 'out-of-range', 'slew', 'stale-timestamp',
    ]);
  });

  it('never mutates the state it is given — the caller owns it (PURE)', () => {
    const s0 = createFilterState('heartRate');
    const snapshot = JSON.stringify(s0);
    const { state: s1 } = step(s0, 70, NOW - 60_000);
    expect(JSON.stringify(s0)).toBe(snapshot);
    expect(s1).not.toBe(s0);
    const snap1 = JSON.stringify(s1);
    step(s1, 71, NOW - 55_000);
    expect(JSON.stringify(s1)).toBe(snap1);
  });

  it('requires `now` — no engine may read the clock (S9)', () => {
    const s = createFilterState('heartRate');
    expect(() => filterReading(s, { value: 70, atMs: NOW }, {})).toThrow(TypeError);
    expect(() => filterReading(s, { value: 70, atMs: NOW })).toThrow(TypeError);
    expect(() => filterReading(s, { value: 70, atMs: NOW }, { now: NaN })).toThrow(TypeError);
  });

  it('rejects an unknown metric at state construction rather than silently defaulting', () => {
    expect(() => createFilterState('vibes')).toThrow(RangeError);
    expect(() => createFilterState()).toThrow(RangeError);
    expect(Object.keys(METRIC_CONFIGS)).toContain('heartRate');
  });

  it('accepts only known, non-negative config overrides — a mistyped knob throws', () => {
    expect(createFilterState('heartRate').config).toBeNull();
    expect(createFilterState('heartRate', { qLevel: 0 }).config).toEqual({ qLevel: 0 });
    expect(() => createFilterState('heartRate', { qlevel: 0 })).toThrow(RangeError);
    expect(() => createFilterState('heartRate', { wanderSigma: 3 })).toThrow(RangeError);
    expect(() => createFilterState('heartRate', { qLevel: -1 })).toThrow(RangeError);
    expect(() => createFilterState('heartRate', { qLevel: NaN })).toThrow(RangeError);
    expect(() => createFilterState('heartRate', 7)).toThrow(TypeError);
  });

  it('requires a finite reading timestamp', () => {
    const s = createFilterState('heartRate');
    expect(() => filterReading(s, { value: 70, atMs: 'yesterday' }, { now: NOW })).toThrow(TypeError);
    expect(() => filterReading(s, { value: 70 }, { now: NOW })).toThrow(TypeError);
  });

  it('derives its heart-rate range from the ONE shared predicate (D9), not a fourth copy', () => {
    expect(METRIC_CONFIGS.heartRate.min).toBe(HR_MIN);
    expect(METRIC_CONFIGS.heartRate.max).toBe(HR_MAX);
  });

  it('pins the derived Kalman constants to their stated physical source', () => {
    const cfg = METRIC_CONFIGS.heartRate;
    // q_level = 2*sigma^2/tau — the diffusion of the short-term HR wander envelope.
    expect(Q_LEVEL).toBeCloseTo((2 * cfg.wanderSigma ** 2) / cfg.wanderTauSec, 9);
    // q_accel = 3*q_level/T*^2 — at the trend-response horizon the trend channel contributes
    // exactly as much level uncertainty as the wander channel. One envelope, both constants.
    expect(Q_ACCEL).toBeCloseTo((3 * Q_LEVEL) / cfg.trendResponseSec ** 2, 12);
    expect(MEASUREMENT_R).toBe(9); // (3 bpm)^2 wrist PPG noise, §M.2
    expect(MAD_TO_SIGMA).toBeCloseTo(1.4826, 6);
    expect(HAMPEL_SIGMAS).toBe(3);
    expect(INNOVATION_GATE_SIGMAS).toBe(3);
    expect(SLEW_MAX_BPM_PER_SEC).toBe(8);
    expect(REJECT_CONFIDENCE_FACTOR).toBeCloseTo(0.7, 9);
    expect(DEGRADED_CONFIDENCE).toBeCloseTo(0.3, 9);
    expect(DEGRADED_RUN_MS).toBe(60_000);
    expect(HAMPEL_WINDOW).toBe(7);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · range and timestamp gates (S6)', () => {
  it('rejects a heart rate outside the shared physiological range', () => {
    const s = createFilterState('heartRate');
    expect(step(s, HR_MIN - 1, NOW - 1000).result).toMatchObject({ accepted: false, reason: 'out-of-range' });
    expect(step(s, HR_MAX + 1, NOW - 1000).result).toMatchObject({ accepted: false, reason: 'out-of-range' });
    expect(step(s, 0, NOW - 1000).result).toMatchObject({ accepted: false, reason: 'out-of-range' });
    expect(step(s, HR_MIN, NOW - 1000).result.accepted).toBe(true);
    expect(step(s, HR_MAX, NOW - 1000).result.accepted).toBe(true);
  });

  it.each([[null], [undefined], [NaN], [Infinity], [-Infinity], ['72'], [{}]])(
    'rejects a non-numeric reading (%p) as not-a-number, never as a heart rate', (bad) => {
      const s = createFilterState('heartRate');
      const { result } = step(s, bad, NOW - 1000);
      expect(result.accepted).toBe(false);
      expect(result.reason).toBe('not-a-number');
    },
  );

  it('rejects a reading dated more than 5 minutes in the future (the Garmin-backfill trap)', () => {
    const s = createFilterState('heartRate');
    expect(step(s, 70, NOW + FUTURE_TOLERANCE_MS - 1000).result.accepted).toBe(true);
    expect(step(s, 70, NOW + FUTURE_TOLERANCE_MS + 1000).result)
      .toMatchObject({ accepted: false, reason: 'future-timestamp' });
    expect(step(s, 70, NOW + 30 * 24 * 3600_000).result)
      .toMatchObject({ accepted: false, reason: 'future-timestamp' });
  });

  it('rejects a reading older than the retention window', () => {
    const s = createFilterState('heartRate');
    expect(step(s, 70, NOW - MAX_AGE_MS + 3600_000).result.accepted).toBe(true);
    expect(step(s, 70, NOW - MAX_AGE_MS - 3600_000).result)
      .toMatchObject({ accepted: false, reason: 'stale-timestamp' });
  });

  it('rejects a duplicate/backwards timestamp instead of dividing by a zero interval (S8)', () => {
    const s0 = createFilterState('heartRate');
    const { state: s1 } = step(s0, 70, NOW - 60_000);
    const dup = step(s1, 71, NOW - 60_000);
    expect(dup.result).toMatchObject({ accepted: false, reason: 'non-monotonic-time' });
    expect(Number.isFinite(dup.result.level)).toBe(true);
    expect(Number.isFinite(dup.result.confidence)).toBe(true);
    const back = step(s1, 71, NOW - 61_000);
    expect(back.result).toMatchObject({ accepted: false, reason: 'non-monotonic-time' });
  });

  it('a rejected reading still reports the last good level — it propagates, it never blanks', () => {
    const { state } = drive(flatSeries(70));
    const before = summarizeFilterState(state).level;
    const { result } = step(state, 500, NOW);
    expect(result.accepted).toBe(false);
    expect(result.level).toBeCloseTo(before, 6);
    expect(result.level).toBeGreaterThan(60);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · Hampel outlier gate (§M.1)', () => {
  it('rejects a lone spike inside a fast stream', () => {
    const series = flatSeries(70, { n: 10, stepMs: 5000 });
    const { state } = drive(series);
    const nextAt = series[series.length - 1].atMs + 5000;
    const { result } = step(state, 140, nextAt);
    expect(result.accepted).toBe(false);
    expect(['hampel', 'slew', 'innovation']).toContain(result.reason);
  });

  it('catches a MODERATE outlier that both other gates wave through', () => {
    // Hampel's unique region, found by scanning rather than assumed: at a ~10 s cadence a
    // +12 bpm sample is only 1.2 bpm/s (the slew gate is a rate test and says nothing) and
    // sits inside 3 sigma of the predictive distribution (the innovation gate says nothing
    // either) — but it is four times the median absolute deviation of its own neighbours.
    // That is the whole point of a model-free median test: the median of seven neighbours is
    // a far lower-variance reference than the model's own forecast, so it is TIGHTER than
    // the model-based gate for moderate outliers, not merely a backup for it.
    //
    // Rejecting a single such reading is safe because it is not permanent: if the body really
    // did move there, the next readings confirm it, the window median follows within four
    // samples, and the reseed hatch adopts it — which is the pin two tests below.
    const series = flatSeries(70, { n: 25, stepMs: 10_000, startMs: NOW - 60 * 60_000 });
    const { state } = drive(series);
    const at = series[series.length - 1].atMs + 10_000;
    expect(step(state, 82, at).result).toMatchObject({ accepted: false, reason: 'hampel' });
  });

  it('abstains when the in-span window is too small — a 5-minute watch ping cannot support an outlier test', () => {
    // Watch lane: pings 300 s apart, so the 60 s Hampel span never holds more than the
    // reading itself. A real climb must NOT be discarded as an outlier just because the
    // cadence is coarse; that would be the filter inventing physiology it cannot see.
    const s0 = createFilterState('heartRate');
    let s = s0;
    let last;
    for (let i = 0; i < 6; i++) {
      const out = filterReading(s, { value: 62, atMs: NOW - (10 - i) * 300_000 }, { now: NOW });
      s = out.state;
      last = out.result;
    }
    expect(last.accepted).toBe(true);
    const climb = filterReading(s, { value: 108, atMs: NOW - 4 * 300_000 }, { now: NOW });
    expect(climb.result.reason).not.toBe('hampel');
    expect(climb.result.accepted).toBe(true);
    expect(HAMPEL_MIN_SAMPLES).toBeGreaterThan(1);
    expect(HAMPEL_SPAN_MS).toBe(60_000);
  });

  it('abstains on a THIN window rather than calling ordinary physiology an outlier', () => {
    // The abstention has teeth in the middle cadences, not just on the watch lane. At 20-25 s
    // the 60 s span holds three samples, and three samples put the scale floor at 3 bpm — so
    // an un-abstaining Hampel rejects any move over 9 bpm. A +10 bpm rise across 20 s is
    // 0.5 bpm/s: standing up, climbing a flight of stairs. Ordinary physiology.
    //
    // Measured both ways: with the abstention this is accepted, and with HAMPEL_MIN_SAMPLES
    // lowered to 1 the same reading comes back 'hampel'. Refusing to answer on thin evidence
    // is a decision the filter makes, not an accident of the window size.
    const series = flatSeries(70, { n: 25, stepMs: 20_000, startMs: NOW - 60 * 60_000 });
    const { state } = drive(series);
    expect(state.window.length).toBeLessThan(HAMPEL_MIN_SAMPLES);
    expect(state.window.length).toBeGreaterThan(1);
    const at = series[series.length - 1].atMs + 20_000;
    const { result } = step(state, 80, at);
    expect(result.accepted).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('does not reject everything when the window is a flatline (MAD = 0 would make any deviation infinite)', () => {
    // Integer-quantised resting HR produces MAD = 0 constantly. Without a scale floor the
    // Hampel threshold collapses to zero and the filter rejects the entire signal.
    const series = heldSeries(60, { n: 12, stepMs: 5000 });
    const { state } = drive(series);
    const nextAt = series[series.length - 1].atMs + 5000;
    const { result } = step(state, 62, nextAt);
    expect(result.accepted).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('keeps the raw window fed on rejection, so a genuine step is adopted and a lone spike never is', () => {
    // The classic Hampel deadlock: if rejected samples are withheld from the window, the
    // median never moves and a real step change is locked out forever.
    const series = flatSeries(65, { n: 12, stepMs: 5000 });
    let { state } = drive(series);
    let at = series[series.length - 1].atMs;

    // A single spike: rejected, and the filter's level stays put.
    at += 5000;
    const spike = step(state, 120, at);
    expect(spike.result.accepted).toBe(false);
    expect(spike.result.level).toBeLessThan(75);
    state = spike.state;

    // A SUSTAINED step to the same value: adopted within a bounded number of readings.
    let acceptedAt = null;
    for (let i = 0; i < 12; i++) {
      at += 5000;
      const out = step(state, 120, at);
      state = out.state;
      if (out.result.accepted && acceptedAt === null) acceptedAt = i + 1;
    }
    expect(acceptedAt).not.toBeNull();
    expect(acceptedAt).toBeLessThanOrEqual(RESEED_AFTER_CONSECUTIVE_REJECTS + 2);
    expect(summarizeFilterState(state).level).toBeGreaterThan(110);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · slew gate (§M.1)', () => {
  it('rejects a change faster than the physiological slew ceiling', () => {
    const series = flatSeries(70, { n: 8, stepMs: 1000 });
    const { state } = drive(series);
    const at = series[series.length - 1].atMs + 1000;
    // +20 bpm in 1 s = 20 bpm/s, far above the 8 bpm/s ceiling. Named exactly, not as one of
    // three possibilities: the model-free gates run first precisely so a wrong model cannot
    // decide this, and an assertion that accepts 'innovation' here would not notice if it did.
    const { result } = step(state, 90, at);
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('slew');
  });

  it('is a RATE gate, not a delta gate — the same jump over a long interval is not a slew artifact', () => {
    const series = flatSeries(70, { n: 8, stepMs: 60_000, startMs: NOW - 40 * 60_000 });
    const { state } = drive(series);
    const at = series[series.length - 1].atMs + 60_000;
    const { result } = step(state, 90, at); // 20 bpm over 60 s = 0.33 bpm/s
    expect(result.reason).not.toBe('slew');
  });

  it('is the ONLY guard on the first readings after a gap, when Hampel has abstained', () => {
    // The case that makes the slew gate load-bearing rather than redundant. After a silence
    // the Hampel window has aged out (so it abstains) and the covariance has grown (so the
    // innovation gate is wide) — a jump that is physiologically impossible but statistically
    // unremarkable passes both. 8 bpm/s is a claim about a sinoatrial node, and this is where
    // that claim is the only thing standing.
    let { state } = drive(flatSeries(70, { n: 20, stepMs: 5000, startMs: NOW - 60 * 60_000 }));
    let at = NOW - 60 * 60_000 + 20 * 5000 + 600_000; // ten minutes of silence
    const resumed = step(state, 70, at);
    expect(resumed.result.accepted).toBe(true);
    expect(resumed.state.window.length).toBeLessThan(HAMPEL_MIN_SAMPLES);
    state = resumed.state;

    // +10 bpm in 1 s = 10 bpm/s: over the ceiling, but well inside 3 sigma of a freshly
    // widened covariance, so nothing else here would object to it.
    expect(step(state, 80, at + 1000).result).toMatchObject({ accepted: false, reason: 'slew' });
    // The control: the SAME 10 bpm over 5 s is 2 bpm/s, and is ordinary physiology.
    expect(step(state, 80, at + 5000).result.accepted).toBe(true);
  });

  it('measures slew from the last ACCEPTED reading, so a rejected spike cannot poison the reference', () => {
    const series = flatSeries(70, { n: 8, stepMs: 1000 });
    let { state } = drive(series);
    let at = series[series.length - 1].atMs;
    at += 1000;
    const spike = step(state, 200, at);
    expect(spike.result.accepted).toBe(false);
    state = spike.state;
    // The very next sample is ordinary. Measured against the 200 bpm spike it would look like
    // a -130 bpm/s collapse; measured against the last accepted 70 it is nothing at all.
    at += 1000;
    const ordinary = step(state, 71, at);
    expect(ordinary.result.accepted).toBe(true);
    expect(ordinary.result.reason).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · Kalman core (§M.2)', () => {
  it('adapts its gain to the sampling cadence — heavy smoothing live, near pass-through on the watch lane', () => {
    // The same filter, the same constants, two cadences. This is what the irregular-dt
    // formulation buys: at 5 s consecutive samples carry shared information and are worth
    // averaging; at 300 s they do not and averaging them would invent a body that is not there.
    const fastIn = flatSeries(60, { n: 30, stepMs: 5000 });
    const slowIn = flatSeries(60, { n: 30, stepMs: 300_000, startMs: NOW - 200 * 300_000 });
    const fast = drive(fastIn);
    const slow = drive(slowIn);

    // Measured as the TRUE gain — how far the estimate moves toward a fresh observation —
    // rather than against a nominal 60, so the fixture's dither cannot flatter the number.
    const gainOf = ({ state }, atMs, dtMs) => {
      const before = summarizeFilterState(state).level;
      const after = filterReading(state, { value: 68, atMs: atMs + dtMs }, { now: NOW }).result.level;
      return (after - before) / (68 - before);
    };
    const fastGain = gainOf(fast, fastIn[fastIn.length - 1].atMs, 5000);
    const slowGain = gainOf(slow, slowIn[slowIn.length - 1].atMs, 300_000);

    expect(fastGain).toBeLessThan(0.45);
    expect(slowGain).toBeGreaterThan(0.9);
    expect(slowGain).toBeGreaterThan(fastGain);
  });

  it('estimates a real trend during a ramp and returns to flat afterwards', () => {
    const start = NOW - 30 * 60_000;
    const ramp = [];
    for (let i = 0; i < 60; i++) ramp.push({ value: 60 + i * 0.5, atMs: start + i * 5000 }); // 0.1 bpm/s
    const { results, state } = drive(ramp);
    const last = results[results.length - 1];
    expect(last.trend).toBeGreaterThan(0.05);
    expect(last.trend).toBeLessThan(0.16);

    let s = state;
    let at = start + 60 * 5000;
    for (let i = 0; i < 90; i++) { at += 5000; s = filterReading(s, { value: 89.5, atMs: at }, { now: NOW }).state; }
    expect(Math.abs(summarizeFilterState(s).trend)).toBeLessThan(0.03);
  });

  it('gates a reading whose innovation exceeds 3 sigma without discarding the state', () => {
    const series = flatSeries(70, { n: 25, stepMs: 5000 });
    const { state } = drive(series);
    const at = series[series.length - 1].atMs + 5000;
    const { result, state: after } = step(state, 200, at);
    expect(result.accepted).toBe(false);
    expect(summarizeFilterState(after).level).toBeCloseTo(summarizeFilterState(state).level, 3);
  });

  it('keeps the covariance finite and positive over a long irregular run (S8)', () => {
    const start = NOW - 40 * 3600_000; // the gap schedule below spans ~18 h; stay in the past
    let s = createFilterState('heartRate');
    let at = start;
    const gaps = [1000, 5000, 250, 60_000, 900_000, 3000];
    for (let i = 0; i < 400; i++) {
      at += gaps[i % gaps.length];
      s = filterReading(s, { value: 60 + (i % 17), atMs: at }, { now: NOW }).state;
    }
    const sum = summarizeFilterState(s);
    expect(Number.isFinite(sum.level)).toBe(true);
    expect(Number.isFinite(sum.trend)).toBe(true);
    expect(sum.levelVariance).toBeGreaterThan(0);
    expect(sum.levelVariance).toBeLessThan(1e6);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · confidence and degraded mode', () => {
  it('never reports full confidence from a single reading', () => {
    const { result } = step(createFilterState('heartRate'), 70, NOW - 1000);
    expect(result.accepted).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.95);
  });

  it('grows more confident as the estimate matures on a clean stream', () => {
    const { results } = drive(flatSeries(70, { n: 40, stepMs: 5000, startMs: NOW - 60 * 60_000 }));
    expect(results[39].confidence).toBeGreaterThan(results[0].confidence);
    expect(results[39].confidence).toBeLessThanOrEqual(1);
  });

  it('is LESS confident just after a long silence than mid-stream, even though both readings are clean', () => {
    // The maturity term, and the only thing that pins it. Both readings below have a near-zero
    // innovation, so exp(-y^2/2S) says "unsurprising" for both; what differs is how well the
    // LEVEL is determined — after a gap the estimate rests on one fresh sample, mid-stream on
    // several. A filter that reported the same confidence for both would be telling the
    // downstream engines that a cold restart is as trustworthy as a settled track.
    const series = flatSeries(70, { n: 40, stepMs: 5000, startMs: NOW - 90 * 60_000 });
    const { results, state } = drive(series);
    const midStream = results[results.length - 1].confidence;

    const at = series[series.length - 1].atMs + 45 * 60_000; // 45 minutes of silence
    const afterGap = filterReading(state, { value: 70, atMs: at }, { now: NOW }).result;
    expect(afterGap.accepted).toBe(true);
    expect(afterGap.confidence).toBeLessThan(midStream);
    expect(afterGap.confidence).toBeGreaterThan(0.5);
  });

  it('decays confidence geometrically while it is flying blind on rejections', () => {
    const series = flatSeries(70, { n: 20, stepMs: 5000 });
    let { state, results } = drive(series);
    let at = series[series.length - 1].atMs;
    let prev = results[results.length - 1].confidence;
    for (let i = 0; i < 4; i++) {
      at += 5000;
      const out = step(state, 260, at); // out-of-range: the filter learns nothing
      expect(out.result.accepted).toBe(false);
      // 4dp, not 6: the filter rounds its confidence on purpose, so the geometric series
      // is the rounded one. Asserting 6dp here would be asserting an artefact of floats.
      expect(out.result.confidence).toBeCloseTo(prev * REJECT_CONFIDENCE_FACTOR, 4);
      prev = out.result.confidence;
      state = out.state;
    }
  });

  it('flags degraded mood-only after a sustained low-confidence run, and never before', () => {
    const series = flatSeries(70, { n: 20, stepMs: 5000 });
    let { state } = drive(series);
    let at = series[series.length - 1].atMs;
    let flaggedAtMs = null;
    const lowStartMs = null;
    let firstLowAt = null;

    for (let i = 0; i < 60; i++) {
      at += 5000;
      const out = step(state, 0, at); // sensor off the wrist: a stream of zeroes
      state = out.state;
      if (out.result.confidence < DEGRADED_CONFIDENCE && firstLowAt === null) firstLowAt = at;
      if (out.result.degraded && flaggedAtMs === null) flaggedAtMs = at;
    }
    expect(lowStartMs).toBeNull();
    expect(firstLowAt).not.toBeNull();
    expect(flaggedAtMs).not.toBeNull();
    // The flag is a RUN condition: it may not fire before 60 s of sub-threshold confidence.
    expect(flaggedAtMs - firstLowAt).toBeGreaterThan(DEGRADED_RUN_MS);
    expect(summarizeFilterState(state).degraded).toBe(DEGRADED_MODE);
  });

  it('clears degraded mode once clean data returns — the flag is a state, not a scar', () => {
    const series = flatSeries(70, { n: 20, stepMs: 5000 });
    let { state } = drive(series);
    let at = series[series.length - 1].atMs;
    for (let i = 0; i < 60; i++) { at += 5000; state = step(state, 0, at).state; }
    expect(summarizeFilterState(state).degraded).toBe(DEGRADED_MODE);

    let cleared = false;
    for (let i = 0; i < 40; i++) {
      at += 5000;
      // A REAL recovery signal: a wrist that reports the identical integer forty times
      // running has not recovered, it has frozen, and the filter is right to keep saying so.
      const out = step(state, 70 + ((i % 3) - 1) * 0.5, at);
      state = out.state;
      if (!out.result.degraded) cleared = true;
    }
    expect(cleared).toBe(true);
    expect(summarizeFilterState(state).degraded).toBeNull();
  });

  it('de-weights a stuck sensor instead of trusting it more (a flatline has y = 0 by construction)', () => {
    // A perfectly repeating value produces zero innovation, which without a stuck-sensor term
    // would drive confidence UP exactly when the signal has stopped carrying information.
    const startMs = NOW - 3 * 3600_000;
    const held = Array.from({ length: 14 }, (_, i) => ({ value: 66, atMs: startMs + i * 60_000 }));
    const { results } = drive(held);
    const flagged = results.filter((r) => r.flags.includes('flatline'));
    expect(flagged.length).toBeGreaterThan(0);
    expect(results[results.length - 1].confidence).toBeLessThan(results[FLATLINE_MIN_RUN].confidence);
    // Derived, not chosen: a value held past the wander's own correlation time has outlived
    // the process that should be moving it.
    expect(FLATLINE_SPAN_MS).toBe(METRIC_CONFIGS.heartRate.wanderTauSec * 1000);
  });

  it('does NOT call ordinary integer-quantised repeats at high cadence a flatline', () => {
    // Six identical readings one second apart is what a resting wrist looks like, not a fault.
    const held = Array.from({ length: 6 }, (_, i) => ({ value: 58, atMs: NOW - 60_000 + i * 1000 }));
    const { results } = drive(held);
    expect(results.every((r) => !r.flags.includes('flatline'))).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
/**
 * TWO cadences, because the artifact classes are not all detectable at one.
 *
 * This is a real property of the problem, not a convenience: the Hampel window spans 60 s,
 * so it only holds enough samples to run at a LIVE cadence, while the generator's flatline
 * runs are 3-7 samples long and only outlive the 165 s wander-correlation time at a COARSE
 * one. A single fixture would have to fudge one of the two, so both are run and the coarse
 * lane's genuine blind spot is pinned as a measurement rather than hidden.
 */
function artifactFixture(sampleIntervalSec) {
  const run = generate({
    persona: 'sedentary', seed: 'w4-003-artifacts', startAt: NOW - 24 * 3600_000,
    days: 1, sampleIntervalSec,
  });
  const readings = readingsFromRun(run);
  const { results } = drive(readings, { now: run.meta.endAtMs });
  const byAt = new Map();
  readings.forEach((r, i) => {
    if (!byAt.has(r.atMs)) byAt.set(r.atMs, []);
    byAt.get(r.atMs).push(results[i]);
  });
  const socketArtifacts = run.artifacts.filter((a) => a.lane === 'socket');
  return {
    run, readings, results, byAt,
    ofKind: (kind) => socketArtifacts.filter((a) => a.kind === kind),
    caughtRate: (kind) => {
      const list = socketArtifacts.filter((a) => a.kind === kind);
      const caught = list.filter((a) => (byAt.get(a.emittedAtMs) || []).some((r) => !r.accepted));
      return { total: list.length, caught: caught.length, rate: caught.length / list.length };
    },
  };
}

describe('W4-003 · persona replay — every injected artifact class (hard DoD)', () => {
  const LIVE_INTERVAL_SEC = 10;
  const live = artifactFixture(LIVE_INTERVAL_SEC);
  const coarse = artifactFixture(60);
  const { readings, results, byAt, ofKind } = coarse;

  it('the fixture actually contains every artifact class (guarding the guard)', () => {
    for (const kind of ['zero', 'doubleCount', 'spike', 'dropout',
      'timestampDuplicate', 'timestampJitter', 'futureTimestamp', 'flatline']) {
      expect(ofKind(kind).length).toBeGreaterThan(0);
    }
  });

  it('zero readings (sensor off the wrist) are rejected out-of-range', () => {
    for (const a of ofKind('zero')) {
      const hits = byAt.get(a.emittedAtMs) || [];
      expect(hits.some((r) => !r.accepted && r.reason === 'out-of-range')).toBe(true);
    }
  });

  it('double-counted beats are rejected — by the range gate above 110 bpm, statistically below it', () => {
    let inRange = 0;
    for (const a of ofKind('doubleCount')) {
      const hits = byAt.get(a.emittedAtMs) || [];
      const rejected = hits.some((r) => !r.accepted);
      if (a.emittedHr <= HR_MAX) inRange += 1;
      expect(rejected).toBe(true);
    }
    expect(inRange).toBeGreaterThan(0); // the class is genuinely exercising the statistics
  });

  it('spikes deliberately kept inside the physiological range are caught at a live cadence', () => {
    const spike = live.caughtRate('spike');
    expect(spike.total).toBeGreaterThan(20);
    expect(spike.rate).toBe(1);
    // The same class on the same persona, all the way down to a 1-in-3600 pass rate:
    expect(live.caughtRate('doubleCount').rate).toBe(1);
  });

  it('and at a COARSE cadence some of them are NOT — measured, because it is a real limit', () => {
    // At one sample a minute the Hampel window holds a single reading and abstains, so a lone
    // +35 bpm sample is left to the innovation gate alone — and a body genuinely CAN climb
    // 35 bpm in a minute (0.58 bpm/s, well inside the slew ceiling). The filter declining to
    // call that an artifact is correct behaviour, not a miss to be tuned away; a threshold
    // tight enough to catch it here would reject real activations on the watch lane. W4-009's
    // state-transition work is what closes this, with dwell rather than with a tighter gate.
    const spike = coarse.caughtRate('spike');
    expect(spike.rate).toBeGreaterThan(0.7);
    expect(spike.rate).toBeLessThan(1);
    expect(live.caughtRate('spike').rate).toBeGreaterThan(spike.rate);
  });

  it('future-dated readings are rejected (S6)', () => {
    for (const a of ofKind('futureTimestamp')) {
      const hits = byAt.get(a.emittedAtMs) || [];
      expect(hits.some((r) => !r.accepted && r.reason === 'future-timestamp')).toBe(true);
    }
  });

  it('duplicate timestamps are rejected exactly once — the first copy is real data', () => {
    for (const a of ofKind('timestampDuplicate')) {
      const hits = byAt.get(a.emittedAtMs) || [];
      expect(hits.length).toBeGreaterThanOrEqual(2);
      expect(hits.some((r) => !r.accepted && r.reason === 'non-monotonic-time')).toBe(true);
    }
  });

  it('backwards timestamp jitter is rejected rather than producing a negative interval', () => {
    const backwards = ofKind('timestampJitter').filter((a) => a.emittedAtMs < a.atMs);
    expect(backwards.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(Number.isFinite(r.level)).toBe(true);
      expect(Number.isFinite(r.confidence)).toBe(true);
    }
  });

  it('flatline runs are de-weighted once they outlive the wander correlation time', () => {
    expect(ofKind('flatline').length).toBeGreaterThan(0);
    expect(results.filter((r) => r.flags.includes('flatline')).length).toBeGreaterThan(0);
    // The mirror image of the spike case: the generator's 3-7 sample runs span only 20-60 s
    // at the live cadence, which is shorter than tau, so they are deliberately NOT flagged
    // there. Six identical integers a few seconds apart is a resting wrist, not a fault.
    expect(live.results.filter((r) => r.flags.includes('flatline')).length).toBe(0);
  });

  it('dropouts are a GAP, not an error — the filter carries on without a rejection', () => {
    // There is nothing to reject: the sample simply never arrives. What must hold is that the
    // widened interval is handled by the dt-aware predict rather than by a special case.
    expect(ofKind('dropout').length).toBeGreaterThan(0);
    const gaps = [];
    for (let i = 1; i < readings.length; i++) gaps.push(readings[i].atMs - readings[i - 1].atMs);
    // Bounded above deliberately: the futureTimestamp class throws intervals of DAYS, which
    // would satisfy a bare max() without a dropout ever having happened.
    const realGaps = gaps.filter((g) => g > 0 && g < 3600_000);
    expect(Math.max(...realGaps)).toBeGreaterThanOrEqual(2 * 60_000);
    expect(results.filter((r) => r.accepted).length).toBeGreaterThan(readings.length * 0.9);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · persona replay — pass-through and convergence', () => {
  it('passes through >= 99% of a CLEAN persona stream', () => {
    for (const id of Object.keys(PERSONAS)) {
      const run = generate({
        persona: id, seed: `w4-003-clean-${id}`, startAt: NOW - 24 * 3600_000,
        days: 1, sampleIntervalSec: 5, artifacts: false,
      });
      const readings = readingsFromRun(run);
      const { results } = drive(readings, { now: run.meta.endAtMs });
      const accepted = results.filter((r) => r.accepted).length;
      const rate = accepted / results.length;
      expect(rate).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('converges to persona ground truth within +/- 2 bpm despite injected artifacts', () => {
    for (const id of Object.keys(PERSONAS)) {
      const run = generate({
        persona: id, seed: `w4-003-conv-${id}`, startAt: NOW - 24 * 3600_000,
        days: 1, sampleIntervalSec: 5,
      });
      const truth = new Map(run.truth.samples.map((s) => [s.tMs, s.hr]));
      const readings = readingsFromRun(run);
      const { results } = drive(readings, { now: run.meta.endAtMs });

      const errors = [];
      readings.forEach((r, i) => {
        if (i < 60) return;                 // startup transient is not what is being measured
        const t = truth.get(r.atMs);
        if (t === undefined) return;        // jittered/future timestamps have no truth partner
        errors.push(Math.abs(results[i].level - t));
      });
      expect(errors.length).toBeGreaterThan(1000);
      expect(median(errors)).toBeLessThanOrEqual(2.0);
      expect(quantile(errors, 0.9)).toBeLessThanOrEqual(5.0);
    }
  });

  it('holds on the HOLDOUT personas, whose noise family the constants were NOT derived from (R.10)', () => {
    for (const id of Object.keys(HOLDOUT_PERSONAS)) {
      const run = generate({
        persona: id, seed: `w4-003-holdout-${id}`, startAt: NOW - 24 * 3600_000,
        days: 1, sampleIntervalSec: 5,
      });
      const truth = new Map(run.truth.samples.map((s) => [s.tMs, s.hr]));
      const readings = readingsFromRun(run);
      const { results } = drive(readings, { now: run.meta.endAtMs });

      const errors = [];
      readings.forEach((r, i) => {
        if (i < 60) return;
        const t = truth.get(r.atMs);
        if (t === undefined) return;
        errors.push(Math.abs(results[i].level - t));
      });
      expect(errors.length).toBeGreaterThan(1000);
      expect(median(errors)).toBeLessThanOrEqual(2.5);
    }
  });

  it('the wander-diffusion term earns its place — ABLATION, on every persona', () => {
    // The module header claims the two-term Q tracks better than the pure white-noise-
    // acceleration form §M.2 literally specifies. That claim is worth exactly as much as the
    // control behind it, so here is the control: the same stream through the shipped config
    // and through one with qLevel forced to 0, which IS the single-term filter.
    //
    // The first draft of this suite had no such test, and deleting the term turned nothing
    // red — an unfalsifiable constant, which is the thing §M's "every constant derived" bar
    // is actually trying to prevent.
    const rows = [];
    for (const id of Object.keys(PERSONAS)) {
      const run = generate({
        persona: id, seed: `w4-003-ablate-${id}`, startAt: NOW - 24 * 3600_000,
        days: 1, sampleIntervalSec: 5,
      });
      const truth = new Map(run.truth.samples.map((x) => [x.tMs, x.hr]));
      const readings = readingsFromRun(run);

      const errorsFor = (state) => {
        const { results } = drive(readings, { now: run.meta.endAtMs, state });
        const errs = [];
        readings.forEach((r, i) => {
          if (i < 60) return;
          const t = truth.get(r.atMs);
          if (t === undefined) return;
          errs.push(Math.abs(results[i].level - t));
        });
        return errs;
      };

      const shipped = median(errorsFor(createFilterState('heartRate')));
      const ablated = median(errorsFor(createFilterState('heartRate', { qLevel: 0 })));
      rows.push({ id, shipped, ablated });
      expect(shipped).toBeLessThan(ablated);
    }
    // Not merely "different": consistently better, by a margin worth the extra term.
    const gains = rows.map((r) => 1 - r.shipped / r.ablated);
    expect(Math.min(...gains)).toBeGreaterThan(0.08);
  });

  it('never fabricates physiology: a stream of pure garbage yields low confidence and degraded mode', () => {
    let s = createFilterState('heartRate');
    let at = NOW - 3600_000;
    let last;
    for (let i = 0; i < 200; i++) {
      at += 5000;
      const out = filterReading(s, { value: i % 2 ? 0 : 260, atMs: at }, { now: NOW });
      s = out.state;
      last = out.result;
    }
    expect(last.accepted).toBe(false);
    expect(last.confidence).toBeLessThan(DEGRADED_CONFIDENCE);
    expect(last.degraded).toBe(DEGRADED_MODE);
  });

  it('does not flag degraded mode anywhere on a clean stream (the flag must mean something)', () => {
    const run = generate({
      persona: 'athlete', seed: 'w4-003-nodegrade', startAt: NOW - 24 * 3600_000,
      days: 1, sampleIntervalSec: 5, artifacts: false,
    });
    const { results } = drive(readingsFromRun(run), { now: run.meta.endAtMs });
    expect(results.some((r) => r.degraded)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · numerical hygiene fuzz (S8)', () => {
  const hostile = fc.oneof(
    fc.double({ min: -1e6, max: 1e6, noNaN: true }),
    fc.constantFrom(NaN, Infinity, -Infinity, 0, -0, null, undefined, '72', {}, []),
    fc.integer({ min: HR_MIN, max: HR_MAX }),
  );

  it('300 rounds of hostile input: finite, clamped, never throws', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(hostile, fc.integer({ min: 0, max: 600_000 })), { minLength: 1, maxLength: 60 }),
        (pairs) => {
          let s = createFilterState('heartRate');
          let at = NOW - 24 * 3600_000;
          for (const [value, gap] of pairs) {
            at += gap;
            const out = filterReading(s, { value, atMs: at }, { now: NOW });
            s = out.state;
            const r = out.result;
            if (r.level !== null) {
              expect(Number.isFinite(r.level)).toBe(true);
              expect(r.level).toBeGreaterThanOrEqual(HR_MIN);
              expect(r.level).toBeLessThanOrEqual(HR_MAX);
            }
            expect(Number.isFinite(r.trend)).toBe(true);
            expect(Number.isFinite(r.confidence)).toBe(true);
            expect(r.confidence).toBeGreaterThanOrEqual(0);
            expect(r.confidence).toBeLessThanOrEqual(1);
            expect(typeof r.accepted).toBe('boolean');
            if (!r.accepted) expect(REJECT_REASONS.has(r.reason)).toBe(true);
            else expect(r.reason).toBeNull();
          }
          return true;
        },
      ),
      { numRuns: 300, seed: 20260819 },
    );
  });

  it('a zero-variance window and an empty window are both survivable', () => {
    const empty = createFilterState('heartRate');
    expect(summarizeFilterState(empty).level).toBeNull();
    expect(summarizeFilterState(empty).confidence).toBe(0);
    const { results } = drive(flatSeries(75, { n: 30, stepMs: 1000 }));
    expect(results.every((r) => Number.isFinite(r.confidence))).toBe(true);
  });

  it('a single reading is a complete, usable state', () => {
    const { result, state } = step(createFilterState('heartRate'), 88, NOW - 1000);
    expect(result.accepted).toBe(true);
    expect(result.level).toBeCloseTo(88, 6);
    expect(result.trend).toBe(0);
    expect(summarizeFilterState(state).sampleCount).toBe(1);
  });

  it('state is JSON round-trippable, so it can live in Redis or a socket map unchanged', () => {
    const { state } = drive(flatSeries(70, { n: 15, stepMs: 5000 }));
    const revived = JSON.parse(JSON.stringify(state));
    const a = filterReading(state, { value: 72, atMs: NOW }, { now: NOW }).result;
    const b = filterReading(revived, { value: 72, atMs: NOW }, { now: NOW }).result;
    expect(b).toEqual(a);
  });
});

// ───────────────────────────────────────────────────────────────────────────────
describe('W4-003 · telemetry line and performance (S10/S15)', () => {
  it('emits a single-line telemetry summary carrying counts only — never a vital', () => {
    const run = generate({
      persona: 'stressedProfessional', seed: 'w4-003-telemetry',
      startAt: NOW - 24 * 3600_000, days: 1, sampleIntervalSec: 60,
    });
    const { state } = drive(readingsFromRun(run), { now: run.meta.endAtMs });
    const line = summarizeFilterState(state).telemetry;
    expect(typeof line).toBe('string');
    expect(line).toMatch(/^\[anomalyFilter\]/);
    expect(line).toMatch(/accepted=\d+/);
    expect(line).toMatch(/rejected=\d+/);
    // Zero-knowledge (§0.2.2): no bpm-shaped field may appear in a log line.
    expect(line).not.toMatch(/\b(hr|bpm|hrv|rhr|level|value)=/i);
  });

  it('costs far less than the live cadence it runs at', async () => {
    const readings = flatSeries(70, { n: 10_000, stepMs: 1000, startMs: NOW - 11_000_000 });
    const m = await measure(() => {
      let s = createFilterState('heartRate');
      for (const r of readings) s = filterReading(s, r, { now: NOW }).state;
    }, { samples: 5, warmup: 2, label: 'anomalyFilter-10k' });
    // 10k readings; the budget is checked against the MIN (W4-D09), so only a genuine
    // algorithmic regression trips it. Per-reading this is ~20 microseconds of headroom.
    expectWithinBudget(m, { budgetMs: 200, strictMs: 60 });
  });
});
