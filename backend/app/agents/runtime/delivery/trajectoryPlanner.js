'use strict';

/**
 * B4 — THE TRAJECTORY PLANNER (W4-008).
 *
 * MMR decides WHICH tracks a listener gets. This decides in WHAT ORDER, and that is the second
 * half of the iso-principle. `wellbeingRegulator` (W4-006) publishes an arc as data — meet the
 * listener where they are, then guide them somewhere — but until now nothing walked it: the
 * playlist came back in MMR's greedy pick order ("best score first, then whatever survived the
 * diversity penalty"), so a stress downshift and an interval session were served in the same
 * shape. Down-regulation by SEQUENCE is what replaced D4's `Math.max(moodValence, 0.6)`; this
 * module is where the replacement finally does something.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE OBJECTIVE (§M.11)
 *
 *   C(π) = Σ_i ‖f_{π(i)} − g(i)‖²_W  +  0.6·Σ_i [ d_oct(π(i), π(i+1))² + Δenergy² ]
 *
 * A FIT term pulling each track toward what its position asks for, and a SEAM term charging
 * discontinuity between neighbours. W = (energy 1.0, valence 0.5, log₂bpm 0.8): energy carries
 * the arc, tempo nearly as much, valence is a colour rather than a shape — it is the axis D4 was
 * about, and giving it the same authority as energy is how a regulator turns back into a mirror.
 *
 * TEMPO LIVES IN LOG₂ AND FOLDS. The distance is `selection/tempo`'s shared metric, so this
 * module, the scorer and MMR cannot drift apart about what "close" means (the D11 lesson). 87
 * next to 174 is one groove continuing, not an 87-bpm cliff — half/double is a beat-tracker
 * artefact, not a property of the music. Against a CADENCE anchor the fold is charged rather
 * than free (§M.10): footfall has no octave.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHAT AN UNMEASURED DIMENSION COSTS — derived, not tuned.
 *
 * Roughly a quarter of any real pool has no features at all and more have some dims null, so the
 * planner needs a principled answer rather than a magic penalty. Model an unknown dim as uniform
 * over the band the gate already enforces — that is exactly what "it got past the band and we
 * know nothing else" means. Then
 *
 *      E[(X − g(i))²] = Var(X) + (g(i) − m)²      m = the band's midpoint
 *
 * and `Var(X)` is the same for every position, so across a BIJECTION (every track takes exactly
 * one slot) it adds the same constant to every permutation and cannot move the argmin. What is
 * left is `(g(i) − m)²`: an unknown is charged in proportion to how EXTREME its position's demand
 * is. That is the mission's "featureless tracks at low-constraint positions", and it falls out of
 * the prior instead of being asserted — no `UNKNOWN_PENALTY` constant appears in this file.
 *
 * The SEAM treats an unknown differently and deliberately: it is imputed to the curve, so a seam
 * touching an unknown costs what a perfectly-placed pair would cost there. Adding the variance
 * term here would NOT be permutation-invariant (a seam has one or two unknown ends depending on
 * the arrangement) and would reward parking unknowns at the two ends of the playlist — the
 * opposite of what the fit term is doing. Imputing keeps unknowns seam-NEUTRAL, so their
 * placement is decided in one place, by the fit term.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE SOLVER (§M.11: dominant-axis greedy seed → 2-opt sweeps → beam fallback if degenerate)
 *
 * Assignment is O(k!) exactly and 50 slots is far past exhaustive, so: seed by rank-matching the
 * tracks against the curve on whichever axis the arc actually moves in, then polish with swap
 * sweeps. When NO axis moves (a flat focus or cadence arc) rank-matching has nothing to sort by,
 * so the seed becomes a beam-8 path construction over the seam metric instead — for a flat curve
 * the fit term is position-independent and the whole problem IS the path.
 *
 * The identity order competes with the seed, so `cost ≤ costBefore` holds by construction: the
 * planner is never allowed to hand back something worse than the order it was given.
 *
 * PURE (§0.4 S9): no clock, no randomness, no environment, no I/O. Ties break by input index, so
 * the same picks always produce the same playlist. `DISABLE_ENV_VAR` names the kill switch the
 * WIRING half must honour (S11) — reading it belongs there, next to the seam it protects, and it
 * is deliberately the SAME flag the regulator names: computing an arc and then ignoring it would
 * be a worse state than either half being off.
 */

