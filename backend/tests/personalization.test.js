'use strict';

// W4-013 (B7) — the PERSONAL WEIGHTS engine, in isolation.
//
// §M.15 is three lines: `w_user = clamp(w_global·(1+δ), 0.6·w_global, 1.4·w_global)`,
// `δ ← δ + 0.02·r·∂`, weekly `δ ← 0.98·δ`. It never says what `∂` is, and that omission is
// where the whole design lives — so the first block below pins the DERIVATION, not just the
// arithmetic. The rest pins the two properties that make a learner safe to dark-launch: it is
// byte-identically dormant until it has evidence, and it can never leave the trust region no
// matter what a corrupt row hands it.

const P = require('../app/agents/runtime/learning/personalization');

/** The v2 mood weights, already normalised to Σ = 1 over the five scoring terms. */
const GLOBAL = Object.freeze({
  taste: 0.35, feature: 0.30, genre: 0.20, discovery: 0.10, rotation: 0.05, exposure: 0.40,
});

const sumScoring = (w) => P.PERSONAL_TERMS.concat('discovery').reduce((s, d) => s + w[d], 0);

describe('W4-013 · the gradient is derived, not asserted', () => {
  it('centres every term on the preference score the weights actually produced', () => {
    const weights = { taste: 0.5, feature: 0.5, genre: 0, discovery: 0, rotation: 0 };
    const terms = {
      tasteAffinity: 1, featureDistance: 0, moodGenreFit: 0.25, provenRotation: 0, discoveryBonus: 0,
    };
    // p = 0.5·1 + 0.5·0 = 0.5 → g = k − p.
    expect(P.gradientOf({ terms, weights })).toEqual({
      taste: 0.5, feature: -0.5, genre: -0.25, rotation: -0.5,
    });
  });

  it('sums the gradient to ~0 under the weights that produced it (it is a reallocation)', () => {
    const weights = { taste: 0.35, feature: 0.30, genre: 0.20, discovery: 0.10, rotation: 0.05 };
    const terms = {
      tasteAffinity: 0.8, featureDistance: 0.6, moodGenreFit: 0.4, provenRotation: 0.2, discoveryBonus: 0,
    };
    const g = P.gradientOf({ terms, weights });
    const p = 0.35 * 0.8 + 0.30 * 0.6 + 0.20 * 0.4 + 0.05 * 0.2;
    // Σ w_d·(k_d − p) = p − p·Σw = 0 when Σw = 1. A uniform push is a no-op after
    // renormalisation, so a gradient that did NOT centre could not move the ranking at all.
    const weighted = P.PERSONAL_TERMS.reduce((s, d) => s + weights[d] * g[d], 0)
      + weights.discovery * (0 - p);
    expect(Math.abs(weighted)).toBeLessThan(1e-12);
    expect(g.taste).toBeCloseTo(0.8 - p, 12);
  });

  it('reads a discovery bonus as the indicator it is, not as its magnitude', () => {
    const weights = { taste: 0, feature: 0, genre: 0, discovery: 1, rotation: 0 };
    const withBonus = P.gradientOf({
      terms: { tasteAffinity: 0, featureDistance: 0, moodGenreFit: 0, provenRotation: 0, discoveryBonus: 0.1 },
      weights,
    });
    // p = 1·1 = 1 (the indicator), so every learnable term sits a full unit below it.
    expect(withBonus.taste).toBe(-1);
  });

  it('abstains rather than inventing a gradient from unusable terms', () => {
    expect(P.gradientOf({ terms: null, weights: GLOBAL })).toBeNull();
    expect(P.gradientOf({ terms: {}, weights: null })).toBeNull();
    expect(P.gradientOf({
      terms: { tasteAffinity: NaN, featureDistance: NaN, moodGenreFit: NaN, provenRotation: NaN },
      weights: GLOBAL,
    })).toBeNull();
  });

  it('clamps every component into [-1, 1] even when handed nonsense magnitudes', () => {
    const g = P.gradientOf({
      terms: { tasteAffinity: 1e9, featureDistance: -1e9, moodGenreFit: 0, provenRotation: 0, discoveryBonus: 0 },
      weights: { taste: 0.5, feature: 0.5, genre: 0, discovery: 0, rotation: 0 },
    });
    for (const d of P.PERSONAL_TERMS) {
      expect(g[d]).toBeGreaterThanOrEqual(-1);
      expect(g[d]).toBeLessThanOrEqual(1);
    }
  });
});

