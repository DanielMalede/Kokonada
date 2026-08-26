'use strict';

/**
 * B6 — the feedback loop (W4-011). PURE: no clock, no database, no randomness, no I/O (§0.4 S9).
 *
 * This is the first module in the wave that closes the loop: everything before it decided what
 * to play, and nothing anywhere told the system whether it worked. The judgement is deliberately
 * split into two independent instruments, because they fail in opposite directions:
 *
 *   BIOMETRIC (§M.12) — did the body actually move the way the arc intended? Honest, hard to
 *     fake, and blind to taste: a track can regulate someone perfectly while they hate it.
 *   BEHAVIOURAL — did the person keep it? Honest about taste, and easily confounded by anything
 *     that has nothing to do with the music (a phone call, a doorbell, an accidental swipe).
 *
 * Neither is trustworthy alone, both are cheap, so the reward is `0.6·bio + 0.4·beh` when both
 * exist and whichever exists when only one does. When neither exists it is a NO-OP — **not a
 * zero**. That distinction is the single most important behaviour in this file: a reward of 0 is
 * the claim "this play was exactly neutral", and writing that into an aggregate on thin evidence
 * pulls every bucket toward the mean and makes the learner converge on nothing. Abstention is
 * the same discipline `affectEngine`'s axes use when they say `mass: 0` rather than guessing.
 *
 * ── WHAT THE BIOMETRIC REWARD IS ACTUALLY MEASURING ─────────────────────────────────────────
 *
 * Not "did the heart rate go down". A person already winding down at 6 bpm/min will go down no
 * matter what plays; a person mid-workout will go up. The instrument is therefore observed slope
 * against a COUNTERFACTUAL — the Kalman trend `anomalyFilter` was already carrying at the moment
 * the track started, which is precisely "where the body was heading before this track". The
 * reward is how far the body departed from that trajectory, signed by the direction the chosen
 * arc wanted. That is why `expectedSlope` is a required input and not an optional refinement:
 * without it the metric degenerates into "reward whatever the person was doing anyway".
 *
 * ── §M.12 DEVIATION, PINNED AND DELIBERATE (`tests/feedbackLoop.test.js`) ────────────────────
 *
 * §M.12 writes `r_bio = clamp[−1,1](((slope_expected − slope_observed)/σ_slope) · goal)` with
 * `goal = −1` for down-regulation archetypes. Evaluate that on the DoD's own success scenario —
 * "HR falls faster than counterfactual on calm target under stress → positive": observed <
 * expected makes `(expected − observed) > 0`, and multiplying by `goal = −1` yields a NEGATIVE
 * reward for the exact case the DoD calls positive. The appendix's operand order contradicts the
 * task it belongs to; one of the two is wrong, and the DoD's scenario is the one that states a
 * physiological fact rather than an algebraic convention. So this module implements
 *
 *     r_bio = clamp[−1,1]( ((slope_observed − slope_expected) / σ_slope) · goal )
 *
 * which is §M.12 with the subtraction transposed, and is positive exactly when the body moved
 * further in the arc's intended direction than it was already going. The deviation is pinned by
 * a test that asserts the two orders disagree in sign, so it cannot be silently "corrected" back.
 *
 * ── WHERE σ_slope COMES FROM (no magic constant) ────────────────────────────────────────────
 *
 * Two things can make a slope difference unimpressive, and σ has to carry both:
 *
 *   1. WE MIGHT HAVE MEASURED IT BADLY. The ordinary-least-squares standard error of the slope,
 *      `σ_meas / √Σ(tᵢ − t̄)²`, is exactly that, and it comes from the window itself — five
 *      samples over two minutes earns a wider σ than forty over ten, automatically, with nothing
 *      to tune. `σ_meas` is `anomalyFilter.MEASUREMENT_SIGMA` (3 bpm wrist noise, §M.2),
 *      IMPORTED rather than re-stated so the two modules cannot drift apart.
 *   2. THE DIFFERENCE MIGHT BE REAL BUT TRIVIAL. A perfectly measured 0.2 bpm/min divergence is
 *      not a success story. `SLOPE_SCALE_BPM_PER_MIN = 2` is the floor: about two beats per
 *      minute of departure from the counterfactual over a track is the smallest change that can
 *      plausibly be attributed to the music rather than to the day, so that is what a
 *      full-magnitude reward should cost.
 *
 * They compose in quadrature — `σ = √(SE² + scale²)` — because they are independent sources of
 * unimpressiveness. Without (1) a long window drives SE toward zero and every reward saturates
 * at ±1, turning a graded signal into a sign bit; without (2) the loop celebrates noise.
 *
 * ── ADR-0012 ────────────────────────────────────────────────────────────────────────────────
 *
 * Track A (bucket aggregates) is provider-neutral by construction: the bucket is
 * `{stateDomain, targetBand, hourBin}` — coordinates of the person and the moment — and no track
 * identity of any provider ever enters it. Track B (Beta posteriors) is gated to CC0 `mbid:`
 * recordings here as well as at the schema, so a caller that reaches past the model still cannot
 * produce a non-CC0 posterior. `bucketOf` emits the coarse DOMAIN (one of six), never the state
 * label — the 34 clinical-sounding taxonomy ids stay inside the engine (§0.2, audit F3).
 */

