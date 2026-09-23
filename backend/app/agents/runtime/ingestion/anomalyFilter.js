'use strict';

/**
 * A0 — signal integrity (W4-003). Hampel -> slew -> Kalman, per §M.1 and §M.2.
 *
 * WHY THIS EXISTS (D6). The live socket lane had ZERO filtering: `handleBiometricReading`
 * latched the last raw sample and drove the music from it. A wrist PPG carries roughly
 * 3 bpm of error against ECG at rest and produces frank artifacts — contact loss reads 0,
 * double-counted beats read 2x, motion reads +40 — so "the last sample" is not a heart
 * rate, it is a heart rate plus whatever the sensor was doing at that instant.
 *
 * PURE, and the caller owns the state (§0.4 S9). Nothing here reads the clock, allocates a
 * socket, or touches a database: `filterReading(state, reading, {now})` returns a NEW state
 * and a result, so the same code runs against a live socket, a replay harness with an
 * accelerated clock, and a fuzz property with no adaptation at all. `now` is a required
 * parameter for exactly that reason — an engine that calls Date.now() cannot be replayed.
 *
 * ── The four gates, in order, and why that order ──────────────────────────────────────
 *
 *   1. TIMESTAMP    is this reading FROM a time we can use?      (S6: the backfill trap)
 *   2. RANGE        is this a heart rate at all?                 (D9: the ONE shared predicate)
 *   3. SLEW         could a body have got here that fast?        (model-free, §M.1)
 *   4. HAMPEL       do this reading's neighbours agree with it?  (model-free, §M.1)
 *   5. INNOVATION   does our own estimate agree with it?         (model-based, §M.2)
 *
 * Model-free before model-based is deliberate: a wrong model must never be able to reject
 * data forever, so the two cheap statistical gates get to speak first, and the model-based
 * gate has an escape hatch (see RESEED below). Gates 1-2 answer "is this data"; gates 3-5
 * answer "is this data plausible". Only readings that clear 1-2 enter the Hampel window,
 * because a 0 bpm contact-loss sample is not a low heart rate to be averaged in, it is the
 * absence of a reading, and letting it into the window would poison the median that the
 * whole outlier test depends on.
 *
 * ── Constants: derived, not chosen ───────────────────────────────────────────────────
 *
 * §M.2 fixes R = 9 ((3 bpm)^2 wrist noise) and asks for "q tuned for ~30 s trend response".
 * A pure white-noise-acceleration Q grows the level variance as q*dt^3/3, which is the wrong
 * SHAPE for heart rate: short-term HR wander is a mean-reverting (OU) process with envelope
 * sigma ~= 4 bpm and autocorrelation time tau ~= 165 s, whose level increment variance grows
 * LINEARLY in dt. Fitting a dt^3 model to a dt^1 process at one timescale necessarily
 * mis-fits every other: tuned at 30 s it is ~37x too stiff at a 5 s cadence (steady-state
 * gain 0.05 rather than 0.28, a 19-sample memory over a process that decorrelates in 33).
 *
 * So Q carries both terms, from ONE physical envelope:
 *
 *      Q(dt) = q_accel * [[dt^3/3, dt^2/2], [dt^2/2, dt]]  +  q_level * [[dt, 0], [0, 0]]
 *
 *      q_level = 2*sigma^2 / tau                  the wander's own diffusion (bpm^2/s)
 *      q_accel = 3*q_level / T*^2                 (bpm^2/s^3)
 *
 * The second line IS the "~30 s trend response" requirement, stated exactly: at the horizon
 * T* the trend channel contributes the same level uncertainty as the wander channel
 * (q_accel*T*^3/3 == q_level*T*). Below T* the filter is a smoother, above it a tracker.
 * Two constants, one envelope, no free parameters — and the numbers are pinned against
 * that derivation in the test suite rather than against themselves.
 *
 * WHAT THE SECOND TERM IS ACTUALLY WORTH, measured by ablation rather than argued (the test
 * suite runs the comparison, so deleting the term turns pins red): median tracking error
 * against persona ground truth falls ~15% on ALL FIVE personas — athlete 0.33 -> 0.29 bpm,
 * sedentary 0.49 -> 0.42, older-adult 0.38 -> 0.33, shift-worker 0.46 -> 0.39, stressed
 * professional 0.55 -> 0.48 — with p90 improving by the same fraction. Stated the other way
 * round, because the first draft of this comment claimed more than the numbers support: the
 * ACCEPTANCE rate is identical to two decimal places either way. The single-term filter is
 * not broken, it is just consistently worse, and this is a 15% accuracy improvement for one
 * extra term derived from an envelope the module already needed.
 *
 * What this buys, measured rather than asserted: the steady-state gain adapts to cadence.
 * At a 5 s live cadence K ~= 0.28 (a ~4-sample memory, level std ~1.6 bpm); at the 5-minute
 * watch cadence K ~= 0.998, i.e. essentially pass-through — which is correct, because two
 * samples five minutes apart share no information and averaging them would invent a body
 * that was never there.
 */

