'use strict';

const { BANDS } = require('../knowledge/stateTaxonomy');
const { recordingKeyOf } = require('../../../services/features/featureProvider');
const { PERSONAL_TERMS } = require('./personalization');

/**
 * W4-011 · the play-window tracker.
 *
 * `feedbackLoop.evaluatePlay` is a pure judgement over three facts nobody upstream of the socket
 * can supply: WHEN the track started, what the body was ALREADY doing when it did (the
 * counterfactual the M.12 reward is measured against), and the heart-rate samples in between.
 * Only the live socket sees readings arrive, so only the socket can hold them — this module is
 * that bookkeeping, extracted so it can be reasoned about without a socket.
 *
 * PURE and clock-free (§0.4 S9). The caller owns the state object exactly the way it owns
 * `filterState`, and every function returns a NEW one rather than mutating in place.
 *
 * ── WHERE A TRACK'S BOUNDARIES COME FROM ────────────────────────────────────────────────────
 *
 * The client does not announce a track START, and deliberately so: W4-011's contract is the three
 * TERMINAL-ish types the reward table scores (`skip`/`complete`/`save`), and a fourth `start`
 * event would be a second thing the mobile app has to emit correctly before ANY of this works.
 * So boundaries are inferred from two sources, in this order:
 *
 *   1. `positionMs` — the client's own report of how long the track had been playing. When
 *      present it ANCHORS the window at `now − positionMs`, which is strictly better than any
 *      server-side guess and, critically, self-corrects when the client failed to report the
 *      PREVIOUS track at all (otherwise those readings would be scored against this track).
 *   2. the serve — a `playlist_ready` starts the first track, and every terminal event starts
 *      the next one. This is the floor the anchor can never reach behind.
 *
 * ── WHY `save` DOES NOT END A PLAY ──────────────────────────────────────────────────────────
 *
 * A saved track keeps playing. If `save` closed the window, the `complete` that follows would
 * open and immediately close an empty one, and `behavioralReward`'s "completed AND saved is a
 * maximal positive" — which it dedupes by type specifically to express — could never occur.
 */

/**
 * ~5 minutes of a 1 Hz pusher, or a full 20-minute window at the 4-second cadence real wearables
 * stream at. Well past the longest track anyone will score, and the cap that makes memory flat
 * (§0.4 S10) no matter how fast a client pushes.
 */
const MAX_SAMPLES = 300;

/**
 * Nothing older than this can belong to the track playing now. It bounds the damage of a client
 * that never reports a terminal event: without it, a socket left open all evening would hand a
 * 3-minute track an evening's worth of physiology the moment one event finally arrived.
 */
const MAX_SAMPLE_AGE_MS = 20 * 60 * 1000;

/**
 * W4-013 · a bound on the per-socket role table. Real playlists are `PLAYLIST_SIZE` (50 by
 * default); 200 is far above any of them and still keeps the set flat under a caller that hands
 * over something unbounded (§0.4 S10).
 */
const MAX_DISCOVERY_KEYS = 200;

/**
 * W4-013 (B7) · the same bound, for the same reason, on the per-socket gradient table. Kept as
 * its OWN constant rather than an alias: the two tables are populated from different sources (one
 * from the served tracks, one from the pipeline's scoring capture) and a later change to either
 * bound should not silently move the other.
 */
const MAX_GRADIENT_KEYS = 200;

/** One of each scoreable type is the most a single play can honestly contribute. */
const MAX_PENDING_EVENTS = 3;

/** See the header: a saved track is still playing, a skipped or completed one is not. */
const TERMINAL_EVENT_TYPES = Object.freeze(new Set(['skip', 'complete']));

const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);

function createPlayWindowState() {
  return { openedAtMs: null, context: null, samples: [], pendingEvents: [], trackKey: null };
}

/**
 * W4-013 (B5) · which of the tracks just served were a GAMBLE.
 *
 * The novelty bandit's whole question is whether spending a slot on music the listener has never
 * heard pays off in this context, and only the serve knows which slots those were — by the time a
 * `playback_event` arrives, the track is just a key. So the roles are captured once, at serve
 * time, and read back per play.
 *
 * Keyed the way the client names tracks: `canonicalKey` when the pipeline attached one, otherwise
 * the shared `recordingKeyOf` projection — imported rather than re-derived, so this is not a
 * fourth place that decides what a track is called.
 */
function discoveryKeysOf(tracks) {
  const out = new Set();
  if (!Array.isArray(tracks)) return out;
  for (const t of tracks) {
    if (!t || t.isDiscovery !== true) continue;
    const key = typeof t.canonicalKey === 'string' && t.canonicalKey ? t.canonicalKey : recordingKeyOf(t);
    if (typeof key === 'string' && key) out.add(key);
    if (out.size >= MAX_DISCOVERY_KEYS) break;
  }
  return out;
}

