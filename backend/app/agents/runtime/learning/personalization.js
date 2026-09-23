'use strict';

/**
 * W4-013 (B7) · PERSONAL WEIGHTS — the bounded trust-region overlay on the scorer.
 *
 * `selection/score.js` ranks a candidate as `Σ_d w_d·k_d − w_exp·exposure` with `Σ_d w_d = 1`
 * (§M.9). Those `w_d` are five numbers read out of the environment, identical for every listener
 * on the deployment: the person who chooses music almost entirely by how it FEELS in the body and
 * the person who wants their own library back are ranked by the same table. This module is the
 * seam `score.js`'s own ADR-0011 header reserved for the fix — a per-user overlay that moves those
 * weights, within a hard bound, from evidence the listener actually produced.
 *
 * ── WHAT `∂` IS (§M.15 does not say, and the answer is the whole design) ────────────────────
 *
 * §M.15 gives `δ ← δ + 0.02·r·∂` without defining `∂`. Read naively as "the partial derivative of
 * the score with respect to `w_d`" it is just `k_d`, the term's own value — and that reading is
 * provably useless HERE, because every `k_d ∈ [0,1]` is non-negative: a positive reward would push
 * all five weights up together, and the renormalisation that keeps `Σw = 1` would divide the whole
 * push straight back out. A gradient that cannot change a ranking is not a gradient.
 *
 * The correct derivative is of the NORMALISED score, which is what the scorer actually computes:
 *
 *     p = Σ_d w̃_d·k_d ,  w̃_d = w_d / Σ_j w_j
 *     ∂p/∂w_d = k_d/Σ_j w_j − (Σ_j w_j·k_j)/(Σ_j w_j)²  =  (k_d − p)/Σ_j w_j
 *
 * and with the `Σ_j w_j = 1` invariant the scorer already maintains, `∂ = k_d − p` exactly. So the
 * gradient is the term's value CENTRED on the preference score it helped produce: "this track was
 * unusually good on tempo/energy fit for its overall rank". A positive reward then buys that dim
 * more weight and pays for it out of the dims the track was ordinary on. It is a reallocation with
 * `Σ_d w_d·∂_d = 0` by construction (pinned by test), which is exactly right — the learner decides
 * the SHAPE of the ranking, never its scale.
 *
 * That derivation is also why the gradient needs no candidate-pool statistics: `p` is the track's
 * own preference score, so one served track plus the weights that served it is the complete input.
 *
 * ── WHY THE TRUST REGION IS ENFORCED ON δ AND NOT ONLY ON w ─────────────────────────────────
 *
 * §M.15 states the bound on the output: `w_user = clamp(w_global·(1+δ), 0.6·w_global,
 * 1.4·w_global)`. Applying it there alone leaves δ itself unbounded, and an unbounded accumulator
 * behind a saturating output is the textbook integrator-windup bug: five hundred positive rewards
 * walk δ to +10, the output sits pinned at 1.4·w the whole time, and then five hundred NEGATIVE
 * rewards are needed before the listener's first disagreement moves anything. Clamping δ to
 * ±0.4 is ALGEBRAICALLY THE SAME WINDOW (`1 ± 0.4` is `[0.6, 1.4]`) and makes the state always one
 * step from the boundary, so the overlay responds to a change of mind immediately. The output
 * clamp is kept anyway as defence in depth — a corrupt row is not a reason to serve a wild weight.
 *
 * ── WHY THE WEEKLY SHRINK IS A READ-TIME COMPUTATION AND NOT A JOB ──────────────────────────
 *
 * §M.15 asks for a weekly `δ ← 0.98·δ`. The obvious implementation is a repeatable BullMQ job —
 * and it would be the third one in this repo to walk a user population, after the one W4-D44
 * caught consolidating the same first 500 users by `_id` every night. Continuous decay makes the
 * job unnecessary: the stored δ is the value AS OF `updatedAt`, and every reader multiplies it by
 * `0.98^(elapsed/week)` on the way out. Same rate, same fixed point (global weights), no cliff at
 * the week boundary, no population walk, no write on the serving path, and a missed run cannot
 * skip a decay because there are no runs. The writer applies the identical factor before adding
 * its step, so the stored value and every reader's view stay consistent.
 *
 * ── COMPLIANCE (ADR-0011 / 0012) ────────────────────────────────────────────────────────────
 *
 * Squarely Track A. The learned artifact is four numbers describing how much this listener's own
 * RANKING should lean on affinity vs. biosonic fit vs. genre vs. proven rotation — it names no
 * recording, no provider and no catalogue of any kind, so it is not "derived functionality" over
 * Spotify Content in any sense ADR-0011 bars. The reward that moves it is the same bounded scalar
 * W4-011's buckets already learn from, and the gradient it multiplies is a residual of the
 * scorer's own output. A per-RECORDING weight would be Track B and would need the `mbid:` gate;
 * this deliberately is not that.
 *
 * PURE and clock-free (§0.4 S9): `now`/`elapsedMs` are parameters, no rng, and every function
 * returns a new object rather than mutating its input.
 */

