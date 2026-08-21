'use strict';

// W4-011 (B6) — the feedback loop's PURE core. No Mongo, no Redis, no clock, no RNG (§0.4 S9):
// every input this engine judges arrives as a parameter, which is what makes a reward
// reproducible in the soak harness six weeks after the play it describes.
//
// The load-bearing assertions here are the SIGN ones. A reward loop that is confidently wrong
// about direction is worse than no reward loop at all: it does not fail to learn, it learns the
// opposite of the truth, and every downstream consumer (W4-013's bandit, PersonalWeights) is
// then fit against it. So the sign is pinned from the DoD's own scenario in both directions,
// and the §M.12 operand-order deviation is pinned EXPLICITLY rather than left as a silent
// difference between the appendix and the code.

const fb = require('../app/agents/runtime/learning/feedbackLoop');
const taxonomy = require('../app/agents/runtime/knowledge/stateTaxonomy');
const { createRng } = require('../sim/rng');

// A play window: `n` samples evenly spread over `spanSec`, on a straight line of `slope` bpm/s.
function window({ n = 9, spanSec = 240, slope = 0, start = 70, atMs = 1_700_000_000_000 } = {}) {
  const step = spanSec / (n - 1);
  return Array.from({ length: n }, (_, i) => ({
    atMs: atMs + i * step * 1000,
    value: start + slope * (i * step),
  }));
}

describe('W4-011 · feedbackLoop — bucket coordinates (ADR-0012 Track A)', () => {
  it('bins the day into four coarse bins that tile [0,24) exactly once', () => {
    const seen = new Map();
    for (let h = 0; h < 24; h++) {
      const bin = fb.hourBinOf(h);
      expect(Number.isInteger(bin)).toBe(true);
      expect(bin).toBeGreaterThanOrEqual(0);
      expect(bin).toBeLessThan(fb.HOUR_BINS);
      seen.set(bin, (seen.get(bin) ?? 0) + 1);
    }
    expect(seen.size).toBe(fb.HOUR_BINS);
    // Equal-width bins — an uneven tiling would make two buckets mean different amounts of day.
    expect([...seen.values()].every((c) => c === 24 / fb.HOUR_BINS)).toBe(true);
  });

  it('bins are LEFT-closed at their boundary hour (00, 06, 12, 18 open a bin)', () => {
    expect(fb.hourBinOf(0)).toBe(0);
    expect(fb.hourBinOf(5.99)).toBe(0);
    expect(fb.hourBinOf(6)).toBe(1);
    expect(fb.hourBinOf(12)).toBe(2);
    expect(fb.hourBinOf(18)).toBe(3);
    expect(fb.hourBinOf(23.99)).toBe(3);
  });

  it('abstains on an hour it cannot trust rather than folding it into bin 0', () => {
    for (const bad of [null, undefined, NaN, Infinity, -1, 24, 25, '12', true, {}, []]) {
      expect(fb.hourBinOf(bad)).toBeNull();
    }
  });

  it('resolves the domain coordinate through the REAL taxonomy, never a copied table', () => {
    // Every state the taxonomy actually publishes must yield the domain the taxonomy says.
    for (const state of taxonomy.STATES) {
      const bucket = fb.bucketOf({ stateId: state.id, targetBand: 'resting', hourOfDay: 9 });
      expect(bucket).not.toBeNull();
      expect(bucket.stateDomain).toBe(state.domain);
    }
  });

  it('accepts a domain directly, but only one the taxonomy declares', () => {
    expect(fb.bucketOf({ stateDomain: 'stress', targetBand: 'peak', hourOfDay: 20 }))
      .toEqual({ stateDomain: 'stress', targetBand: 'peak', hourBin: 3 });
    expect(fb.bucketOf({ stateDomain: 'anxiety', targetBand: 'peak', hourOfDay: 20 })).toBeNull();
  });

  it('returns null when ANY coordinate is missing — a partial bucket is not a bucket', () => {
    const ok = { stateDomain: 'rest', targetBand: 'resting', hourOfDay: 3 };
    expect(fb.bucketOf(ok)).not.toBeNull();
    expect(fb.bucketOf({ ...ok, stateDomain: null })).toBeNull();
    expect(fb.bucketOf({ ...ok, targetBand: null })).toBeNull();
    expect(fb.bucketOf({ ...ok, targetBand: 'quiet' })).toBeNull(); // not a taxonomy band
    expect(fb.bucketOf({ ...ok, hourOfDay: null })).toBeNull();
    expect(fb.bucketOf()).toBeNull();
  });

  it('never carries a state LABEL into the bucket (§0.2.2 — only the coarse domain)', () => {
    const bucket = fb.bucketOf({ stateId: 'acute-stress', targetBand: 'resting', hourOfDay: 9 });
    expect(Object.keys(bucket).sort()).toEqual(['hourBin', 'stateDomain', 'targetBand']);
    expect(JSON.stringify(bucket)).not.toContain('acute-stress');
  });
});