const { DOMAINS, BANDS, ARCHETYPE_DIRECTION, byId } = require('../knowledge/stateTaxonomy');
const { MEASUREMENT_SIGMA } = require('../ingestion/anomalyFilter');

const FEEDBACK_LOOP_VERSION = 1;

// ── constants ───────────────────────────────────────────────────────────────────────────────

/**
 * Four six-hour bins, aligned to the vocabulary the taxonomy's own Daily Rhythm domain already
 * speaks (morning-activation / afternoon-dip / evening-unwind / night-owl-alert), so a learning
 * coordinate and a state label describe the same day rather than two overlapping ones.
 *
 * Coarser than it could be, on purpose. The bucket space is |domains| × |bands| × |bins| = 72,
 * and a real listener occupies a handful of cells; 24 hourly bins would give 432 and guarantee
 * that nothing ever accumulates enough observations to outrun its prior. Coarse also serves
 * §0.2.2: a bin is a quarter of a day, not a timestamp.
 */
const HOUR_BINS = 4;
const HOURS_PER_BIN = 24 / HOUR_BINS;

/** §3's play-window gates: a judgement needs at least this much evidence or it abstains. */
const MIN_WINDOW_SEC = 120;
const MIN_SAMPLES = 5;

/** §3's behavioural table. An early skip is the strongest negative a listener can give. */
const EARLY_SKIP_MS = 30_000;
const BEHAVIOR_REWARDS = Object.freeze({
  earlySkip: -1,
  lateSkip: -0.3,
  complete: 0.3,
  save: 1,
});

/** See the header: the physiological floor on σ_slope, in bpm per minute. */
const SLOPE_SCALE_BPM_PER_MIN = 2;
const SLOPE_SCALE_BPM_PER_SEC = SLOPE_SCALE_BPM_PER_MIN / 60;

/** §M.12's combination weights. */
const BIO_WEIGHT = 0.6;
const BEH_WEIGHT = 0.4;

/**
 * ARCHETYPE_DIRECTION re-exported under the name §M.12 uses for it. Re-exported, not copied:
 * the arc's intended direction is the taxonomy's fact about the arc, and a second table here
 * would be free to drift (the D11 / W4-D42 class this wave keeps finding under new names).
 */
const ARCHETYPE_GOAL = ARCHETYPE_DIRECTION;

/** ADR-0012 Track B: CC0 corpus identity only, anchored so `spotify:…mbid:…` cannot pass. */
const CC0_KEY_RE = /^mbid:/;

// ── helpers ─────────────────────────────────────────────────────────────────────────────────

/**
 * Strict: only a genuine finite number counts. Deliberately narrower than the `finite()` helpers
 * elsewhere in the engine stack, which accept a numeric string — those read database rows, this
 * reads a socket payload and a worker's own arithmetic, and `Number([]) === 0` is precisely the
 * coercion W4-D15/W4-D17/W4-D21 kept finding as a live defect. Nothing here should be a string.
 */
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const clamp1 = (x) => (x > 1 ? 1 : x < -1 ? -1 : x);
const round3 = (x) => Math.round(x * 1000) / 1000;