/**
 * The learnable subset of `score._SCORING_TERMS`.
 *
 * `discovery` is deliberately NOT in it. B5's novelty bandit already decides how much of a
 * playlist is music the listener has never heard, from its own Beta posterior over its own
 * context bucket. A δ on `w_discovery` would be a SECOND learner moving the same quantity from
 * different evidence — the D11 / W4-D42 "second disagreeing table" class this wave keeps finding.
 * Its share still moves when the other four are re-allocated, but only by the renormalisation
 * every term shares, never by a decision of its own.
 *
 * `exposure` is not in it either, for a different reason: it sits OUTSIDE the Σ = 1 sum as a
 * subtractive penalty, so `w·(1+δ)` on it would not re-allocate anything — it would change the
 * scale of the anti-repetition guarantee. That is a product decision about fairness of rotation,
 * not something a reward signal gets to move.
 */
const PERSONAL_TERMS = Object.freeze(['taste', 'feature', 'genre', 'rotation']);

/** Every term the scorer normalises, in the order `score._normalizeWeights` uses. */
const SCORING_TERMS = Object.freeze([...PERSONAL_TERMS, 'discovery']);

/** §M.15's step size. A module constant, not an env read: see the W4-D26 finding. */
const LEARNING_RATE = 0.02;

/** §M.15's bound on `w_user / w_global`. */
const TRUST_REGION = Object.freeze({ lo: 0.6, hi: 1.4 });

/** The same window expressed on δ — see the windup paragraph in the header. */
const DELTA_LIMIT = 0.4;

/** §M.15's shrink-to-global, applied continuously at this rate. */
const SHRINK_PER_WEEK = 0.98;
const SHRINK_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Below this, a δ is indistinguishable from global weights at any precision a playlist can
 * express, so carrying it is noise. It is what makes "decayed away to nothing" and "never learned
 * anything" the same answer — both ABSTAIN, and both therefore serve today's ranking byte for byte.
 */
const NEGLIGIBLE_DELTA = 1e-6;

/**
 * §0.4 S11 with the sign inverted, exactly as B5's `WAVE4_NOVELTY_BANDIT` is. Every other wave-4
 * switch is a KILL switch (unset = new behaviour on); §3 lists W4-013 as STRETCH and says it
 * "ships dark", so this is an ENABLE switch. Unset means no overlay is read, no gradient is
 * captured, nothing is written and nothing appears in telemetry.
 */
const PERSONAL_FLAG = 'WAVE4_PERSONAL_WEIGHTS';

/** The cold-start state, and the value `applyStep` starts from when a row has no deltas yet. */
const ZERO_DELTAS = Object.freeze({ taste: 0, feature: 0, genre: 0, rotation: 0 });

const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);
const num = (x) => (isFiniteNumber(x) ? x : null);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const round3 = (x) => Math.round(x * 1000) / 1000;

/** A stored δ vector, sanitised: non-finite → 0, out-of-region → the region boundary. */
function _sane(deltas) {
  const out = {};
  for (const d of PERSONAL_TERMS) {
    const v = num(deltas?.[d]);
    out[d] = v == null ? 0 : clamp(v, -DELTA_LIMIT, DELTA_LIMIT);
  }
  return out;
}

/** True when every component is small enough that applying it could not change a ranking. */
function _negligible(deltas) {
  return PERSONAL_TERMS.every((d) => Math.abs(deltas[d]) < NEGLIGIBLE_DELTA);
}

/**
 * §M.15's `∂`, derived in the header: `k_d − p`, where `p` is the preference score those weights
 * produce for this track.
 *
 * Takes the scorer's own `terms` object and the weights that were actually in force — not the
 * `total`, which carries the exposure penalty and would bias every component by the same
 * repetition-dependent amount. Returns null when the terms carry no usable value at all; a
 * gradient invented from missing evidence is worse than no update.
 */
function gradientOf({ terms = null, weights = null } = {}) {
  if (!terms || typeof terms !== 'object' || !weights || typeof weights !== 'object') return null;

  const k = {
    taste: num(terms.tasteAffinity),
    feature: num(terms.featureDistance),
    genre: num(terms.moodGenreFit),
    rotation: num(terms.provenRotation),
    // The bonus is `w_discovery` when the track is a gamble and 0 otherwise, so the KERNEL it
    // stands for is the indicator, not the bonus's magnitude. Reading the magnitude would make
    // the discovery term's contribution to `p` quadratic in its own weight.
    discovery: num(terms.discoveryBonus) != null ? (terms.discoveryBonus > 0 ? 1 : 0) : null,
  };
  if (PERSONAL_TERMS.every((d) => k[d] == null)) return null;

  let p = 0;
  for (const d of SCORING_TERMS) {
    const w = num(weights[d]);
    if (w == null || k[d] == null) continue;
    p += w * k[d];
  }
  if (!Number.isFinite(p)) return null;

  const out = {};
  for (const d of PERSONAL_TERMS) out[d] = k[d] == null ? 0 : clamp(k[d] - p, -1, 1);
  return out;
}