describe('W4-011 · feedbackLoop — the observed slope (OLS over the play window)', () => {
  it('recovers a known slope exactly on a noiseless window', () => {
    const r = fb.observedSlope(window({ slope: 0.05, n: 9, spanSec: 240 }));
    expect(r.usable).toBe(true);
    expect(r.slope).toBeCloseTo(0.05, 9);
    expect(r.samples).toBe(9);
    expect(r.spanSec).toBeCloseTo(240, 6);
  });

  it('reports a standard error that SHRINKS as the window carries more information', () => {
    const few = fb.observedSlope(window({ n: 5, spanSec: 120, slope: 0 }));
    const many = fb.observedSlope(window({ n: 41, spanSec: 120, slope: 0 }));
    const wide = fb.observedSlope(window({ n: 5, spanSec: 600, slope: 0 }));
    expect(many.standardError).toBeLessThan(few.standardError);
    expect(wide.standardError).toBeLessThan(few.standardError);
  });

  it('abstains when the times carry no spread (every sample at one instant)', () => {
    const flat = [1, 2, 3, 4, 5].map((v) => ({ atMs: 1_700_000_000_000, value: 60 + v }));
    expect(fb.observedSlope(flat).usable).toBe(false);
  });

  it('abstains on fewer than two usable samples, and drops unusable rows rather than coercing them', () => {
    expect(fb.observedSlope([]).usable).toBe(false);
    expect(fb.observedSlope([{ atMs: 1, value: 60 }]).usable).toBe(false);
    const dirty = [
      { atMs: 1_700_000_000_000, value: 60 },
      { atMs: 1_700_000_060_000, value: null },     // unmeasured — NOT a measured zero
      { atMs: 1_700_000_120_000, value: 'x' },
      { atMs: null, value: 70 },
      { atMs: 1_700_000_180_000, value: 66 },
    ];
    const r = fb.observedSlope(dirty);
    expect(r.usable).toBe(true);
    expect(r.samples).toBe(2);
    expect(r.slope).toBeCloseTo(6 / 180, 9);
  });
});