const { toLog2, foldedDistanceLog2 } = require('../../../services/selection/tempo');
const { measured, FEATURE_RANGES } = require('../../../services/features/featureProvider');
const { tempoBandOf } = require('../../../services/biosonic/translate');

const PLANNER_VERSION = 'trajectory/v1';

/** The wiring half's escape hatch, shared with `wellbeingRegulator` (one flag, one feature). */
const DISABLE_ENV_VAR = 'WAVE4_TRAJECTORY_DISABLED';

/** §M.11's W. Energy carries the arc; valence colours it; tempo is nearly as structural as energy. */
const AXIS_WEIGHT = Object.freeze({ energy: 1.0, valence: 0.5, l2: 0.8 });
const AXES = Object.freeze(['energy', 'valence', 'l2']);
/** The name each axis reports itself under — `l2` is an implementation unit, not a telemetry word. */
const AXIS_LABEL = Object.freeze({ energy: 'energy', valence: 'valence', l2: 'tempo' });

/** §M.11's 0.6 on the neighbour term. */
const SEAM_COEFF = 0.6;

/**
 * Per-archetype multiplier on the seam coefficient. Continuity is not equally important to every
 * arc: a focus playlist exists to not be noticed, so an audible transition costs it more than it
 * costs a workout, whose whole job is to change. This is also the ONLY thing distinguishing
 * `flat-focus` from `steady` — both are flat curves, and without it the taxonomy would be naming
 * a difference the engine does not make.
 */
const SMOOTHNESS = Object.freeze({
  'flat-focus': 1.5,
  'cadence-locked': 1.3,
  steady: 1.0,
  'monotone-wind-down': 1.0,
  'meet-then-lower': 1.0,
  'warmup-peak-cooldown': 0.8,
  'gentle-lift': 0.8,
});

/**
 * The curve specs, one per archetype the taxonomy can name. `startFrac`/`endFrac` are positions
 * WITHIN the band, used only when the regulator did not publish explicit endpoints — the band is
 * the whole space the arc is allowed to live in (`wellbeingRegulator` clamps its endpoints into
 * it for the same reason), so expressing a default as a fraction of it cannot ask for a tempo the
 * band filter already threw away.
 */
const ARCHETYPES = Object.freeze({
  'monotone-wind-down': Object.freeze({ shape: 'ease', startFrac: 0.75, endFrac: 0.15 }),
  'meet-then-lower': Object.freeze({ shape: 'hold-then-ease', startFrac: 0.85, endFrac: 0.20 }),
  'gentle-lift': Object.freeze({ shape: 'ease', startFrac: 0.30, endFrac: 0.75 }),
  'warmup-peak-cooldown': Object.freeze({ shape: 'double-sigmoid', startFrac: 0.20, endFrac: 0.30 }),
  'flat-focus': Object.freeze({ shape: 'flat', startFrac: 0.50, endFrac: 0.50 }),
  steady: Object.freeze({ shape: 'flat', startFrac: 0.50, endFrac: 0.50 }),
  'cadence-locked': Object.freeze({ shape: 'flat', startFrac: 0.50, endFrac: 0.50, pinTempo: true }),
});

/** How long `meet-then-lower` stays WITH the listener before it starts leading. */
const MEET_HOLD = 0.25;
/** The double sigmoid's two inflection points and their shared width, in playlist fraction. */
const RISE_MID = 0.25;
const FALL_MID = 0.75;
const SIGMOID_W = 0.07;
/**
 * The most `lift-gently` may brighten across a whole playlist. Small on purpose: this is an
 * ORDERING preference over tracks the band already admitted, never a filter, and D4 is the
 * standing reminder of what happens when the engine gets an opinion about how somebody should
 * feel. Nothing here can introduce a track the selection stage did not choose.
 */
const VALENCE_LIFT = 0.12;

/** Below this weighted curve range no axis discriminates between positions — rank-matching has
 *  nothing to sort by and the seed falls back to beam path construction. */
const DEGENERATE_RANGE = 0.05;
const BEAM_WIDTH = 8;
/**
 * Hoisted so the fold's options object is allocated once per generation rather than once per
 * call: `foldedDistanceLog2`'s `= {}` default would otherwise allocate inside a k² loop.
 */
const FOLD_FREE = Object.freeze({ cadenceLocked: false });