describe('W4-013 · the step (§M.15 δ ← δ + 0.02·r·∂)', () => {
  const g = { taste: 0.5, feature: -0.5, genre: 0.25, rotation: 0 };

  it('scales the gradient by the reward and the learning rate', () => {
    const step = P.stepFrom({ gradient: g, reward: 1 });
    expect(step.taste).toBeCloseTo(P.LEARNING_RATE * 0.5, 12);
    expect(step.feature).toBeCloseTo(-P.LEARNING_RATE * 0.5, 12);
  });

  it('reverses direction on a negative reward', () => {
    const up = P.stepFrom({ gradient: g, reward: 1 });
    const down = P.stepFrom({ gradient: g, reward: -1 });
    expect(down.taste).toBeCloseTo(-up.taste, 12);
  });

  it('is NULL — not a zero step — when there is no evidence', () => {
    expect(P.stepFrom({ gradient: g, reward: 0 })).toBeNull();
    expect(P.stepFrom({ gradient: g, reward: NaN })).toBeNull();
    expect(P.stepFrom({ gradient: null, reward: 1 })).toBeNull();
    expect(P.stepFrom({ gradient: { taste: 0, feature: 0, genre: 0, rotation: 0 }, reward: 1 })).toBeNull();
  });
});

describe('W4-013 · the trust region binds on the STATE, not only on the output', () => {
  it('clamps δ at ±0.4, which is exactly the [0.6, 1.4] window §M.15 puts on w', () => {
    expect(P.DELTA_LIMIT).toBeCloseTo(P.TRUST_REGION.hi - 1, 12);
    expect(P.DELTA_LIMIT).toBeCloseTo(1 - P.TRUST_REGION.lo, 12);
  });

  it('cannot be walked out of the region by repeated same-sign steps (no integrator windup)', () => {
    let deltas = P.ZERO_DELTAS;
    const step = { taste: 0.02, feature: -0.02, genre: 0, rotation: 0 };
    for (let i = 0; i < 500; i++) deltas = P.applyStep(deltas, step);
    expect(deltas.taste).toBeCloseTo(P.DELTA_LIMIT, 12);
    expect(deltas.feature).toBeCloseTo(-P.DELTA_LIMIT, 12);
  });

  it('recovers within a bounded number of opposite steps once it is saturated', () => {
    // The windup this pins the absence of: an UNCLAMPED δ walked to +10 by 500 steps would need
    // 500 more to come back. A clamped one is one step from the boundary at all times.
    let deltas = { ...P.ZERO_DELTAS, taste: P.DELTA_LIMIT };
    deltas = P.applyStep(deltas, { taste: -0.02, feature: 0, genre: 0, rotation: 0 });
    expect(deltas.taste).toBeCloseTo(P.DELTA_LIMIT - 0.02, 12);
  });

  it('sanitises a corrupt stored delta instead of propagating it', () => {
    const out = P.applyStep({ taste: NaN, feature: Infinity, genre: 99, rotation: -99 }, P.ZERO_DELTAS);
    // Two different corruptions, two different safe readings, and the difference is the point.
    // A NON-FINITE stored value carries no information at all, so it falls back to 0 — global
    // weights, the cold start. An out-of-range FINITE value is a real preference that overshot
    // its bound, so it is pulled to the bound rather than thrown away. Reading Infinity as
    // "maximal preference" would let a corrupt row assert the strongest opinion in the system.
    expect(out.taste).toBe(0);
    expect(out.feature).toBe(0);
    expect(out.genre).toBeCloseTo(P.DELTA_LIMIT, 12);
    expect(out.rotation).toBeCloseTo(-P.DELTA_LIMIT, 12);
  });
});

