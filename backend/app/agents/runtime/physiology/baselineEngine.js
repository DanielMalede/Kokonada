'use strict';

/**
 * A1 — personal baselines (W4-004). PURE: no clock, no database, no randomness (S9).
 *
 * WHAT WAS WRONG (the four defects this module exists to kill)
 *
 *   D1  `translate()` reads `baselines.hrvMedian / hrvMAD`. `computeBaselines()` returned
 *       `{rhrMedian, rhrMAD}` and nothing else, so EVERY user in production has been scored
 *       against the population constant {45, 8}. Not "some users" — every user, always.
 *   D2  Every batch heart-rate row is written with `activity: 'unknown'`, and the old resting
 *       pool was `activity ∈ {resting, unknown}`. So "resting heart rate" was the median of a
 *       pool containing workouts, sleep and everything in between.
 *   D14 Fixed anchors for everyone: exertion `(HR−60)/100`, bands at 90/120 bpm. A body is not
 *       a constant.
 *   D15 `MIN_SAMPLES = 10`, all-or-nothing: nine samples produced NOTHING, ten produced a fully
 *       trusted personal baseline. A cliff where there should be a slope.
 *
 * ── THE THREE IDEAS THIS MODULE IS BUILT ON ─────────────────────────────────────────────
 *
 * 1. ONE VALUE PER DAY, NOT ONE PER SAMPLE.
 *    A night of 1-minute heart-rate samples is 360 numbers but nowhere near 360 independent
 *    observations — consecutive readings are almost perfectly correlated (the anomaly filter
 *    measures the wander's autocorrelation time at ~165 s). Feeding n = 43200 into any
 *    confidence expression would claim a precision the data does not contain, and every
 *    "confidence" downstream would be a lie in the direction that matters most: overconfident.
 *    So every estimator here first collapses each LOCAL day to one number, and only then does
 *    statistics across days. `n` therefore means DAYS everywhere in this module, and the
 *    resulting confidences are calibrated against something real.
 *
 * 2. SHRINKAGE INSTEAD OF THRESHOLDS (§M.4).
 *    `μ̂ = (n·x̄ + k·μ₀)/(n + k)`, confidence `n/(n+k)`. One day of data moves the estimate a
 *    little; twenty days move it a lot; zero days return the population prior at confidence 0
 *    and say so. There is no n at which behaviour jumps. `fuse()` below is the same formula
 *    generalised to several sources of differing quality — and the test suite pins that it
 *    reduces to §M.4 exactly in the one-source case, so the generalisation is checked rather
 *    than asserted.
 *
 * 3. THE TROUGH IS THE RESTING RATE — WHEREVER IT FALLS.
 *    §M/A1 specifies a nocturnal 00:00–06:00 window. That window is a proxy for "asleep", and
 *    it is only a good proxy for a day-active person: the shift-worker persona peaks at 23:00,
 *    so its 00:00–06:00 window is its most ACTIVE period, and a fixed-window estimator reads
 *    the busiest part of that user's day as their resting rate. Rather than quietly ship an
 *    estimator that is wrong for shift workers, each day contributes
 *        min( P10 over the local nocturnal window , P10 over the day's non-exercise samples )
 *    Both terms estimate the same physiological quantity (the diurnal trough); whichever is
 *    lower is the one that actually found it. Taking a min over two ROBUST quantiles is safe
 *    in a way that taking a min over raw samples would not be — a single artifact cannot drag
 *    a tenth percentile — and the median across days robustifies the day axis in turn.
 *    The mission's three input streams (device RHR series, nocturnal window, live
 *    `activity === 'resting'` rows) all still feed the estimate; they are organised as two
 *    estimators rather than three because the resting-labelled rows are a strict SUBSET of the
 *    non-exercise pool, and counting them twice would manufacture confidence.
 *
 * ── ZERO-KNOWLEDGE ──────────────────────────────────────────────────────────────────────
 * Inputs are plaintext vitals, so every caller must be worker-scope with an audited decrypt
 * (the `baselines.computeBaselines` precedent). The OUTPUT is derived statistics only: no
 * sample, no timestamp, no per-reading detail — bounded in size and safe to cache as an
 * AAD-bound encrypted blob. There is no logging in this module at all; a stray telemetry line
 * here would be the easiest possible way to leak special-category numbers.
 */

const { fitCosinor } = require('./chronobiology');

// Bumped when the cached blob's shape changes (S15). `baselines.peekBaselines` consumers must
// tolerate an older `v` — the legacy keys are guaranteed to survive every bump.
const BASELINE_BLOB_VERSION = 1;

const MAD_SCALE = 1.4826;      // MAD -> sigma for a normal, matching translate.js
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const TZ_MIN = -840;           // matches the telemetry DTO / VitalSample admissible band
const TZ_MAX = 720;