/** A swap must actually improve the objective; floating-point noise is not an improvement. */
const SWAP_EPS = 1e-12;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const round3 = (v) => Math.round(v * 1000) / 1000;
const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const finitePositive = (v) => {
  const n = finite(v);
  return n != null && n > 0 ? n : null;
};

const L2_MIN = Math.log2(FEATURE_RANGES.bpm[0]);
const L2_MAX = Math.log2(FEATURE_RANGES.bpm[1]);

const smoothstep = (u) => u * u * (3 - 2 * u);
const logistic = (z) => 1 / (1 + Math.exp(-z));

/**
 * A logistic rescaled so it is exactly 0 at u=0 and exactly 1 at u=1. Without this the composite
 * warmup curve starts a few percent above its start and ends a few percent above its end, which
 * turns "the arc ends where the regulator said" into "roughly there" — and the endpoints are the
 * part of the arc a listener actually notices.
 */
function normLogistic(u, mid) {
  const at = (x) => logistic((x - mid) / SIGMOID_W);
  const lo = at(0);
  const span = at(1) - lo;
  return Math.abs(span) > 1e-12 ? (at(u) - lo) / span : u;
}

// ── choosing the arc ────────────────────────────────────────────────────────────────────────

const TEMPO_BAND_TOKENS = new Set(['resting', 'active', 'peak']);

/**
 * The band's class, preferring the NUMBER over the token. `targets.tempoBand` is effectively
 * write-only today (logged, and stored on ServeEvent from a different source entirely), and the
 * W4-007 golden fixtures already carry an older `slow|mid|fast` spelling — so the token is a hint
 * and `bpmCenter` is the fact. `tempoBandOf` is imported rather than re-derived: one table, two
 * readings of it, which is the D11 lesson written down.
 */
function bandClassOf(targets) {
  if (!targets || typeof targets !== 'object') return null;
  const center = finitePositive(targets.bpmCenter);
  if (center != null) return tempoBandOf(center);
  const token = targets.tempoBand;
  return typeof token === 'string' && TEMPO_BAND_TOKENS.has(token) ? token : null;
}

/**
 * Which arc this generation gets: the regulator's published archetype, else the activity, else
 * the band's own shape (mission §3 W4-008: `targets.trajectory?.archetype` ∨ activity ∨ defaults).
 */
function resolveArchetype(targets) {
  const traj = targets && typeof targets === 'object' ? targets.trajectory : null;
  const named = traj && typeof traj === 'object' ? traj.archetype : null;
  if (typeof named === 'string' && Object.prototype.hasOwnProperty.call(ARCHETYPES, named)) return named;

  if (targets?.cadenceLocked === true) return 'cadence-locked';
  const band = bandClassOf(targets);
  if (band === 'peak') return 'warmup-peak-cooldown';
  // An explicit chip is a direct intent to exert: at a mid band it still wants a workout SHAPE,
  // where a mid band with no chip is just a request for mid-energy music.
  if (targets?.activityDriven === true && band === 'active') return 'warmup-peak-cooldown';
  if (band === 'resting') return 'monotone-wind-down';
  return 'steady';
}

// ── the curve ───────────────────────────────────────────────────────────────────────────────

function sampleShape(shape, k, start, end, peak) {
  const out = new Array(k);
  for (let i = 0; i < k; i++) {
    const u = k > 1 ? i / (k - 1) : 0;
    let v;
    switch (shape) {
      case 'ease':
        v = start + (end - start) * smoothstep(u);
        break;
      case 'hold-then-ease':
        v = start + (end - start) * smoothstep(clamp01((u - MEET_HOLD) / (1 - MEET_HOLD)));
        break;
      case 'double-sigmoid':
        v = start + (peak - start) * normLogistic(u, RISE_MID) - (peak - end) * normLogistic(u, FALL_MID);
        break;
      case 'flat':
      default:
        // A flat archetype ignores any direction the regulator attached — its own policy says the
        // listener should be held, not moved — but it still sits between the endpoints rather
        // than picking one of them arbitrarily.
        v = (start + end) / 2;
        break;
    }
    out[i] = v;
  }
  return out;
}

/** Squared deviation of the curve from its own midpoint: what an UNMEASURED dim is charged. */
function deviationCost(curve) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of curve) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const mid = (lo + hi) / 2;
  return curve.map(v => (v - mid) * (v - mid));
}

