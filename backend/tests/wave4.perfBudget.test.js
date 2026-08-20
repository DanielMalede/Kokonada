'use strict';

// W4-D09 — the robust performance-budget helper.
//
// Why this module exists. Measured on this box, 2026-08-19, by replacing the two original
// assertions with a 20-sample probe and running BOTH conditions:
//
//   generateV2 stageMs.total   full suite (170 suites ahead of it) : 188..194   spread   6 ms
//                              two-suite isolated run              : 231..307   spread  76 ms
//   selection pipeline, k=50   full suite                          : 190..204   spread  14 ms
//   over a 500-track pool      two-suite isolated run              : 241..292   spread  51 ms
//
// Both were asserted against a SINGLE-SHOT `< 300`. In the isolated run two of twelve
// generateV2 samples (304, 307) clear that budget with the box otherwise idle, an observed
// over-budget rate of 2/12 — so the five-sample loop at shadow.flip:192 passes roughly
// 0.83^5 ~= 40% of the time under that condition. The operation's cost swings ~60%
// (188 -> 307 ms) on ambient conditions alone and the budget sat INSIDE that band. An
// instrument whose own spread is wider than the margin it polices cannot police it, and
// §0.4 S1a forbids banking that as a baseline.
//
// This corrects two things the W4-D09 backlog row inferred from a single observation: the
// SLOW condition is the isolated run, not the loaded one (170 suites of warm JIT make the
// full suite the FAST case), and no memory pressure is needed to produce the failure.
//
// The statistic is min-of-N, not the mean or p50. Wall-clock noise is one-sided — an
// operation cannot run FASTER than its true cost, while GC pauses, deopts and descheduling
// only ever add — so the minimum is the estimator that survives a loaded machine: every
// sample has to be inflated for the result to be. On the isolated generateV2 samples above,
// rolling min-of-5 spans 231..273 where the single shots it is drawn from span 231..307.

const path = require('path');
const fs = require('fs');

const perf = require('../jest/perfBudget');

// A clock that returns a scripted sequence, so the module's arithmetic is verified against
// known durations rather than against whatever the machine happened to do (S9: the engine
// takes its clock as a parameter; a test that cannot fix time cannot pin a timing helper).
const scriptedClock = (durations) => {
  const marks = [];
  for (const d of durations) { marks.push(0, d); }
  let i = 0;
  return () => marks[i++];
};

describe('perfBudget.summarize', () => {
  it('reports min, p50, p90, max and n over the sample set', () => {
    const s = perf.summarize([50, 10, 40, 20, 30]);
    expect(s.min).toBe(10);
    expect(s.max).toBe(50);
    expect(s.n).toBe(5);
    expect(s.p50).toBe(30);
  });

  it('uses nearest-rank percentiles so a 5-sample set has a defined p90', () => {
    const s = perf.summarize([1, 2, 3, 4, 100]);
    expect(s.p90).toBe(100);
    expect(s.p50).toBe(3);
  });

  it('handles a single sample without NaN', () => {
    const s = perf.summarize([7]);
    expect(s).toMatchObject({ min: 7, p50: 7, p90: 7, max: 7, n: 1 });
    for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
  });

  it('rejects an empty sample set rather than returning Infinity', () => {
    expect(() => perf.summarize([])).toThrow(/at least one sample/i);
  });

  it('rejects a non-finite sample rather than poisoning the statistics', () => {
    expect(() => perf.summarize([10, NaN])).toThrow(/finite/i);
    expect(() => perf.summarize([10, Infinity])).toThrow(/finite/i);
  });
});

