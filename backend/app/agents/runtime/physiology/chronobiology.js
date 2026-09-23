'use strict';

/**
 * A2 — chronobiology (W4-004). PURE: no clock, no database, no randomness (S9).
 *
 * WHAT WAS WRONG (D13). The entire circadian model in this product was ONE binary step:
 *
 *     const windDown = (hour >= 21 || hour < 5) ? 0.8 : 1.0;     // translate.js:96
 *
 * on the SERVER's local hour. Three separate failures in one line. It is a step function, so
 * 20:59 and 21:01 are different worlds and 03:00 and 04:59 are the same one. It is identical
 * for every human being, so the endurance athlete whose rhythm peaks at 15:00 and the
 * night-shift worker whose rhythm peaks at 23:00 get the same curve. And it reads the hour off
 * the machine the code happens to be running on, so a user in Tokyo is wound down when a
 * server in Frankfurt says so.
 *
 * This module replaces it with the user's OWN rhythm, fitted from their own data.
 *
 * ── WHY A COSINOR (§M.3) ────────────────────────────────────────────────────────────────
 *
 * A single 24 h harmonic — `y = M + β·cos(ωt) + γ·sin(ωt)` — is the standard model in human
 * chronobiology (Halberg's cosinor) and it is the right amount of model for this data. It has
 * three parameters for 24 bins, so it cannot overfit; it is LINEAR in those parameters, so the
 * fit is a closed-form weighted least squares rather than an optimiser that can fail to
 * converge in a worker; and its parameters are exactly the three quantities anyone downstream
 * actually wants: the MESOR M (rhythm-adjusted mean), the AMPLITUDE A (how much of a rhythm
 * this person has at all — it flattens with age, which is the older-adult persona's whole
 * point), and the ACROPHASE φ (WHEN their peak is, which is what a shift worker moves).
 *
 * Deliberately NOT modelled: harmonics beyond the first (a second harmonic buys little on
 * hourly means and doubles the parameters), and the Borbély two-process model — the mission
 * CUT it for this wave and pinned the formula in ADR-0013 for later. What is here instead is
 * its homeostatic half in the cheapest honest form: a multi-night sleep-debt accumulator.
 *
 * ── WHY HEART RATE IS AN ACCEPTABLE PHASE MARKER ────────────────────────────────────────
 *
 * Stated plainly because it is the weakest link in the chain: heart rate is not alertness. The
 * gold-standard circadian phase markers are core body temperature and dim-light melatonin
 * onset, and we have neither. But heart rate carries a strong, well-documented 24 h rhythm
 * whose phase tracks the temperature rhythm closely, and both peak in the late afternoon /
 * early evening alongside subjective alertness. So the HR acrophase is used here as a PHASE
 * MARKER — an estimate of where this person's clock is — and never as a measurement of how
 * alert they feel. `circadianAlertness()` says the same thing in code by damping its own swing
 * with the fit's confidence: a rhythm we barely resolved barely moves the answer.
 */

const STAGE_WEIGHTS = Object.freeze({ deep: 1.5, light: 1.0, rem: 1.2 });

// translate.js's DEFAULT_NIGHT {deep: 90, light: 300, rem: 90} under STAGE_WEIGHTS:
// 1.5*90 + 1.0*300 + 1.2*90 = 543 weighted minutes. Adopted verbatim as the population sleep
// need so a user with no sleep history is treated exactly as the product treats them today.
const POPULATION_SLEEP_NEED = 543;

const OMEGA = (2 * Math.PI) / 24;

// §M.3's admission gate: at least 6 populated bins that are at least 2 h apart. Six points
// clustered inside one afternoon determine a 3-parameter sinusoid the way three collinear
// points determine a circle — arithmetically yes, meaningfully no.
const MIN_SPREAD_BINS = 6;
const MIN_BIN_SEPARATION_H = 2;
const MAX_SPREAD_BINS = 12;         // the most bins that can be >= 2 h apart around 24 h

// A fitted amplitude beyond this is a fit artifact, not a circadian rhythm (the largest
// credible human HR amplitude is ~10-12 bpm; 25 leaves a wide margin before clamping).
const MAX_AMPLITUDE = 25;

// Determinant floor for the 3x3 normal equations. Below it the design is degenerate and the
// solution is noise amplification, so the prior is the honest answer (S8).
const DET_EPSILON = 1e-9;

// §M.6: yesterday's debt decays by 15% overnight. Chosen by the mission; the physiological
// reading is that recovery sleep repays debt faster than it accumulates but never instantly.
const DEBT_DECAY = 0.85;
const DEBT_CEILING_NIGHTS = 2;      // D_max = two entire nights owed; past that the number stops informing