/**
 * W4-013 (B7) · what the RANKING thought of each track it just served.
 *
 * The mirror of `discoveryKeysOf`, and it exists for the same reason: §M.15's `∂` is a residual of
 * the scorer's own per-term values against the weight table that was in force, and neither of
 * those survives the request. The pipeline computes it at the only moment both are in hand
 * (`_gradientsOf`), and this turns that bounded list into the lookup a `playback_event` needs.
 *
 * Fail-closed on a malformed entry: a gradient that is not four finite numbers is dropped whole
 * rather than repaired, so the track reads back as UNKNOWN. Admitting a half-filled one would let
 * a defaulted zero pose as a measurement — the coercion class W4-D15 and W4-D21 both were.
 *
 * The list arrives keyed the way the client names tracks, so this deliberately does NOT re-derive
 * a key: one projection (`canonicalKey`, else `recordingKeyOf`), decided once in the pipeline
 * beside the discovery roles.
 */
function gradientsOf(list) {
  const out = new Map();
  if (!Array.isArray(list)) return out;
  for (const entry of list) {
    const key = entry?.key;
    if (typeof key !== 'string' || !key) continue;
    const g = entry.g;
    if (!g || typeof g !== 'object') continue;
    const clean = {};
    let ok = true;
    for (const term of PERSONAL_TERMS) {
      const v = g[term];
      if (typeof v !== 'number' || !Number.isFinite(v)) { ok = false; break; }
      clean[term] = v;
    }
    if (!ok) continue;
    out.set(key, clean);
    if (out.size >= MAX_GRADIENT_KEYS) break;
  }
  return out;
}

/**
 * W4-013 (B7) · the gradient for the track this play belongs to, as a TRI-state.
 *
 * `null` carries the `wasDiscovery` lesson exactly: a zero gradient is a real answer ("no term
 * distinguished this track"), and "the serve never told me" is not an answer at all. The second
 * one is also the COMMON one — the overlay is opt-in, so on every deployment that has not switched
 * it on the pipeline captures nothing and every play lands here. That is what makes the write lane
 * dormant by construction and not merely by flag.
 */
function _gradientOf(context, trackKey) {
  const table = context?.gradients;
  if (!(table instanceof Map) || typeof trackKey !== 'string' || !trackKey) return null;
  return table.get(trackKey) ?? null;
}

/**
 * W4-013 · the role of the track this play belongs to, as a TRI-state.
 *
 * `null` is the load-bearing one. Today's shipped client forwards `track_skipped` with no track
 * key at all, so which track ended is genuinely unknown — and a window opened before this feature
 * existed (or by a socket that reconnected mid-playlist) knows no roles either. Collapsing either
 * case to `false` would let silence vote, over and over, that novelty was not involved.
 */
function _roleOf(context, trackKey) {
  const keys = context?.discoveryKeys;
  if (!(keys instanceof Set) || typeof trackKey !== 'string' || !trackKey) return null;
  return keys.has(trackKey);
}

/**
 * The bucket coordinates + arc a serve fixes, read off the targets that CHOSE the music.
 *
 * Serve-time, not event-time, on purpose: the reward answers "given this state, at this band, at
 * this time of day, did that mix work" — and the state that answered is the one that picked the
 * tracks. Reading the clock again when the event arrives would file a play under a context that
 * never produced it.
 *
 * `targetBand` is `targets.tempoBand`, which speaks the taxonomy's own `BANDS` vocabulary (one
 * table, one reading of it — D11's lesson) and, unlike a band derived from `stateId`, is present
 * on EVERY serve because it is one of the 13 keys §0.2.5 freezes. `hourOfDay` is the listener's
 * own local hour (W4-004 / D13), resolved once in `targetsBuilder` from their habitual offset.
 */
function contextFromTargets(targets) {
  const t = targets && typeof targets === 'object' ? targets : {};
  const band = BANDS.includes(t.tempoBand) ? t.tempoBand : null;
  const hour = isFiniteNumber(t.hourOfDay) && t.hourOfDay >= 0 && t.hourOfDay < 24 ? Math.floor(t.hourOfDay) : null;
  return {
    stateId: typeof t.stateId === 'string' && t.stateId ? t.stateId : null,
    targetBand: band,
    hourOfDay: hour,
    archetype: typeof t.trajectory?.archetype === 'string' && t.trajectory.archetype ? t.trajectory.archetype : null,
  };
}

/** A serve: the first track of a new playlist starts now, under a new context. */
function openWindow(state, context, nowMs) {
  return {
    openedAtMs: isFiniteNumber(nowMs) ? nowMs : null,
    context: context ?? null,
    samples: [],
    pendingEvents: [],
    trackKey: null,
  };
}