describe('W4-013 · shrink-to-global is continuous, not a weekly cliff', () => {
  it('applies §M.15 0.98 over exactly one week', () => {
    const out = P.decay({ ...P.ZERO_DELTAS, taste: 0.4 }, { elapsedMs: P.SHRINK_WEEK_MS });
    expect(out.taste).toBeCloseTo(0.4 * P.SHRINK_PER_WEEK, 12);
  });

  it('composes: two half-weeks equal one week (a missed run cannot skip decay)', () => {
    const half = P.SHRINK_WEEK_MS / 2;
    const once = P.decay({ ...P.ZERO_DELTAS, taste: 0.4 }, { elapsedMs: P.SHRINK_WEEK_MS });
    const twice = P.decay(P.decay({ ...P.ZERO_DELTAS, taste: 0.4 }, { elapsedMs: half }), { elapsedMs: half });
    expect(twice.taste).toBeCloseTo(once.taste, 12);
  });

  it('converges to global rather than to some other fixed point', () => {
    let d = { ...P.ZERO_DELTAS, taste: 0.4 };
    for (let i = 0; i < 2000; i++) d = P.decay(d, { elapsedMs: P.SHRINK_WEEK_MS });
    expect(d.taste).toBeCloseTo(0, 9);
  });

  it('never AMPLIFIES on a backwards clock', () => {
    const out = P.decay({ ...P.ZERO_DELTAS, taste: 0.4 }, { elapsedMs: -P.SHRINK_WEEK_MS * 10 });
    expect(out.taste).toBeCloseTo(0.4, 12);
  });

  it('treats an unusable elapsed time as no elapsed time', () => {
    expect(P.decay({ ...P.ZERO_DELTAS, taste: 0.4 }, { elapsedMs: NaN }).taste).toBeCloseTo(0.4, 12);
    expect(P.decay({ ...P.ZERO_DELTAS, taste: 0.4 }, {}).taste).toBeCloseTo(0.4, 12);
  });
});

describe('W4-013 · the DORMANCY INVARIANT', () => {
  it('returns the callers OWN weights object when there is nothing learned', () => {
    // Identity, not equality. Byte-identical selection is then a property of the maths rather
    // than of a float comparison that happens to hold today (the B5 abstention precedent).
    expect(P.overlay(GLOBAL, null)).toBe(GLOBAL);
    expect(P.overlay(GLOBAL, P.ZERO_DELTAS)).toBe(GLOBAL);
    expect(P.overlay(GLOBAL, { taste: 0, feature: 0, genre: 0, rotation: 0 })).toBe(GLOBAL);
  });

  it('returns the callers own weights when every delta is unusable', () => {
    expect(P.overlay(GLOBAL, { taste: NaN, feature: undefined, genre: null, rotation: 'x' })).toBe(GLOBAL);
  });

  it('effectiveDeltas is NULL for a cold-start user (no row at all)', () => {
    expect(P.effectiveDeltas(null, { now: 0 })).toBeNull();
    expect(P.effectiveDeltas({}, { now: 0 })).toBeNull();
    expect(P.effectiveDeltas({ deltas: P.ZERO_DELTAS, updatedAt: new Date(0) }, { now: 0 })).toBeNull();
  });

  it('effectiveDeltas decays a stored row forward to NOW without writing anything', () => {
    const row = { deltas: { ...P.ZERO_DELTAS, taste: 0.4 }, updatedAt: new Date(0) };
    const out = P.effectiveDeltas(row, { now: P.SHRINK_WEEK_MS });
    expect(out.taste).toBeCloseTo(0.4 * P.SHRINK_PER_WEEK, 12);
    // The row is untouched: this is a read-side computation, not a mutation.
    expect(row.deltas.taste).toBe(0.4);
  });

  it('effectiveDeltas returns null once decay has taken the row below usefulness', () => {
    const row = { deltas: { ...P.ZERO_DELTAS, taste: 1e-9 }, updatedAt: new Date(0) };
    expect(P.effectiveDeltas(row, { now: 0 })).toBeNull();
  });
});

