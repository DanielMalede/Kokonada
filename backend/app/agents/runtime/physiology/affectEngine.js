'use strict';

/**
 * A3 — the affect engine (W4-005). PURE: no clock, no I/O, no randomness. Every caller owns
 * its own state and passes `now` (S9), so a replay of the same inputs is the same output.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────────────────
 *
 * `translate()` derives three numbers — R (recovery), S (stress), E (exertion) — from fixed
 * population constants and an unweighted mean. That was enough to ship, and it is wrong in
 * three specific, measured ways this module fixes structurally rather than by tuning:
 *
 *   D3   Any reading that could not be PROVEN to be exercise fed `restingElevation`, so a
 *        165 bpm run scored z ≈ 17 and saturated stress. W4-001 bought time with a flat
 *        `heartRate < 110` ceiling. That constant is wrong at both ends of the population:
 *        for an athlete (RHR 48, HRmax 190) 110 bpm is a brisk walk, and for an older adult
 *        (HRmax 155) it is genuine zone-3 work. Here the rest gate is a SOFT function of
 *        Karvonen exertion, which is personal by construction — there is no shared threshold
 *        left to be wrong about.
 *   D1   Every user was scored against `{hrvMedian: 45, hrvMAD: 8}`. W4-004 computes the real
 *        per-person baseline; this engine reads it, including the 24-bin hour-of-day table,
 *        so "elevated" finally means "elevated FOR YOU, AT THIS HOUR".
 *   D14  Fixed anchors, all-or-nothing. Every axis here carries an explicit evidence MASS.
 *
 * ── THE ONE IDEA ────────────────────────────────────────────────────────────────────────
 *
 * Every axis is a pair, not a number: `{ value, mass }`. `mass` is the fraction of the answer
 * that is DATA rather than prior — `evidence / (evidence + AXIS_PRIOR_MASS)` — and it is the
 * mechanism by which this engine can say **"I don't know"**. An axis with no evidence returns
 * its neutral prior at mass 0, and the temporal layer reads mass 0 as *this axis constrains
 * nothing*, never as *this axis says 0.5*. Fabricating physiology out of silence is the single
 * worst thing a system that steers a person's music can do, so it is made structurally
 * impossible rather than remembered.
 *
 * The combiner is `baselineEngine.fuse` — deliberately the same precision-weighted fusion the
 * baselines use, not a second implementation of the same algebra.
 *
 * ── §0.2.4 REGULATOR, NOT MIRROR ────────────────────────────────────────────────────────
 *
 * Physiology NEVER writes valence. There is no vital sign that means "sad"; HRV suppression is
 * as consistent with excitement and with a cold as it is with distress. An engine that inferred
 * low valence from a stressed body and then steered music toward it would be amplifying what it
 * found — exactly what VISION §6 forbids. `axes.valence` moves only on a DECLARED tap, and the
 * suite pins that. Down-regulation is the trajectory's job (W4-006), not valence's.
 *
 * ── ZERO KNOWLEDGE ──────────────────────────────────────────────────────────────────────
 *
 * Inputs are raw vitals (this runs in worker scope). Outputs are unit-interval abstractions and
 * coarse bands only — no bpm, no ms, no percentage ever leaves in a value or a log line.
 */

const {
  fuse, localHour, EXERCISE_ACTIVITIES, ZONE_FRACTIONS,
} = require('./baselineEngine');
const { circadianAlertness } = require('./chronobiology');
const { ACTIVITY_EXERTION_FLOOR } = require('../../../services/biosonic/translate');

const AFFECT_ENGINE_VERSION = 'affect/v1';

// ── constants, every one derived rather than chosen ─────────────────────────────────────

/**
 * The width of the squash, in robust sigmas. `tanh(z / 2)` puts a 2-sigma deviation at 0.76
 * and a 4-sigma one at 0.96: a genuinely unusual reading is unmistakably high without any
 * single reading ever reaching 1.0, which is what keeps a spike from pinning an axis.
 */
const Z_SCALE = 2;

/**
 * How much counter-evidence an axis needs before it leaves its resting default, expressed in
 * the same units as the parts (a part with mass 1 is one fully-confident observation). At 0.35
 * a single confident observation already owns ~74% of the answer, while pure silence owns 0% —
 * which is the trade this number encodes: responsive to real data, immovable by no data.
 */
const AXIS_PRIOR_MASS = 0.35;

