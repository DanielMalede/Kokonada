'use strict';

const { getRedis } = require('../../config/redis');
const { encrypt } = require('../../utils/encryption');
const { auditedDecrypt } = require('../../utils/biometricAudit');

/**
 * W4-006 (seam half) — WHERE THE CARRIED AFFECT POSTERIOR LIVES.
 *
 * `affectEngine.updateAffect(state, input, opts)` is a forward step, not a classifier: the whole
 * temporal layer (§M.5 sticky transitions `A(s,s)=exp(−Δt/τ_s)`, dwell priors, the four-gate
 * hysteresis) only exists if the PREVIOUS posterior survives to the next call. Without somewhere
 * to keep it, every generation would start from a uniform prior, and the engine would collapse to
 * a per-request argmax — the flapping label the temporal layer was built to prevent.
 *
 * This module is modelled directly on `baselines.cacheBaselines`/`peekBaselines` and follows the
 * same rules, deliberately rather than incidentally (§0.2.2, R9):
 *   · AES-256-GCM at rest, AAD-bound to the userId, so one person's inferred state cannot be
 *     replayed into another's session even by someone holding the ciphertext;
 *   · reads go through `auditedDecrypt`, never a bare `decrypt`;
 *   · best-effort everywhere — no Redis, a corrupt blob or a failed write degrades the engine to
 *     a cold start, and NEVER fails a generation.
 *
 * WHAT IS STORED, AND WHAT DELIBERATELY IS NOT. Only the HMM state:
 * `{v, sig, alpha, label, labelSinceMs, lastAtMs, updates}`. No axes, no evidence, no reading.
 * The axes are recomputed from live inputs on every call — they are cheap and they are about NOW,
 * whereas `alpha` is the one quantity that genuinely cannot be recovered. Storing less is also
 * the smaller blast radius: the only sensitive field here is the internal state id, which is why
 * the whole blob is encrypted rather than merely scoped (R10).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY A CARRIED POSTERIOR EXPIRES (the ruling this module adds to the baseline precedent)
 *
 * A 30-day median is not wrong at six hours and one second — that is what makes the baseline
 * cache's stale-while-revalidate correct. A STATE is the opposite kind of quantity. §M.5's dwell
 * priors are 3–30 minutes; a label carried from four hours ago is not a slightly-late fact, it is
 * an assertion about a person that has stopped being true, and it does not fail quietly: the
 * hysteresis gate holds the incumbent against fresh evidence unless it clears `SWITCH_MARGIN`, so
 * a stale label actively RESISTS the reading that would correct it.
 *
 * So past `MAX_CARRY_AGE_S` the posterior is dropped and the engine starts clean. That costs one
 * cold start and buys the guarantee that the temporal layer never speaks for a moment it did not
 * observe. The Redis TTL is set to the same window, so retention and usefulness expire together
 * rather than leaving a key alive past the point anything would read it.
 *
 * S9: this module takes `now` as a PARAMETER and contains no clock. Freshness is a decision the
 * replay harness and the soak must be able to control.
 *
 * BOUNDARY WITH W4-009: the live socket lane will run its own O(1) `onlineUpdate` per filtered
 * reading (`liveStateAdapter`). It shares THIS key — one user has one posterior, not two that
 * disagree — and that module owns the update cadence, not the storage.
 */

const AFFECT_CACHE_VERSION = 1;

/**
 * How long a carried posterior is still a statement about now. Two hours is generous relative to
 * §M.5's longest dwell prior (30 min) and matches the TTL W4-009 specifies for the same blob;
 * beyond it the alpha would in any case have decayed toward the stationary distribution, so the
 * cut removes the LABEL's stale authority rather than useful information.
 */
const MAX_CARRY_AGE_S = 2 * 3600;

/** Retention. Never shorter than the carry window — a key that vanishes while still usable would
 *  silently cost cold starts that look like engine flakiness. Pinned by the suite. */
const AFFECT_TTL_S = 2 * 3600;

const affectKey = (userId) => `bio:affect:${userId}`;

const _scoped = (userId) => {
  const id = typeof userId === 'string' ? userId : String(userId ?? '');
  return id.trim() ? id : null;
};

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Is this blob a posterior the engine can actually resume from?
 *
 * `updateAffect` already refuses an unusable state (wrong length, changed state-set signature) and
 * falls back to `createAffectState`, so this check is not what makes resuming safe. It is what
 * keeps a nonsense blob from being handed across the boundary at all — the difference between the
 * engine tolerating garbage and the store never producing it.
 */
function _usable(state, nowMs) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return false;
  if (!Array.isArray(state.alpha) || state.alpha.length === 0) return false;

  const at = finite(state.lastAtMs);
  // No timestamp means unbounded age. Dropping is the safe direction: it costs a cold start,
  // whereas carrying costs a stale label with hysteresis behind it.
  if (at == null) return false;
  const ageMs = nowMs - at;
  // A future-dated posterior is clock skew or a replayed blob, not freshness (S6).
  if (ageMs < 0) return false;
  return ageMs <= MAX_CARRY_AGE_S * 1000;
}

/**
 * Request-path read: the carried posterior, or null for a cold start. Never throws for an absent,
 * corrupt, foreign or stale blob — all four are the same thing to the caller.
 */
async function peekAffectState(userId, { now } = {}) {
  const nowMs = finite(now);
  if (nowMs == null) {
    throw new TypeError('affectCache.peekAffectState: `now` is required (epoch ms) — freshness is never read from the clock (S9)');
  }
  const id = _scoped(userId);
  if (!id) return null;

  const redis = getRedis();
  if (!redis) return null;

  try {
    const blob = await redis.get(affectKey(id));
    if (!blob) return null;
    const state = auditedDecrypt(id, 'affect-state-peek', blob, { parseJson: true });
    return _usable(state, nowMs) ? state : null;
  } catch {
    // corrupt / tampered / rotated key / foreign AAD → a miss, which is a cold start
    return null;
  }
}

/**
 * Write the posterior back. Returns whether it was stored, so a caller can assert the write
 * happened rather than infer it; callers on the serving path ignore it deliberately (a failed
 * cache write must never cost a user their playlist).
 */
async function saveAffectState(userId, state) {
  const id = _scoped(userId);
  if (!id) return false;
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return false;

  const redis = getRedis();
  if (!redis) return false;

  try {
    // No wrapper version field is added here on purpose: the engine's own `v`
    // (`AFFECT_STATE_VERSION`) and `sig` (the state-set signature) already version this blob, and
    // `updateAffect` discards a posterior whose signature no longer matches the taxonomy. A
    // second version number would be a second thing to keep in step (S15 is satisfied by `v`).
    const blob = encrypt(JSON.stringify(state), id);
    await redis.set(affectKey(id), blob, 'EX', AFFECT_TTL_S);
    return true;
  } catch (e) {
    // Type only — a serialization/crypto message could quote the payload it choked on.
    console.error(`[affect] state cache write failed: ${e?.name || 'Error'}`);
    return false;
  }
}

module.exports = {
  affectKey,
  peekAffectState,
  saveAffectState,
  AFFECT_CACHE_VERSION,
  AFFECT_TTL_S,
  MAX_CARRY_AGE_S,
};