describe('W4-013 · the overlay (§M.15 w_user = clamp(w_global·(1+δ), 0.6·w_global, 1.4·w_global))', () => {
  it('keeps the v2 sum-to-one invariant the scorer depends on', () => {
    const out = P.overlay(GLOBAL, { taste: 0.4, feature: -0.4, genre: 0.2, rotation: 0 });
    expect(sumScoring(out)).toBeCloseTo(1, 12);
  });

  it('re-allocates toward the term the learner rewarded', () => {
    const out = P.overlay(GLOBAL, { taste: 0.4, feature: -0.4, genre: 0, rotation: 0 });
    expect(out.taste).toBeGreaterThan(GLOBAL.taste);
    expect(out.feature).toBeLessThan(GLOBAL.feature);
  });

  it('never moves a weight outside the trust region, even from a corrupt delta', () => {
    // The bound holds on the SERVED weights, after renormalisation — which is the only place it
    // means anything. A component-wise clamp followed by a renormalise does NOT deliver this:
    // this exact input lands `feature` at 0.588·w under that reading. See the overlay header.
    const out = P.overlay(GLOBAL, { taste: 99, feature: -99, genre: 0, rotation: 0 });
    expect(out.feature / GLOBAL.feature).toBeCloseTo(P.TRUST_REGION.lo, 12);
    expect(out.taste / GLOBAL.taste).toBeLessThanOrEqual(P.TRUST_REGION.hi + 1e-12);
    expect(sumScoring(out)).toBeCloseTo(1, 12);
  });

  it('holds the region over 20k random weight tables and delta vectors (fuzz, §0.4 S8)', () => {
    // Deterministic LCG — no Math.random in a pin whose failure has to be reproducible.
    let seed = 20130713;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const ALL = P.PERSONAL_TERMS.concat('discovery');

    // Extremes accumulated in plain JS and asserted ONCE. A `expect()` per component per round
    // is 400k matcher invocations, and the jest sandbox makes each one ~21x the cost of the
    // arithmetic it is checking (W4-D30) — 30 s of suite time to verify what four numbers say.
    let minRatio = Infinity;
    let maxRatio = -Infinity;
    let worstSum = 0;
    let nonFinite = 0;
    let exposureMoved = 0;

    for (let i = 0; i < 20000; i++) {
      const raw = {};
      for (const d of ALL) raw[d] = rnd();
      const mass = ALL.reduce((s, d) => s + raw[d], 0);
      const w = { exposure: 0.4 };
      for (const d of ALL) w[d] = raw[d] / mass; // normalised, as the scorer guarantees

      const deltas = {};
      for (const d of P.PERSONAL_TERMS) deltas[d] = (rnd() * 2 - 1) * P.DELTA_LIMIT;

      const out = P.overlay(w, deltas);
      worstSum = Math.max(worstSum, Math.abs(ALL.reduce((s, d) => s + out[d], 0) - 1));
      for (const d of ALL) {
        if (!Number.isFinite(out[d])) nonFinite++;
        const ratio = out[d] / w[d];
        if (ratio < minRatio) minRatio = ratio;
        if (ratio > maxRatio) maxRatio = ratio;
      }
      if (out.exposure !== 0.4) exposureMoved++;
    }

    expect(nonFinite).toBe(0);
    expect(exposureMoved).toBe(0);
    expect(worstSum).toBeLessThan(1e-10);
    expect(minRatio).toBeGreaterThanOrEqual(P.TRUST_REGION.lo - 1e-9);
    expect(maxRatio).toBeLessThanOrEqual(P.TRUST_REGION.hi + 1e-9);
    // Not vacuous: the fuzz must actually reach the boundary it is guarding, or it is only
    // pinning that the overlay does nothing much.
    expect(minRatio).toBeLessThan(P.TRUST_REGION.lo + 0.05);
    expect(maxRatio).toBeGreaterThan(P.TRUST_REGION.hi - 0.15);
  });

  it('leaves the renormalisation with nothing to do — centring already preserved the mass', () => {
    // The property the exactness rests on: Σ_d w_d·(1+δ_d) = Σ_d w_d once δ is w-centred, so the
    // divide-by-sum is an identity rather than a second, unbounded rescaling.
    const deltas = { taste: 0.4, feature: -0.4, genre: 0, rotation: 0 };
    const out = P.overlay(GLOBAL, deltas);
    const moved = P.PERSONAL_TERMS.concat('discovery').map((d) => out[d] / GLOBAL[d] - 1);
    // The centred vector is w-orthogonal: Σ w_d·(w'_d/w_d − 1) = 0.
    const orth = P.PERSONAL_TERMS.concat('discovery')
      .reduce((s, d, i) => s + GLOBAL[d] * moved[i], 0);
    expect(Math.abs(orth)).toBeLessThan(1e-12);
  });

  it('leaves the exposure penalty alone — it is not one of the competing preferences', () => {
    const out = P.overlay(GLOBAL, { taste: 0.4, feature: -0.4, genre: 0, rotation: 0 });
    expect(out.exposure).toBe(GLOBAL.exposure);
  });

  it('leaves DISCOVERY alone — the B5 bandit already owns how much novelty a playlist gets', () => {
    const out = P.overlay(GLOBAL, { taste: 0.4, feature: -0.4, genre: 0, rotation: 0, discovery: 0.4 });
    // Its share moves only by renormalisation, never by a δ of its own: two learners on one
    // quantity is the D11 / W4-D42 "second disagreeing table" class.
    expect(P.PERSONAL_TERMS).not.toContain('discovery');
    const ratio = out.discovery / GLOBAL.discovery;
    const genreRatio = out.genre / GLOBAL.genre;
    expect(ratio).toBeCloseTo(genreRatio, 12); // both moved by the SAME renormalisation factor
  });

  it('returns the input weights unchanged rather than dividing by zero', () => {
    const dead = { taste: 0, feature: 0, genre: 0, discovery: 0, rotation: 0, exposure: 0.4 };
    expect(P.overlay(dead, { taste: 0.4, feature: -0.4, genre: 0, rotation: 0 })).toBe(dead);
  });

  it('is idempotent in the sense that overlaying twice with zero deltas changes nothing', () => {
    const once = P.overlay(GLOBAL, { taste: 0.4, feature: -0.4, genre: 0, rotation: 0 });
    expect(P.overlay(once, P.ZERO_DELTAS)).toBe(once);
  });

  it('produces a FROZEN object so no consumer can mutate a shared weight table', () => {
    const out = P.overlay(GLOBAL, { taste: 0.4, feature: -0.4, genre: 0, rotation: 0 });
    expect(Object.isFrozen(out)).toBe(true);
  });
});

