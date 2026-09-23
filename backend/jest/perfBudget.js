'use strict';

// W4-D09 — robust performance budgets for the test suite.
//
// THE PROBLEM. Two suites asserted a single wall-clock sample against `< 300`:
// `shadow.selection.test.js` (selection pipeline, 500-track pool, k=50) and
// `shadow.flip.test.js` (orchestrator.generateV2, engine-reported stageMs.total).
// Measured on the dev box 2026-08-19 with a 20-sample probe in place of those
// assertions, the same operations cost 188..194 ms inside the full 170-suite run and
// 231..307 ms in a two-suite isolated run — a ~60% swing driven by nothing but how warm
// V8 happened to be. Two of twelve isolated generateV2 samples already exceeded 300 with
// the box idle. The budget sat INSIDE the operation's own noise band, so the assertion
// was a coin flip rather than a control, and §0.4 S1a forbids banking a non-deterministic
// suite as a baseline.
//
// THE STATISTIC IS min-of-N. Wall-clock noise is one-sided: an operation cannot run
// faster than its true cost, while GC pauses, deoptimisation and descheduling only ever
// add time. The minimum is therefore the estimator of the floor, and the only one that
// survives a loaded machine — every sample must be inflated for the result to be, where a
// single shot needs only one unlucky slice. Mean and p50 both track the machine's mood;
// min tracks the code. It also absorbs first-run warm-up for free, which is why the
// call sites need no elaborate priming.
//
// A ceiling loose enough never to flake is also loose enough to hide a slow 2x drift, so
// this module RECORDS the full distribution on every run (§0.4 S15 single-line telemetry)
// and reserves the real SLO number for an opt-in strict mode. The record is what keeps the
// loose ceiling honest instead of a quiet weakening of the test. Ceiling => collapse guard;
// record => drift visibility; strict mode => the SLO, on demand.
//
// Purity: the clock, the CPU source and the environment are all PARAMETERS (§0.4 S9), so
// the arithmetic is testable against scripted durations rather than against whatever the
// machine did. The module arms no timers of its own — it must never become the open handle
// W4-D06 exists to catch.

const DEFAULT_SAMPLES = 5;
const DEFAULT_WARMUP = 1;

// The two numbers the call sites share, kept here next to the measurements that justify
// them — hand-copying a threshold into each consumer is the trigger/key divergence D11 was
// about. Both operations are the same magnitude (generateV2's stageMs is dominated by the
// selection stage), so one ceiling covers both.
//
// COLLAPSE_BUDGET_MS = 600: 2.6x the worst min-of-N observed for either operation (231 ms,
// cold and isolated) and ~2x the worst single sample ever seen (307 ms). It sits clear of
// the operation's entire observed range, so it can only be tripped by a real algorithmic
// regression — an O(n^2) over the candidate pool, a lost index, a re-introduced network
// call — and never by an unlucky scheduler slice.
// SLO_MS = 300: the product number from §0.4 S10 (selection p95 < 300 ms). Enforced on p50
// under PERF_STRICT rather than on every run, because it is a target to watch, not a
// threshold a shared CI runner should be able to turn red on its own.
const COLLAPSE_BUDGET_MS = 600;
const SLO_MS = 300;