/**
 * What each axis means when nothing is known. These are ABSTENTION values, not estimates: they
 * are returned at mass 0 precisely so a consumer can tell the difference. `stress` and
 * `exertion` default low and `recovery` defaults to 0.6 to match `translate()`'s neutral
 * defaults exactly, so a blind user gets the same music they get today.
 */
const NEUTRAL = Object.freeze({
  arousal: 0.5,
  stress: 0.2,
  recovery: 0.6,
  exertion: 0.15,
  fatigue: 0.2,
  circadianAlertness: 0.5,
  valence: 0.5,
});

/**
 * Floors for the robust-z denominator (S8). A MAD of zero is not evidence of a person with no
 * variability — it is evidence of too few samples — and dividing by it would turn a one-bpm
 * wobble into an infinite z. Both floors are the smallest spread the underlying sensor can
 * actually resolve: ~2 bpm for optical HR, ~3 ms for RMSSD.
 */
const MIN_SIGMA = Object.freeze({ heartRate: 2, hrv: 3 });

/**
 * An hour bin the user has never populated still carries their shrunk personal level (W4-004
 * shrinks every bin toward the user's own overall, which itself shrinks toward the population),
 * so it is genuinely informative — just much less so than a bin built from their own nights and
 * afternoons. This is the floor of that information, with the rest earned by the bin's own
 * shrinkage confidence.
 */
const BIN_PRIOR_MASS = 0.3;

/** The same floor logic for the HRV baseline and the cosinor fit. */
const HRV_BASELINE_PRIOR_MASS = 0.3;
const COSINOR_PRIOR_MASS = 0.35;

/**
 * The stated activity as a PRIOR, not an override — the whole point of the change. Same table
 * as `translate.ACTIVITY_EXERTION_FLOOR` (imported, never copied), read differently: there it
 * was `Math.max(measured, floor)`, so a Workout chip forced peak exertion onto a body sitting
 * still. Here it enters the fusion with ~a third of an observation's weight, which means a
 * genuine 165 bpm barely notices it (< 0.02) while a stated intent with no reading at all still
 * moves the axis most of the way there.
 */
const ACTIVITY_EXERTION_PRIOR = ACTIVITY_EXERTION_FLOOR;
const ACTIVITY_PRIOR_MASS = 0.35;

/**
 * How much to trust the Karvonen denominator. A user-provided HRmax is a fact; a P99.5 of 90
 * days of high-exertion samples is a good estimate of a ceiling they may simply never have
 * reached; the 190 default is a guess about a stranger. Exertion is only as good as its
 * denominator, so the mass says so.
 */
const HRMAX_SOURCE_RELIABILITY = Object.freeze({ provided: 1, measured: 0.85, default: 0.6 });

/**
 * The soft rest gate: above what exertion is an elevated heart rate EXPLAINED by work rather
 * than by distress? Reading work as distress is D3; the gate is what kills it.
 *
 * Both bounds are read off tables that already exist rather than picked, because the naive
 * choice is a trap this engine fell into and its own tests caught. A first cut put the gate at
 * 0.30 HRR — below §M.7's zone-1 floor — and it was measurably self-defeating: a stress episode
 * raises heart rate, a raised heart rate raises Karvonen exertion, and the gate then shut on
 * exactly the elevation it was supposed to weigh (measured on the `stressedProfessional`
 * persona: a genuine 2.4-sigma resting elevation kept only 21% of its mass). Any gate that is a
 * monotone function of heart rate has this defect — including W4-001's flat 110 bpm ceiling.
 *
 * So the bounds are placed where exertion stops being ambiguous:
 *   OPEN  = ACTIVITY_EXERTION_PRIOR.walking — ordinary locomotion. Below it, an elevated heart
 *           rate is compatible with sitting still and being agitated, so the gate is fully open.
 *   CLOSE = ZONE_FRACTIONS[0] — the bottom of Karvonen zone 1. At or above it the heart rate is
 *           aerobic work BY DEFINITION, and stress is left to the HRV term rather than invented.
 * Linear in between, so there is no cliff to straddle (the anti-cliff principle of D15).
 */
const REST_GATE_OPEN = ACTIVITY_EXERTION_FLOOR.walking;
const REST_GATE_CLOSE = ZONE_FRACTIONS[0];

/** The dormant Garmin stress lane (D16). No writer today; the engine is ready for consent v2. */
const STRESS_LEVEL_MASS = 0.6;