// Activity labels that are, by definition, not rest. Everything else ('resting', 'unknown',
// null) is resting-PLAUSIBLE and enters the trough pool — which is the point: 'unknown' is the
// label every batch row carries (D2), so excluding it would exclude nearly all real data.
const EXERCISE_ACTIVITIES = Object.freeze(new Set(['walking', 'running', 'cycling', 'swimming', 'strength']));

/**
 * Population priors: the `μ₀` and the `k` of §M.4, plus the `scale` that turns a prior into a
 * precision. Every one is sourced, not chosen:
 *
 * EVERY entry carries TWO spreads, and keeping them apart is the whole point:
 *   `scale`  = the BETWEEN-person SD — how much this quantity varies from human to human.
 *   `spread` = the WITHIN-person day-to-day MAD — how much it varies for one human.
 * The ratio of those two is what decides how fast a personal estimate should overtake the
 * population's; conflating them is how you end up shrinking an endurance athlete's 85 ms HRV
 * a third of the way to 45 and calling it a personal baseline.
 *
 *   restingHeartRate 62 bpm; between-person SD ~9 bpm (adult resting HR), within-person
 *                     day-to-day MAD ~3 bpm (SD ~4.4).
 *   hrv              45 ms / MAD 8 — taken verbatim from translate.js's HRV_FALLBACK, because
 *                     that IS the constant the whole system has been scoring against; adopting
 *                     it as the prior means a user with no HRV history is treated exactly as
 *                     today, and every additional day moves them off it. Between-person SD 25:
 *                     RMSSD genuinely spans ~20-100 ms across adults, which is why HRV needs
 *                     the least shrinkage of anything here.
 *   maxHeartRate     190 bpm — the mission's specified default. Deliberately NOT an age
 *                     formula: no DOB is stored (MedicalProfile says so explicitly), so any
 *                     `220 − age` would require collecting a field we chose not to collect.
 *   k                RHR 20, HRV 15, hour-bins 10 — §M.4 verbatim, used by `shrink()` for the
 *                     SPREAD estimates and the hourly table. See PRIOR_OBSERVATIONS below for
 *                     why the central estimates do not use these numbers.
 */
const POPULATION = Object.freeze({
  restingHeartRate: Object.freeze({ value: 62, scale: 9, spread: 3, k: 20 }),
  hourlyHeartRate:  Object.freeze({ value: 72, scale: 10, spread: 6, k: 10 }),
  hrv:              Object.freeze({ value: 45, scale: 25, spread: 8, k: 15 }),
  respirationRate:  Object.freeze({ value: 15, scale: 3, spread: 1.5, k: 15 }),
  spO2:             Object.freeze({ value: 97, scale: 2, spread: 1, k: 15 }),
  bodyBattery:      Object.freeze({ value: 60, scale: 20, spread: 12, k: 15 }),
  stressLevel:      Object.freeze({ value: 35, scale: 20, spread: 12, k: 15 }),
  maxHeartRate:     Object.freeze({ value: 190, scale: 15, spread: 8, k: 10 }),
});

/**
 * How many observations the population prior is worth inside `fuse()`. ONE — and that is a
 * derivation, not a preference.
 *
 * DELIBERATE, DOCUMENTED DEVIATION FROM §M.4's LITERAL CONSTANTS. §M.4 lists pseudo-counts of
 * k = 20 (RHR) and 15 (HRV). Those are correct for the formula as written, where `n` counts
 * SAMPLES. This module counts DAYS instead (idea 1 above), because samples are not independent
 * — and 20 days is not the same amount of evidence as 20 samples. Applying k = 15 to a
 * day-count would leave a user a third of the way to the population mean after a MONTH of
 * data, which is the D1 defect wearing a lab coat.
 *
 * Rather than pick a different round number, the weight comes from the variance decomposition
 * that empirical-Bayes shrinkage IS. The optimal weight on n observations of a person whose
 * quantity varies within-person by σ_w and between-people by σ_b is n/(n + σ_w²/σ_b²). In
 * `fuse()` the source already enters as n/σ_w² and the prior as k/σ_b², so those two agree
 * exactly when k = 1: the population mean carries the information of ONE observation drawn
 * from the between-person distribution, which is precisely what it is.
 *
 * §M.4's k values are still used verbatim — by `shrink()`, for the SPREAD estimates and the
 * hourly table, where the count unit and the prior are the ones §M.4 assumes.
 */
const PRIOR_OBSERVATIONS = 1;

// How far above their own resting baseline a reading can be and still count as "resting" for
// the purpose of measuring resting SPREAD. 20 bpm is generous — postural change, digestion and
// mild emotion all fit inside it — while still excluding the workouts that arrive labelled
// 'unknown' (D2) and would otherwise inflate the spread until nothing looked unusual.
const RESTING_BAND_BPM = 20;