const ABSTAIN = (reason) => ({ usable: false, value: 0, reason });

// ── Track A coordinates ─────────────────────────────────────────────────────────────────────

/**
 * Local hour-of-day → coarse bin, or `null` when the hour is not one this engine can trust.
 * Abstaining rather than folding a bad hour into bin 0 matters: bin 0 is "night", and quietly
 * filing every unknown play under night would teach the learner a nocturnal habit nobody has.
 */
function hourBinOf(hourOfDay) {
  const h = num(hourOfDay);
  if (h == null || h < 0 || h >= 24) return null;
  return Math.floor(h / HOURS_PER_BIN);
}

/**
 * The Track-A bucket coordinates, or `null` if any one of them is unknown. Partial buckets are
 * refused rather than defaulted: a bucket is an ADDRESS, and an address with a guessed component
 * accumulates one context's rewards under another context's name.
 */
function bucketOf({ stateId = null, stateDomain = null, targetBand = null, hourOfDay = null } = {}) {
  const domain = stateDomain ?? byId(stateId)?.domain ?? null;
  if (!DOMAINS.includes(domain)) return null;
  if (!BANDS.includes(targetBand)) return null;
  const hourBin = hourBinOf(hourOfDay);
  if (hourBin == null) return null;
  return { stateDomain: domain, targetBand, hourBin };
}

/** The one place a bucket becomes a string, so every consumer spells it the same way. */
function bucketKey(bucket) {
  if (!bucket) return null;
  return `${bucket.stateDomain}:${bucket.targetBand}:${bucket.hourBin}`;
}

// ── the observed slope ──────────────────────────────────────────────────────────────────────

/**
 * Ordinary least squares over a play window `[{atMs, value}]`, returning the slope in **bpm per
 * second** (the unit `anomalyFilter`'s Kalman `trend` already speaks, so the observation and the
 * counterfactual are directly comparable without a conversion nobody would remember to keep).
 *
 * Rows that are not measurable are DROPPED, not coerced — an unmeasured heart rate is an absence,
 * and `Number(null) === 0` has been a live defect in this repo three separate times.
 */
function observedSlope(samples) {
  const rows = (Array.isArray(samples) ? samples : [])
    .map((s) => ({ t: num(s?.atMs), v: num(s?.value) }))
    .filter((s) => s.t != null && s.v != null);

  if (rows.length < 2) return { usable: false, slope: 0, standardError: null, samples: rows.length, spanSec: 0, reason: 'too-few-samples' };

  const n = rows.length;
  const ts = rows.map((r) => r.t / 1000);
  const tBar = ts.reduce((a, b) => a + b, 0) / n;
  const vBar = rows.reduce((a, r) => a + r.v, 0) / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dt = ts[i] - tBar;
    sxx += dt * dt;
    sxy += dt * (rows[i].v - vBar);
  }
  // Every sample at one instant: the window has a value but no slope. Abstain rather than
  // divide (§0.4 S8 — every division zero-guarded, at the point where zero is meaningful).
  if (!(sxx > 0)) {
    return { usable: false, slope: 0, standardError: null, samples: n, spanSec: 0, reason: 'no-time-spread' };
  }

  return {
    usable: true,
    slope: sxy / sxx,
    // The textbook OLS standard error of the slope under known measurement noise. `σ_meas` is
    // the filter's own wrist-noise figure, not a second opinion about it.
    standardError: MEASUREMENT_SIGMA / Math.sqrt(sxx),
    samples: n,
    spanSec: Math.max(...ts) - Math.min(...ts),
    reason: null,
  };
}

// ── the two instruments ─────────────────────────────────────────────────────────────────────

/**
 * §M.12 with the transposition documented in the header. Returns `{usable, value, reason,
 * observedSlope, expectedSlope, sigma, samples, spanSec}`.
 *
 * ZERO-KNOWLEDGE NOTE: `observedSlope`/`expectedSlope` are physiological RATES and stay
 * worker-scope. They exist on this object so a failing reward can be root-caused in a test or a
 * replay; they must never reach a log line, a DTO or a persisted document — `telemetry()` below
 * is the only thing in this module shaped for stdout, and it carries neither.
 */