/**
 * Recovery's weights, explicit and summing to 1 — `translate()` took an unweighted mean of
 * whatever happened to be present, which silently made a body-battery percentage worth as much
 * as a whole night of sleep staging. Sleep and HRV are the two measurements with actual
 * physiological standing; battery and readiness are vendor composites derived partly from them,
 * so they get half the weight and are treated as corroboration, not independent evidence.
 */
const RECOVERY_WEIGHTS = Object.freeze({ sleep: 0.3, hrv: 0.3, bodyBattery: 0.2, dailyReadiness: 0.2 });

/** Fatigue: accumulated sleep debt dominates; a multi-day HRV downtrend corroborates it. */
const FATIGUE_WEIGHTS = Object.freeze({ debt: 0.6, hrvTrend: 0.4 });

/**
 * `baselines.trend.*` is already in robust-sigma units (acute median minus chronic median over
 * the chronic spread), so the scale here is a sigma count, not a raw quantity: a 1.5-sigma
 * sustained drop is most of the way to "yes, this person is accumulating fatigue".
 */
const TREND_Z_SCALE = 1.5;

/**
 * Declared mood. `k = 1` is the same variance-decomposition prior weight `baselineEngine.fuse`
 * uses (W4-D12's ruling): one tap is worth exactly one observation. The dispersion sigma is the
 * radius on the emotion wheel past which taps stop agreeing — 0.6 is a quarter of the wheel's
 * 2-unit diameter, so taps in the same quadrant stay coherent and taps in opposite quadrants
 * cancel to near-zero confidence. Ambivalence is not evidence.
 */
const DECLARED_PRIOR_COUNT = 1;
const DECLARED_DISPERSION_SIGMA = 0.6;

/** Coarse bands for the telemetry line. Never a number that came off a sensor. */
const BAND_CUTS = Object.freeze([0.2, 0.4, 0.6, 0.8]);
const BAND_LABELS = Object.freeze(['min', 'low', 'mid', 'high', 'peak']);

const DEFAULT_NIGHT = Object.freeze({ deep: 90, light: 300, rem: 90 }); // == translate.js
const SLEEP_STAGE_WEIGHTS = Object.freeze({ deep: 1.5, light: 1.0, rem: 1.2 });

// ── primitives ──────────────────────────────────────────────────────────────────────────

/**
 * Strict numeric coercion. Deliberately NOT `Number(x)`: `Number(null)` is 0 and `Number(false)`
 * is 0, and a missing vital silently becoming a zero vital is precisely how a blind engine
 * starts making confident claims. (W4-004 shipped that bug twice and its own tests caught it.)
 */
