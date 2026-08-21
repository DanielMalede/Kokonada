'use strict';

const { evaluatePlay, FEEDBACK_LOOP_VERSION } = require('../../agents/runtime/learning/feedbackLoop');
const { outcomeDelta } = require('../../agents/runtime/knowledge/noveltyController');
const personalization = require('../../agents/runtime/learning/personalization');
const { QUEUES } = require('../../queues/definitions');
const { enqueue } = require('../../queues/queue');

/**
 * W4-011 · the lane from a finished play to the two ADR-0012 stores.
 *
 * ── WHY THE JUDGEMENT HAPPENS *HERE* AND NOT IN THE WORKER ──────────────────────────────────
 *
 * The tempting shape is to enqueue the play window and let the worker do the arithmetic: the
 * socket stays thin, the maths gets a retry, and the worker is where heavy work belongs. It is
 * also a §0.2.2 breach. A BullMQ job payload is an unencrypted Redis blob, and that constraint
 * bars numeric vitals from Redis in as many words — so a job carrying `samples: [{atMs, value}]`
 * would put a minute-resolution heart-rate trace in a store the zero-knowledge model says can
 * never hold one.
 *
 * So `evaluatePlay` runs in the SOCKET process, where the readings already legitimately live
 * (`handleBiometricReading` receives them raw), and what crosses the queue is what survives the
 * judgement: a coarse bucket address, one bounded scalar in [-1, 1], and — for CC0 recordings
 * only — a Beta delta of ones and zeros. `REWARD_JOB_KEYS` is pinned closed by test because a
 * field added carelessly later is exactly how a vital would get back in.
 *
 * ── WHAT HAPPENS WITHOUT REDIS ──────────────────────────────────────────────────────────────
 *
 * `enqueue` is a graceful no-op when `REDIS_URL` is unset, so a deployment without Redis simply
 * never learns — the same posture every other queue in this repo already has (embeddings, feature
 * hydration, daily analysis). Deliberately NOT a direct-write fallback: that would put two Mongo
 * round trips on a socket handler precisely when infrastructure is degraded, to salvage a signal
 * whose whole design premise is that missing one costs nothing (`evaluatePlay` abstains far more
 * often than it fires).
 */

/**
 * §0.4 S11. Set it and the entire feedback lane reverts to pre-W4-011 behaviour with no deploy:
 * nothing is evaluated, nothing is logged, nothing is queued. The same forgiving parse the other
 * wave-4 switches use — a kill-switch that rejects `=1` because it wanted `=true` is a
 * kill-switch that fails at the moment it is finally needed.
 */
const FEEDBACK_FLAG = 'WAVE4_FEEDBACK_DISABLED';
function feedbackDisabled() {
  const v = String(process.env[FEEDBACK_FLAG] ?? '').trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
}

/** The closed payload contract. Pinned by test; see the header for why it matters. */
const REWARD_JOB_KEYS = Object.freeze(['v', 'userId', 'bucket', 'reward', 'posterior', 'novelty', 'weightStep', 'at']);

const REWARD_JOB_VERSION = FEEDBACK_LOOP_VERSION;

/**
 * Judge one finished play and hand the verdict to the write lane.
 *
 * NEVER THROWS and never rejects. This hangs off a socket event; a learning failure has no
 * business interrupting playback, and the caller has nothing useful to do with the error.
 * Returns `{dispatched, reason, verdict}` so a test (and a future caller) can see what happened.
 */