function biometricReward({ samples = [], expectedSlope = null, archetype = null, goal = null } = {}) {
  const direction = num(goal) ?? ARCHETYPE_GOAL[archetype] ?? null;
  // A flat arc (`flat-focus`, `cadence-locked`, `steady`) has direction 0 and genuinely cannot
  // sign a slope: neither up nor down is what it asked for. Abstaining is the honest answer —
  // inventing a |slope|-based stability reward here would be a second, unmandated metric
  // (queued as W4-D46 instead of smuggled in). The behavioural instrument still applies.
  if (direction !== 1 && direction !== -1) return { ...ABSTAIN('no-direction'), observedSlope: null, expectedSlope: null, sigma: null, samples: 0, spanSec: 0 };

  const expected = num(expectedSlope);
  if (expected == null) return { ...ABSTAIN('no-counterfactual'), observedSlope: null, expectedSlope: null, sigma: null, samples: 0, spanSec: 0 };

  const ols = observedSlope(samples);
  const shape = { observedSlope: null, expectedSlope: expected, sigma: null, samples: ols.samples, spanSec: ols.spanSec };
  if (!ols.usable) return { ...ABSTAIN(ols.reason), ...shape };
  if (ols.samples < MIN_SAMPLES) return { ...ABSTAIN('too-few-samples'), ...shape };
  if (ols.spanSec < MIN_WINDOW_SEC) return { ...ABSTAIN('window-too-short'), ...shape };

  const sigma = Math.hypot(ols.standardError, SLOPE_SCALE_BPM_PER_SEC);
  return {
    usable: true,
    value: clamp1(((ols.slope - expected) / sigma) * direction),
    reason: null,
    observedSlope: ols.slope,
    expectedSlope: expected,
    sigma,
    samples: ols.samples,
    spanSec: ols.spanSec,
  };
}

/**
 * §3's behavioural table over the play's `playback_event`s. Each event CLASS contributes once —
 * a client that re-sends `save` three times (a retry, a reconnect, a double tap) must not be
 * able to triple its own vote — and the sum is bounded, so "completed AND saved" is a maximal
 * positive rather than an arithmetic 1.3.
 */
function behavioralReward(events) {
  const list = Array.isArray(events) ? events : [];
  const seen = new Set();
  let total = 0;
  const types = [];

  for (const e of list) {
    const type = e?.type;
    let contribution = null;
    if (type === 'skip') {
      const pos = num(e?.positionMs);
      // No position reported → the MILDER claim. An early skip is the strongest negative in the
      // table, and inferring it from missing data would punish a track for a client's silence.
      contribution = pos != null && pos < EARLY_SKIP_MS ? BEHAVIOR_REWARDS.earlySkip : BEHAVIOR_REWARDS.lateSkip;
    } else if (type === 'complete') {
      contribution = BEHAVIOR_REWARDS.complete;
    } else if (type === 'save') {
      contribution = BEHAVIOR_REWARDS.save;
    }
    if (contribution == null || seen.has(type)) continue;
    seen.add(type);
    types.push(type);
    total += contribution;
  }

  if (!types.length) return { ...ABSTAIN('no-events'), types: [] };
  return { usable: true, value: clamp1(total), reason: null, types };
}

/** §M.12: `0.6·bio + 0.4·beh` when both exist, otherwise whichever does, otherwise a no-op. */
function combineReward(bio, beh) {
  const hasBio = bio?.usable === true;
  const hasBeh = beh?.usable === true;
  if (hasBio && hasBeh) {
    return { usable: true, value: BIO_WEIGHT * bio.value + BEH_WEIGHT * beh.value, source: 'both', reason: null };
  }
  if (hasBio) return { usable: true, value: bio.value, source: 'biometric', reason: null };
  if (hasBeh) return { usable: true, value: beh.value, source: 'behavioral', reason: null };
  return { usable: false, value: 0, source: null, reason: 'no-signal' };
}

// ── Track B ─────────────────────────────────────────────────────────────────────────────────