/**
 * The arc, sampled at k positions, in (energy, valence, log₂bpm).
 *
 * An axis whose band is unknown gets NO curve rather than a fabricated one — abstaining is the
 * house discipline (`tempo.tempoKernel`, `featureProvider.measured`) and a made-up centre would
 * reorder a playlist on evidence that does not exist.
 */
function buildCurve(archetypeId, targets, k) {
  const spec = ARCHETYPES[archetypeId] ?? ARCHETYPES.steady;
  const t = targets && typeof targets === 'object' ? targets : {};
  const traj = t.trajectory && typeof t.trajectory === 'object' ? t.trajectory : {};
  const intensity = clamp01(finite(traj.intensityScale) ?? 1);
  const n = Number.isInteger(k) && k > 0 ? k : 0;

  const out = {
    archetype: archetypeId,
    k: n,
    cadenceLocked: t.cadenceLocked === true,
    energy: null,
    valence: null,
    l2: null,
    constraint: { energy: null, valence: null, l2: null },
  };
  if (n === 0) return out;

  // ── energy ──
  const eA = finite(t.energyFloor);
  const eB = finite(t.energyCeiling);
  if (eA != null && eB != null) {
    // An inverted band is survived, not amplified: it is read as the interval it describes.
    const eLo = clamp01(Math.min(eA, eB));
    const eHi = clamp01(Math.max(eA, eB));
    const at = (f) => eLo + (eHi - eLo) * f;
    const start = clamp(finite(traj.start?.energy) ?? at(spec.startFrac), eLo, eHi);
    const end = clamp(finite(traj.end?.energy) ?? at(spec.endFrac), eLo, eHi);
    const peak = Math.max(at(intensity), start, end);
    out.energy = sampleShape(spec.shape, n, start, end, peak);
    out.constraint.energy = deviationCost(out.energy);
  }

  // ── valence ──
  // `sustain` and `meet` are both flat: post-D4 `valenceTarget` already IS where the listener is,
  // so meeting them means not moving. Only `lift-gently` has anywhere to go.
  const vt = finite(t.valenceTarget);
  if (vt != null) {
    const base = clamp01(vt);
    const lift = traj.valenceApproach === 'lift-gently' ? clamp01(base + VALENCE_LIFT) : base;
    out.valence = sampleShape(lift === base ? 'flat' : 'ease', n, base, lift, lift);
    out.constraint.valence = deviationCost(out.valence);
  }

  // ── tempo, in log₂ ──
  const center = finitePositive(t.bpmCenter);
  if (center != null) {
    const l2of = (bpm) => clamp(Math.log2(Math.max(bpm, 1)), L2_MIN, L2_MAX);
    if (spec.pinTempo) {
      // Footfall does not drift. A cadence anchor is a physical entrainment target, so the arc is
      // not permitted to move it even when the regulator handed over endpoints that would.
      const pinned = l2of(center);
      out.l2 = new Array(n).fill(pinned);
    } else {
      const width = Math.max(0, finite(t.bpmWidth) ?? 0);
      const bLo = Math.max(1, center - width);
      const bHi = Math.max(bLo, center + width);
      const at = (f) => bLo + (bHi - bLo) * f;
      const start = l2of(finitePositive(traj.start?.bpm) ?? at(spec.startFrac));
      const end = l2of(finitePositive(traj.end?.bpm) ?? at(spec.endFrac));
      const peak = Math.max(l2of(at(intensity)), start, end);
      out.l2 = sampleShape(spec.shape, n, start, end, peak);
    }
    out.constraint.l2 = deviationCost(out.l2);
  }

  return out;
}

// ── track projection ────────────────────────────────────────────────────────────────────────

const defaultFeaturesOf = (p) => p?.track?.features ?? p?.features ?? null;

/**
 * A pick's position in the arc's own coordinates. Values are clamped into the store's legal
 * ranges: `clampFeatures` is the write-side trust boundary and every value the serving path sees
 * has passed it, so doing the same here costs nothing and stops a junk row (a fuzzed 1e6 energy,
 * a 0.0001 bpm) from dominating an otherwise sane arc.
 */