describe('W4-011 · feedbackLoop — biometric reward sign (§M.12, the DoD scenario)', () => {
  // The DoD, verbatim: "HR falls faster than counterfactual on calm target under stress →
  // positive". The counterfactual is the Kalman trend at track start (§M.12).
  const DOWN = 'meet-then-lower';   // ARCHETYPE_DIRECTION -1 — down-regulation
  const UP = 'warmup-peak-cooldown'; // ARCHETYPE_DIRECTION +1 — activation

  it('is POSITIVE when HR falls faster than the counterfactual under a down-regulation arc', () => {
    const r = fb.biometricReward({
      samples: window({ slope: -0.05 }),  // observed: falling 3 bpm/min
      expectedSlope: 0,                   // counterfactual: flat
      archetype: DOWN,
    });
    expect(r.usable).toBe(true);
    expect(r.value).toBeGreaterThan(0);
  });

  it('is NEGATIVE when HR rises against a down-regulation arc', () => {
    const r = fb.biometricReward({ samples: window({ slope: +0.05 }), expectedSlope: 0, archetype: DOWN });
    expect(r.usable).toBe(true);
    expect(r.value).toBeLessThan(0);
  });

  it('is POSITIVE when HR rises faster than the counterfactual under an activation arc', () => {
    const r = fb.biometricReward({ samples: window({ slope: +0.05 }), expectedSlope: 0, archetype: UP });
    expect(r.usable).toBe(true);
    expect(r.value).toBeGreaterThan(0);
  });

  it('judges against the COUNTERFACTUAL, not against zero: falling slower than a steep decline is a miss', () => {
    // Already on the way down at 6 bpm/min; the track only manages 3 bpm/min. The body was
    // heading there anyway and the music slowed it — that is a negative result under a
    // down-regulation goal, and a zero-referenced rule would have called it a success.
    const r = fb.biometricReward({ samples: window({ slope: -0.05 }), expectedSlope: -0.1, archetype: DOWN });
    expect(r.usable).toBe(true);
    expect(r.value).toBeLessThan(0);
  });

  // §M.12 PINNED DEVIATION. The appendix writes `((slope_expected − slope_observed)/σ)·goal`
  // with `goal = −1` for down-regulation. That product is NEGATIVE for the appendix's own
  // success case (observed < expected under goal −1), i.e. the operand order in §M.12
  // contradicts this task's stated DoD. The code implements `((observed − expected)/σ)·goal`.
  // This pin exists so the difference can never be "tidied" back to the appendix's order
  // without a red test explaining why.
  it('implements (observed − expected)·goal, NOT the appendix operand order', () => {
    // A divergence small enough to stay off the ±1 clamp, so the ALGEBRA is compared and not
    // two saturated values that would agree by accident.
    const samples = window({ slope: -0.01 });
    const r = fb.biometricReward({ samples, expectedSlope: 0, archetype: DOWN });
    const observed = fb.observedSlope(samples).slope;
    const asWritten = (0 - observed) / r.sigma * fb.ARCHETYPE_GOAL[DOWN];
    expect(Math.sign(r.value)).toBe(-Math.sign(asWritten));
    expect(r.value).toBeCloseTo((observed - 0) / r.sigma * fb.ARCHETYPE_GOAL[DOWN], 9);
  });

  it('takes its goal from the REAL taxonomy directions, for every archetype the taxonomy names', () => {
    for (const archetype of taxonomy.TRAJECTORY_ARCHETYPES) {
      expect(fb.ARCHETYPE_GOAL[archetype]).toBe(taxonomy.ARCHETYPE_DIRECTION[archetype]);
    }
  });
});