function finite(x) {
  if (x === null || x === undefined || x === '' || typeof x === 'boolean') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const clamp01 = (x) => clamp(x, 0, 1);

const isExercise = (activity) => EXERCISE_ACTIVITIES.has(String(activity ?? '').toLowerCase());

/**
 * The MAD-scaled deviation from a personal centre, matching `translate._robustZ`. `minSigma` is
 * the S8 guard and only ever WIDENS the denominator — a genuinely measured spread is never
 * narrowed by it, so a tight person stays sensitive.
 */
function robustZ(x, center, madValue, { minSigma = 1 } = {}) {
  const v = finite(x);
  const c = finite(center);
  if (v == null || c == null) return null;
  const m = finite(madValue);
  const sigma = Math.max((m != null && m > 0 ? m : 0) * 1.4826, minSigma, 1e-6);
  return (v - c) / sigma;
}

/** One-sided: 0 at or below the baseline, saturating toward 1 above it. */
function rise(z, k = Z_SCALE) {
  const v = finite(z);
  if (v == null) return 0;
  return clamp01(Math.tanh(Math.max(0, v) / Math.max(finite(k) ?? Z_SCALE, 1e-9)));
}

/** Two-sided: 0.5 at the baseline. "Typical for you" is the middle, not the bottom. */
function squash(z, k = Z_SCALE) {
  const v = finite(z);
  if (v == null) return 0.5;
  return clamp01(0.5 + 0.5 * Math.tanh(v / Math.max(finite(k) ?? Z_SCALE, 1e-9)));
}

/**
 * The missing-data mass mechanism, and the only place an axis value is ever produced.
 *
 *     value = (Σ mass_i · value_i + priorMass · neutral) / (Σ mass_i + priorMass)
 *     mass  = Σ mass_i / (Σ mass_i + priorMass)
 *
 * Implemented through `baselineEngine.fuse` with unit scales, which reduces to exactly that —
 * reusing the tested algebra instead of restating it. Note the deliberate absence of rounding:
 * an axis is an intermediate quantity and rounding it here would break the convex-hull property
 * the suite pins. Rounding happens once, at the DTO boundary.
 */
function blend(parts, { neutral = 0.5, priorMass = AXIS_PRIOR_MASS } = {}) {
  const sources = [];
  for (const p of Array.isArray(parts) ? parts : []) {
    const value = finite(p?.value);
    const mass = finite(p?.mass);
    if (value == null || mass == null || mass <= 0) continue;
    sources.push({ name: p?.name ?? null, value: clamp01(value), n: mass, scale: 1 });
  }
  const n = finite(neutral) ?? 0.5;
  const k = Math.max(finite(priorMass) ?? AXIS_PRIOR_MASS, 0);
  const f = fuse(sources, { value: n, scale: 1, k });
  const evidence = sources.reduce((a, s) => a + s.n, 0);
  return {
    value: clamp01(f.value),
    mass: clamp01(f.confidence),
    evidence,
    parts: sources.map((s) => ({ name: s.name, value: s.value, mass: s.n })),
  };
}

/**
 * The hour-of-day baseline bin for a local hour, with two fallbacks that matter operationally:
 * a cached PRE-W4-004 blob has no `hourly` array at all (the cache TTL outlives a deploy), and
 * a blob with neither an hourly table nor an RHR is a stranger. The first degrades to the flat
 * RHR baseline and says so with `confidence: 0`; the second abstains rather than manufacturing
 * a bin, because a fake bin is a fake z is a fake claim.
 */
function hourBinFor(baselines, hourOfDay) {
  const h = finite(hourOfDay);
  if (h == null) return null;
  const hour = ((Math.floor(h) % 24) + 24) % 24;

  const table = baselines?.hourly;
  if (Array.isArray(table) && table.length === 24) {
    const bin = table[hour];
    if (bin && finite(bin.value) != null) {
      return {
        hour,
        value: finite(bin.value),
        mad: finite(bin.mad) ?? 0,
        n: finite(bin.n) ?? 0,
        confidence: clamp01(finite(bin.confidence) ?? 0),
        source: 'hourly',
      };
    }
  }

  const rhr = finite(baselines?.rhrMedian);
  if (rhr == null) return null;
  return {
    hour,
    value: rhr,
    mad: finite(baselines?.rhrMAD) ?? 0,
    n: 0,
    // Honest: this is a flat 24h baseline wearing an hour bin's clothes. It carries the
    // BIN_PRIOR_MASS floor and nothing more.
    confidence: 0,
    source: 'rhr-fallback',
  };
}

/** `floor + (1 - floor) · confidence` — a prior that is informative but never conclusive. */
function evidenceMass(confidence, floor) {
  const c = clamp01(finite(confidence) ?? 0);
  return floor + (1 - floor) * c;
}

// ── declared mood ───────────────────────────────────────────────────────────────────────

/**
 * Fuse EVERY emotion tap, not just the last one. The emotion wheel emits `{x, y}` in [-1, 1]
 * with **x = valence and y = arousal** (D5 — `geminiEngine`'s prompt had the axes swapped and
 * the model was reading arousal as valence for a year).
 *
 * Two taps in the same quadrant are corroboration; two in opposite quadrants are a person who
 * does not know what they feel, and that is genuinely LESS information than one clear tap — so
 * confidence is the product of an evidence term (n/(n+1), the §M.4 shrinkage weight with the
 * variance-derived k = 1) and a coherence term (a Gaussian in the RMS dispersion about the
 * centroid). Scattered taps therefore fall toward zero confidence rather than averaging into a
 * confident-looking neutral, which is the failure mode of taking a mean and stopping.
 */
function fuseDeclared(taps) {
  const pts = [];
  for (const t of Array.isArray(taps) ? taps : []) {
    const x = finite(t?.x);
    const y = finite(t?.y);
    if (x == null || y == null) continue;
    pts.push([clamp(x, -1, 1), clamp(y, -1, 1)]);
  }

  if (pts.length === 0) {
    return {
      n: 0, valence: NEUTRAL.valence, arousal: NEUTRAL.arousal, dispersion: 0, mass: 0,
    };
  }

  const n = pts.length;
  const cx = pts.reduce((a, p) => a + p[0], 0) / n;
  const cy = pts.reduce((a, p) => a + p[1], 0) / n;
  const meanSq = pts.reduce((a, p) => a + (p[0] - cx) ** 2 + (p[1] - cy) ** 2, 0) / n;
  const dispersion = Math.sqrt(Math.max(0, meanSq));

  const evidence = n / (n + DECLARED_PRIOR_COUNT);
  const coherence = Math.exp(-(dispersion * dispersion) / (2 * DECLARED_DISPERSION_SIGMA ** 2));

  return {
    n,
    valence: clamp01((cx + 1) / 2),
    arousal: clamp01((cy + 1) / 2),
    dispersion,
    mass: clamp01(evidence * coherence),
  };
}

// ── the six evidence axes ───────────────────────────────────────────────────────────────

/**
 * AROUSAL — how activated this body is *relative to itself, at this hour*. The hour bin is what
 * makes this personal in the way a global constant never could: 78 bpm at 03:00 and 78 bpm at
 * 18:00 are different statements about the same person, and only one of them is remarkable.
 *
 * Declared arousal fuses in here by confidence weight. This is the replacement for every fixed
 * 50/50 blend in the old path: when the user has tapped clearly and often, their word carries
 * more; when they have not tapped at all, the body speaks alone; and when neither exists the
 * axis abstains.
 */
function arousalAxis({ heartRate, bin, readingConfidence = 1, declared = null } = {}) {
  const parts = [];

  const hr = finite(heartRate);
  const rc = clamp01(finite(readingConfidence) ?? 0);
  if (hr != null && bin && rc > 0) {
    const z = robustZ(hr, bin.value, bin.mad, { minSigma: MIN_SIGMA.heartRate });
    if (z != null) {
      parts.push({
        name: 'physiological',
        value: squash(z, Z_SCALE),
        mass: rc * evidenceMass(bin.confidence, BIN_PRIOR_MASS),
      });
    }
  }

  if (declared && finite(declared.mass) > 0) {
    parts.push({ name: 'declared', value: declared.arousal, mass: declared.mass });
  }

  return blend(parts, { neutral: NEUTRAL.arousal });
}

/**
 * EXERTION — §M.8 Karvonen, `(HR − RHR) / (HRmax − RHR)`. This replaces `(HR − 60) / 100`, a
 * formula that is only correct for a person whose RHR is 60 and whose reserve is 100. For the
 * simulator's athlete it under-reads by more than a zone; for the older adult it over-reads.
 *
 * The stated activity enters as a PRIOR (see ACTIVITY_EXERTION_PRIOR). No DOB is stored and no
 * age formula is ever used (§M.7).
 */
function exertionAxis({ heartRate, zones, hrMaxSource, activity, readingConfidence = 1 } = {}) {
  const parts = [];

  const rhr = finite(zones?.restingHeartRate);
  // S8: a body whose estimated maximum lands at or below its resting rate must still produce an
  // ordered, finite exertion rather than a division by zero propagating into every downstream
  // axis. `karvonenZones` already floors this; the floor is repeated here because this function
  // is public and its callers are not all inside this file.
  const hrr = Math.max(1, finite(zones?.hrr) ?? 1);
  const hr = finite(heartRate);
  const rc = clamp01(finite(readingConfidence) ?? 0);

  if (hr != null && rhr != null && rc > 0) {
    const reliability = HRMAX_SOURCE_RELIABILITY[String(hrMaxSource)] ?? HRMAX_SOURCE_RELIABILITY.default;
    parts.push({ name: 'measured', value: clamp01((hr - rhr) / hrr), mass: rc * reliability });
  }

  const prior = finite(ACTIVITY_EXERTION_PRIOR[String(activity ?? '').toLowerCase()]);
  if (prior != null) parts.push({ name: 'activity', value: prior, mass: ACTIVITY_PRIOR_MASS });

  return blend(parts, { neutral: NEUTRAL.exertion });
}

/**
 * STRESS — and the place D3 dies structurally.
 *
 * Two independent lines of evidence, plus a dormant third:
 *
 *  1. HRV suppression, against the user's OWN median and MAD (D1). This is a daily scalar drawn
 *     from nightly/morning VitalSample rows, so it is deliberately NOT gated by what the body is
 *     doing right now — the measurement predates the moment.
 *  2. Resting elevation: heart rate above the personal hour-bin baseline, weighted by a SOFT
 *     gate on Karvonen exertion. An explicit exercise activity zeroes the gate outright; an
 *     unlabelled reading — which is every batch row (D2) — is gated by exertion alone, so the
 *     165 bpm run that used to score S = 1.0 now contributes nothing here, and does so because
 *     of what the number means rather than because someone labelled it.
 *  3. Garmin's own stress score, dormant behind consent v2 (D16). Wired, unfed.
 *
 * When neither line has evidence the axis returns NEUTRAL.stress at mass 0. It does not guess.
 */
function stressAxis({
  heartRate, hrv, bin, baselines, exertion = 0, activity, stressLevel, readingConfidence = 1,
} = {}) {
  const parts = [];

  const hrvZ = robustZ(hrv, baselines?.hrvMedian, baselines?.hrvMAD, { minSigma: MIN_SIGMA.hrv });
  if (hrvZ != null) {
    parts.push({
      name: 'hrvSuppression',
      value: rise(-hrvZ, Z_SCALE),
      mass: evidenceMass(baselines?.coverage?.hrvConfidence, HRV_BASELINE_PRIOR_MASS),
    });
  }

  const hr = finite(heartRate);
  const rc = clamp01(finite(readingConfidence) ?? 0);
  if (hr != null && bin && rc > 0 && !isExercise(activity)) {
    const e = clamp01(finite(exertion) ?? 0);
    const restGate = clamp01((REST_GATE_CLOSE - e) / Math.max(REST_GATE_CLOSE - REST_GATE_OPEN, 1e-9));
    const mass = rc * evidenceMass(bin.confidence, BIN_PRIOR_MASS) * restGate;
    if (mass > 0) {
      const z = robustZ(hr, bin.value, bin.mad, { minSigma: MIN_SIGMA.heartRate });
      if (z != null) parts.push({ name: 'restingElevation', value: rise(z, Z_SCALE), mass });
    }
  }

  const sl = finite(stressLevel);
  if (sl != null) parts.push({ name: 'stressLevel', value: clamp01(sl / 100), mass: STRESS_LEVEL_MASS });

  return blend(parts, { neutral: NEUTRAL.stress });
}

/** The weighted-stage night total, matching `translate._weightedSleep` and §M.6's STAGE_WEIGHTS. */
function weightedNight(night) {
  if (!night || typeof night !== 'object') return null;
  let total = 0;
  let any = false;
  for (const [stage, weight] of Object.entries(SLEEP_STAGE_WEIGHTS)) {
    const v = finite(night[stage]);
    if (v != null && v >= 0) { total += v * weight; any = true; }
  }
  return any ? total : null;
}

/**
 * RECOVERY — `translate()`'s R, with explicit weights and honest missing-data mass instead of a
 * mean over whatever happened to be present. The QA4 Q1 guard is kept verbatim in spirit: an
 * all-zero or falsy sleep baseline is not a "need" of zero, it is a data bug, so the need falls
 * back to the default night rather than producing a 0/0 that silently poisons the axis.
 */
function recoveryAxis({ sleep, hrv, bodyBattery, dailyReadiness, baselines } = {}) {
  const parts = [];

  const actual = weightedNight(sleep?.lastNight);
  if (actual != null) {
    const baselineNeed = weightedNight(sleep?.baseline);
    const need = baselineNeed != null && baselineNeed > 0 ? baselineNeed : weightedNight(DEFAULT_NIGHT);
    if (need > 0) parts.push({ name: 'sleep', value: clamp01(actual / need), mass: RECOVERY_WEIGHTS.sleep });
  }

  const hrvZ = robustZ(hrv, baselines?.hrvMedian, baselines?.hrvMAD, { minSigma: MIN_SIGMA.hrv });
  if (hrvZ != null) parts.push({ name: 'hrv', value: squash(hrvZ, Z_SCALE), mass: RECOVERY_WEIGHTS.hrv });

  const battery = finite(bodyBattery);
  if (battery != null) parts.push({ name: 'bodyBattery', value: clamp01(battery / 100), mass: RECOVERY_WEIGHTS.bodyBattery });

  const readiness = finite(dailyReadiness);
  if (readiness != null) parts.push({ name: 'dailyReadiness', value: clamp01(readiness / 100), mass: RECOVERY_WEIGHTS.dailyReadiness });

  return blend(parts, { neutral: NEUTRAL.recovery });
}

/**
 * FATIGUE — the slow axis. Recovery answers "how is today's body"; fatigue answers "what has
 * been accumulating", and the two genuinely dissociate: a person can wake rested after one good
 * night on top of a fortnight of debt. §M.6's debt accumulator carries most of the weight; a
 * sustained multi-day HRV downtrend corroborates it. An HRV UPtrend is not negative fatigue —
 * `rise` is one-sided precisely so recovering does not read as being extra-rested.
 */
function fatigueAxis({ debt, baselines } = {}) {
  const parts = [];

  const ratio = finite(debt?.ratio);
  const nights = finite(debt?.nights) ?? 0;
  if (ratio != null && nights > 0) {
    parts.push({
      name: 'sleepDebt',
      value: clamp01(ratio),
      mass: FATIGUE_WEIGHTS.debt * clamp01(finite(debt?.confidence) ?? 0),
    });
  }

  const trend = finite(baselines?.trend?.hrv);
  if (trend != null) {
    parts.push({
      name: 'hrvTrend',
      value: rise(-trend, TREND_Z_SCALE),
      mass: FATIGUE_WEIGHTS.hrvTrend * evidenceMass(baselines?.coverage?.hrvConfidence, HRV_BASELINE_PRIOR_MASS),
    });
  }

  return blend(parts, { neutral: NEUTRAL.fatigue });
}

/**
 * CIRCADIAN ALERTNESS — the personal clock, replacing `translate()`'s binary `windDown` (a step
 * function at 21:00 that is simply false for the night-shift worker, whose acrophase is +8h).
 * The curve comes from the user's own cosinor fit, damped by that fit's confidence.
 *
 * Mass is zero without a cosinor object: a population acrophase is a fine curve to DRAW, but it
 * is not evidence about this person, and this engine's contract is that mass means personal
 * evidence. A stranger gets the neutral 0.5 at mass 0 like every other axis.
 */
function alertnessAxis({ baselines, hourOfDay, debtRatio = 0 } = {}) {
  const h = finite(hourOfDay);
  const cosinor = baselines?.cosinor;
  if (h == null || !cosinor || finite(cosinor.phi) == null) {
    return blend([], { neutral: NEUTRAL.circadianAlertness });
  }
  const { alertness } = circadianAlertness({ cosinor, hourOfDay: h, debtRatio: clamp01(finite(debtRatio) ?? 0) });
  return blend(
    [{ name: 'cosinor', value: alertness, mass: evidenceMass(cosinor.confidence, COSINOR_PRIOR_MASS) }],
    { neutral: NEUTRAL.circadianAlertness },
  );
}

// ── composition ─────────────────────────────────────────────────────────────────────────

function band(value, mass) {
  if (!(mass > 0)) return 'n/a';
  let i = 0;
  while (i < BAND_CUTS.length && value >= BAND_CUTS[i]) i++;
  return BAND_LABELS[i];
}

/**
 * The full evidence vector for one moment. PURE and clock-free: `now` is a required parameter
 * (S9) so a replay of the same inputs produces the same axes, which is what makes the soak
 * harness and the golden sets comparable at all.
 *
 * `degraded` is honoured hard rather than softly: when the ingestion filter reports a
 * low-confidence RUN it is saying *do not trust the physiology at all*, so every HR-derived
 * axis is dropped to mass 0 rather than merely discounted. Mood still works; physiology
 * abstains. That is what "mood-only" has to mean if it means anything.
 */
function computeAxes({
  live = {}, baselines = {}, state = {}, sleep = {}, taps = null,
  now, tzOffsetMinutes = 0, debt: debtOverride = null,
} = {}) {
  const t0 = process.hrtime.bigint();
  const nowMs = finite(now);
  if (nowMs == null) {
    throw new TypeError('affectEngine: `now` is required (epoch ms) — engines never read the clock (S9)');
  }

  const hourOfDay = localHour(nowMs, tzOffsetMinutes);
  const degraded = live?.degraded ?? null;
  const activity = live?.activity ?? null;

  // Under a degraded run the heart rate is present but not believable. Withholding it is the
  // difference between "I cannot see" and "I see nothing happening" — and withholding the VALUE
  // is the whole mechanism, deliberately not doubled up with a second confidence-zeroing guard:
  // every HR-derived part already requires a heart rate, so a second guard would be unfalsifiable
  // by construction (this session's stub-out battery caught exactly that and it was removed).
  // `readingConfidence` therefore stays what the ingestion filter actually reported.
  const heartRate = degraded ? null : finite(live?.heartRate);
  const readingConfidence = clamp01(finite(live?.confidence) ?? 1);

  const bin = hourBinFor(baselines, hourOfDay);
  const declared = fuseDeclared(taps);

  const debt = debtOverride ?? sleepDebtFrom(sleep);

  const exertion = exertionAxis({
    heartRate,
    zones: baselines?.zones,
    hrMaxSource: baselines?.maxHeartRateSource,
    activity,
    readingConfidence,
  });

  const axes = {
    arousal: arousalAxis({ heartRate, bin, readingConfidence, declared }),
    stress: stressAxis({
      heartRate,
      hrv: state?.hrv,
      bin,
      baselines,
      exertion: exertion.value,
      activity,
      stressLevel: state?.stressLevel,
      readingConfidence,
    }),
    recovery: recoveryAxis({
      sleep, hrv: state?.hrv, bodyBattery: state?.bodyBattery, dailyReadiness: state?.dailyReadiness, baselines,
    }),
    exertion,
    fatigue: fatigueAxis({ debt, baselines }),
    circadianAlertness: alertnessAxis({ baselines, hourOfDay, debtRatio: debt?.ratio }),
    // §0.2.4: declared-only, by design and forever. See the module header.
    valence: blend(
      declared.mass > 0 ? [{ name: 'declared', value: declared.valence, mass: declared.mass }] : [],
      { neutral: NEUTRAL.valence },
    ),
  };

  // Overall confidence: how much of this reading is data, tempered by how much of the BASELINE
  // it is measured against is data. Both have to be true — a confident reading against a
  // population baseline is a confident statement about a stranger.
  const meanMass = Object.values(axes).reduce((a, x) => a + x.mass, 0) / Object.keys(axes).length;
  const baselineConfidence = clamp01(finite(baselines?.confidence) ?? 0);
  const confidence = clamp01(meanMass * (0.5 + 0.5 * baselineConfidence));

  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  // S15 house telemetry. COARSE BANDS AND COUNTS ONLY — never a bpm, an ms of RMSSD or a
  // percentage. The habit is what keeps the zero-knowledge grep honest, and this line is
  // asserted against a vitals blacklist in the suite rather than merely intended to be safe.
  const telemetry = `[affect.axes] v=${AFFECT_ENGINE_VERSION} hour=${Math.floor(hourOfDay)} `
    + Object.entries(axes).map(([k, a]) => `${k}=${band(a.value, a.mass)}`).join(' ')
    + ` taps=${declared.n} bin=${bin ? bin.source : 'none'} degraded=${degraded ?? 'none'}`
    + ` conf=${band(confidence, 1)}`;

  return {
    v: AFFECT_ENGINE_VERSION,
    axes,
    declared,
    hourOfDay,
    degraded: degraded ?? null,
    confidence,
    telemetry,
    ms,
  };
}

/** `sleep.history` → §M.6 debt, or a zero-evidence stand-in. Kept private; callers pass sleep. */
function sleepDebtFrom(sleep) {
  const history = sleep?.history;
  if (!Array.isArray(history) || history.length === 0) return { debt: 0, ratio: 0, nights: 0, confidence: 0 };
  // Required lazily: chronobiology does not import this module, but keeping the dependency at
  // the call site documents that debt is chronobiology's formula, not a second copy of §M.6.
  const { sleepDebt } = require('./chronobiology');
  return sleepDebt(history);
}

module.exports = {
  AFFECT_ENGINE_VERSION,
  // primitives
  finite, robustZ, rise, squash, blend, hourBinFor, evidenceMass, weightedNight, band,
  // declared mood
  fuseDeclared,
  // axes
  arousalAxis, stressAxis, recoveryAxis, exertionAxis, fatigueAxis, alertnessAxis,
  computeAxes,
  // constants — exported so the suite pins the DERIVATION, not a copy of it
  Z_SCALE, AXIS_PRIOR_MASS, NEUTRAL, MIN_SIGMA, BIN_PRIOR_MASS, HRV_BASELINE_PRIOR_MASS,
  COSINOR_PRIOR_MASS, ACTIVITY_EXERTION_PRIOR, ACTIVITY_PRIOR_MASS, HRMAX_SOURCE_RELIABILITY,
  REST_GATE_OPEN, REST_GATE_CLOSE, STRESS_LEVEL_MASS, RECOVERY_WEIGHTS, FATIGUE_WEIGHTS, TREND_Z_SCALE,
  DECLARED_PRIOR_COUNT, DECLARED_DISPERSION_SIGMA, DEFAULT_NIGHT, SLEEP_STAGE_WEIGHTS,
  BAND_CUTS, BAND_LABELS,
};
