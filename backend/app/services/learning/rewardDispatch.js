'use strict';

const { evaluatePlay, FEEDBACK_LOOP_VERSION } = require('../../agents/runtime/learning/feedbackLoop');
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
const REWARD_JOB_KEYS = Object.freeze(['v', 'userId', 'bucket', 'reward', 'posterior', 'at']);

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

    if (!verdict.usable && !verdict.posterior) {
      return { dispatched: false, reason: verdict.reason ?? 'no-signal', verdict };
    }

    const result = await enqueue(QUEUES.REWARD_INGEST, {
      v: REWARD_JOB_VERSION,
      userId: String(userId),
      // Track A and Track B travel together but stay separable: either may be null, and the
      // worker writes whichever is present. They are separate collections for compliance
      // reasons, not separate jobs — one play is one observation.
      bucket: verdict.usable ? verdict.bucket : null,
      reward: verdict.usable ? verdict.reward : 0,
      posterior: verdict.posterior,
      at: atMs,
    });

    return { dispatched: result?.queued === true, reason: result?.reason ?? null, verdict };
  } catch (e) {
    console.error('[feedback] dispatch failed:', e.message);
    return { dispatched: false, reason: 'error', verdict: null };
  }
}

module.exports = { dispatchReward, feedbackDisabled, FEEDBACK_FLAG, REWARD_JOB_KEYS, REWARD_JOB_VERSION };