describe('W4-013 · S11 — B7 ships dark behind an opt-IN flag', () => {
  it('is off when unset, off on anything false-ish, on for true/1', () => {
    expect(P.enabled({})).toBe(false);
    expect(P.enabled({ [P.PERSONAL_FLAG]: '' })).toBe(false);
    expect(P.enabled({ [P.PERSONAL_FLAG]: 'false' })).toBe(false);
    expect(P.enabled({ [P.PERSONAL_FLAG]: 'true' })).toBe(true);
    expect(P.enabled({ [P.PERSONAL_FLAG]: '1' })).toBe(true);
    expect(P.enabled(null)).toBe(false);
  });
});

describe('W4-013 · S15 telemetry carries no vital, no track and no state label', () => {
  it('names the deltas it applied and nothing else', () => {
    const line = P.telemetryLine({
      deltas: { taste: 0.123, feature: -0.05, genre: 0, rotation: 0 }, reason: null, updates: 7,
    });
    expect(line.startsWith('[personal]')).toBe(true);
    expect(line).toContain('taste=0.123');
    expect(line).toContain('n=7');
    expect(line.split('\n')).toHaveLength(1);
    expect(line).not.toMatch(/\b(hr|bpm|hrv|rmssd)\b/i);
  });

  it('names an abstention rather than printing a fake overlay', () => {
    expect(P.telemetryLine({ deltas: null, reason: 'cold-start', updates: 0 })).toContain('reason=cold-start');
  });
});

describe('W4-013 · §0.4 S9 — the engine is pure and clock-free', () => {
  it('reads no clock and no rng', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../app/agents/runtime/learning/personalization.js'), 'utf8',
    );
    expect(src).not.toMatch(/Date\.now\(\)/);
    expect(src).not.toMatch(/Math\.random\(\)/);
    expect(src).not.toMatch(/new Date\(\)/);
  });
});