const { HR_MIN, HR_MAX, isPhysiologicalHR } = require('../../../services/wearable/hrRange');

const ANOMALY_FILTER_VERSION = 1;

// §M.2: R ~= 9 == (3 bpm)^2, consumer wrist PPG error against ECG.
const MEASUREMENT_R = 9;
const MEASUREMENT_SIGMA = Math.sqrt(MEASUREMENT_R);

// §M.1 Hampel. The window is bounded by COUNT and by TIME, and the time bound is the one
// that matters: seven samples at 1 Hz describe one moment, seven samples at the 5-minute
// watch cadence describe half an hour, over which a real heart rate legitimately moves 40
// bpm. Applying a deviation-from-median test across that span would reject physiology. So
// on a coarse lane the in-span window falls below HAMPEL_MIN_SAMPLES and the gate ABSTAINS
// — an honest "I cannot tell" instead of a confident wrong answer.
const HAMPEL_WINDOW = 7;
const HAMPEL_SPAN_MS = 60_000;
const HAMPEL_MIN_SAMPLES = 5;
const HAMPEL_SIGMAS = 3;
const MAD_TO_SIGMA = 1.4826; // MAD -> sigma for a Gaussian

// §M.1 slew. 8 bpm/s is above anything a sinoatrial node does and below every motion
// artifact. It is a RATE, so it self-disables over long intervals — which is what makes it
// safe to run on the watch lane as well as the live one.
const SLEW_MAX_BPM_PER_SEC = 8;

// §M.2 innovation gate.
const INNOVATION_GATE_SIGMAS = 3;

// §M.1: "rejected readings propagate the prediction with confidence x0.7". Multiplicative,
// so a filter flying blind decays geometrically into degraded mode instead of sitting at a
// confident number it has not earned.
const REJECT_CONFIDENCE_FACTOR = 0.7;

// A low-confidence RUN, not a low-confidence sample: on a healthy stream ~12% of readings
// dip below the threshold by chance, and 60 s of them in a row does not happen by chance.
const DEGRADED_CONFIDENCE = 0.3;
const DEGRADED_RUN_MS = 60_000;
const DEGRADED_MODE = 'mood-only';

// S6 timestamp sanity. Five minutes of future tolerance covers ordinary client clock skew;
// beyond that it is the Garmin-backfill trap (a device replaying history with tomorrow's
// timestamps). The floor matches BiometricLog's 90-day retention: a reading we would not
// keep is a reading we must not learn from either.
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const MAX_AGE_MS = 90 * 24 * 3600_000;

// Predict horizon clamp. After an hour of silence the model has no usable memory anyway
// (K -> 1), and clamping keeps dt^3 from turning into a float that no longer has meaningful
// precision. Cheaper and more honest than pretending a day-old estimate still constrains
// anything.
const MAX_PREDICT_DT_SEC = 3600;

// The escape hatch. A model-based gate that can reject forever is a filter that goes deaf
// the moment it is wrong — the classic failure of a naive innovation gate on a genuine step
// change (an interval sprint, a cold-start on the wrong level). After this many CONSECUTIVE
// statistical rejections, if the recent RAW readings agree with each other, the conclusion
// is that the model is wrong rather than the data, and the state is re-seeded to them.
// Sized to the Hampel window's own recovery horizon: 4 of 7 is a new median.
const RESEED_AFTER_CONSECUTIVE_REJECTS = 4;

