'use strict';

/**
 * A6 — daily analysis (W4-012). PURE: no clock, no database, no randomness (S9).
 *
 * The nightly per-user consolidation. Two things live here that do not live anywhere else in
 * the engine stack:
 *
 *   1. CUSUM CHANGE-POINT DETECTION (§M.13) on daily RHR/HRV residuals — "is this person's
 *      physiology drifting", as opposed to `baselineEngine.estimateMetricBaseline`'s `trend`,
 *      which is a SNAPSHOT (acute-7d vs chronic-30d) rather than an accumulating statistic. A
 *      snapshot trend answers "is this week different from this month"; CUSUM answers "when,
 *      specifically, did this person's rhythm start moving" — the accumulation is what lets a
 *      small, sustained shift clear the noise floor days before any single day's z-score would.
 *
 *   2. THE READINESS COMPOSITE — deliberately NOT a third recovery/fatigue formula. It is built
 *      from the SAME `affectEngine.recoveryAxis` / `fatigueAxis` every other consumer of "how
 *      rested is this person" already uses (imported, not re-derived), because a second
 *      disagreeing implementation of the same physiological judgement is exactly the defect
 *      class this wave keeps finding under a different name (D11, W4-D42's third taste ranking,
 *      W4-D17/W4-D21's copied coercion bugs). `blend()` — also reused, not re-implemented — folds
 *      the two axes into one 0..1 number the same mass-weighted way every other axis is folded.
 *
 * ── WHY CUSUM NEEDS A FROZEN REFERENCE, NOT A ROLLING ONE ───────────────────────────────────
 *
 * §M.13's formula (`z = (x − μ_chronic)/σ`, `C+ = max(0, C+ + z − k)`, flag at 4) does not by
 * itself say where μ_chronic/σ come from. The tempting answer — the SAME rolling 30-day chronic
 * median `baselineEngine.estimateMetricBaseline` already computes — is wrong for a change-point
 * detector specifically: a rolling reference that keeps re-including the most recent days drifts
 * along with an emerging shift and progressively erases its own signal (by the time 20 of 30
 * reference days are drifted, "the reference" IS the drift). So the reference here is a WINDOW
 * held strictly OLDER than the days being tested — `[lastDay - recentDays - referenceDays,
 * lastDay - recentDays)` — frozen for the whole scan, and only the most recent `recentDays` are
 * walked through the CUSUM recursion against it. This is the standard control-chart target: a
 * period established BEFORE monitoring begins, not recomputed under it.
 *
 * The whole detector is STATELESS by design (recomputed fresh from the full available day series
 * every call, not carried night-to-night as persisted C+/C− state) for the same reason
 * baselineEngine/chronobiology are pure and clock-free: a stateless function is trivially
 * replayable in the soak harness and cannot silently diverge from a persisted accumulator that
 * drifted out of sync with its own inputs.
 */

const {
  median, mad, MAD_SCALE, MIN_SPREAD, dailySeries,
} = require('./baselineEngine');
const { blend, recoveryAxis, fatigueAxis } = require('./affectEngine');
const { sleepDebt } = require('./chronobiology');

const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;
const finite = (x) => {
  if (x == null || typeof x === 'boolean') return null;
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
};

// ── §M.13 CUSUM ─────────────────────────────────────────────────────────────────────────

// The chronic reference: how many days of history, held strictly before the test window, the
// median/sigma are estimated from. Matches baselineEngine's own CHRONIC_DAYS convention (30).
const REFERENCE_DAYS = 30;
// How many of the most recent days are actually walked through the CUSUM recursion. 14 gives
// room for a 10-day injected drift (the DoD's own scenario) to both start and clear the
// threshold inside the scanned window without needing the reference window to shrink.
const RECENT_DAYS = 14;
// Below this many reference days the median/sigma are too thin to trust — abstain rather than
// flag off three data points (the same MIN_SAMPLES-cliff lesson D15 exists to avoid, applied
// as an honest "insufficient evidence" rather than a silently generous one).
const MIN_REFERENCE_DAYS = 10;
const CUSUM_K = 0.5;        // §M.13 slack constant
const CUSUM_THRESHOLD = 4;  // §M.13 flag threshold

const CHANGE_POINT_ABSTAIN = Object.freeze({
  flagged: false, direction: null, day: null, cPlus: 0, cMinus: 0,
  referenceMedian: null, referenceSigma: null, referenceDays: 0, testedDays: 0,
  insufficientReference: true,
});

/**
 * §M.13 CUSUM over a day-indexed series `[{day, value}]` (ascending order NOT required — sorted
 * here). Returns `{flagged, direction, day, cPlus, cMinus, referenceMedian, referenceSigma,
 * referenceDays, testedDays, insufficientReference}`. `day` is the FIRST day the statistic
 * crossed the threshold (null if it never did).
 */