describe('perfBudget.measure', () => {
  it('invokes the operation exactly warmup + samples times', async () => {
    const fn = jest.fn();
    await perf.measure(fn, { samples: 4, warmup: 2, clock: scriptedClock([1, 2, 3, 4, 5, 6]) });
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('excludes warmup runs from the statistics', async () => {
    // Warmups are the two 900s; only the 10/20/30 tail is measured.
    const m = await perf.measure(() => {}, {
      samples: 3, warmup: 2, clock: scriptedClock([900, 900, 10, 20, 30]),
    });
    expect(m.wall.n).toBe(3);
    expect(m.wall.max).toBe(30);
    expect(m.wall.min).toBe(10);
  });

  it('awaits an async operation so the measurement spans the whole thing', async () => {
    let done = false;
    const m = await perf.measure(async () => {
      await new Promise((r) => setImmediate(r));
      done = true;
    }, { samples: 2, warmup: 0, clock: scriptedClock([5, 6]) });
    expect(done).toBe(true);
    expect(m.wall.n).toBe(2);
  });

  it('calls the reset hook before every run, and never counts it as measured time', async () => {
    const order = [];
    const m = await perf.measure(() => order.push('run'), {
      samples: 2,
      warmup: 1,
      reset: () => order.push('reset'),
      clock: scriptedClock([10, 10, 10]),
    });
    expect(order).toEqual(['reset', 'run', 'reset', 'run', 'reset', 'run']);
    expect(m.wall.n).toBe(2);
  });

  it('summarises CPU time alongside wall time when a cpu source is injected', async () => {
    let t = 0;
    const cpu = () => ({ user: (t += 1000) * 1000, system: 0 });
    const m = await perf.measure(() => {}, {
      samples: 2, warmup: 0, clock: scriptedClock([10, 10]), cpu,
    });
    expect(m.cpu.n).toBe(2);
    expect(Number.isFinite(m.cpu.min)).toBe(true);
  });

  it('uses the injected clock verbatim — no hidden Date.now inside the engine', async () => {
    const m = await perf.measure(() => {}, {
      samples: 3, warmup: 0, clock: scriptedClock([11, 22, 33]),
    });
    expect(m.wall.min).toBe(11);
    expect(m.wall.max).toBe(33);
    expect(m.wall.p50).toBe(22);
  });

  it('carries the label through so a failure names the operation', async () => {
    const m = await perf.measure(() => {}, {
      samples: 1, warmup: 0, label: 'selection-500', clock: scriptedClock([5]),
    });
    expect(m.label).toBe('selection-500');
  });

  it('rejects a sample count below 1 instead of summarising nothing', async () => {
    await expect(perf.measure(() => {}, { samples: 0 })).rejects.toThrow(/samples/i);
  });

  it('rejects a non-function operation', async () => {
    await expect(perf.measure('not a function', { samples: 1 })).rejects.toThrow(/function/i);
  });
});

describe('perfBudget.fromDurations', () => {
  it('builds a measurement from durations the caller already collected', () => {
    // shadow.flip already runs 5 sequential generations and reads the engine's OWN
    // stageMs.total; re-timing them from outside would measure a different thing.
    const m = perf.fromDurations([300, 210, 280], { label: 'generateV2' });
    expect(m.label).toBe('generateV2');
    expect(m.wall.min).toBe(210);
    expect(m.wall.n).toBe(3);
  });
});

// These blocks assert the DECISION, not the record, and they call the helper ~20 times.
// Left on the default logger they would bury the two real call-site records under twenty
// fixture lines — which is precisely how a useful log line stops being read.
const QUIET = () => {};

describe('perfBudget.expectWithinBudget', () => {
  const m = (durations) => perf.fromDurations(durations, { label: 'op' });

  it('passes when the best sample is inside the budget', () => {
    expect(() => perf.expectWithinBudget(m([200, 800, 900]), { budgetMs: 500, log: QUIET })).not.toThrow();
  });

  it('THE STATISTIC IS min — a slow median with one clean sample still passes', () => {
    // This is the whole point: the loaded-machine samples are noise, the clean one is signal.
    expect(() => perf.expectWithinBudget(m([100, 900, 950, 980, 990]), { budgetMs: 300, log: QUIET }))
      .not.toThrow();
  });

  it('fails when EVERY sample is over budget — a real collapse, not scheduler noise', () => {
    expect(() => perf.expectWithinBudget(m([310, 320, 330]), { budgetMs: 300, log: QUIET })).toThrow();
  });

  it('names the operation, the budget and the full distribution in the failure', () => {
    let err;
    try {
      perf.expectWithinBudget(perf.fromDurations([700, 800, 900], { label: 'selection-500' }), { budgetMs: 400, log: QUIET });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/selection-500/);
    expect(err.message).toMatch(/400/);        // the budget
    expect(err.message).toMatch(/700/);        // min
    expect(err.message).toMatch(/900/);        // max
    expect(err.message).toMatch(/n=3/);        // sample count
  });

  it('rejects a budget that is not a positive finite number', () => {
    expect(() => perf.expectWithinBudget(m([10]), { budgetMs: 0, log: QUIET })).toThrow(/budgetMs/i);
    expect(() => perf.expectWithinBudget(m([10]), { log: QUIET })).toThrow(/budgetMs/i);
  });

  it('validates the budget BEFORE recording, so a misconfigured call cannot log a verdict', () => {
    const lines = [];
    expect(() => perf.expectWithinBudget(m([10]), { budgetMs: -1, log: (l) => lines.push(l) })).toThrow(/budgetMs/i);
    expect(lines).toHaveLength(0);
  });
});

describe('perfBudget strict mode (the SLO number, opt-in)', () => {
  const slow = () => perf.fromDurations([250, 260, 270], { label: 'op' });
  const strict = (opts) => perf.expectWithinBudget(slow(), { budgetMs: 900, log: QUIET, ...opts });

  it('ignores strictMs by default, so an ordinary run cannot flake on the SLO', () => {
    expect(() => strict({ strictMs: 200, env: {} })).not.toThrow();
  });

  it('enforces strictMs on p50 when opted in', () => {
    expect(() => strict({ strictMs: 200, env: { PERF_STRICT: '1' } })).toThrow(/strict/i);
  });

  it('passes strict mode when p50 is inside the SLO', () => {
    expect(() => strict({ strictMs: 300, env: { PERF_STRICT: '1' } })).not.toThrow();
  });

  it('reads the env at CALL time, not at require() time', () => {
    // A module-level constant would freeze the answer when the file was first required and
    // make the flag untestable — the W4-002 soak-gate lesson.
    const before = process.env.PERF_STRICT;
    try {
      delete process.env.PERF_STRICT;
      expect(() => strict({ strictMs: 100 })).not.toThrow();
      process.env.PERF_STRICT = '1';
      expect(() => strict({ strictMs: 100 })).toThrow(/strict/i);
    } finally {
      if (before === undefined) delete process.env.PERF_STRICT; else process.env.PERF_STRICT = before;
    }
  });

  it('is forgiving about the flag value — a kill-switch that demands one spelling fails when needed', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      expect(() => strict({ strictMs: 100, env: { PERF_STRICT: v } })).toThrow(/strict/i);
    }
    for (const v of ['', '0', 'false', 'off', 'no']) {
      expect(() => strict({ strictMs: 100, env: { PERF_STRICT: v } })).not.toThrow();
    }
  });

  it('the collapse ceiling still binds in strict mode — strict ADDS a check, never replaces one', () => {
    expect(() => perf.expectWithinBudget(perf.fromDurations([700], { label: 'op' }),
      { budgetMs: 300, strictMs: 900, env: { PERF_STRICT: '1' }, log: QUIET })).toThrow(/budget/i);
  });
});