async function dispatchReward({ userId, play, atMs } = {}) {
  if (feedbackDisabled()) return { dispatched: false, reason: 'disabled', verdict: null };
  if (!userId || !play || typeof play !== 'object') return { dispatched: false, reason: 'no-play', verdict: null };

  try {
    const verdict = evaluatePlay(play);

    // S15 house telemetry, always on. One line, closed key set, and — pinned in `feedbackLoop` —
    // no vital, no state label and no track identity on it. Emitted for EVERY judgement including
    // the abstentions, because "the learner never fires" and "the learner fires and finds nothing"
    // are the two failure modes a dark-launched loop has, and they look identical without this.
    console.warn(verdict.telemetry);

    // W4-013 (B7): the same play, read as an answer to a THIRD question — which scoring
    // dimension does this listener actually respond to. `0.02 · r · ∂`, computed here because the
    // gradient is serve-time evidence and the reward is event-time evidence, and this is the only
    // place both exist.
    //
    // DELIBERATELY NOT `verdict.reward`. That field is forced to exactly 0 when the play cannot be
    // filed under a bucket, which is a TRACK-A rule: the bucket store is addressed by
    // (stateDomain, targetBand, hourBin), so a reward with no bucket has nowhere to go. The
    // overlay is addressed by the USER and carries no bucket coordinates at all, so that rule does
    // not apply to it — and reading it here would mean "listeners whose taxonomy state cannot be
    // resolved never learn", which is precisely the degraded-signal population most in need of a
    // ranking that adapts. `components.combined` is the verdict BEFORE Track A's addressability is
    // applied, and it is bounded to [-1, 1] by `combineReward` exactly as `reward` is.
    const combined = verdict.components?.combined;
    const weightStep = personalization.stepFrom({
      gradient: play.gradient,
      reward: combined?.usable === true ? combined.value : 0,
    });

    // The guard admits a job that teaches ONLY the overlay (the orphan case above). It stays a
    // guard: `stepFrom` returns null rather than a zero step for a play with no verdict or no
    // gradient, so "nothing to write" still means nothing is queued.
    if (!verdict.usable && !verdict.posterior && !weightStep) {
      return { dispatched: false, reason: verdict.reason ?? 'no-signal', verdict };
    }

    // W4-013 (B5): the same play, read as an answer to a DIFFERENT question — was gambling a
    // slot on unfamiliar music worth it here. The rule is the bandit's own (`outcomeDelta`), not
    // a second copy of it: if the controller changes its mind about what counts as evidence, this
    // lane changes with it.
    //
    // There is deliberately NO `verdict.usable` guard here, though the first draft had one. It was
    // provably dead: `evaluatePlay` already reports `reward: 0` for any play it could not file
    // under a bucket, and `outcomeDelta` treats an exactly-neutral reward as no evidence — so the
    // guard could not change an outcome, and a mutation removing it was undetectable by any test.
    // The real containment is downstream and fail-closed: the novelty posterior lives ON the
    // bucket row, so `rewardRepo.recordNoveltyOutcome` refuses a write it cannot address.
    const novelty = outcomeDelta({ wasDiscovery: play.wasDiscovery, reward: verdict.reward });

    const result = await enqueue(QUEUES.REWARD_INGEST, {
      v: REWARD_JOB_VERSION,
      userId: String(userId),
      // Track A and Track B travel together but stay separable: either may be null, and the
      // worker writes whichever is present. They are separate collections for compliance
      // reasons, not separate jobs — one play is one observation.
      bucket: verdict.usable ? verdict.bucket : null,
      reward: verdict.usable ? verdict.reward : 0,
      posterior: verdict.posterior,
      novelty,
      // Four music-RANKING coefficients bounded by the learning rate, naming no recording, no
      // provider and no vital — strictly less sensitive than the HR-slope-derived `reward` this
      // payload already carries, which is the bar §0.2.2 sets for anything crossing Redis.
      weightStep,
      at: atMs,
    });

    return { dispatched: result?.queued === true, reason: result?.reason ?? null, verdict };
  } catch (e) {
    console.error('[feedback] dispatch failed:', e.message);
    return { dispatched: false, reason: 'error', verdict: null };
  }
}

module.exports = { dispatchReward, feedbackDisabled, FEEDBACK_FLAG, REWARD_JOB_KEYS, REWARD_JOB_VERSION };