/**
 * The Beta update a reward implies: a positive outcome is one success, a negative one is one
 * failure, and an exactly-zero reward moves nothing. Counting one observation rather than
 * `|reward|` is deliberate — a Beta posterior's α/β are counts of TRIALS, and letting a strong
 * reward contribute 0.9 of a trial would make the posterior's own confidence a function of how
 * much we liked the outcome. Magnitude belongs in Track A's `rewardSum`, which is a mean.
 */
function posteriorDelta(reward) {
  const r = num(reward) ?? 0;
  if (r > 0) return { alpha: 1, beta: 0 };
  if (r < 0) return { alpha: 0, beta: 1 };
  return { alpha: 0, beta: 0 };
}

/** ADR-0012 Track B gate — anchored, fail-closed, and asserted by the tripwire suite. */
function isCc0Key(recordingKey) {
  return typeof recordingKey === 'string' && CC0_KEY_RE.test(recordingKey);
}

// ── the composed judgement ──────────────────────────────────────────────────────────────────

/**
 * S15 house telemetry: one line, closed key set, no vital, no track identity, no state label.
 * The only physiological facts on it are how MUCH evidence there was, never what it said.
 */
function _telemetry({ bucket, combined, bio, beh, cc0 }) {
  return [
    '[feedback]',
    `domain=${bucket?.stateDomain ?? 'none'}`,
    `band=${bucket?.targetBand ?? 'none'}`,
    `bin=${bucket?.hourBin ?? 'none'}`,
    `src=${combined.source ?? 'none'}`,
    `r=${combined.usable ? round3(combined.value) : 'na'}`,
    `bio=${bio.usable ? 'y' : bio.reason}`,
    `beh=${beh.usable ? beh.types.join('+') : beh.reason}`,
    `cc0=${cc0 ? 'y' : 'n'}`,
    `v=${FEEDBACK_LOOP_VERSION}`,
  ].join(' ');
}

/**
 * The whole judgement for one play. Returns
 * `{usable, reward, bucket, posterior, components, reason, telemetry}`.
 *
 * `usable` is the TRACK-A verdict: a reward that has nowhere to be filed teaches nothing, so an
 * unresolvable bucket makes the record unusable and forces `reward` to exactly 0 (a caller that
 * ignored the flag would otherwise write a real number into nothing). `posterior` is TRACK B and
 * stands alone by design — the two tracks are separate stores precisely so one can be absent
 * without suppressing the other (ADR-0012 "that separation is the compliance boundary").
 */
function evaluatePlay({
  samples = [], expectedSlope = null, archetype = null, goal = null, events = [],
  stateId = null, stateDomain = null, targetBand = null, hourOfDay = null, recordingKey = null,
} = {}) {
  const bio = biometricReward({ samples, expectedSlope, archetype, goal });
  const beh = behavioralReward(events);
  const combined = combineReward(bio, beh);
  const bucket = bucketOf({ stateId, stateDomain, targetBand, hourOfDay });

  const cc0 = isCc0Key(recordingKey);
  const delta = combined.usable && cc0 ? posteriorDelta(combined.value) : null;
  const posterior = delta ? { recordingKey, alpha: delta.alpha, beta: delta.beta } : null;

  const usable = combined.usable && bucket != null;
  const reason = combined.usable ? (bucket ? null : 'no-bucket') : combined.reason;

  return {
    usable,
    reward: usable ? round3(combined.value) : 0,
    bucket,
    posterior,
    components: { biometric: bio, behavioral: beh, combined },
    reason,
    telemetry: _telemetry({ bucket, combined, bio, beh, cc0 }),
  };
}

module.exports = {
  FEEDBACK_LOOP_VERSION,
  HOUR_BINS, HOURS_PER_BIN,
  MIN_WINDOW_SEC, MIN_SAMPLES, EARLY_SKIP_MS, BEHAVIOR_REWARDS,
  SLOPE_SCALE_BPM_PER_MIN, SLOPE_SCALE_BPM_PER_SEC,
  BIO_WEIGHT, BEH_WEIGHT, ARCHETYPE_GOAL, CC0_KEY_RE,
  hourBinOf, bucketOf, bucketKey,
  observedSlope, biometricReward, behavioralReward, combineReward,
  posteriorDelta, isCc0Key, evaluatePlay,
};