// The lowest MAD any baseline may report. A spread that collapses toward 0 makes every robust
// z-score explode, which would saturate `restingElevation` and hand every user maximal stress —
// D3's failure mode arriving through the back door. 1.5 bpm/ms is below any plausible real
// spread but far enough from 0 to keep the division sane.
const MIN_SPREAD = 1.5;

const RESTING_QUANTILE = 0.10;         // §A1: "low-percentile (P10)"
const NOCTURNAL_START = 0;             // local hours [0, 6)
const NOCTURNAL_END = 6;
const MIN_NOCTURNAL_SAMPLES = 5;       // below this the window is noise, not a night
const MIN_DAY_SAMPLES = 5;

const HRMAX_QUANTILE = 0.995;
const HRMAX_PLAUSIBILITY_FLOOR = 160;  // §A1: a "measured max" below this was not a max effort
const HRMAX_EXERTION_HR_FLOOR = 120;   // unlabelled rows only count as exertion above this

const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 30;
const TREND_CLAMP = 6;
const EWMA_HALF_LIFE_DAYS = 7;

const ZONE_FRACTIONS = Object.freeze([0.5, 0.6, 0.7, 0.8, 0.9]);
const ZONE_LABELS = Object.freeze(['recovery', 'fat-burn', 'aerobic', 'anaerobic', 'max']);

// ── numeric helpers (S8: nothing below may ever return NaN) ─────────────────────────────

// `Number(null)`, `Number(false)` and `Number('')` are all 0, which is how a missing vital
// becomes a plausible-looking heart rate of zero and poisons a median. Reject those shapes
// explicitly before coercing — the same trap services/biosonic/baselines.js already documents.
const finite = (x) => {
  if (x == null || typeof x === 'boolean') return null;
  if (typeof x === 'string' && x.trim() === '') return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};
const clamp = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));
const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;

function finiteValues(values) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const v of values) {
    const n = finite(v);
    if (n != null) out.push(n);
  }
  return out;
}

