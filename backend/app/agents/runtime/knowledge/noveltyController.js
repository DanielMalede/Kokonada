'use strict';

const { posteriorDelta } = require('../learning/feedbackLoop');

/**
 * W4-013 (B5) · the novelty bandit — how much of a playlist should be music the listener has
 * never heard.
 *
 * The question is a genuine explore/exploit trade-off and it is CONTEXTUAL: the same person who
 * welcomes an unknown track on a Sunday morning skips it three times in a row mid-interval. So
 * the posterior is held per context bucket — the same `{stateDomain, targetBand, hourBin}`
 * address W4-011's rewards already use — and Thompson sampling turns it into a budget.
 *
 * ── WHY THE BANDIT ABSTAINS INSTEAD OF SAMPLING ITS PRIOR ───────────────────────────────────
 *
 * §M.14 says "sample θ; noveltyBudget = round(k·min(0.3, θ))", and read literally that is what
 * an untouched Beta(2,2) does too: it returns a draw centred on 0.5, so a listener the system
 * knows NOTHING about would have their playlist capped at a random share of novelty that changes
 * on every generation. That is not exploration, it is noise wearing exploration's clothes — the
 * draw carries no information because the posterior carries none, and the cost is a real user's
 * real playlist reshuffled by a coin flip.
 *
 * So `planNovelty` returns a NULL budget until the bucket has at least one observation, and the
 * pipeline reads null as "impose no quota" — the discovery share stays exactly what the scorer
 * and MMR make it, which is today's behaviour byte for byte. This is the same posture W4-011
 * took when it chose a NO-OP over a zero: a learner with nothing to say should say nothing.
 * It is also what makes the DORMANCY INVARIANT a property of the maths rather than of a flag.
 *
 * ── WHY THE OUTCOME RULE IS BROADER THAN §M.14's WORDING ────────────────────────────────────
 *
 * §M.14 writes the update as "positive discovery reward → α+=1, early skip → β+=1". Taken
 * literally the LATE skip (−0.3 in the behavioural table) would be no evidence at all, which
 * cannot be right: a listener who skips a novel track two minutes in has still rejected it, and
 * the reward that reaches this module has already combined physiology and behaviour into one
 * signed scalar. `outcomeDelta` therefore delegates to `feedbackLoop.posteriorDelta` — the Beta
 * update this repo already pins for Track B — so positive is success, negative is failure, and
 * there is exactly ONE Beta rule in the codebase rather than two that drift (the D11 / W4-D42
 * "second disagreeing table" class this wave keeps finding).
 *
 * ── COMPLIANCE (ADR-0011 / 0012) ────────────────────────────────────────────────────────────
 *
 * Nothing here touches track identity of any provider. The posterior is addressed by a coarse
 * context bucket and the observation that moves it is a bounded scalar, so this is squarely
 * ADR-0012 Track A — the track that may legitimately learn from Spotify-served plays precisely
 * BECAUSE it records nothing about which recording was served. A per-recording novelty posterior
 * would be Track B and would need the `mbid:` gate; this one deliberately is not that.
 *
 * PURE and clock-free (§0.4 S9): `rng` is a parameter, `now` is never read, and the caller owns
 * both the posterior it passes in and the decision to persist what comes back.
 */

/**
 * §M.14. Beta(2,2) rather than the uniform Beta(1,1) `TrackPosterior` uses: 2,2 is weakly
 * informative and unimodal at 0.5, so the first success cannot drive θ to ~1.0 the way it can
 * under a uniform prior. That matters more here than for a track posterior, because this
 * posterior spends a real listener's playlist rather than ranking within one.
 */
const NOVELTY_PRIOR = Object.freeze({ alpha: 2, beta: 2 });

/**
 * §M.14's hard ceiling. Even a bucket where novelty has never once failed spends at most 30% of
 * the playlist on it — the remaining 70% is the listener's own library, which is what they came
 * for. The cap is on the BUDGET, not on the posterior, so a confident bucket saturates here
 * rather than being talked out of its confidence.
 */
const MAX_NOVELTY_SHARE = 0.3;

/**
 * §0.4 S11 with the sign deliberately inverted. Every other wave-4 switch is a KILL switch
 * (unset = new behaviour on); this one is an ENABLE switch, because §3 lists W4-013 as STRETCH
 * and says in as many words that it "ships dark". Unset means the quota is never computed, never
 * read from Mongo, and never appears in telemetry.
 */
const NOVELTY_FLAG = 'WAVE4_NOVELTY_BANDIT';

/**
 * Marsaglia–Tsang rejects a candidate ~2–5% of the time, so a hundred consecutive rejections is
 * not bad luck — it is a broken rng (one stuck at a constant, say). The loop is bounded and the
 * fallback is the posterior MEAN, which is the honest degradation: it is what Thompson sampling
 * converges to anyway once the evidence is strong, and it is never NaN.
 */
const MAX_GAMMA_ITERATIONS = 100;

const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);

/** Read a bare `() => [0,1)` rng into the open interval (0,1) so every log below is in domain. */
function _unit(rng) {
  const u = typeof rng === 'function' ? Number(rng()) : NaN;
  if (!Number.isFinite(u)) return 0.5;
  return Math.min(1 - 1e-12, Math.max(1e-12, u));
}