function changePointDetect(series, {
  referenceDays = REFERENCE_DAYS,
  recentDays = RECENT_DAYS,
  k = CUSUM_K,
  threshold = CUSUM_THRESHOLD,
  minReferenceDays = MIN_REFERENCE_DAYS,
} = {}) {
  const rows = (Array.isArray(series) ? series : [])
    .map((d) => ({ day: finite(d?.day), value: finite(d?.value) }))
    .filter((d) => d.day != null && d.value != null)
    .sort((a, b) => a.day - b.day);

  if (!rows.length) return { ...CHANGE_POINT_ABSTAIN };

  const lastDay = rows[rows.length - 1].day;
  const referenceCutoff = lastDay - recentDays;         // strictly OLDER than this = reference
  const referenceFloor = referenceCutoff - referenceDays;

  const referenceValues = rows
    .filter((d) => d.day <= referenceCutoff && d.day > referenceFloor)
    .map((d) => d.value);

  if (referenceValues.length < Math.max(1, finite(minReferenceDays) ?? MIN_REFERENCE_DAYS)) {
    return { ...CHANGE_POINT_ABSTAIN, referenceDays: referenceValues.length };
  }

  const refMedian = median(referenceValues);
  const refMad = mad(referenceValues);
  const refSigma = Math.max((refMad ?? 0) * MAD_SCALE, MIN_SPREAD);

  const tested = rows.filter((d) => d.day > referenceCutoff);

  let cPlus = 0;
  let cMinus = 0;
  let flagDay = null;
  let direction = null;
  for (const d of tested) {
    const z = (d.value - refMedian) / refSigma;
    cPlus = Math.max(0, cPlus + z - k);
    cMinus = Math.max(0, cMinus - z - k);
    if (flagDay == null && (cPlus >= threshold || cMinus >= threshold)) {
      flagDay = d.day;
      direction = cPlus >= threshold ? 'up' : 'down';
      break; // §M.13 flags at first breach; later days do not change WHEN it was first true
    }
  }

  return {
    flagged: flagDay != null,
    direction,
    day: flagDay,
    cPlus: round3(cPlus),
    cMinus: round3(cMinus),
    referenceMedian: round2(refMedian),
    referenceSigma: round2(refSigma),
    referenceDays: referenceValues.length,
    testedDays: tested.length,
    insufficientReference: false,
  };
}

// ── readiness composite ─────────────────────────────────────────────────────────────────

/**
 * `readiness = blend([recovery, 1 − fatigue])` — freshness minus accumulated debt, on the exact
 * mass-weighted fusion every affect axis already uses. An axis with zero mass (no evidence)
 * drops out of the blend entirely rather than dragging the composite toward a fabricated 0.5 —
 * `blend()` itself handles that (see affectEngine's own doc on `fuse`).
 */
function readinessComposite({ recovery, fatigue } = {}) {
  const parts = [];
  const rVal = finite(recovery?.value);
  const rMass = finite(recovery?.mass);
  if (rVal != null && rMass != null && rMass > 0) parts.push({ name: 'recovery', value: rVal, mass: rMass });

  const fVal = finite(fatigue?.value);
  const fMass = finite(fatigue?.mass);
  if (fVal != null && fMass != null && fMass > 0) {
    parts.push({ name: 'fatigueInverse', value: 1 - fVal, mass: fMass });
  }

  return blend(parts, { neutral: 0.5 });
}

// ── the composed nightly output ─────────────────────────────────────────────────────────

/**
 * The pure nightly consolidation. Inputs are already-decrypted plaintext (worker-scope only —
 * see dailyAnalysis.worker.js). `baselines` is the SAME superset blob `baselinesService
 * .computeBaselines` produces (its `cosinor` is threaded straight through — a second cosinor fit
 * here would be exactly the disagreeing-algorithm class this module's header warns about).
 * `priorNights` is oldest-first `[{deep, light, rem}]`; `profile.lastNightSleep` (if present) is
 * appended as the most recent night.
 */
function _seriesFor(vitalSamples, metric, tzOffsetMinutes) {
  const rows = (Array.isArray(vitalSamples) ? vitalSamples : []).filter((s) => s?.metric === metric);
  return dailySeries(rows, { reduce: median, tzOffsetMinutes });
}

// `now` is deliberately NOT a parameter: every input here is already day-indexed (the series,
// `priorNights`) or clock-free (`baselines`, `profile`), so there is nothing left for a clock to
// do — unlike baselineEngine/chronobiology, which DO need `now` to define "today" relative to
// their own raw samples (S9).
function consolidate({
  vitalSamples = [], priorNights = [], profile = {}, baselines = {},
  tzOffsetMinutes = 0,
} = {}) {
  // Both RHR and HRV CUSUM inputs are the DEVICE-REPORTED daily VitalSample series — the same
  // series `baselineEngine.estimateMetricBaseline` already treats `restingHeartRate` as (see
  // `computeBaselineBlob`'s `rhrSeries`), not a re-derivation from raw per-minute samples. A
  // trough-of-raw-samples estimate answers "what is this person's resting rate"; the device's
  // own daily figure is the one that actually carries a slow physiological drift day to day.
  const rhrSeries = _seriesFor(vitalSamples, 'restingHeartRate', tzOffsetMinutes);
  const hrvSeries = _seriesFor(vitalSamples, 'hrv', tzOffsetMinutes);

  const rhrCp = changePointDetect(rhrSeries);
  const hrvCp = changePointDetect(hrvSeries);

  const nights = [...(Array.isArray(priorNights) ? priorNights : [])];
  if (profile?.lastNightSleep) nights.push(profile.lastNightSleep);
  const debt = sleepDebt(nights);

  const recovery = recoveryAxis({
    sleep: { lastNight: profile?.lastNightSleep, baseline: profile?.sleepStages },
    hrv: profile?.hrv,
    bodyBattery: profile?.bodyBattery,
    dailyReadiness: profile?.dailyReadiness,
    baselines,
  });
  const fatigue = fatigueAxis({ debt, baselines });
  const readiness = readinessComposite({ recovery, fatigue });

  return {
    readiness: { value: round3(readiness.value), confidence: round3(readiness.mass) },
    sleepDebt: debt,
    cosinor: baselines?.cosinor ?? null,
    cusum: { rhr: rhrCp, hrv: hrvCp },
  };
}

module.exports = {
  changePointDetect,
  readinessComposite,
  consolidate,
  REFERENCE_DAYS, RECENT_DAYS, MIN_REFERENCE_DAYS, CUSUM_K, CUSUM_THRESHOLD,
};
