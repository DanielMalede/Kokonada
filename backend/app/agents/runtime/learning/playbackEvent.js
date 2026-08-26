'use strict';

/**
 * W4-011 · `playback_event` — the S7 boundary.
 *
 * This is the first socket event in the repo whose payload can reach a PERSISTED learned artifact
 * (`TrackPosterior`, via `trackKey`), so §0.4 S7 asks for the treatment the tap buffer already
 * gets: a closed type enum, a bounded position, a capped payload, unknown fields dropped, and a
 * per-socket rate limit. Everything below is refusal logic; there is no business rule here.
 *
 * ── WHY THE BOUNDARY IS STRICTER THAN THE ENGINE ────────────────────────────────────────────
 *
 * `feedbackLoop` is deliberately forgiving — an unknown event type contributes nothing, a missing
 * `positionMs` degrades a skip to the MILDER claim, an unusable window abstains. That forgiveness
 * is right for an engine (it must never over-correct) and wrong for a boundary: a malformed
 * payload that the engine quietly tolerates never announces itself, so a client bug looks like a
 * listener who simply never gives feedback. Refusing here is what makes the failure visible.
 *
 * ── WHAT THIS LAYER DELIBERATELY DOES *NOT* DO ──────────────────────────────────────────────
 *
 * It does not enforce ADR-0012. A `spotify:` key is admitted here and refused twice downstream —
 * once by `feedbackLoop.isCc0Key` and once, fail-closed, by the `TrackPosterior` query pre-hook.
 * A third copy of that rule at the socket edge would be a fourth thing to keep in sync, and the
 * one furthest from the write. Shape is this module's job; policy is the model's.
 *
 * PURE and clock-free (§0.4 S9): `now` is a parameter, the rate-limit state is the caller's.
 */

/** The closed enum. Exactly the three the §3 behavioural table scores — nothing else is a vote. */
const PLAYBACK_EVENT_TYPES = Object.freeze(['skip', 'complete', 'save']);
const TYPE_SET = new Set(PLAYBACK_EVENT_TYPES);

/**
 * Four hours. Longer than any single recording anyone streams, so a larger value is a client
 * reporting a SESSION position rather than a track position — and `positionMs` anchors the
 * sample window (`playWindow`), so an unbounded one silently widens what physiology gets
 * attributed to a track.
 */
const MAX_POSITION_MS = 4 * 60 * 60 * 1000;

/** Canonical keys in this repo are `<provider>:<id>` shapes; 256 is far above every real one. */
const MAX_TRACK_KEY_LENGTH = 256;
const TRACK_KEY_RE = /^[A-Za-z0-9:._-]+$/;

/**
 * Three real fields plus generous slack for a client that adds one. A payload beyond this is
 * refused WHOLE rather than trimmed: at that point it is a probe or a bug, and quietly reading
 * three fields out of forty is how a boundary stops being one.
 */
const MAX_PAYLOAD_KEYS = 12;

/**
 * A listener produces feedback at human pace: a few events per track, a track every few minutes.
 * Twenty per minute is roughly an order of magnitude above the busiest honest client (skipping
 * hard through a queue) and far below anything that could load the reward path.
 */
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * Validate and re-BUILD a `playback_event` payload, or return null.
 *
 * Re-built, not filtered: the returned object is constructed from three named reads, so unknown
 * fields are dropped by construction rather than by an allowlist somebody has to remember to
 * update. A field that fails validation is ABSENT (`null`), not defaulted — the engine already
 * treats absence as the honest weaker claim, and a default would be an invented observation.
 */
function sanitizePlaybackEvent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).length > MAX_PAYLOAD_KEYS) return null;

  // Own-property read: `{type: 'toString'}` must not resolve through the prototype, and a payload
  // whose `type` was inherited is not a type the client sent.
  const type = Object.prototype.hasOwnProperty.call(raw, 'type') ? raw.type : undefined;
  if (typeof type !== 'string' || !TYPE_SET.has(type)) return null;

  const rawPos = raw.positionMs;
  const positionMs = isFiniteNumber(rawPos) && rawPos >= 0 && rawPos <= MAX_POSITION_MS
    ? Math.floor(rawPos)
    : null;

  const rawKey = raw.trackKey;
  const trackKey = typeof rawKey === 'string' && rawKey.length > 0 && rawKey.length <= MAX_TRACK_KEY_LENGTH && TRACK_KEY_RE.test(rawKey)
    ? rawKey
    : null;

  return { type, positionMs, trackKey };
}

// ── the per-socket budget ───────────────────────────────────────────────────────────────────

/** Sliding-window arrival times, capped by construction at `RATE_LIMIT_MAX`. */
function createRateLimitState() {
  return { hits: [] };
}

/**
 * Spend one unit of this socket's feedback budget. Returns `{state, allowed}`.
 *
 * A REFUSED arrival is NOT recorded. Recording it would make the window roll forward on every
 * attempt, so a client that floods once stays locked out for as long as it keeps trying — the
 * failure mode where a buggy retry loop permanently disables a real listener's feedback. Dropping
 * the refusal on the floor means the budget recovers exactly `RATE_LIMIT_WINDOW_MS` after the
 * last ADMITTED event, which is the property a limiter is supposed to have.
 *
 * A non-finite `now` is refused rather than tolerated: arithmetic against NaN makes every
 * comparison false, which would empty the window and turn the limiter off precisely when a
 * caller's clock is broken.
 */
function admitPlaybackEvent(state, nowMs) {
  const hits = Array.isArray(state?.hits) ? state.hits : [];
  if (!isFiniteNumber(nowMs)) return { state: { hits: hits.slice() }, allowed: false };

  const floor = nowMs - RATE_LIMIT_WINDOW_MS;
  const live = hits.filter((t) => t > floor);
  if (live.length >= RATE_LIMIT_MAX) return { state: { hits: live }, allowed: false };
  return { state: { hits: [...live, nowMs] }, allowed: true };
}

module.exports = {
  PLAYBACK_EVENT_TYPES,
  MAX_POSITION_MS,
  MAX_TRACK_KEY_LENGTH,
  MAX_PAYLOAD_KEYS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  TRACK_KEY_RE,
  sanitizePlaybackEvent,
  createRateLimitState,
  admitPlaybackEvent,
};