/** Median of the finite entries, or null. Never 0-by-coercion. */
function median(values) {
  const xs = finiteValues(values);
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Median absolute deviation, UNSCALED — the same convention as services/biosonic/baselines.js,
 *  because `translate._robustZ` applies MAD_SCALE itself. Changing the convention here would
 *  silently rescale every stress score in the product. */
function mad(values) {
  const med = median(values);
  if (med == null) return null;
  return median(finiteValues(values).map((v) => Math.abs(v - med)));
}

/** Type-7 (R/numpy default) quantile with linear interpolation. q is clamped, so a caller
 *  bug produces an endpoint rather than a NaN. */
function quantile(values, q) {
  const xs = finiteValues(values);
  if (!xs.length) return null;
  xs.sort((a, b) => a - b);
  const p = clamp(finite(q) ?? 0, 0, 1);
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo];
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

/**
 * §M.4 empirical-Bayes shrinkage, stated plainly so the formula is readable in one line and
 * testable on its own. `n` is in whatever unit the caller counts in — for this module, days.
 */
function shrink({ n, mean, k, prior }) {
  const p = finite(prior) ?? 0;
  const nn = finite(n);
  const kk = finite(k);
  const m = finite(mean);
  if (nn == null || nn <= 0 || m == null) return { value: p, confidence: 0, n: 0 };
  if (kk == null || kk <= 0) return { value: m, confidence: 1, n: nn };
  return { value: (nn * m + kk * p) / (nn + kk), confidence: nn / (nn + kk), n: nn };
}

/**
 * Precision-weighted fusion of several estimators of the SAME quantity, plus a population
 * prior. This is §M.4 generalised: with one source whose scale equals the prior's it reduces
 * algebraically to `(n·x̄ + k·μ₀)/(n+k)`, which the suite pins.
 *
 *   se_s² = scale_s² / (n_s · reliability_s)      standard error of source s
 *   w_s   = 1 / se_s²                             its precision
 *   w₀    = k / scale₀²                           the prior's precision (k pseudo-observations)
 *   value = (Σ w_s·m_s + w₀·μ₀) / (Σ w_s + w₀)
 *   confidence = Σ w_s / (Σ w_s + w₀)             the fraction of the answer that is DATA
 *
 * `reliability` discounts a source by treating it as having proportionally fewer observations,
 * which is the honest encoding of "we trust this less": less information, not a different
 * number.
 */
function fuse(sources, prior) {
  const p = {
    value: finite(prior?.value) ?? 0,
    scale: Math.max(finite(prior?.scale) ?? 1, 1e-6),
    k: Math.max(finite(prior?.k) ?? 0, 0),
  };
  const w0 = p.k / (p.scale * p.scale);
  let wSum = 0;
  let wxSum = 0;
  const used = [];

  for (const s of Array.isArray(sources) ? sources : []) {
    const value = finite(s?.value);
    const n = finite(s?.n);
    const reliability = clamp(finite(s?.reliability) ?? 1, 0, 1);
    if (value == null || n == null || n <= 0 || reliability <= 0) continue;
    // A zero/degenerate scale would make the precision infinite and swallow every other
    // source; floor it at the prior's scale / 20 so a constant series is confident, not
    // omnipotent.
    const scale = Math.max(finite(s?.scale) ?? p.scale, p.scale / 20, 1e-6);
    const w = (n * reliability) / (scale * scale);
    wSum += w;
    wxSum += w * value;
    used.push({ name: s.name ?? null, n, reliability, weight: w });
  }

  if (wSum <= 0) return { value: p.value, confidence: 0, weight: 0, used };
  const denom = wSum + w0;
  return {
    value: (wxSum + w0 * p.value) / denom,
    confidence: clamp(wSum / denom, 0, 1),
    weight: wSum,
    used,
  };
}

/**
 * Local hour-of-day in [0, 24). D13: the hour a reading belongs to is the SUBJECT's hour, and
 * the old code used the SERVER's. An absent or implausible offset degrades to UTC rather than
 * producing NaN — a wrong hour is a worse baseline, a NaN hour is a poisoned one.
 */
function localHour(atMs, tzOffsetMinutes) {
  const t = finite(atMs);
  if (t == null) return 0;
  const tz = finite(tzOffsetMinutes);
  const off = tz != null && tz >= TZ_MIN && tz <= TZ_MAX ? tz : 0;
  const h = ((t + off * 60000) / HOUR_MS) % 24;
  return h < 0 ? h + 24 : h;
}

function localDayIndex(atMs, tzOffsetMinutes) {
  const t = finite(atMs);
  if (t == null) return null;
  const tz = finite(tzOffsetMinutes);
  const off = tz != null && tz >= TZ_MIN && tz <= TZ_MAX ? tz : 0;
  return Math.floor((t + off * 60000) / DAY_MS);
}

const atMsOf = (s) => {
  const raw = s?.recordedAt;
  if (raw instanceof Date) return finite(raw.getTime());
  return finite(raw);
};

/**
 * Collapse samples into one observation per LOCAL day (idea 1 above). `reduce` receives that
 * day's values; the caller decides whether a day means its median, its tenth percentile, or
 * something else. Days are returned in ascending order with their raw sample count, so a
 * caller can weight a well-covered day above a two-sample one if it wants to.
 */
function dailySeries(samples, { reduce = median, tzOffsetMinutes = 0, minSamples = 1 } = {}) {
  const byDay = new Map();
  for (const s of Array.isArray(samples) ? samples : []) {
    const value = finite(s?.value);
    if (value == null) continue;
    const at = atMsOf(s);
    if (at == null) continue;
    const tz = finite(s?.tzOffsetMinutes) ?? tzOffsetMinutes;
    const day = localDayIndex(at, tz);
    if (day == null) continue;
    let bucket = byDay.get(day);
    if (!bucket) { bucket = []; byDay.set(day, bucket); }
    bucket.push(value);
  }

  const out = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const values = byDay.get(day);
    if (values.length < minSamples) continue;
    const v = finite(reduce(values));
    if (v == null) continue;
    out.push({ day, value: v, n: values.length });
  }
  return out;
}

// ── resting heart rate ──────────────────────────────────────────────────────────────────

const isExercise = (activity) => EXERCISE_ACTIVITIES.has(String(activity ?? '').toLowerCase());

/**
 * The spread to attribute to a source's daily estimates. The OBSERVED between-day spread is
 * the right answer once there are enough days to measure it — but with one or two days the
 * observed MAD is 0, which would hand that source infinite precision and let a single bad day
 * become the user's baseline forever. So it is itself shrunk (§M.4, k = 5 days) toward the
 * population's within-person spread: unknown variability is assumed typical, not absent.
 */
function _sourceScale(values, prior, k = 5) {
  const observed = mad(values);
  const shrunk = shrink({
    n: values.length,
    mean: observed == null ? null : observed * MAD_SCALE,
    k,
    prior: prior.spread * MAD_SCALE,
  });
  return Math.max(shrunk.value, MIN_SPREAD);
}

/**
 * Per local day: `min(P10 over the nocturnal window, P10 over the day's non-exercise samples)`.
 * See idea (3) for why the min, and why a fixed nocturnal window alone is not enough.
 *
 * PUBLIC (W4-012): the CUSUM change-point detector needs the identical per-day RHR estimate
 * this module already computes for the baseline itself — reusing it (rather than a second,
 * disagreeing day-level RHR estimator) is the D11/W4-D42 one-definition-rule precedent.
 */