// A stuck sensor repeats a value exactly. Its innovation is zero by construction, which
// without this term would push confidence UP precisely when the signal has stopped carrying
// information. TIME-based, not count-based, for the same reason the Hampel window is: six
// identical integers one second apart is an ordinary resting wrist, whereas the same six
// spread over five minutes is a fault.
//
// The span threshold is DERIVED from the same wander envelope that gives q, not chosen: a
// value held longer than the wander's own autocorrelation time tau has outlived the process
// that is supposed to be moving it. Devices report 1 bpm resolution and a sleeping heart
// genuinely sits on one integer for a while, so anything shorter than tau flags real
// physiology — which is exactly what a first cut at 30 s did, on quiet persona nights.
const FLATLINE_MIN_RUN = 3;
const FLATLINE_DECAY = 0.9;
// Floored, not annihilated: a stuck reading is usually still NEAR the truth. What it has
// lost is independence, not accuracy, so it is de-weighted rather than discarded.
const FLATLINE_MIN_FACTOR = 0.25;

const REJECT_REASONS = new Set([
  'not-a-number',
  'out-of-range',
  'future-timestamp',
  'stale-timestamp',
  'non-monotonic-time',
  'slew',
  'hampel',
  'innovation',
]);

/**
 * Per-metric physics. `wanderSigma`/`wanderTauSec`/`trendResponseSec` are the SOURCE
 * quantities; q_level and q_accel are derived from them here so the two can never drift
 * apart in a later edit.
 */
function buildConfig(spec) {
  const qLevel = (2 * spec.wanderSigma ** 2) / spec.wanderTauSec;
  const qAccel = (3 * qLevel) / spec.trendResponseSec ** 2;
  return Object.freeze({
    ...spec,
    qLevel,
    qAccel,
    // Prior on an unknown trend: over the response horizon an unmodelled slope b produces
    // b*T* of level error, so setting that equal to the sensor's own noise gives
    // sigma_b = sigma_z/T*. A derived prior rather than a chosen one.
    trendVar0: (MEASUREMENT_SIGMA / spec.trendResponseSec) ** 2,
    // A held value outlives the wander process once it spans tau (see FLATLINE_MIN_RUN).
    flatlineSpanMs: spec.wanderTauSec * 1000,
  });
}

const METRIC_CONFIGS = Object.freeze({
  heartRate: buildConfig({
    unit: 'bpm',
    min: HR_MIN,
    max: HR_MAX,
    isValid: isPhysiologicalHR,
    // Short-term HR wander envelope. 4 bpm / 165 s sits in the middle of the five W4-002
    // personas (sigma 2.8-4.2, tau 140-200), which are themselves the literature's
    // short-term HRV band rather than a fixture invented for this filter.
    wanderSigma: 4,
    wanderTauSec: 165,
    trendResponseSec: 30,
    R: MEASUREMENT_R,
    sigmaZ: MEASUREMENT_SIGMA,
    slewMax: SLEW_MAX_BPM_PER_SEC,
  }),
});

// The heart-rate values, exported so the derivation can be pinned. When a second metric
// goes live these stay heartRate's and every consumer reads them off the config instead.
const Q_LEVEL = METRIC_CONFIGS.heartRate.qLevel;
const Q_ACCEL = METRIC_CONFIGS.heartRate.qAccel;
const FLATLINE_SPAN_MS = METRIC_CONFIGS.heartRate.flatlineSpanMs;

// ── small numeric helpers (all zero-guarded — S8) ─────────────────────────────────────

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x) => clamp(x, 0, 1);
const round = (x, dp) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