function projectFeatures(features) {
  const f = features && typeof features === 'object' ? features : null;
  if (!f) return { energy: null, valence: null, l2: null };
  const e = measured(f.energy);
  const v = measured(f.valence);
  const raw = toLog2(f.bpm);
  return {
    energy: e == null ? null : clamp01(e),
    valence: v == null ? null : clamp01(v),
    l2: raw == null ? null : clamp(raw, L2_MIN, L2_MAX),
  };
}

// ── the plan ────────────────────────────────────────────────────────────────────────────────

function identityResult(picks, archetype, reason) {
  const k = picks.length;
  return {
    ordered: picks.slice(),
    stats: {
      v: PLANNER_VERSION,
      planned: false,
      reason,
      archetype,
      axes: [],
      k,
      seed: 'none',
      passes: 0,
      swaps: 0,
      cost: 0,
      costBefore: 0,
      folded: 0,
      telemetry: `[trajectory] v=${PLANNER_VERSION} arc=${archetype} k=${k} planned=false reason=${reason}`,
    },
  };
}

/**
 * Lay a selected playlist along its arc.
 *
 * @param {Array<{track: object}>} picks   MMR's chosen picks, in its own order
 * @param {object} [opts]
 * @param {object} [opts.targets]          the `translate()`/`wellbeingRegulator` target object
 * @param {boolean} [opts.disabled]        S11 kill switch, read by the caller
 * @param {(p:any)=>object|null} [opts.features]  how to read a pick's features
 * @returns {{ordered: Array, stats: object}} a PERMUTATION of `picks`, plus telemetry
 */
