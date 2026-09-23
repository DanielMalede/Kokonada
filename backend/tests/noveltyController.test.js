'use strict';

/**
 * W4-013 (B5) · the novelty bandit's pure core.
 *
 * Everything here runs against an INJECTED rng (§0.4 S9), so every assertion below is a fact
 * about the maths rather than about a lucky afternoon. The seeded generator is `sim/rng` — the
 * same one the personas use — because a bandit that cannot be replayed cannot be root-caused.
 */

const { createRng } = require('../sim/rng');
const novelty = require('../app/agents/runtime/knowledge/noveltyController');

const rngFrom = (seed) => {
  const r = createRng(seed);
  return () => r.next();
};

/** Sample mean + variance of n draws, so the distribution claims are measured, not asserted. */
function moments(draws) {
  const n = draws.length;
  const mean = draws.reduce((a, b) => a + b, 0) / n;
  const variance = draws.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, variance };
}

const drawMany = (alpha, beta, n, seed) => {
  const rng = rngFrom(seed);
  return Array.from({ length: n }, () => novelty.sampleBeta(alpha, beta, rng));
};

describe('W4-013 · noveltyController — the prior and the shape of the budget', () => {
  test('§M.14 priors are Beta(2,2)', () => {
    expect(novelty.NOVELTY_PRIOR).toEqual({ alpha: 2, beta: 2 });
  });

  test('§M.14 caps novelty at 30% of the playlist', () => {
    expect(novelty.MAX_NOVELTY_SHARE).toBeCloseTo(0.3, 10);
  });
});