/** Standard normal by Box–Muller. Both uniforms drawn per call; the second variate is discarded. */
function _gaussian(rng) {
  const u1 = _unit(rng);
  const u2 = _unit(rng);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Gamma(shape ≥ 1, scale 1) by Marsaglia–Tsang (2000), "A Simple Method for Generating Gamma
 * Variables", ACM TOMS 26(3). Chosen over the sum-of-exponentials identity that also works for
 * the integer shapes this module produces: that one costs O(shape) logarithms per draw, so a
 * bucket with four hundred observations would silently become four hundred times more expensive
 * to plan than a fresh one. Marsaglia–Tsang is O(1) in expectation for any real shape ≥ 1.
 *
 * Returns null when the bounded loop gives up, so the caller can degrade explicitly.
 */
function _gamma1(shape, rng) {
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < MAX_GAMMA_ITERATIONS; i++) {
    const x = _gaussian(rng);
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = _unit(rng);
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  return null;
}

/**
 * One Thompson draw θ ~ Beta(alpha, beta), via the Gamma ratio X/(X+Y).
 *
 * Both shapes are ≥ 1 by construction here (the prior is 2,2 and observations only ever add),
 * so the ≥1 branch of Marsaglia–Tsang is the only one needed; a shape that arrives below 1
 * anyway is a corrupt row, and corrupt rows fall back to the mean rather than to a NaN that
 * would propagate into a playlist size.
 */
function sampleBeta(alpha, beta, rng) {
  const a = isFiniteNumber(alpha) && alpha > 0 ? alpha : null;
  const b = isFiniteNumber(beta) && beta > 0 ? beta : null;
  if (a == null || b == null) return 0.5;

  const mean = a / (a + b);
  if (a < 1 || b < 1) return mean;

  const x = _gamma1(a, rng);
  const y = _gamma1(b, rng);
  if (x == null || y == null) return mean;

  const sum = x + y;
  if (!Number.isFinite(sum) || sum <= 0) return mean;

  // Nudged off the closed endpoints: a θ of exactly 0 or 1 is an assertion of certainty that a
  // Beta posterior with finite evidence never actually makes.
  return Math.min(1 - 1e-12, Math.max(1e-12, x / sum));
}

/** How many real observations a posterior carries, over and above the prior it started at. */
function observations(posterior) {
  if (!posterior || typeof posterior !== 'object') return 0;
  const a = isFiniteNumber(posterior.alpha) ? posterior.alpha : NOVELTY_PRIOR.alpha;
  const b = isFiniteNumber(posterior.beta) ? posterior.beta : NOVELTY_PRIOR.beta;
  return Math.max(0, (a - NOVELTY_PRIOR.alpha) + (b - NOVELTY_PRIOR.beta));
}

/**
 * Decide this generation's novelty quota.
 *
 * `{budget: null}` means ABSTAIN — impose no quota at all. It is not the same as `{budget: 0}`,
 * which is an active decision that this listener wants no novelty in this context right now.
 *
 * `theta` may be supplied directly instead of an rng. That is not a test affordance: it is how a
 * caller replays a decision it has already logged, and it keeps this function total when there
 * is no random source to hand.
 */
function planNovelty({ posterior = null, k = null, rng = null, theta = null } = {}) {
  const size = isFiniteNumber(k) && k >= 0 ? Math.floor(k) : null;
  if (size == null) return { budget: null, theta: null, reason: 'no-k' };

  if (observations(posterior) <= 0) return { budget: null, theta: null, reason: 'no-evidence' };

  const drawn = isFiniteNumber(theta)
    ? Math.min(1, Math.max(0, theta))
    : sampleBeta(posterior.alpha, posterior.beta, rng);

  const share = Math.min(MAX_NOVELTY_SHARE, drawn);
  const budget = Math.min(size, Math.max(0, Math.round(size * share)));
  return { budget, theta: drawn, reason: null };
}

/**
 * Turn one finished play into a Beta observation for the bucket's novelty posterior — or into
 * nothing at all, which is the common case.
 *
 * `wasDiscovery` is a TRI-state and the third state is load-bearing. Today's shipped client
 * reports a skip with no track key, so which track was skipped is genuinely unknown; reading
 * unknown as `false` would let every silent client repeatedly assert that novelty was not
 * involved, and the bandit would learn a fact nobody ever observed.
 */
function outcomeDelta({ wasDiscovery = null, reward = null } = {}) {
  if (wasDiscovery !== true) return null;
  if (!isFiniteNumber(reward) || reward === 0) return null;
  const delta = posteriorDelta(reward);
  return delta.alpha > 0 || delta.beta > 0 ? delta : null;
}

/** §3: STRETCH work ships dark, so this is an opt-IN flag. See NOVELTY_FLAG. */
function enabled(env = process.env) {
  const v = String(env?.[NOVELTY_FLAG] ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

module.exports = {
  NOVELTY_PRIOR,
  MAX_NOVELTY_SHARE,
  NOVELTY_FLAG,
  MAX_GAMMA_ITERATIONS,
  sampleBeta,
  observations,
  planNovelty,
  outcomeDelta,
  enabled,
};