/**
 * §M.15's `0.02·r·∂`, as a step vector — or NULL when the play taught nothing.
 *
 * NULL rather than a zero step, for the reason W4-011 chose a no-op over a zero and B5 chose an
 * abstention over a prior draw: a learner with nothing to say should say nothing, and a caller
 * that can see the difference can decline the write instead of touching a row to add zero.
 */
function stepFrom({ gradient = null, reward = null } = {}) {
  const r = num(reward);
  if (r == null || r === 0 || !gradient || typeof gradient !== 'object') return null;

  const out = {};
  let moved = false;
  for (const d of PERSONAL_TERMS) {
    const g = num(gradient[d]) ?? 0;
    out[d] = LEARNING_RATE * r * clamp(g, -1, 1);
    if (out[d] !== 0) moved = true;
  }
  return moved ? out : null;
}

/** Continuous shrink-to-global: `δ · 0.98^(elapsed / week)`. See the header for why not a job. */
function decay(deltas, { elapsedMs = null } = {}) {
  const sane = _sane(deltas);
  const ms = num(elapsedMs);
  // A backwards clock (NTP step, a row stamped in the future) must never AMPLIFY a δ. Treating
  // it as no elapsed time is the fail-safe direction: it delays a shrink, it cannot invent one.
  if (ms == null || ms <= 0) return sane;

  const factor = Math.pow(SHRINK_PER_WEEK, ms / SHRINK_WEEK_MS);
  if (!Number.isFinite(factor) || factor <= 0) return { ...ZERO_DELTAS };

  const out = {};
  for (const d of PERSONAL_TERMS) out[d] = clamp(sane[d] * factor, -DELTA_LIMIT, DELTA_LIMIT);
  return out;
}

/** `δ ← clamp(δ + step)`. The clamp is on the STATE — see the windup paragraph in the header. */
function applyStep(deltas, step) {
  const sane = _sane(deltas);
  const out = {};
  for (const d of PERSONAL_TERMS) {
    out[d] = clamp(sane[d] + (num(step?.[d]) ?? 0), -DELTA_LIMIT, DELTA_LIMIT);
  }
  return out;
}

/**
 * What a stored row means RIGHT NOW: its δ decayed forward from `updatedAt`, or NULL.
 *
 * NULL is the cold start and it is a real answer — no row, no deltas, or deltas that have shrunk
 * back into global weights. `overlay` turns all three into today's exact ranking.
 */
function effectiveDeltas(row, { now = null } = {}) {
  if (!row || typeof row !== 'object' || !row.deltas) return null;

  const stampedAt = row.updatedAt instanceof Date ? row.updatedAt.valueOf() : num(row.updatedAt);
  const nowMs = num(now);
  const elapsedMs = stampedAt != null && nowMs != null ? nowMs - stampedAt : null;

  const out = decay(row.deltas, { elapsedMs });
  return _negligible(out) ? null : out;
}

/**
 * §M.15's `w_user = clamp(w_global·(1+δ), 0.6·w_global, 1.4·w_global)`, in a form that survives
 * the renormalisation the scorer's `Σw = 1` invariant requires.
 *
 * ── WHY THE δ VECTOR IS CENTRED AND SCALED RATHER THAN CLAMPED COMPONENT-WISE ───────────────
 *
 * Written literally, §M.15 clamps each weight into `[0.6·w, 1.4·w]` and stops. Do that and then
 * renormalise — which §M.9 leaves no choice about, since `Σw = 1` is what makes `total`
 * comparable and the exposure penalty bite evenly — and the stated bound is simply not what gets
 * served. Worked example, measured on the real mood weights: `δ_taste = +0.4`, `δ_feature = −0.4`
 * gives `Σ = 1.02`, so the normalisation divides everything by 1.02 and `feature` lands at
 * `0.588·w`, OUTSIDE the region §M.15 promised. In the worst case the composition of the two
 * steps admits `[0.6/1.4, 1.4/0.6]` — a 0.43×–2.33× window, four times wider than the bound.
 *
 * The cause is that the component of δ along the all-ones direction is pure GAUGE: normalisation
 * deletes it, so clamping it is clamping a quantity that has no effect, while the part that does
 * have an effect escapes. So this removes the gauge first — subtract the w-weighted mean, which
 * is exactly the projection making `Σ_d w_d·δ_d = 0` — and then bounds what is left by SCALING
 * the whole vector to radius `DELTA_LIMIT` instead of clipping it per component.
 *
 * Both choices are load-bearing:
 *   · centring makes `Σ_d w_d(1+δ_d) = Σ_d w_d` identically, so the renormalisation becomes an
 *     identity and cannot move anything out of the region;
 *   · scaling (rather than clipping) preserves w-orthogonality, because a scalar multiple of a
 *     w-orthogonal vector is still w-orthogonal — a per-component clip would re-introduce exactly
 *     the gauge component that was just removed. It is also what "trust region" means in the
 *     optimisation literature this constant comes from: keep the step's DIRECTION, bound its
 *     RADIUS.
 * The result is that `w_user/w_global ∈ [0.6, 1.4]` holds EXACTLY on the served weights, which is
 * the guarantee §M.15 was making. Pinned by a fuzz suite over random weights and deltas.
 *
 * THE DORMANCY INVARIANT ALSO LIVES HERE: with nothing learned this returns the caller's OWN
 * object, by identity. Selection is then byte-identical to today as a property of the maths rather
 * than of a float comparison that happens to hold — the same posture B5's abstention takes, and
 * the reason the invariant does not depend on the flag being off.
 */