function planTrajectory(picks, opts = {}) {
  if (!Array.isArray(picks)) {
    throw new TypeError('planTrajectory: `picks` must be the array of scored picks');
  }
  const { targets = null, disabled = false, features = defaultFeaturesOf } = opts ?? {};
  const archetype = resolveArchetype(targets);
  const k = picks.length;

  if (disabled === true) return identityResult(picks, archetype, 'disabled');
  if (k < 2) return identityResult(picks, archetype, 'too-short');

  const curve = buildCurve(archetype, targets, k);
  const axes = AXES.filter(a => curve[a] != null);
  if (axes.length === 0) return identityResult(picks, archetype, 'no-arc');

  const vecs = picks.map(p => projectFeatures(features(p)));
  const weightTotal = axes.reduce((s, a) => s + AXIS_WEIGHT[a], 0);
  const cadenceLocked = curve.cadenceLocked;

  // ── fit matrix: what each track costs at each position ──
  //
  // FLAT and TYPED, one pass per axis, because this is the hot loop: k² cells × 3 axes. The
  // straightforward `for (const axis of axes)` version inside the cell paid a dynamic string-keyed
  // property lookup per axis and, for tempo, an options-object allocation per CELL. Measured at
  // k=50 on this box (2026-08-20, plain node — jest's sandbox is ~21x slower on numeric work and
  // is not the instrument the §0.4 S10 budget is written against): 3.13 ms per plan before,
  // 1.23 ms after, against a 30 ms budget. The rewrite is headroom, not a rescue.
  //
  // NaN is the "unmeasured" sentinel throughout: it is the only value that fails every comparison,
  // so a missing dim can never be silently read as a zero (the W4-D21 / W4-D15 coercion class).
  const fitFlat = new Float64Array(k * k); // index t*k + i
  const foldOpts = { cadenceLocked };
  for (const axis of axes) {
    const w = AXIS_WEIGHT[axis] / weightTotal;
    const g = Float64Array.from(curve[axis]);
    const cst = Float64Array.from(curve.constraint[axis]);
    const values = Float64Array.from(vecs, v => (v[axis] == null ? NaN : v[axis]));
    for (let t = 0; t < k; t++) {
      const value = values[t];
      const base = t * k;
      if (Number.isNaN(value)) {
        // Unmeasured: the uniform-prior residual, i.e. how extreme this position's demand is.
        for (let i = 0; i < k; i++) fitFlat[base + i] += w * cst[i];
      } else if (axis === 'l2') {
        for (let i = 0; i < k; i++) {
          const d = foldedDistanceLog2(value, g[i], foldOpts);
          fitFlat[base + i] += w * d * d;
        }
      } else {
        for (let i = 0; i < k; i++) {
          const d = value - g[i];
          fitFlat[base + i] += w * d * d;
        }
      }
    }
  }

  // ── seam matrices: what each ADJACENT PAIR costs, and what the curve itself would cost there ──
  // NaN is the "this pair cannot be compared on this axis" sentinel; the imputed value stands in.
  const pairL2 = new Float64Array(k * k).fill(NaN);
  const pairE = new Float64Array(k * k).fill(NaN);
  for (let a = 0; a < k; a++) {
    for (let b = a + 1; b < k; b++) {
      const va = vecs[a];
      const vb = vecs[b];
      if (va.l2 != null && vb.l2 != null) {
        // Free fold: both sides are CANDIDATES, and half/double between two recordings is the
        // measurement artefact §M.10 exists to reconcile. Only an ANCHOR is charged for it.
        const d = foldedDistanceLog2(va.l2, vb.l2, FOLD_FREE);
        pairL2[a * k + b] = d * d;
        pairL2[b * k + a] = d * d;
      }
      if (va.energy != null && vb.energy != null) {
        const d = va.energy - vb.energy;
        pairE[a * k + b] = d * d;
        pairE[b * k + a] = d * d;
      }
    }
  }
  const impL2 = new Float64Array(Math.max(0, k - 1));
  const impE = new Float64Array(Math.max(0, k - 1));
  for (let s = 0; s + 1 < k; s++) {
    if (curve.l2) { const d = curve.l2[s + 1] - curve.l2[s]; impL2[s] = d * d; }
    if (curve.energy) { const d = curve.energy[s + 1] - curve.energy[s]; impE[s] = d * d; }
  }

  const seamWeight = SEAM_COEFF * (SMOOTHNESS[archetype] ?? 1);
  const seam = (a, b, s) => {
    const l = pairL2[a * k + b];
    const e = pairE[a * k + b];
    return seamWeight * ((Number.isNaN(l) ? impL2[s] : l) + (Number.isNaN(e) ? impE[s] : e));
  };

  const totalCost = (order) => {
    let c = 0;
    for (let i = 0; i < k; i++) c += fitFlat[order[i] * k + i];
    for (let s = 0; s + 1 < k; s++) c += seam(order[s], order[s + 1], s);
    return c;
  };

  // ── seed ──
  const identity = Array.from({ length: k }, (_, i) => i);
  let seedName = 'dominant-axis';
  let dominant = null;
  let bestRange = 0;
  for (const a of axes) {
    const c = curve[a];
    const range = AXIS_WEIGHT[a] * (Math.max(...c) - Math.min(...c));
    if (range > bestRange) { bestRange = range; dominant = a; }
  }

  let seeded;
  if (dominant != null && bestRange >= DEGENERATE_RANGE) {
    // Rank-match: the curve is monotone in this axis over the positions it moves through, so the
    // cheapest assignment ignoring seams is the order-preserving one. Tracks missing the dominant
    // axis sort by the curve's own midpoint, which is where their unmeasured-dim cost is lowest —
    // the same answer the fit term gives, reached without evaluating it.
    const c = curve[dominant];
    const mid = (Math.max(...c) + Math.min(...c)) / 2;
    const byPosition = identity.slice().sort((x, y) => (c[x] - c[y]) || (x - y));
    const byTrack = identity.slice().sort((x, y) => ((vecs[x][dominant] ?? mid) - (vecs[y][dominant] ?? mid)) || (x - y));
    seeded = new Array(k);
    for (let r = 0; r < k; r++) seeded[byPosition[r]] = byTrack[r];
  } else {
    // Degenerate: no axis discriminates between positions, so the fit term is a constant and the
    // whole problem is the seam path. Beam-8 construction, ties by index so it stays deterministic.
    seedName = 'beam';
    let beams = [{ order: [], used: new Uint8Array(k), cost: 0 }];
    for (let pos = 0; pos < k; pos++) {
      const candidates = [];
      for (let bi = 0; bi < beams.length; bi++) {
        const beam = beams[bi];
        const last = pos > 0 ? beam.order[pos - 1] : -1;
        for (let t = 0; t < k; t++) {
          if (beam.used[t]) continue;
          const step = fitFlat[t * k + pos] + (pos > 0 ? seam(last, t, pos - 1) : 0);
          candidates.push({ bi, t, cost: beam.cost + step });
        }
      }
      candidates.sort((x, y) => (x.cost - y.cost) || (x.bi - y.bi) || (x.t - y.t));
      const next = [];
      for (let i = 0; i < candidates.length && next.length < BEAM_WIDTH; i++) {
        const { bi, t, cost } = candidates[i];
        const parent = beams[bi];
        const used = Uint8Array.from(parent.used);
        used[t] = 1;
        next.push({ order: [...parent.order, t], used, cost });
      }
      beams = next;
    }
    seeded = beams[0].order;
  }

  // ── 2-opt polish, seeded from whichever of {seed, the order we were handed} is cheaper ──
  const costBefore = totalCost(identity);
  const seededCost = totalCost(seeded);
  const order = seededCost < costBefore ? seeded.slice() : identity.slice();

  // Work scales with k², so the sweep count is capped rather than the objective quietly abandoned
  // mid-pass — a truncated pass would make the result depend on where the budget ran out.
  const maxPasses = k <= 80 ? 3 : k <= 200 ? 2 : 1;
  let passes = 0;
  let swaps = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false;
    passes++;
    for (let p = 0; p < k - 1; p++) {
      for (let q = p + 1; q < k; q++) {
        // Read fresh: an accepted swap replaces `order[p]`, and the rest of this sweep must
        // compare against the incumbent that is actually sitting there.
        const a = order[p];
        const b = order[q];
        const baseA = a * k;
        const baseB = b * k;
        // Delta, not a recompute: exchanging two positions moves two fit terms and at most four
        // seams, so a sweep stays O(k²) rather than O(k³). The four seam indices are enumerated
        // by hand instead of collected into a Set — the only collision possible is q === p+1
        // (then q−1 === p), and at 1225 pairs × 3 passes the per-pair Set allocation was the
        // whole cost of this stage: 38 ms measured at k=50, over the §0.4 S10 budget of 30.
        let delta = (fitFlat[baseB + p] + fitFlat[baseA + q]) - (fitFlat[baseA + p] + fitFlat[baseB + q]);
        if (p > 0) {
          const l = order[p - 1];
          delta += seam(l, b, p - 1) - seam(l, a, p - 1);
        }
        if (p + 1 < k) {
          // When q === p+1 the two swapped tracks ARE this seam; it is symmetric, so it cancels.
          const rAfter = p + 1 === q ? a : order[p + 1];
          delta += seam(b, rAfter, p) - seam(a, order[p + 1], p);
        }
        if (q - 1 !== p) {
          const l = order[q - 1];
          delta += seam(l, a, q - 1) - seam(l, b, q - 1);
        }
        if (q + 1 < k) {
          const r = order[q + 1];
          delta += seam(a, r, q) - seam(b, r, q);
        }
        if (delta < -SWAP_EPS) {
          order[p] = b;
          order[q] = a;
          swaps++;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  const cost = totalCost(order);
  let folded = 0;
  for (let s = 0; s + 1 < k; s++) {
    const la = vecs[order[s]].l2;
    const lb = vecs[order[s + 1]].l2;
    if (la == null || lb == null) continue;
    if (foldedDistanceLog2(la, lb, FOLD_FREE) < Math.abs(la - lb) - 1e-12) folded++;
  }

  const axisLabels = axes.map(a => AXIS_LABEL[a]);
  return {
    ordered: order.map(i => picks[i]),
    stats: {
      v: PLANNER_VERSION,
      planned: true,
      reason: 'planned',
      archetype,
      axes: axisLabels,
      k,
      seed: seedName,
      passes,
      swaps,
      cost: round3(cost),
      costBefore: round3(costBefore),
      folded,
      // S15 house telemetry: tokens and coarse numbers only. No vital, no track identity, no
      // display copy — the archetype is internal closed vocabulary (R10).
      telemetry: `[trajectory] v=${PLANNER_VERSION} arc=${archetype} k=${k} axes=${axisLabels.join('+') || 'none'} `
        + `seed=${seedName} passes=${passes} swaps=${swaps} folded=${folded} `
        + `cost=${round3(cost)} from=${round3(costBefore)}`,
    },
  };
}

module.exports = {
  planTrajectory,
  resolveArchetype,
  buildCurve,
  projectFeatures,
  ARCHETYPES,
  AXIS_WEIGHT,
  SMOOTHNESS,
  SEAM_COEFF,
  VALENCE_LIFT,
  PLANNER_VERSION,
  DISABLE_ENV_VAR,
};