describe('W4-011 · feedbackLoop — biometric reward abstention (never over-correct on thin data)', () => {
  const DOWN = 'meet-then-lower';
  const base = { expectedSlope: 0, archetype: DOWN };

  it('abstains below the §3 minimum window (120 s)', () => {
    const r = fb.biometricReward({ ...base, samples: window({ spanSec: 90, n: 9, slope: -0.05 }) });
    expect(r.usable).toBe(false);
    expect(r.value).toBe(0);
    expect(r.reason).toBe('window-too-short');
  });

  it('abstains below the §3 minimum sample count (5)', () => {
    const r = fb.biometricReward({ ...base, samples: window({ n: 4, spanSec: 240, slope: -0.05 }) });
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('too-few-samples');
  });

  it('abstains when the archetype has NO direction — a flat goal cannot sign a slope', () => {
    for (const flat of ['flat-focus', 'cadence-locked', 'steady']) {
      expect(taxonomy.ARCHETYPE_DIRECTION[flat]).toBe(0);
      const r = fb.biometricReward({ samples: window({ slope: -0.05 }), expectedSlope: 0, archetype: flat });
      expect(r.usable).toBe(false);
      expect(r.reason).toBe('no-direction');
    }
  });

  it('abstains on an unknown archetype and on a missing counterfactual', () => {
    expect(fb.biometricReward({ samples: window({ slope: -0.05 }), expectedSlope: 0, archetype: 'vibes' }).usable).toBe(false);
    expect(fb.biometricReward({ samples: window({ slope: -0.05 }), expectedSlope: null, archetype: 'meet-then-lower' }).reason)
      .toBe('no-counterfactual');
  });

  it('never exceeds ±1 however extreme the divergence', () => {
    const r = fb.biometricReward({ samples: window({ slope: -7.9 }), expectedSlope: 7.9, archetype: 'meet-then-lower' });
    expect(r.value).toBe(1);
    const r2 = fb.biometricReward({ samples: window({ slope: 7.9 }), expectedSlope: -7.9, archetype: 'meet-then-lower' });
    expect(r2.value).toBe(-1);
  });

  // The σ FLOOR, pinned on its own because the "noisy window" pin below does NOT catch its
  // removal (both sides just saturate). Without the floor σ is the pure OLS standard error,
  // which a long clean window drives toward zero — so a physiologically trivial 0.2 bpm/min
  // departure would score a MAXIMAL +1 and the reward would collapse into a sign bit.
  it('does not celebrate a trivial divergence just because it was measured precisely', () => {
    const r = fb.biometricReward({
      samples: window({ n: 41, spanSec: 600, slope: -0.2 / 60 }),
      expectedSlope: 0,
      archetype: 'meet-then-lower',
    });
    expect(r.usable).toBe(true);
    expect(r.value).toBeGreaterThan(0);
    expect(r.value).toBeLessThan(0.25);
    // …and the floor is what holds it there, not the measurement.
    expect(r.sigma).toBeGreaterThan(fb.SLOPE_SCALE_BPM_PER_SEC);
    expect(r.sigma).toBeLessThan(fb.SLOPE_SCALE_BPM_PER_SEC * 1.1);
  });

  it('discounts a noisy window: the same divergence earns LESS when the slope is badly measured', () => {
    const clean = fb.biometricReward({ samples: window({ n: 41, spanSec: 240, slope: -0.02 }), expectedSlope: 0, archetype: 'meet-then-lower' });
    const thin = fb.biometricReward({ samples: window({ n: 5, spanSec: 120, slope: -0.02 }), expectedSlope: 0, archetype: 'meet-then-lower' });
    expect(clean.sigma).toBeLessThan(thin.sigma);
    expect(clean.value).toBeGreaterThan(thin.value);
  });
});

describe('W4-011 · feedbackLoop — behavioural reward', () => {
  it('scores each event class at the §3 value', () => {
    expect(fb.behavioralReward([{ type: 'skip', positionMs: 12_000 }]).value).toBe(-1);
    expect(fb.behavioralReward([{ type: 'skip', positionMs: 90_000 }]).value).toBe(-0.3);
    expect(fb.behavioralReward([{ type: 'complete' }]).value).toBe(0.3);
    expect(fb.behavioralReward([{ type: 'save' }]).value).toBe(1);
  });

  it('puts the early-skip boundary at exactly 30 s, on the LATE side', () => {
    expect(fb.behavioralReward([{ type: 'skip', positionMs: 29_999 }]).value).toBe(-1);
    expect(fb.behavioralReward([{ type: 'skip', positionMs: 30_000 }]).value).toBe(-0.3);
  });

  it('treats a skip with NO position as a late skip (the milder claim), never as an early one', () => {
    expect(fb.behavioralReward([{ type: 'skip' }]).value).toBe(-0.3);
    expect(fb.behavioralReward([{ type: 'skip', positionMs: null }]).value).toBe(-0.3);
  });

  it('combines a completion and a save, bounded to ±1', () => {
    const r = fb.behavioralReward([{ type: 'complete' }, { type: 'save' }]);
    expect(r.value).toBe(1); // 0.3 + 1 clamped
    expect(r.usable).toBe(true);
  });

  it('counts each event CLASS once — a client that re-sends a save cannot inflate it', () => {
    const once = fb.behavioralReward([{ type: 'save' }]);
    const thrice = fb.behavioralReward([{ type: 'save' }, { type: 'save' }, { type: 'save' }]);
    expect(thrice.value).toBe(once.value);
  });

  it('ignores an event class it does not know, and abstains when nothing is left', () => {
    expect(fb.behavioralReward([{ type: 'shared' }]).usable).toBe(false);
    expect(fb.behavioralReward([]).usable).toBe(false);
    expect(fb.behavioralReward(null).usable).toBe(false);
    const mixed = fb.behavioralReward([{ type: 'shared' }, { type: 'save' }]);
    expect(mixed.usable).toBe(true);
    expect(mixed.value).toBe(1);
  });
});