function overlay(weights, deltas) {
  if (!weights || typeof weights !== 'object') return weights;
  if (!deltas || typeof deltas !== 'object') return weights;

  const sane = _sane(deltas);
  if (_negligible(sane)) return weights;

  // `discovery` carries no δ of its own (see PERSONAL_TERMS), but it is part of the sum the
  // centring is taken against — it is one of the terms the re-allocation is funded from.
  const base = {};
  let mass = 0;
  for (const d of SCORING_TERMS) {
    const w = num(weights[d]) ?? 0;
    base[d] = w > 0 ? w : 0;
    mass += base[d];
  }
  // Every weight zeroed by configuration: there is nothing to re-allocate and nothing to divide
  // by. Hand back what came in rather than inventing a distribution (the `_normalizeWeights`
  // "the biosonic target must never stop working" posture, one layer up).
  if (!(mass > 0) || !Number.isFinite(mass)) return weights;

  let mean = 0;
  for (const d of SCORING_TERMS) mean += base[d] * (sane[d] ?? 0);
  mean /= mass;

  const centred = {};
  let radius = 0;
  for (const d of SCORING_TERMS) {
    centred[d] = (sane[d] ?? 0) - mean;
    radius = Math.max(radius, Math.abs(centred[d]));
  }
  if (!Number.isFinite(radius)) return weights;
  const scale = radius > DELTA_LIMIT ? DELTA_LIMIT / radius : 1;

  const scaled = {};
  let sum = 0;
  for (const d of SCORING_TERMS) {
    scaled[d] = base[d] * (1 + centred[d] * scale);
    sum += scaled[d];
  }
  // Identically `mass` in exact arithmetic; divided out anyway so float error can never leak into
  // the Σ = 1 invariant §M.9 depends on.
  if (!(sum > 0) || !Number.isFinite(sum)) return weights;

  const out = { ...weights };
  for (const d of SCORING_TERMS) out[d] = scaled[d] / sum;
  return Object.freeze(out);
}

/** §3: STRETCH work ships dark, so this is an opt-IN flag. See PERSONAL_FLAG. */
function enabled(env = process.env) {
  const v = String(env?.[PERSONAL_FLAG] ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * S15 house telemetry: one line, closed key set. The only facts on it are four scoring deltas and
 * a count of observations — no vital, no track identity, no state label, nothing that could carry
 * one. An abstention is NAMED rather than printed as a fake overlay, because "the overlay never
 * fires" and "it fires and finds nothing" are the two failure modes a dark launch has and they
 * look identical without this (the `[feedback]` precedent).
 */
function telemetryLine({ deltas = null, reason = null, updates = 0 } = {}) {
  const parts = ['[personal]'];
  if (deltas) for (const d of PERSONAL_TERMS) parts.push(`${d}=${round3(num(deltas[d]) ?? 0)}`);
  parts.push(`n=${num(updates) ?? 0}`);
  parts.push(`reason=${reason ?? 'none'}`);
  return parts.join(' ');
}

module.exports = {
  PERSONAL_TERMS,
  SCORING_TERMS,
  LEARNING_RATE,
  TRUST_REGION,
  DELTA_LIMIT,
  SHRINK_PER_WEEK,
  SHRINK_WEEK_MS,
  NEGLIGIBLE_DELTA,
  PERSONAL_FLAG,
  ZERO_DELTAS,
  gradientOf,
  stepFrom,
  decay,
  applyStep,
  effectiveDeltas,
  overlay,
  enabled,
  telemetryLine,
};