describe('perfBudget record line — the DoD\'s "recorded p50"', () => {
  // A budget loose enough never to flake is also loose enough to hide a 2x drift, so the
  // distribution is RECORDED on every run. That record is what makes the loose ceiling
  // honest rather than a quiet weakening of the test.
  const capture = (m, opts) => {
    const lines = [];
    const run = () => perf.expectWithinBudget(m, { log: (l) => lines.push(l), ...opts });
    return { lines, run };
  };

  it('emits exactly ONE line carrying the label, the budget and the whole distribution', () => {
    const { lines, run } = capture(perf.fromDurations([190, 204, 193], { label: 'selection-500' }), { budgetMs: 600 });
    run();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[perf\] selection-500 /);
    expect(lines[0]).toMatch(/min=190/);
    expect(lines[0]).toMatch(/p50=193/);
    expect(lines[0]).toMatch(/max=204/);
    expect(lines[0]).toMatch(/n=3/);
    expect(lines[0]).toMatch(/budget=600/);
  });

  it('records even when the budget FAILS — the distribution is WHY the run is red', () => {
    const { lines, run } = capture(perf.fromDurations([700], { label: 'op' }), { budgetMs: 300 });
    expect(run).toThrow();
    expect(lines).toHaveLength(1);
  });

  it('reports the CPU floor when a cpu source was sampled', async () => {
    let t = 0;
    const m = await perf.measure(() => {}, {
      samples: 2, warmup: 0, label: 'op', clock: scriptedClock([10, 10]),
      cpu: () => ({ user: (t += 1000) * 1000, system: 0 }),
    });
    const { lines, run } = capture(m, { budgetMs: 600 });
    run();
    expect(lines[0]).toMatch(/cpuMin=1000/);
  });

  it('omits the CPU term entirely when there is none, rather than printing NaN', () => {
    const { lines, run } = capture(perf.fromDurations([190], { label: 'op' }), { budgetMs: 600 });
    run();
    expect(lines[0]).not.toMatch(/cpuMin/);
    expect(lines[0]).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('carries timings and counts only — no identifier, no vital (§0.2.2 house rule)', () => {
    const { lines, run } = capture(perf.fromDurations([190], { label: 'selection-500' }), { budgetMs: 600 });
    run();
    expect(lines[0]).not.toMatch(/\b(hr|bpm|hrv|rhr|userId|user|heartRate)=/i);
  });

  it('defaults to console.log so a call site gets the record for free', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      perf.expectWithinBudget(perf.fromDurations([190], { label: 'op' }), { budgetMs: 600 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toMatch(/^\[perf\] op /);
    } finally { spy.mockRestore(); }
  });
});

describe('perfBudget budgets — ONE definition, derived from the header measurements', () => {
  // Both call sites need the same two numbers. Hand-copying them into each file is exactly
  // the trigger/key divergence D11 was about, so they live next to the measurements that
  // justify them and the call sites import them.
  it('exports a collapse ceiling clear of the entire observed range', () => {
    expect(perf.COLLAPSE_BUDGET_MS).toBe(600);
    // Worst min-of-N observed for either operation was 231 ms (cold, isolated) and the
    // worst single sample 307 ms. A ceiling inside that range is the defect W4-D09 removes.
    expect(perf.COLLAPSE_BUDGET_MS).toBeGreaterThan(2 * 231);
    expect(perf.COLLAPSE_BUDGET_MS).toBeGreaterThan(307);
  });

  it('keeps the real SLO separate from the ceiling, and stricter', () => {
    expect(perf.SLO_MS).toBe(300);                    // §0.4 S10 — selection p95 < 300 ms
    expect(perf.SLO_MS).toBeLessThan(perf.COLLAPSE_BUDGET_MS);
  });
});

describe('perfBudget hygiene', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'jest', 'perfBudget.js'), 'utf8');

  it('arms no timers of its own — the helper must not become a W4-D06 open handle', () => {
    expect(src).not.toMatch(/setTimeout|setInterval|setImmediate/);
  });

  it('has no direct Date.now in its measurement path — the clock is a parameter (S9)', () => {
    // A default of Date.now is fine, but it must be a default, i.e. appear once as a fallback.
    const hits = src.match(/Date\.now/g) || [];
    expect(hits.length).toBeLessThanOrEqual(1);
  });
});