function troughSeries(hrSamples, tzOffsetMinutes) {
  const byDay = new Map();
  for (const s of Array.isArray(hrSamples) ? hrSamples : []) {
    const value = finite(s?.value);
    if (value == null) continue;
    const at = atMsOf(s);
    if (at == null) continue;
    if (isExercise(s?.activity)) continue;
    const tz = finite(s?.tzOffsetMinutes) ?? tzOffsetMinutes;
    const day = localDayIndex(at, tz);
    if (day == null) continue;
    let bucket = byDay.get(day);
    if (!bucket) { bucket = { all: [], night: [] }; byDay.set(day, bucket); }
    bucket.all.push(value);
    const h = localHour(at, tz);
    if (h >= NOCTURNAL_START && h < NOCTURNAL_END) bucket.night.push(value);
  }

  const out = [];
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const { all, night } = byDay.get(day);
    if (all.length < MIN_DAY_SAMPLES) continue;
    const dayTrough = quantile(all, RESTING_QUANTILE);
    const nightTrough = night.length >= MIN_NOCTURNAL_SAMPLES ? quantile(night, RESTING_QUANTILE) : null;
    const value = nightTrough == null ? dayTrough : Math.min(nightTrough, dayTrough);
    if (finite(value) == null) continue;
    out.push({ day, value, n: all.length, nocturnal: nightTrough != null });
  }
  return out;
}

/**
 * The personal resting heart rate, plus the spread `translate()` z-scores against.
 *
 * TWO DIFFERENT SPREADS, deliberately kept apart — conflating them is the subtle bug this
 * comment exists to prevent:
 *   · `mad`  is the WITHIN-person day-to-day spread of resting-plausible readings. It is what
 *            `translate._robustZ(heartRate, rhrMedian, rhrMAD)` divides by, so it must stay a
 *            physiological spread and must NOT shrink toward 0 as evidence accumulates. If it
 *            did, every user would eventually read as maximally stressed.
 *   · `se`   is the standard error OF THE ESTIMATE — that one does shrink with evidence, and
 *            it is reported separately for anyone who needs to know how sure we are.
 */
function estimateRestingHeartRate({
  hrSamples, deviceRestingHeartRate, now, tzOffsetMinutes = 0,
} = {}) {
  const prior = POPULATION.restingHeartRate;

  const trough = troughSeries(hrSamples, tzOffsetMinutes);
  const device = dailySeries(deviceRestingHeartRate, { reduce: median, tzOffsetMinutes });

  const troughValues = trough.map((d) => d.value);
  const deviceValues = device.map((d) => d.value);

  const fused = fuse([
    {
      name: 'device',
      value: median(deviceValues),
      scale: _sourceScale(deviceValues, prior),
      n: device.length,
      reliability: 1,
    },
    {
      name: 'trough',
      value: median(troughValues),
      scale: _sourceScale(troughValues, prior),
      n: trough.length,
      // The trough is derived rather than device-certified: it can be dragged upward by a day
      // with no genuine rest in it. 0.9 says "nearly as good", not "as good".
      reliability: 0.9,
    },
  ], { value: prior.value, scale: prior.scale, k: PRIOR_OBSERVATIONS });

  // ── the within-person spread (see the note above) ──
  // Pool the readings that are actually resting-plausible GIVEN the estimate we just made:
  // non-exercise, and within a generous band above the estimated resting rate. Without the
  // band this MAD would inherit D2 wholesale (every workout row is labelled 'unknown' and
  // would inflate the spread until no elevation ever looked unusual).
  const restingBand = fused.value + RESTING_BAND_BPM;
  const restingPool = [];
  let sampleCount = 0;
  for (const s of Array.isArray(hrSamples) ? hrSamples : []) {
    const v = finite(s?.value);
    if (v == null || isExercise(s?.activity)) continue;
    sampleCount += 1;
    if (v <= restingBand) restingPool.push(v);
  }
  const poolMad = mad(restingPool);
  const spread = shrink({
    n: trough.length,             // in DAYS, consistent with everything else here
    mean: poolMad,
    k: prior.k,
    prior: prior.spread,
  });

  const se = fused.weight > 0 ? Math.sqrt(1 / fused.weight) : prior.scale;

  return {
    value: round2(fused.value),
    mad: round2(Math.max(spread.value, MIN_SPREAD)),
    se: round3(se),
    confidence: round3(fused.confidence),
    days: trough.length + device.length,
    sampleCount,
    sources: {
      device: { n: device.length },
      trough: { n: trough.length, nocturnalDays: trough.filter((d) => d.nocturnal).length },
    },
    computedFor: finite(now),
  };
}