// How far a full night of debt is allowed to pull alertness down. 0.35 keeps the circadian
// term (amplitude 0.5) dominant while making debt clearly visible — a maximally indebted
// person at their circadian peak still reads more alert than at their trough, which matches
// how sleep deprivation actually presents.
const DEBT_ALERTNESS_WEIGHT = 0.35;

// `Number(null)`, `Number(false)` and `Number('')` are all 0. A missing sleep stage coerced to
// 0 minutes is not a missing stage, it is a claim that the person had none — and a missing hour
// coerced to 00:00 puts everyone in the middle of the night. Reject those shapes before
// coercing. (Same guard, same reason, as baselineEngine's.)
const finite = (x) => {
  if (x == null || typeof x === 'boolean') return null;
  if (typeof x === 'string' && x.trim() === '') return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};
const clamp = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));
const clamp01 = (x) => clamp(x, 0, 1);
const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;

function _median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function _quantile(values, q) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * clamp(q, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

/**
 * How many of these hours can be chosen so that every chosen pair is at least
 * MIN_BIN_SEPARATION_H apart AROUND THE CLOCK (23:00 and 00:00 are one hour apart, not 23).
 * Greedy from the earliest hour, which is optimal for this interval-scheduling shape.
 */
function _circularSpread(hours) {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted.length;
  const chosen = [sorted[0]];
  for (const h of sorted.slice(1)) {
    if (h - chosen[chosen.length - 1] >= MIN_BIN_SEPARATION_H) chosen.push(h);
  }
  // Close the circle: if the last chosen bin is too near the first one going forward through
  // midnight, it is not an independent point.
  if (chosen.length > 1 && (24 - chosen[chosen.length - 1] + chosen[0]) < MIN_BIN_SEPARATION_H) {
    chosen.pop();
  }
  return chosen.length;
}

/** Solve a symmetric 3x3 system by Cramer's rule, or null when it is degenerate. */
function _solve3(m, b) {
  const det = (a) => (
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
    - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  );
  const d = det(m);
  if (!Number.isFinite(d) || Math.abs(d) < DET_EPSILON) return null;
  const col = (i) => m.map((row, r) => row.map((v, c) => (c === i ? b[r] : v)));
  const x = [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
  return x.every(Number.isFinite) ? x : null;
}

/**
 * §M.3 cosinor fit over a 24-bin hour-of-day table.
 *
 * `bins` are the objects `baselineEngine.buildHourlyTable` produces. The fit deliberately uses
 * each bin's RAW median, not its shrunk value: shrinkage pulls every bin toward the user's
 * overall level, which is precisely an amplitude ATTENUATOR — fitting the shrunk table would
 * systematically under-report how much rhythm a person has, and "this user has almost no
 * circadian amplitude" is a clinically meaningful statement we must not manufacture. Bin
 * counts are the weights (§M.3), which is how low-coverage hours are down-weighted instead.
 *
 * Convention check, because a sign error here silently inverts everyone's day: the persona
 * generator defines HR(t) = M + A·cos(ω(t − φ)). Expanding gives β = A·cos(ωφ) and
 * γ = A·sin(ωφ), hence A = √(β² + γ²) and φ = atan2(γ, β)/ω — exactly §M.3, and exactly what
 * `tests/chronobiology.test.js` recovers from the simulator's independent answer key.
 */
function fitCosinor(bins, { prior } = {}) {
  const fallback = {
    M: round2(finite(prior?.M) ?? 62),
    A: round2(finite(prior?.A) ?? 4),
    phi: round2(finite(prior?.phi) ?? 15.0),
    confidence: 0,
    r2: 0,
    bins: 0,
    spread: 0,
    source: 'prior',
  };

  const points = [];
  for (const bin of Array.isArray(bins) ? bins : []) {
    const n = finite(bin?.n);
    const hour = finite(bin?.hour);
    // `raw` is the unshrunk bin median; a bin with no observations has none.
    const y = finite(bin?.raw);
    if (n == null || n <= 0 || hour == null || y == null) continue;
    points.push({ hour, y, w: n });
  }

  const spread = _circularSpread(points.map((p) => p.hour));
  if (points.length < MIN_SPREAD_BINS || spread < MIN_SPREAD_BINS) {
    return { ...fallback, bins: points.length, spread };
  }

  let fit = _fitOnce(points);
  if (!fit) return { ...fallback, bins: points.length, spread };

  // ONE robust reweighting pass. Least squares is not robust, and this data has a specific,
  // predictable contaminant: the hour a person habitually trains. A 45-minute workout most
  // evenings can be the MAJORITY of an 18:00 bin's samples, so even that bin's median is the
  // workout rather than the rhythm — and one such bin drags a 3-parameter LSQ fit noticeably.
  // Dropping bins whose residual exceeds 3 robust sigmas and refitting is the standard remedy
  // (it is the same Hampel test the ingestion filter applies to readings, applied to bins),
  // and it is capped at one pass so the cost stays bounded and the result stays deterministic.
  const kept = _rejectOutliers(points, fit);
  let outliersDropped = points.length - kept.length;
  if (outliersDropped > 0 && kept.length >= MIN_SPREAD_BINS
      && _circularSpread(kept.map((p) => p.hour)) >= MIN_SPREAD_BINS) {
    const refit = _fitOnce(kept);
    if (refit) fit = refit;
  } else {
    outliersDropped = 0;
  }

  const { M, beta, gamma, r2, S0 } = fit;
  const A = Math.sqrt(beta * beta + gamma * gamma);
  let phi = (Math.atan2(gamma, beta) / OMEGA) % 24;
  if (phi < 0) phi += 24;

  if (!Number.isFinite(M) || !Number.isFinite(A) || !Number.isFinite(phi)) {
    return { ...fallback, bins: points.length, spread };
  }

  // Confidence is the product of three things that all have to be true for the fit to mean
  // anything: the harmonic explains the variation (r2), the observations are spread around
  // the clock rather than clustered (spread), and there is enough of them (S0). None of the
  // three alone is sufficient — a perfect r2 over six clustered hours is a straight line.
  const coverage = clamp01(spread / MAX_SPREAD_BINS);
  const evidence = S0 / (S0 + 720); // 720 samples ~ half a day at 1/min
  const confidence = clamp01(r2 * coverage * evidence);

  return {
    M: round2(M),
    A: round2(clamp(A, 0, MAX_AMPLITUDE)),
    phi: round2(phi),
    confidence: round3(confidence),
    r2: round3(r2),
    bins: points.length,
    spread,
    outliersDropped,
    source: 'fit',
  };
}

/** One weighted least-squares pass over `[{hour, y, w}]`, or null if the design is degenerate. */
function _fitOnce(points) {
  let S0 = 0; let Sc = 0; let Ss = 0; let Scc = 0; let Sss = 0; let Scs = 0;
  let Sy = 0; let Scy = 0; let Ssy = 0;
  for (const { hour, y, w } of points) {
    const c = Math.cos(OMEGA * hour);
    const s = Math.sin(OMEGA * hour);
    S0 += w; Sc += w * c; Ss += w * s;
    Scc += w * c * c; Sss += w * s * s; Scs += w * c * s;
    Sy += w * y; Scy += w * c * y; Ssy += w * s * y;
  }
  if (!(S0 > 0)) return null;

  const solved = _solve3([[S0, Sc, Ss], [Sc, Scc, Scs], [Ss, Scs, Sss]], [Sy, Scy, Ssy]);
  if (!solved) return null;
  const [M, beta, gamma] = solved;
  if (![M, beta, gamma].every(Number.isFinite)) return null;

  // Weighted R^2 — how much of the between-hour variation the single harmonic explains.
  const yBar = Sy / S0;
  let sse = 0;
  let sst = 0;
  for (const { hour, y, w } of points) {
    const yHat = M + beta * Math.cos(OMEGA * hour) + gamma * Math.sin(OMEGA * hour);
    sse += w * (y - yHat) * (y - yHat);
    sst += w * (y - yBar) * (y - yBar);
  }
  return { M, beta, gamma, S0, r2: sst > 0 ? clamp01(1 - sse / sst) : 0 };
}

/** Drop bins more than 3 robust sigmas from the fitted curve (Hampel, on residuals). */
function _rejectOutliers(points, fit) {
  const residuals = points.map(({ hour, y }) => (
    y - (fit.M + fit.beta * Math.cos(OMEGA * hour) + fit.gamma * Math.sin(OMEGA * hour))
  ));
  const med = _median(residuals);
  if (med == null) return points;
  const scale = _median(residuals.map((r) => Math.abs(r - med)));
  if (scale == null || scale <= 0) return points; // a perfect fit has nothing to reject
  const limit = 3 * 1.4826 * scale;
  return points.filter((_, i) => Math.abs(residuals[i] - med) <= limit);
}

/** Weighted sleep minutes for one night — the same STAGE_WEIGHTS translate.js already uses,
 *  so "a good night" means the same thing on both sides of the system. */
function weightedNight(night) {
  if (!night || typeof night !== 'object') return null;
  let total = 0;
  let any = false;
  for (const [stage, weight] of Object.entries(STAGE_WEIGHTS)) {
    const v = finite(night[stage]);
    if (v != null && v >= 0) { total += v * weight; any = true; }
  }
  return any ? total : null;
}

/**
 * §M.6 multi-night sleep debt: `D_t = clamp(0.85·D_{t−1} + (need − actual_t), 0, D_max)`.
 *
 * The one judgement call, stated openly. §M.6 says need is "the personal weighted-night
 * baseline". If that is read as the MEDIAN of the user's own nights, then by construction
 * roughly half their nights are surpluses and half deficits, the accumulator hovers near zero,
 * and a chronically sleep-deprived person is measured as having no sleep debt — which is the
 * exact population the number exists to identify. So `need` is the 75th percentile of the
 * user's own weighted nights: what they get when nothing stops them, which is the closest
 * observable proxy for what they need. It is then shrunk (§M.4, k = 5 nights) toward the
 * population need so a user with two logged nights is not assigned a need from two nights.
 *
 * Nights arrive oldest-first and are consumed in order; the caller owns the window.
 */
function sleepDebt(nights, { need: needOverride } = {}) {
  const weighted = [];
  for (const n of Array.isArray(nights) ? nights : []) {
    const w = weightedNight(n);
    if (w != null && w > 0) weighted.push(w);
  }

  const personal = _quantile(weighted, 0.75);
  const k = 5;
  const need = finite(needOverride) ?? (
    weighted.length > 0
      ? (weighted.length * personal + k * POPULATION_SLEEP_NEED) / (weighted.length + k)
      : POPULATION_SLEEP_NEED
  );
  const safeNeed = Math.max(need, 60); // a "need" below an hour is a data bug, not a person
  const ceiling = DEBT_CEILING_NIGHTS * safeNeed;

  let debt = 0;
  for (const actual of weighted) {
    debt = clamp(DEBT_DECAY * debt + (safeNeed - actual), 0, ceiling);
  }

  return {
    debt: round2(debt),
    ratio: round3(ceiling > 0 ? clamp01(debt / ceiling) : 0),
    need: round2(safeNeed),
    ceiling: round2(ceiling),
    nights: weighted.length,
    confidence: round3(weighted.length / (weighted.length + k)),
  };
}

/**
 * The personal circadian alertness curve — the replacement for the binary `windDown` step.
 *
 *     alertness(h) = clamp01( 0.5 + 0.5·swing·cos(ω(h − φ)) − w_D·debtRatio )
 *
 * `swing` damps the curve by the fit's confidence, so a user whose rhythm we have barely
 * resolved gets a nearly flat 0.5 rather than a confidently wrong sinusoid. It never reaches
 * zero (floor 0.4): even a poorly-resolved human has a day and a night, and the population
 * acrophase prior is a better guess than no rhythm at all.
 *
 * Returns `windDown` alongside as the direct, continuous replacement for the old boolean —
 * 1 − alertness, so the pre-sleep hours ramp instead of stepping.
 */
function circadianAlertness({ cosinor, hourOfDay, debtRatio = 0 } = {}) {
  const h = finite(hourOfDay);
  const phi = finite(cosinor?.phi) ?? 15.0;
  const conf = clamp01(finite(cosinor?.confidence) ?? 0);
  const debt = clamp01(finite(debtRatio) ?? 0);

  if (h == null) {
    // No hour is knowable — return the rhythm-neutral midpoint minus the debt penalty rather
    // than inventing a phase.
    const neutral = clamp01(0.5 - DEBT_ALERTNESS_WEIGHT * debt);
    return { alertness: round3(neutral), windDown: round3(1 - neutral), phase: 0, swing: 0 };
  }

  const swing = 0.4 + 0.6 * conf;
  const phase = Math.cos(OMEGA * (h - phi));
  const alertness = clamp01(0.5 + 0.5 * swing * phase - DEBT_ALERTNESS_WEIGHT * debt);
  return {
    alertness: round3(alertness),
    windDown: round3(1 - alertness),
    phase: round3(phase),
    swing: round3(swing),
  };
}

module.exports = {
  fitCosinor,
  weightedNight,
  sleepDebt,
  circadianAlertness,
  // exported for tests + reuse; the constants are pinned against their derivation, not copied
  STAGE_WEIGHTS,
  POPULATION_SLEEP_NEED,
  OMEGA,
  DEBT_DECAY,
  DEBT_CEILING_NIGHTS,
  DEBT_ALERTNESS_WEIGHT,
  MIN_SPREAD_BINS,
  MAX_AMPLITUDE,
  _circularSpread,
};