// A kill-switch that demands one spelling fails at the moment it is needed (W4-D05's lesson).
const TRUTHY = /^(1|true|yes|on)$/i;

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** Nearest-rank percentile: defined for every n >= 1, no interpolation, no NaN at the edges. */
function percentile(sorted, q) {
  const rank = Math.ceil(q * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * Reduce raw durations to the five numbers a budget decision needs.
 * Returns ONLY finite numbers, so a caller can assert over Object.values().
 */
function summarize(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error('perfBudget.summarize needs at least one sample');
  }
  for (const s of samples) {
    if (!isFiniteNumber(s)) {
      throw new Error(`perfBudget.summarize needs finite samples, got ${String(s)}`);
    }
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
    n: sorted.length,
  };
}

/**
 * Run `op` (warmup + samples) times and summarise wall time, plus CPU time when a source
 * is available. `reset` runs before EVERY iteration and is never inside the timed region,
 * so a stateful operation can be returned to its starting conditions without paying for it.
 */
async function measure(op, options = {}) {
  const {
    samples = DEFAULT_SAMPLES,
    warmup = DEFAULT_WARMUP,
    clock = Date.now,
    cpu = typeof process !== 'undefined' && process.cpuUsage ? () => process.cpuUsage() : null,
    reset = null,
    label = 'unlabelled',
  } = options;

  if (typeof op !== 'function') {
    throw new TypeError('perfBudget.measure needs a function to measure');
  }
  if (!Number.isInteger(samples) || samples < 1) {
    throw new RangeError(`perfBudget.measure needs samples >= 1, got ${String(samples)}`);
  }
  if (!Number.isInteger(warmup) || warmup < 0) {
    throw new RangeError(`perfBudget.measure needs warmup >= 0, got ${String(warmup)}`);
  }

  const wall = [];
  const cpuMs = [];

  for (let i = 0; i < warmup + samples; i++) {
    if (reset) await reset();
    const c0 = cpu ? cpu() : null;
    const t0 = clock();
    await op();
    const t1 = clock();
    const c1 = cpu ? cpu() : null;
    wall.push(t1 - t0);
    if (c0 && c1) cpuMs.push(((c1.user - c0.user) + (c1.system - c0.system)) / 1000);
  }

  const measured = wall.slice(warmup);
  const measuredCpu = cpuMs.slice(warmup);
  return {
    label,
    wall: summarize(measured),
    cpu: measuredCpu.length === measured.length && measured.length > 0 ? summarize(measuredCpu) : null,
  };
}

/**
 * Build a measurement from durations the caller already has. Some call sites run the
 * operation N times for their OWN reasons and read the engine's own stage timings —
 * re-timing those from outside would measure a different thing and cost N extra runs.
 */
function fromDurations(durations, options = {}) {
  const { label = 'unlabelled' } = options;
  return { label, wall: summarize(durations), cpu: null };
}

function strictEnabled(env) {
  const raw = env ? env.PERF_STRICT : undefined;
  return typeof raw === 'string' && TRUTHY.test(raw.trim());
}

function recordLine(m, budgetMs) {
  const w = m.wall;
  const cpuTerm = m.cpu ? ` cpuMin=${m.cpu.min}` : '';
  return `[perf] ${m.label} min=${w.min} p50=${w.p50} p90=${w.p90} max=${w.max} n=${w.n} budget=${budgetMs}${cpuTerm}`;
}

/**
 * Assert a measurement against a COLLAPSE ceiling (always) and the SLO (opt-in).
 *
 * `budgetMs` is checked against the min — sized well above the operation's whole observed
 * range so only a real algorithmic regression trips it. `strictMs` is the true SLO number
 * and is checked against p50 only when PERF_STRICT is set, exactly as the soak gates its
 * expensive path: a number the team wants to watch, not one an unlucky CI slice can turn red.
 * The distribution is recorded either way, including on failure — the numbers are the
 * diagnosis, and a red run that hid them would send the reader back to reproduce it by hand.
 */
function expectWithinBudget(m, options = {}) {
  const { budgetMs, strictMs = null, env = null, log = console.log } = options;

  if (!isFiniteNumber(budgetMs) || budgetMs <= 0) {
    throw new RangeError(`perfBudget.expectWithinBudget needs a positive budgetMs, got ${String(budgetMs)}`);
  }

  const w = m.wall;
  const dist = `p50=${w.p50} p90=${w.p90} max=${w.max} n=${w.n}`;
  log(recordLine(m, budgetMs));

  if (w.min > budgetMs) {
    throw new Error(
      `${m.label} exceeded its performance budget: min=${w.min}ms > budget=${budgetMs}ms (${dist}). ` +
      'The statistic is the MINIMUM, so every sample was over budget — this is a real regression, ' +
      'not scheduler noise.'
    );
  }

  if (strictMs !== null && strictEnabled(env || process.env)) {
    if (!isFiniteNumber(strictMs) || strictMs <= 0) {
      throw new RangeError(`perfBudget.expectWithinBudget needs a positive strictMs, got ${String(strictMs)}`);
    }
    if (w.p50 > strictMs) {
      throw new Error(
        `${m.label} missed its strict SLO: p50=${w.p50}ms > strict=${strictMs}ms (${dist}). ` +
        'Strict mode is opt-in via PERF_STRICT and measures the SLO, not the collapse ceiling.'
      );
    }
  }
}

module.exports = {
  summarize, measure, fromDurations, expectWithinBudget, recordLine,
  COLLAPSE_BUDGET_MS, SLO_MS, DEFAULT_SAMPLES, DEFAULT_WARMUP,
};