// ── the 24-bin hour-of-day table ────────────────────────────────────────────────────────

/**
 * A personal "what is normal for me at this hour" table (D13/D14). Each bin is the median of
 * that hour's readings shrunk toward the user's OWN overall baseline (§M.4, k = 10), which is
 * itself shrunk toward the population. So an unobserved 03:00 is not a hole and not a
 * population guess — it is this user's own level, at confidence 0, and it becomes their real
 * 03:00 as soon as they have one.
 *
 * All activities are included on purpose. The median absorbs an occasional workout, and a user
 * who genuinely runs every day at 18:00 SHOULD have an elevated 18:00 baseline — that is their
 * normal, and calling it anomalous every evening would be the wrong answer.
 */
function buildHourlyTable({ hrSamples, tzOffsetMinutes = 0 } = {}) {
  const prior = POPULATION.hourlyHeartRate;
  const bins = Array.from({ length: 24 }, () => []);
  const all = [];

  for (const s of Array.isArray(hrSamples) ? hrSamples : []) {
    const v = finite(s?.value);
    if (v == null) continue;
    const at = atMsOf(s);
    if (at == null) continue;
    const tz = finite(s?.tzOffsetMinutes) ?? tzOffsetMinutes;
    const h = Math.floor(localHour(at, tz)) % 24;
    bins[h].push(v);
    all.push(v);
  }

  // The user's own overall level, itself shrunk toward the population so a two-sample user
  // does not anchor 24 bins on two samples.
  const overallShrunk = shrink({
    n: all.length ? 1 + Math.log2(all.length) : 0, // sub-linear: correlated samples, idea (1)
    mean: median(all),
    k: 3,
    prior: prior.value,
  });
  const overallSpread = shrink({
    n: all.length ? 1 + Math.log2(all.length) : 0,
    mean: mad(all),
    k: 3,
    prior: prior.spread,
  });

  return bins.map((values, hour) => {
    // Bin counts are also correlated within a day; use the number of DAYS the bin was seen in
    // as the effective count. Approximated as the sample count divided by the typical samples
    // per hour, floored at 1 when anything was seen at all.
    const nEff = values.length ? Math.max(1, Math.round(values.length / 60)) : 0;
    const rawMedian = median(values);
    const est = shrink({ n: nEff, mean: rawMedian, k: prior.k, prior: overallShrunk.value });
    const spr = shrink({ n: nEff, mean: mad(values), k: prior.k, prior: overallSpread.value });
    return {
      hour,
      value: round2(est.value),
      // UNSHRUNK bin median. The cosinor fit reads this rather than `value`, because shrinking
      // every bin toward the overall level is exactly an amplitude attenuator — see the note
      // in chronobiology.fitCosinor. Null when the hour was never observed.
      raw: rawMedian == null ? null : round2(rawMedian),
      mad: round2(Math.max(spr.value, MIN_SPREAD)),
      n: values.length,
      nEff,
      confidence: round3(est.confidence),
      overall: round2(overallShrunk.value),
    };
  });
}

// ── generic per-metric baseline (HRV and the dormant lanes) ─────────────────────────────