describe('W4-011 · feedbackLoop — combination (§M.12 0.6/0.4)', () => {
  it('weights biometric 0.6 and behavioural 0.4 when both exist', () => {
    const r = fb.combineReward({ usable: true, value: 0.5 }, { usable: true, value: -1 });
    expect(r.usable).toBe(true);
    expect(r.value).toBeCloseTo(0.6 * 0.5 + 0.4 * -1, 9);
    expect(r.source).toBe('both');
  });

  it('uses the one that exists, at full weight, when only one does', () => {
    expect(fb.combineReward({ usable: true, value: 0.5 }, { usable: false, value: 0 }))
      .toMatchObject({ usable: true, value: 0.5, source: 'biometric' });
    expect(fb.combineReward({ usable: false, value: 0 }, { usable: true, value: -0.3 }))
      .toMatchObject({ usable: true, value: -0.3, source: 'behavioral' });
  });

  it('is a NO-OP when neither exists — an absent signal is not a zero reward', () => {
    const r = fb.combineReward({ usable: false, value: 0 }, { usable: false, value: 0 });
    expect(r.usable).toBe(false);
    expect(r.source).toBeNull();
  });
});

describe('W4-011 · feedbackLoop — evaluatePlay (the composed judgement)', () => {
  const play = (overrides = {}) => ({
    samples: window({ slope: -0.05 }),
    expectedSlope: 0,
    archetype: 'meet-then-lower',
    events: [{ type: 'complete' }],
    stateId: 'acute-stress',
    targetBand: 'resting',
    hourOfDay: 22,
    ...overrides,
  });

  it('returns a usable reward with its bucket coordinates', () => {
    const r = fb.evaluatePlay(play());
    expect(r.usable).toBe(true);
    expect(r.reward).toBeGreaterThan(0);
    expect(r.bucket).toEqual({ stateDomain: 'stress', targetBand: 'resting', hourBin: 3 });
  });

  it('is a NO-OP on thin data — no bucket write is proposed at all', () => {
    const r = fb.evaluatePlay(play({ samples: window({ n: 3, spanSec: 40 }), events: [] }));
    expect(r.usable).toBe(false);
    expect(r.reward).toBe(0);
    expect(r.posterior).toBeNull();
  });

  it('is a NO-OP when the reward is real but the bucket coordinates are not', () => {
    const r = fb.evaluatePlay(play({ targetBand: null }));
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('no-bucket');
  });

  // ADR-0012 Track B, enforced a second time in the engine so a caller that bypasses the
  // schema still cannot produce a non-CC0 posterior.
  it('proposes a track posterior ONLY for a CC0 mbid: recording', () => {
    const cc0 = fb.evaluatePlay(play({ recordingKey: 'mbid:9f8e7d6c-1234-5678-9abc-def012345678' }));
    expect(cc0.posterior).toEqual({
      recordingKey: 'mbid:9f8e7d6c-1234-5678-9abc-def012345678', alpha: 1, beta: 0,
    });
    for (const restricted of ['spotify:track:4iV5W9uYEdYUVa79Axb7Rh', 'youtube:abc123', 'mbidfoo', 'MBID:x', '', null]) {
      const r = fb.evaluatePlay(play({ recordingKey: restricted }));
      expect(r.usable).toBe(true);      // the BUCKET still learns — that is Track A's whole point
      expect(r.posterior).toBeNull();
    }
  });

  it('signs the posterior by the reward: a negative outcome updates beta, never alpha', () => {
    const key = 'mbid:9f8e7d6c-1234-5678-9abc-def012345678';
    const bad = fb.evaluatePlay(play({
      samples: window({ slope: +0.05 }), events: [{ type: 'skip', positionMs: 5_000 }], recordingKey: key,
    }));
    expect(bad.reward).toBeLessThan(0);
    expect(bad.posterior).toEqual({ recordingKey: key, alpha: 0, beta: 1 });
  });

  it('emits no track identity and no numeric vital in the telemetry line (§0.2.2)', () => {
    const r = fb.evaluatePlay(play({ recordingKey: 'mbid:9f8e7d6c-1234-5678-9abc-def012345678' }));
    expect(typeof r.telemetry).toBe('string');
    expect(r.telemetry).not.toContain('mbid:');
    expect(r.telemetry).not.toContain('acute-stress');
    // The window's heart rates are 70 bpm and its slope is a physiological rate — neither may
    // appear in a line destined for stdout.
    expect(r.telemetry).not.toMatch(/\b70\b/);
    expect(r.telemetry).not.toContain(String(r.components.biometric.observedSlope));
  });
});