describe('W4-013 · sampleBeta — the Thompson draw', () => {
  test('recovers the mean and variance of Beta(2,2)', () => {
    const { mean, variance } = moments(drawMany(2, 2, 20000, 'beta-2-2'));
    // Beta(a,b): mean a/(a+b) = 0.5, var = ab/((a+b)^2 (a+b+1)) = 4/(16*5) = 0.05.
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
    expect(variance).toBeGreaterThan(0.045);
    expect(variance).toBeLessThan(0.055);
  });

  test('recovers the mean of a skewed posterior Beta(9,3)', () => {
    const { mean, variance } = moments(drawMany(9, 3, 20000, 'beta-9-3'));
    // mean 9/12 = 0.75, var = 27/(144*13) = 0.014423
    expect(mean).toBeGreaterThan(0.74);
    expect(mean).toBeLessThan(0.76);
    expect(variance).toBeGreaterThan(0.012);
    expect(variance).toBeLessThan(0.017);
  });

  test('concentrates as evidence accumulates — Beta(200,200) is far tighter than Beta(2,2)', () => {
    const wide = moments(drawMany(2, 2, 4000, 'wide'));
    const tight = moments(drawMany(200, 200, 4000, 'tight'));
    expect(tight.variance).toBeLessThan(wide.variance / 10);
    expect(tight.mean).toBeGreaterThan(0.48);
    expect(tight.mean).toBeLessThan(0.52);
  });

  test('every draw is a finite probability in (0,1)', () => {
    for (const d of drawMany(2, 2, 5000, 'bounds')) {
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(1);
    }
  });

  test('is deterministic given the seed — the same stream twice is the same draws', () => {
    expect(drawMany(5, 3, 200, 'same')).toEqual(drawMany(5, 3, 200, 'same'));
  });

  test('an rng pinned at 0 or at 1 still yields a finite probability (S8 log/domain guards)', () => {
    for (const stuck of [0, 1, 1 - Number.EPSILON]) {
      const d = novelty.sampleBeta(2, 2, () => stuck);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(1);
    }
  });

  test('a degenerate posterior falls back to its mean rather than to NaN', () => {
    const rng = rngFrom('degenerate');
    for (const [a, b] of [[0, 0], [-1, 4], [NaN, 2], [2, Infinity], [null, null]]) {
      const d = novelty.sampleBeta(a, b, rng);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
});

describe('W4-013 · planNovelty — abstain until there is evidence', () => {
  const rng = () => 0.5;

  test('ABSTAINS on a missing posterior — this is the dormancy invariant at its source', () => {
    const plan = novelty.planNovelty({ posterior: null, k: 50, rng });
    expect(plan.budget).toBeNull();
    expect(plan.reason).toBe('no-evidence');
  });

  test('ABSTAINS on a posterior still sitting exactly at the prior', () => {
    const plan = novelty.planNovelty({ posterior: { alpha: 2, beta: 2 }, k: 50, rng });
    expect(plan.budget).toBeNull();
    expect(plan.reason).toBe('no-evidence');
    expect(plan.theta).toBeNull();
  });

  test('a single observation is enough to start planning', () => {
    const plan = novelty.planNovelty({ posterior: { alpha: 3, beta: 2 }, k: 50, rng });
    expect(plan.budget).not.toBeNull();
    expect(plan.reason).toBeNull();
    expect(Number.isFinite(plan.theta)).toBe(true);
  });

  test('§M.14: budget = round(k · min(0.3, θ)) — the 30% cap binds on an enthusiastic draw', () => {
    // A posterior that has seen nothing but success still cannot spend more than 30% of the list.
    const plan = novelty.planNovelty({ posterior: { alpha: 400, beta: 2 }, k: 50, rng: () => 0.999 });
    expect(plan.theta).toBeGreaterThan(0.9);
    expect(plan.budget).toBe(15); // round(50 * 0.3)
  });

  test('a posterior that has only ever been skipped drives the budget to zero', () => {
    // Measured over a seeded stream rather than asserted off one draw: Thompson sampling is
    // stochastic by design, so "this bucket gets no novelty" is a claim about the DISTRIBUTION.
    // Beta(2,400) has mean 0.00497, and round(50·θ) is 0 for every θ < 0.01.
    const rng = rngFrom('all-skipped');
    const budgets = Array.from({ length: 2000 }, () => (
      novelty.planNovelty({ posterior: { alpha: 2, beta: 400 }, k: 50, rng }).budget
    ));
    const zero = budgets.filter((b) => b === 0).length;
    expect(zero / budgets.length).toBeGreaterThan(0.85);
    expect(Math.max(...budgets)).toBeLessThanOrEqual(2);

    // And at the posterior mean itself — the draw this bucket converges on — it is exactly 0.
    expect(novelty.planNovelty({ posterior: { alpha: 2, beta: 400 }, k: 50, theta: 2 / 402 }).budget).toBe(0);
  });

  test('the budget is monotone in θ at fixed k', () => {
    const at = (theta) => novelty.planNovelty({
      posterior: { alpha: 5, beta: 5 }, k: 50, rng: null, theta,
    }).budget;
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const b = at(t);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  test('the budget never exceeds k, even for a tiny playlist', () => {
    for (const k of [0, 1, 2, 3, 7, 50]) {
      const plan = novelty.planNovelty({ posterior: { alpha: 400, beta: 2 }, k, rng: () => 0.999 });
      expect(plan.budget).toBeGreaterThanOrEqual(0);
      expect(plan.budget).toBeLessThanOrEqual(k);
    }
  });

  test('a nonsense k abstains rather than inventing a quota', () => {
    for (const k of [null, undefined, -3, NaN, 'ten']) {
      expect(novelty.planNovelty({ posterior: { alpha: 9, beta: 2 }, k, rng }).budget).toBeNull();
    }
  });

  test('is deterministic given the seed', () => {
    const one = novelty.planNovelty({ posterior: { alpha: 9, beta: 4 }, k: 50, rng: rngFrom('plan') });
    const two = novelty.planNovelty({ posterior: { alpha: 9, beta: 4 }, k: 50, rng: rngFrom('plan') });
    expect(one).toEqual(two);
  });
});

describe('W4-013 · outcomeDelta — what teaches the bandit', () => {
  test('a positive reward on a DISCOVERY play is one success (§M.14 α+=1)', () => {
    expect(novelty.outcomeDelta({ wasDiscovery: true, reward: 0.4 })).toEqual({ alpha: 1, beta: 0 });
  });

  test('a negative reward on a DISCOVERY play is one failure (§M.14 β+=1)', () => {
    expect(novelty.outcomeDelta({ wasDiscovery: true, reward: -1 })).toEqual({ alpha: 0, beta: 1 });
  });

  test('a LATE skip counts as failure too — a skip is a skip', () => {
    // §M.14 names only "early skip" as the negative. A late skip scores -0.3 in the behavioural
    // table, and reading that as no evidence at all would be a second, disagreeing rule.
    expect(novelty.outcomeDelta({ wasDiscovery: true, reward: -0.3 })).toEqual({ alpha: 0, beta: 1 });
  });

  test('an exactly neutral reward teaches nothing', () => {
    expect(novelty.outcomeDelta({ wasDiscovery: true, reward: 0 })).toBeNull();
  });

  test('a FAMILIAR play teaches the novelty bandit nothing — it is not what was being tested', () => {
    expect(novelty.outcomeDelta({ wasDiscovery: false, reward: 1 })).toBeNull();
    expect(novelty.outcomeDelta({ wasDiscovery: false, reward: -1 })).toBeNull();
  });

  test('an UNKNOWN role teaches nothing — silence is not a familiar play', () => {
    // The tri-state is load-bearing: today's shipped client sends `track_skipped` with no
    // trackKey, so the role is genuinely unknown. Reading unknown as familiar would let every
    // silent client quietly assert that novelty was never involved.
    expect(novelty.outcomeDelta({ wasDiscovery: null, reward: -1 })).toBeNull();
    expect(novelty.outcomeDelta({ reward: -1 })).toBeNull();
  });

  test('a non-finite reward teaches nothing', () => {
    for (const reward of [NaN, Infinity, -Infinity, null, undefined, 'good']) {
      expect(novelty.outcomeDelta({ wasDiscovery: true, reward })).toBeNull();
    }
  });
});

describe('W4-013 · enabled — STRETCH work ships dark', () => {
  test('is OFF when the flag is unset', () => {
    expect(novelty.enabled({})).toBe(false);
  });

  test('is ON only for an affirmative value', () => {
    expect(novelty.enabled({ [novelty.NOVELTY_FLAG]: 'true' })).toBe(true);
    expect(novelty.enabled({ [novelty.NOVELTY_FLAG]: '1' })).toBe(true);
    expect(novelty.enabled({ [novelty.NOVELTY_FLAG]: 'TRUE' })).toBe(true);
  });

  test('is OFF for every negative or malformed value', () => {
    for (const v of ['', 'false', '0', 'no', 'off', 'yes-please']) {
      expect(novelty.enabled({ [novelty.NOVELTY_FLAG]: v })).toBe(false);
    }
  });
});