describe('W4-D09 tripwire — the single-shot wall-clock budgets stay dead', () => {
  const TARGETS = ['shadow.selection.test.js', 'shadow.flip.test.js'];
  // Built by concatenation on purpose: a literal would make THIS file an offender and force
  // the scan to skip itself, which is how a tripwire quietly stops covering everything.
  const OFFENDER = 'toBeLessThan(' + '300)';

  const scan = (src) => src.includes(OFFENDER);

  it.each(TARGETS)('%s no longer asserts a single-shot 300ms wall-clock budget', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(scan(src)).toBe(false);
  });

  it.each(TARGETS)('%s measures through the shared budget helper', (file) => {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    expect(src).toMatch(/perfBudget/);
  });

  it('detector self-test: the scan really does catch the offending pattern', () => {
    expect(scan(`expect(Date.now() - started).${OFFENDER};`)).toBe(true);
    expect(scan('expect(wall).toBeLessThan(6000);')).toBe(false);
  });

  // The 20-user burst in the same file is the SAME defect on a longer timescale: an absolute
  // millisecond constant standing in for a throughput property. It failed at 6236 ms on a
  // clean full-suite run (C) and again under load (B) while the concurrency it guards was
  // healthy — 20 concurrent generations cost 1.07x the serial equivalent.
  const ABSOLUTE_BURST = 'toBeLessThan(' + '6000)';

  it('shadow.flip.test.js no longer bounds the 20-user burst with an absolute constant', () => {
    const src = fs.readFileSync(path.join(__dirname, 'shadow.flip.test.js'), 'utf8');
    expect(src.includes(ABSOLUTE_BURST)).toBe(false);
  });

  it('the burst is bounded RELATIVE to this machine\'s own per-call cost', () => {
    const src = fs.readFileSync(path.join(__dirname, 'shadow.flip.test.js'), 'utf8');
    // A budget derived from a calibration measured on the same box in the same run is what
    // makes the guard machine-speed invariant instead of a constant that ages with hardware.
    expect(src).toMatch(/serialEquivalent/);
    expect(src).toMatch(/BURST_OVERHEAD_RATIO/);
  });

  it('detector self-test: the burst scan really does catch its offending pattern', () => {
    const burstScan = (s) => s.includes(ABSOLUTE_BURST);
    expect(burstScan('expect(wall).toBeLessThan(6000);')).toBe(true);
    expect(burstScan('expect(wall).toBeLessThan(serialEquivalentMs);')).toBe(false);
  });
});