describe('W4-011 · feedbackLoop — numerical hygiene (§0.4 S8) and replay discipline (S9)', () => {
  it('survives 300 rounds of hostile input with a finite, bounded reward and never throws', () => {
    const rng = createRng('w4-011-feedback-fuzz');
    const junk = [null, undefined, NaN, Infinity, -Infinity, 0, -0, '', 'x', true, false, [], {}];
    const bands = [...taxonomy.BANDS, null, 'nope'];
    const archetypes = [...taxonomy.TRAJECTORY_ARCHETYPES, null, 'nope'];
    const types = ['skip', 'complete', 'save', 'shared', null];

    for (let round = 0; round < 300; round++) {
      const n = rng.int(12);
      const samples = Array.from({ length: n }, (_, i) => (
        rng.bernoulli(0.25)
          ? { atMs: rng.pick(junk), value: rng.pick(junk) }
          : { atMs: 1_700_000_000_000 + i * rng.range(1, 60_000), value: rng.range(-50, 400) }
      ));
      const events = Array.from({ length: rng.int(4) }, () => ({
        type: rng.pick(types), positionMs: rng.bernoulli(0.5) ? rng.pick(junk) : rng.range(-1e9, 1e9),
      }));

      const out = fb.evaluatePlay({
        samples,
        expectedSlope: rng.bernoulli(0.4) ? rng.pick(junk) : rng.range(-20, 20),
        archetype: rng.pick(archetypes),
        events,
        stateId: rng.bernoulli(0.5) ? rng.pick(taxonomy.STATES).id : rng.pick(junk),
        targetBand: rng.pick(bands),
        hourOfDay: rng.bernoulli(0.5) ? rng.range(-5, 30) : rng.pick(junk),
        recordingKey: rng.pick([...junk, 'mbid:abc', 'spotify:track:x']),
      });

      expect(Number.isFinite(out.reward)).toBe(true);
      expect(out.reward).toBeGreaterThanOrEqual(-1);
      expect(out.reward).toBeLessThanOrEqual(1);
      expect(typeof out.usable).toBe('boolean');
      if (!out.usable) expect(out.reward).toBe(0);
      if (out.bucket) {
        expect(taxonomy.DOMAINS).toContain(out.bucket.stateDomain);
        expect(taxonomy.BANDS).toContain(out.bucket.targetBand);
        expect(Number.isInteger(out.bucket.hourBin)).toBe(true);
      }
      if (out.posterior) expect(out.posterior.recordingKey.startsWith('mbid:')).toBe(true);
    }
  });

  it('is deterministic: the same play judged twice gives byte-identical output', () => {
    const args = {
      samples: window({ slope: -0.031 }), expectedSlope: 0.004, archetype: 'monotone-wind-down',
      events: [{ type: 'skip', positionMs: 44_000 }], stateId: 'evening-unwind',
      targetBand: 'resting', hourOfDay: 21, recordingKey: 'mbid:abc',
    };
    expect(JSON.stringify(fb.evaluatePlay(args))).toBe(JSON.stringify(fb.evaluatePlay(args)));
  });

  it('reaches for no global clock and no global RNG (§0.4 S9)', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../app/agents/runtime/learning/feedbackLoop.js'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/Date\.now\s*\(/);
    expect(src).not.toMatch(/Math\.random\s*\(/);
    expect(src).not.toMatch(/new Date\s*\(\s*\)/);
  });
});