/**
 * Collect one accepted reading.
 *
 * A CLOSED window collects nothing. Nothing has been served on this socket, so there is no play
 * for a reading to belong to, and buffering against a play that may never start is memory held
 * for a hypothesis.
 *
 * `trend` rides along because the counterfactual has to be read at a moment that has already
 * passed by the time the event arrives — there is no way to ask the filter what it thought
 * three minutes ago. It is stripped again before the engine sees the samples.
 */
function recordSample(state, sample, nowMs) {
  if (state?.openedAtMs == null) return state ?? createPlayWindowState();

  const atMs = sample?.atMs;
  const value = sample?.value;
  const trend = sample?.trend;
  if (!isFiniteNumber(atMs) || !isFiniteNumber(value) || !isFiniteNumber(trend)) return state;

  const floor = (isFiniteNumber(nowMs) ? nowMs : atMs) - MAX_SAMPLE_AGE_MS;
  const kept = state.samples.filter((s) => s.atMs > floor);
  kept.push({ atMs, value, trend });
  return { ...state, samples: kept.length > MAX_SAMPLES ? kept.slice(kept.length - MAX_SAMPLES) : kept };
}

/**
 * Record a sanitized `playback_event`. Returns `{state, play}`, where `play` is the argument
 * object for `feedbackLoop.evaluatePlay` on a terminal event and `null` otherwise.
 *
 * An event on a NEVER-OPENED window still produces a play, with null coordinates. ADR-0012 keeps
 * the two learning tracks in separate stores precisely so one can be absent: a `mbid:` key with a
 * behavioural vote is real Track-B evidence even when there is no bucket to file Track A under,
 * and `evaluatePlay` already refuses the half it cannot address.
 */
function noteEvent(state, event, nowMs) {
  const s = state ?? createPlayWindowState();
  const type = event?.type;
  if (typeof type !== 'string') return { state: s, play: null };

  const eventKey = typeof event.trackKey === 'string' && event.trackKey ? event.trackKey : null;

  // A DIFFERENT named recording means the previous track ended without ever reporting a terminal
  // event. Its votes cannot be moved onto this one, and there is no boundary left to score them
  // against, so they are dropped rather than misattributed. The samples need no such surgery:
  // this event's own `positionMs` re-anchors the window below.
  const stale = eventKey != null && s.trackKey != null && eventKey !== s.trackKey;
  const carried = stale ? [] : s.pendingEvents;
  const trackKey = eventKey ?? (stale ? null : s.trackKey);

  const pendingEvents = carried.some((e) => e.type === type) || carried.length >= MAX_PENDING_EVENTS
    ? carried
    : [...carried, { type, positionMs: event.positionMs ?? null }];

  if (!TERMINAL_EVENT_TYPES.has(type)) {
    return { state: { ...s, pendingEvents, trackKey }, play: null };
  }

  const positionMs = isFiniteNumber(event.positionMs) ? event.positionMs : null;
  const openedAtMs = s.openedAtMs;
  const anchored = positionMs != null && isFiniteNumber(nowMs) ? nowMs - positionMs : null;
  const startMs = anchored != null
    ? (openedAtMs != null ? Math.max(openedAtMs, anchored) : anchored)
    : openedAtMs;

  const inWindow = startMs == null ? [] : s.samples.filter((x) => x.atMs >= startMs);
  // The trend the filter held going INTO the window is the honest counterfactual: what the body
  // was doing before this track could have influenced it. The first IN-window sample is the
  // fallback, not the preference — it is already (marginally) inside what is being measured.
  const before = startMs == null ? [] : s.samples.filter((x) => x.atMs < startMs);
  const expectedSlope = before.length ? before[before.length - 1].trend
    : inWindow.length ? inWindow[0].trend
      : null;

  const play = {
    samples: inWindow.map((x) => ({ atMs: x.atMs, value: x.value })),
    expectedSlope,
    archetype: s.context?.archetype ?? null,
    events: pendingEvents,
    stateId: s.context?.stateId ?? null,
    targetBand: s.context?.targetBand ?? null,
    hourOfDay: s.context?.hourOfDay ?? null,
    recordingKey: trackKey,
    wasDiscovery: _roleOf(s.context, trackKey),
    gradient: _gradientOf(s.context, trackKey),
  };

  // The next track starts the moment this one ended.
  return {
    state: { openedAtMs: isFiniteNumber(nowMs) ? nowMs : openedAtMs, context: s.context, samples: [], pendingEvents: [], trackKey: null },
    play,
  };
}

module.exports = {
  MAX_SAMPLES,
  MAX_DISCOVERY_KEYS,
  discoveryKeysOf,
  MAX_GRADIENT_KEYS,
  gradientsOf,
  MAX_SAMPLE_AGE_MS,
  MAX_PENDING_EVENTS,
  TERMINAL_EVENT_TYPES,
  createPlayWindowState,
  contextFromTargets,
  openWindow,
  recordSample,
  noteEvent,
};