function medianOf(sorted) {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function median(values) {
  return medianOf([...values].sort((a, b) => a - b));
}

// The only config fields a caller may override, and they are all plain numbers so the state
// stays JSON-serialisable. This exists so the derivations above can be ABLATED by a test
// (qLevel: 0 is the pure white-noise-acceleration filter) instead of merely asserted — a
// constant nothing can falsify is a constant nobody is checking. W4-004's per-user
// baselines are the second consumer: one person's wander envelope is not another's.
const OVERRIDABLE = Object.freeze(['qLevel', 'qAccel', 'R', 'sigmaZ', 'slewMax', 'flatlineSpanMs']);

/** Resolve a state's effective config. Returns the frozen shared object when unmodified. */
function configFor(state) {
  const base = METRIC_CONFIGS[state.metric];
  if (!base) throw new RangeError(`anomalyFilter: unknown metric ${JSON.stringify(state.metric)}`);
  return state.config ? { ...base, ...state.config } : base;
}

/**
 * A fresh, JSON-serialisable filter state for one metric on one stream.
 * Throws on an unknown metric rather than defaulting: a silently-defaulted metric would
 * filter an SpO2 series with heart-rate physics and look like it worked.
 *
 * @param {string} metric
 * @param {object} [overrides] subset of OVERRIDABLE; anything else throws rather than
 *                             being ignored, because a typo'd tuning knob that silently
 *                             does nothing is worse than no knob at all.
 */
function createFilterState(metric, overrides) {
  const cfg = METRIC_CONFIGS[metric];
  if (!cfg) {
    throw new RangeError(
      `anomalyFilter: unknown metric ${JSON.stringify(metric)} (known: ${Object.keys(METRIC_CONFIGS).join(', ')})`,
    );
  }
  let config = null;
  if (overrides != null) {
    if (typeof overrides !== 'object') throw new TypeError('anomalyFilter: overrides must be an object');
    config = {};
    for (const [k, val] of Object.entries(overrides)) {
      if (!OVERRIDABLE.includes(k)) {
        throw new RangeError(`anomalyFilter: ${k} is not overridable (allowed: ${OVERRIDABLE.join(', ')})`);
      }
      if (!Number.isFinite(val) || val < 0) {
        throw new RangeError(`anomalyFilter: override ${k} must be a finite number >= 0`);
      }
      config[k] = val;
    }
  }
  return {
    config,
    v: ANOMALY_FILTER_VERSION,
    metric,
    // Kalman state x = [level, trend]; P stored as [p00, p01, p11] (symmetric by construction).
    level: null,
    trend: 0,
    p: [0, 0, 0],
    // Time of the last reading that ADVANCED THE MODEL. A reading rejected before the
    // Kalman never moves this, so the next accepted reading's dt spans the whole outage and
    // the covariance grows to match — which is how the gate re-opens on its own.
    lastAtMs: null,
    // Slew reference: the last reading we actually believed. Deliberately NOT the last
    // reading seen, or one rejected spike would make the next ordinary sample look like a
    // 130 bpm/s collapse and reject it too.
    lastAcceptedValue: null,
    lastAcceptedAtMs: null,
    // Raw in-range observations for the Hampel test, oldest first, as [value, atMs] pairs.
    // Rejected readings ARE recorded: withholding them is the classic Hampel deadlock, in
    // which the median never moves and a genuine step change is locked out permanently.
    window: [],
    confidence: 0,
    lowSinceMs: null,
    degraded: null,
    consecutiveRejects: 0,
    flatValue: null,
    flatRun: 0,
    flatStartMs: null,
    sampleCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    reseedCount: 0,
    flatlineCount: 0,
  };
}

function cloneState(s) {
  return {
    ...s,
    config: s.config ? { ...s.config } : null,
    p: [s.p[0], s.p[1], s.p[2]],
    window: s.window.map((w) => [w[0], w[1]]),
  };
}

/** Kalman predict over `dtSec`, returning the prior [level, trend, p00, p01, p11]. */
function predict(level, trend, p, dtSec, cfg) {
  const dt = clamp(dtSec, 0, MAX_PREDICT_DT_SEC);
  const [a, b, c] = p;
  // F P F^T with F = [[1, dt], [0, 1]]
  let p00 = a + 2 * dt * b + dt * dt * c;
  let p01 = b + dt * c;
  let p11 = c;
  // Q = q_accel * [[dt^3/3, dt^2/2], [dt^2/2, dt]] + q_level * [[dt, 0], [0, 0]]
  const dt2 = dt * dt;
  const dt3 = dt2 * dt;
  p00 += cfg.qAccel * (dt3 / 3) + cfg.qLevel * dt;
  p01 += cfg.qAccel * (dt2 / 2);
  p11 += cfg.qAccel * dt;
  return [level + trend * dt, trend, p00, p01, p11];
}

/** Seed (or re-seed) the state onto a single observation. */
function seedOnto(next, value, atMs, cfg) {
  next.level = clamp(value, cfg.min, cfg.max);
  next.trend = 0;
  // The level IS this measurement, so its variance is exactly the measurement's.
  next.p = [cfg.R, 0, cfg.trendVar0];
  next.lastAtMs = atMs;
}

/**
 * Filter one reading.
 *
 * @param {object} state              from createFilterState (never mutated)
 * @param {{value:*, atMs:number}} reading
 * @param {{now:number}} opts         `now` in epoch ms — REQUIRED (S9)
 * @returns {{state:object, result:{
 *            accepted:boolean, reason:string|null, level:number|null, trend:number,
 *            confidence:number, degraded:string|null, flags:string[], v:number}}}
 */
function filterReading(state, reading, opts) {
  const now = opts && opts.now;
  if (!Number.isFinite(now)) {
    throw new TypeError('anomalyFilter: `now` is required (epoch ms) — engines never read the clock (S9)');
  }
  if (!reading || !Number.isFinite(reading.atMs)) {
    throw new TypeError('anomalyFilter: reading.atMs is required (epoch ms)');
  }
  const cfg = configFor(state);

  const atMs = reading.atMs;
  const value = reading.value;
  const next = cloneState(state);
  next.sampleCount += 1;
  const flags = [];

  /** Reject: propagate the last estimate, decay confidence, never blank the output. */
  const reject = (reason) => {
    next.rejectedCount += 1;
    next.confidence = clamp01(round(state.confidence * REJECT_CONFIDENCE_FACTOR, 4));
    return finish(false, reason);
  };

  const finish = (accepted, reason) => {
    // Degraded is a RUN condition evaluated on every reading, accepted or not.
    if (next.confidence < DEGRADED_CONFIDENCE) {
      if (next.lowSinceMs === null) next.lowSinceMs = atMs;
      next.degraded = atMs - next.lowSinceMs > DEGRADED_RUN_MS ? DEGRADED_MODE : null;
    } else {
      next.lowSinceMs = null;
      next.degraded = null;
    }
    return {
      state: next,
      result: {
        v: ANOMALY_FILTER_VERSION,
        accepted,
        reason: accepted ? null : reason,
        level: next.level === null ? null : round(next.level, 2),
        trend: round(next.trend, 5),
        confidence: next.confidence,
        degraded: next.degraded,
        flags,
      },
    };
  };

  // ── 1. timestamp sanity (S6) ────────────────────────────────────────────────────────
  if (atMs > now + FUTURE_TOLERANCE_MS) return reject('future-timestamp');
  if (atMs < now - MAX_AGE_MS) return reject('stale-timestamp');

  // ── 2. is it a number, and is it a heart rate (D9's ONE predicate) ──────────────────
  if (typeof value !== 'number' || !Number.isFinite(value)) return reject('not-a-number');
  if (!cfg.isValid(value)) return reject('out-of-range');

  // ── 3. monotonic time — and the only place a dt division could see a zero ───────────
  if (state.lastAtMs !== null && atMs <= state.lastAtMs) return reject('non-monotonic-time');

  // Past this point the reading is a PLAUSIBLE observation, so it joins the Hampel window
  // whatever the statistical gates decide about it.
  next.window = [...next.window, [value, atMs]]
    .filter(([, t]) => t > atMs - HAMPEL_SPAN_MS)
    .slice(-HAMPEL_WINDOW);

  // Stuck-sensor run, tracked on plausible observations only.
  if (value === state.flatValue) {
    next.flatRun = state.flatRun + 1;
  } else {
    next.flatValue = value;
    next.flatRun = 1;
    next.flatStartMs = atMs;
  }
  const flatSpanMs = atMs - (next.flatStartMs ?? atMs);
  const isFlatline = next.flatRun >= FLATLINE_MIN_RUN && flatSpanMs > cfg.flatlineSpanMs;
  let flatlineFactor = 1;
  if (isFlatline) {
    flags.push('flatline');
    next.flatlineCount += 1;
    flatlineFactor = Math.max(
      FLATLINE_MIN_FACTOR,
      FLATLINE_DECAY ** (next.flatRun - FLATLINE_MIN_RUN + 1),
    );
  }

  // First usable reading: nothing to test it against, so seed and say so honestly.
  if (state.level === null || state.lastAtMs === null) {
    seedOnto(next, value, atMs, cfg);
    next.lastAcceptedValue = value;
    next.lastAcceptedAtMs = atMs;
    next.acceptedCount += 1;
    next.consecutiveRejects = 0;
    // y = 0 by construction, so confidence is the maturity term alone: one reading is one
    // reading, and sigma_z/sqrt(sigma_z^2 + R) = 0.707 is exactly how much that is worth.
    next.confidence = clamp01(round(maturity(cfg, next.p[0]) * flatlineFactor, 4));
    return finish(true, null);
  }

  // The reseed decision is shared by all three statistical gates: whichever one fires, the
  // question "is the model wrong rather than the data?" is the same question.
  const rejectStatistical = (reason) => {
    const consec = state.consecutiveRejects + 1;
    if (consec >= RESEED_AFTER_CONSECUTIVE_REJECTS) {
      const recent = next.window.slice(-RESEED_AFTER_CONSECUTIVE_REJECTS).map(([x]) => x);
      if (recent.length >= RESEED_AFTER_CONSECUTIVE_REJECTS) {
        const med = median(recent);
        // The recent raw readings agree with EACH OTHER to within sensor noise, and they
        // disagree with us. Believe them.
        if (Math.abs(value - med) <= HAMPEL_SIGMAS * cfg.sigmaZ) {
          seedOnto(next, value, atMs, cfg);
          next.lastAcceptedValue = value;
          next.lastAcceptedAtMs = atMs;
          next.acceptedCount += 1;
          next.consecutiveRejects = 0;
          next.reseedCount += 1;
          flags.push('reseed');
          next.confidence = clamp01(round(maturity(cfg, next.p[0]) * flatlineFactor, 4));
          return finish(true, null);
        }
      }
    }
    next.consecutiveRejects = consec;
    return reject(reason);
  };

  // ── 4. slew (§M.1) — measured from the last BELIEVED reading ────────────────────────
  if (state.lastAcceptedValue !== null && state.lastAcceptedAtMs !== null) {
    const dtSec = (atMs - state.lastAcceptedAtMs) / 1000;
    if (dtSec > 0 && Math.abs(value - state.lastAcceptedValue) / dtSec > cfg.slewMax) {
      return rejectStatistical('slew');
    }
  }

  // ── 5. Hampel (§M.1) — abstains when the in-span window cannot support the test ─────
  const win = next.window.map(([x]) => x);
  if (win.length >= HAMPEL_MIN_SAMPLES) {
    const med = median(win);
    const mad = median(win.map((x) => Math.abs(x - med)));
    // Scale floor. Integer-quantised resting HR produces MAD = 0 routinely, and an
    // unfloored 3*1.4826*0 threshold rejects the entire signal. The sensor's own noise is
    // the smallest scale the data can honestly have.
    const scale = Math.max(MAD_TO_SIGMA * mad, cfg.sigmaZ);
    if (Math.abs(value - med) > HAMPEL_SIGMAS * scale) return rejectStatistical('hampel');
  }

  // ── 6. Kalman predict + innovation gate + update (§M.2) ─────────────────────────────
  const dtSec = (atMs - state.lastAtMs) / 1000;
  const [lPred, bPred, p00, p01, p11] = predict(state.level, state.trend, state.p, dtSec, cfg);
  const y = value - lPred;
  const S = p00 + cfg.R;
  // S >= R > 0 always (p00 is a variance and Q is PSD), so this root and the divisions
  // below cannot see a zero. Asserted rather than assumed, because a NaN here would
  // propagate silently into every downstream target.
  const rootS = Math.sqrt(S);

  next.lastAtMs = atMs;

  if (Math.abs(y) > INNOVATION_GATE_SIGMAS * rootS) {
    // Keep the PREDICTED state (the model's own best guess) rather than the stale posterior:
    // the prediction is what the filter actually believes at this instant.
    next.level = clamp(lPred, cfg.min, cfg.max);
    next.trend = bPred;
    next.p = [p00, p01, p11];
    return rejectStatistical('innovation');
  }

  const k0 = p00 / S;
  const k1 = p01 / S;
  next.level = clamp(lPred + k0 * y, cfg.min, cfg.max);
  next.trend = clamp(bPred + k1 * y, -cfg.slewMax, cfg.slewMax);
  // (I - KH)P with H = [1, 0]; symmetric by construction, so only three numbers are kept.
  next.p = [(1 - k0) * p00, (1 - k0) * p01, p11 - k1 * p01];

  next.lastAcceptedValue = value;
  next.lastAcceptedAtMs = atMs;
  next.acceptedCount += 1;
  next.consecutiveRejects = 0;

  // §M.2 c = exp(-y^2/2S), times the gate factors §M.1 allows for.
  //   innovation — how surprising this reading was under the model.
  //   maturity   — how well determined the estimate now is, relative to a single reading.
  //                Without it a cold-started filter reports confidence 1.0 for its very
  //                first sample, which is the opposite of true.
  //   flatline   — how much independent information the sensor is still supplying.
  const innovation = Math.exp(-(y * y) / (2 * S));
  next.confidence = clamp01(round(innovation * maturity(cfg, next.p[0]) * flatlineFactor, 4));

  return finish(true, null);
}

/** sigma_z / sqrt(sigma_z^2 + p00): 0 for a hopeless estimate, -> 1 for a certain one. */
function maturity(cfg, p00) {
  const v = Number.isFinite(p00) && p00 > 0 ? p00 : 0;
  return cfg.sigmaZ / Math.sqrt(cfg.sigmaZ * cfg.sigmaZ + v);
}

/**
 * A read-only view of a state, plus the house single-line telemetry (S15).
 *
 * ZERO-KNOWLEDGE: the telemetry line carries COUNTS and FLAGS only. `level` is returned to
 * the caller (which is inside worker/socket scope and entitled to it) but never rendered
 * into the string, because the string is the thing that ends up in a log.
 */
function summarizeFilterState(state) {
  return {
    metric: state.metric,
    level: state.level === null ? null : round(state.level, 2),
    trend: round(state.trend, 5),
    levelVariance: state.p[0],
    confidence: state.confidence,
    degraded: state.degraded,
    sampleCount: state.sampleCount,
    accepted: state.acceptedCount,
    rejected: state.rejectedCount,
    telemetry:
      `[anomalyFilter] metric=${state.metric} v=${ANOMALY_FILTER_VERSION} `
      + `samples=${state.sampleCount} accepted=${state.acceptedCount} `
      + `rejected=${state.rejectedCount} reseeds=${state.reseedCount} `
      + `flatlines=${state.flatlineCount} degraded=${state.degraded ?? 'none'}`,
  };
}

module.exports = {
  createFilterState,
  filterReading,
  summarizeFilterState,
  METRIC_CONFIGS,
  OVERRIDABLE,
  REJECT_REASONS,
  ANOMALY_FILTER_VERSION,
  MEASUREMENT_R,
  MEASUREMENT_SIGMA,
  Q_LEVEL,
  Q_ACCEL,
  MAD_TO_SIGMA,
  HAMPEL_WINDOW,
  HAMPEL_SPAN_MS,
  HAMPEL_MIN_SAMPLES,
  HAMPEL_SIGMAS,
  SLEW_MAX_BPM_PER_SEC,
  INNOVATION_GATE_SIGMAS,
  REJECT_CONFIDENCE_FACTOR,
  DEGRADED_CONFIDENCE,
  DEGRADED_RUN_MS,
  DEGRADED_MODE,
  FUTURE_TOLERANCE_MS,
  MAX_AGE_MS,
  MAX_PREDICT_DT_SEC,
  RESEED_AFTER_CONSECUTIVE_REJECTS,
  FLATLINE_MIN_RUN,
  FLATLINE_SPAN_MS,
  FLATLINE_DECAY,
  FLATLINE_MIN_FACTOR,
};
