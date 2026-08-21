'use strict';

const { BANDS } = require('../knowledge/stateTaxonomy');

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

/** One of each scoreable type is the most a single play can honestly contribute. */
const MAX_PENDING_EVENTS = 3;

/** See the header: a saved track is still playing, a skipped or completed one is not. */
const TERMINAL_EVENT_TYPES = Object.freeze(new Set(['skip', 'complete']));

const isFiniteNumber = (x) => typeof x === 'number' && Number.isFinite(x);

function createPlayWindowState() {
  return { openedAtMs: null, context: null, samples: [], pendingEvents: [], trackKey: null };
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
  };

  // The next track starts the moment this one ended.
  return {
    state: { openedAtMs: isFiniteNumber(nowMs) ? nowMs : openedAtMs, context: s.context, samples: [], pendingEvents: [], trackKey: null },
    play,
  };
}

module.exports = {
  MAX_SAMPLES,
  MAX_SAMPLE_AGE_MS,
  MAX_PENDING_EVENTS,
  TERMINAL_EVENT_TYPES,
  createPlayWindowState,
  contextFromTargets,
  openWindow,
  recordSample,
  noteEvent,
};