/** Exponentially weighted mean over a day-indexed series, most recent day heaviest. */
function _ewma(series, halfLifeDays) {
  if (!series.length) return null;
  const lambda = Math.log(2) / Math.max(halfLifeDays, 1e-9);
  const last = series[series.length - 1].day;
  let num = 0;
  let den = 0;
  for (const d of series) {
    const w = Math.exp(-lambda * Math.max(0, last - d.day));
    num += w * d.value;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/**
 * The personal median/MAD of one metric, plus the acute-vs-chronic view W4-005's `fatigue`
 * axis and W4-012's change-point detector both need.
 *
 * `trend` is a ROBUST z of the acute shift: how many chronic-MADs the last 7 days sit away
 * from the last 30. Clamped to ±6 so a zero-variance chronic window (a device reporting a
 * constant) cannot produce an infinite trend — the S8 division guard with a physical meaning
 * rather than an epsilon.
 */
function estimateMetricBaseline({ metric, samples, now, tzOffsetMinutes = 0 } = {}) {
  const prior = POPULATION[metric] ?? POPULATION.hrv;
  const rows = (Array.isArray(samples) ? samples : []).filter(
    (s) => s && (s.metric === undefined || s.metric === metric),
  );
  const series = dailySeries(rows, { reduce: median, tzOffsetMinutes });
  const values = series.map((d) => d.value);

  const est = fuse(
    [{ name: metric, value: median(values), scale: _sourceScale(values, prior), n: series.length, reliability: 1 }],
    { value: prior.value, scale: prior.scale, k: PRIOR_OBSERVATIONS },
  );
  const spr = shrink({ n: series.length, mean: mad(values), k: prior.k, prior: prior.spread });

  const nowMs = finite(now);
  const lastDay = series.length ? series[series.length - 1].day : null;
  const refDay = nowMs != null ? localDayIndex(nowMs, tzOffsetMinutes) : lastDay;

  const inWindow = (days) => (refDay == null
    ? values
    : series.filter((d) => refDay - d.day < days).map((d) => d.value));

  const acuteValues = inWindow(ACUTE_DAYS);
  const chronicValues = inWindow(CHRONIC_DAYS);
  const acute = median(acuteValues);
  const chronic = median(chronicValues);
  // The denominator floor is a QUARTER of the population spread, not the whole of it: flooring
  // at the population spread would damp a genuinely tight person's real drift into invisibility,
  // which is the opposite of what W4-012's change-point detector needs. A quarter is still far
  // enough from zero to guard the division (S8).
  const chronicSpread = Math.max(
    (mad(chronicValues) ?? 0) * MAD_SCALE, prior.spread * MAD_SCALE * 0.25, MIN_SPREAD,
  );

  const trend = (acute != null && chronic != null)
    ? clamp((acute - chronic) / chronicSpread, -TREND_CLAMP, TREND_CLAMP)
    : 0;

  return {
    metric,
    median: round2(est.value),
    mad: round2(Math.max(spr.value, MIN_SPREAD)),
    n: series.length,
    confidence: round3(est.confidence),
    acute: round2(acute ?? est.value),
    chronic: round2(chronic ?? est.value),
    ewma: round2(_ewma(series, EWMA_HALF_LIFE_DAYS) ?? est.value),
    trend: round3(trend),
  };
}

// ── maximum heart rate + Karvonen zones ─────────────────────────────────────────────────

/**
 * §A1: user-provided ∨ P99.5 of high-exertion samples if ≥ 160 ∨ 190 default. Never an age
 * formula — no date of birth is stored anywhere in this product, and inventing one from a
 * default would be worse than admitting we do not know.
 *
 * The P99.5 (rather than the max) is the artifact guard: a single double-counted-beat reading
 * of 210 is exactly the kind of sample a `max()` would enshrine as this user's ceiling for the
 * next 90 days.
 */
function estimateHrMax({ provided, hrSamples, restingHeartRate } = {}) {
  const given = finite(provided);
  if (given != null && given >= 100 && given <= 230) {
    return { value: round2(given), source: 'provided', confidence: 0.9, n: 0 };
  }

  const exertion = [];
  for (const s of Array.isArray(hrSamples) ? hrSamples : []) {
    const v = finite(s?.value);
    if (v == null) continue;
    if (isExercise(s?.activity) || v >= HRMAX_EXERTION_HR_FLOOR) exertion.push(v);
  }

  const measured = quantile(exertion, HRMAX_QUANTILE);
  if (measured != null && measured >= HRMAX_PLAUSIBILITY_FLOOR) {
    // Confidence grows with how much high-exertion evidence there is, capped below
    // "provided": a P99.5 is an estimate of a ceiling the user may simply never have reached.
    const conf = clamp(exertion.length / (exertion.length + 500), 0, 0.8);
    return { value: round2(measured), source: 'measured', confidence: round3(conf), n: exertion.length };
  }

  const rhr = finite(restingHeartRate);
  const fallback = POPULATION.maxHeartRate.value;
  return {
    value: rhr != null && rhr + 40 > fallback ? round2(rhr + 40) : fallback,
    source: 'default',
    confidence: 0.2,
    n: exertion.length,
  };
}

/**
 * §M.7 Karvonen: `HRR = HRmax − RHR`, zone bounds `RHR + [.5,.6,.7,.8,.9,1.0]·HRR`.
 * The `Math.max(1, …)` is the S8 guard for the degenerate body where the estimated maximum
 * lands at or below the resting rate — it must still yield ordered finite bounds, because a
 * NaN zone table would propagate silently into every downstream exertion calculation.
 */
function karvonenZones(restingHeartRate, maxHeartRate) {
  const rhr = finite(restingHeartRate) ?? POPULATION.restingHeartRate.value;
  const hrMax = finite(maxHeartRate) ?? POPULATION.maxHeartRate.value;
  const hrr = Math.max(1, hrMax - rhr);
  const bounds = [...ZONE_FRACTIONS, 1.0].map((f) => rhr + f * hrr);
  const zones = ZONE_FRACTIONS.map((f, i) => ({
    label: ZONE_LABELS[i],
    minBpm: round2(bounds[i]),
    maxBpm: round2(bounds[i + 1]),
    // NOTE: MedicalProfile calls this field `percentOfMax`, but Karvonen bands are percentages
    // of heart-rate RESERVE, not of maximum. The field name is legacy (nothing reads it yet);
    // the string states what the number actually is so a future reader is not misled.
    percentOfMax: `${Math.round(f * 100)}-${Math.round((ZONE_FRACTIONS[i + 1] ?? 1) * 100)}% HRR`,
  }));
  return { hrr: round2(hrr), restingHeartRate: round2(rhr), maxHeartRate: round2(hrMax), zones };
}

// ── the composed blob ───────────────────────────────────────────────────────────────────

/**
 * The SUPERSET cache blob (§0.2.5). Every legacy key keeps its exact old meaning, so
 * `translate()` needs no change at all to be fixed:
 *
 *   rhrMedian / rhrMAD / sampleCount / computedAt   unchanged semantics, better values
 *   hrvMedian / hrvMAD                              NEW — D1 dies here, with zero translate edits
 *   hourly / cosinor                                NEW — D13/D14's personal clock
 *   zones / maxHeartRate                            NEW — §M.7/M.8 Karvonen exertion
 *   acute / chronic / trend                         NEW — W4-005 fatigue, W4-012 change points
 *   confidence                                      NEW — how much of the above is really THIS user
 *
 * `computedAt` is derived from the `now` PARAMETER, never from the clock (S9): the same inputs
 * must produce the same blob in a replay, or the soak harness cannot compare runs.
 */
function computeBaselineBlob({
  hrSamples = [], vitalSamples = [], profile = {}, now, tzOffsetMinutes = 0,
} = {}) {
  const nowMs = finite(now) ?? 0;

  const deviceRhrRows = (Array.isArray(vitalSamples) ? vitalSamples : [])
    .filter((s) => s?.metric === 'restingHeartRate');

  const rhr = estimateRestingHeartRate({
    hrSamples, deviceRestingHeartRate: deviceRhrRows, now: nowMs, tzOffsetMinutes,
  });
  const hrv = estimateMetricBaseline({ metric: 'hrv', samples: vitalSamples, now: nowMs, tzOffsetMinutes });
  const rhrSeries = estimateMetricBaseline({
    metric: 'restingHeartRate', samples: deviceRhrRows, now: nowMs, tzOffsetMinutes,
  });

  const hourly = buildHourlyTable({ hrSamples, tzOffsetMinutes });
  const cosinor = fitCosinor(hourly, { prior: { M: rhr.value, A: 4, phi: 15.0 } });

  const hrMax = estimateHrMax({
    provided: profile?.maxHeartRate, hrSamples, restingHeartRate: rhr.value,
  });
  const zones = karvonenZones(rhr.value, hrMax.value);

  // Overall confidence: the weakest link that actually matters downstream. `translate` reads
  // rhr and hrv; a blob confident in one and blind in the other is not a confident blob.
  const confidence = round3(Math.min(rhr.confidence, Math.max(hrv.confidence, 0)));

  return {
    v: BASELINE_BLOB_VERSION,

    // ── legacy keys (unchanged semantics) ──
    rhrMedian: rhr.value,
    rhrMAD: rhr.mad,
    sampleCount: rhr.sampleCount,
    computedAt: new Date(nowMs).toISOString(),

    // ── superset ──
    hrvMedian: hrv.median,
    hrvMAD: hrv.mad,
    hourly,
    cosinor,
    zones,
    maxHeartRate: hrMax.value,
    maxHeartRateSource: hrMax.source,
    acute: { rhr: rhrSeries.n ? rhrSeries.acute : rhr.value, hrv: hrv.acute },
    chronic: { rhr: rhrSeries.n ? rhrSeries.chronic : rhr.value, hrv: hrv.chronic },
    trend: { rhr: rhrSeries.trend, hrv: hrv.trend },
    confidence,
    coverage: {
      rhrDays: rhr.days,
      hrvDays: hrv.n,
      hourlyBins: hourly.filter((b) => b.n > 0).length,
      rhrConfidence: rhr.confidence,
      hrvConfidence: hrv.confidence,
      cosinorConfidence: cosinor.confidence,
    },
  };
}

module.exports = {
  // primitives
  median, mad, quantile, shrink, fuse, localHour, localDayIndex, dailySeries,
  // estimators
  estimateRestingHeartRate, buildHourlyTable, estimateMetricBaseline, estimateHrMax, karvonenZones,
  troughSeries,
  // composition
  computeBaselineBlob,
  // constants (exported so tests pin the derivation, not a copy of it)
  POPULATION, BASELINE_BLOB_VERSION, MAD_SCALE, MIN_SPREAD, ZONE_FRACTIONS, ZONE_LABELS,
  EXERCISE_ACTIVITIES, PRIOR_OBSERVATIONS, RESTING_BAND_BPM,
};
