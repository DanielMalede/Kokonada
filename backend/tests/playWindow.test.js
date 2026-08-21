'use strict';

// W4-011 (wiring half) — the play-window tracker.
//
// `feedbackLoop.evaluatePlay` is pure and takes three things it cannot invent: WHEN the track
// started, what the body was ALREADY doing at that moment (the counterfactual), and the heart-rate
// samples in between. This module is the only thing that knows them, because only the socket sees
// the readings arrive. Everything here is clock-free (§0.4 S9) and side-effect free — the socket
// owns the state object exactly as it owns `filterState`.

const {
  MAX_SAMPLES,
  MAX_SAMPLE_AGE_MS,
  MAX_PENDING_EVENTS,
  TERMINAL_EVENT_TYPES,
  createPlayWindowState,
  contextFromTargets,
  openWindow,
  recordSample,
  noteEvent,
} = require('../app/agents/runtime/learning/playWindow');

const CTX = { stateId: 'acute-stress', targetBand: 'resting', hourOfDay: 21, archetype: 'meet-then-lower' };
const T0 = 1_700_000_000_000;

/** Feed `n` samples one second apart, starting at `from`, each carrying `trend`. */
const feed = (state, { from, n, value = 70, step = 1_000, trend = 0 }) => {
  let s = state;
  for (let i = 0; i < n; i++) {
    const atMs = from + i * step;
    s = recordSample(s, { atMs, value: value + i, trend }, atMs);
  }
  return s;
};

describe('playWindow — sample collection', () => {
  test('a CLOSED window collects nothing (no serve ⇒ no play to attribute readings to)', () => {
    const s = feed(createPlayWindowState(), { from: T0, n: 10 });
    expect(s.samples).toEqual([]);
  });

  test('an OPEN window collects', () => {
    const s = feed(openWindow(createPlayWindowState(), CTX, T0), { from: T0, n: 10 });
    expect(s.samples).toHaveLength(10);
    expect(s.samples[0]).toEqual({ atMs: T0, value: 70, trend: 0 });
  });

  test.each([
    ['a non-finite value', { atMs: T0 + 1, value: NaN, trend: 0 }],
    ['a null value', { atMs: T0 + 1, value: null, trend: 0 }],
    ['a string value', { atMs: T0 + 1, value: '70', trend: 0 }],
    ['a non-finite timestamp', { atMs: NaN, value: 70, trend: 0 }],
    ['a missing timestamp', { value: 70, trend: 0 }],
    ['a non-finite trend', { atMs: T0 + 1, value: 70, trend: Infinity }],
    ['nothing at all', undefined],
  ])('drops %s rather than coercing it', (_label, sample) => {
    const open = openWindow(createPlayWindowState(), CTX, T0);
    expect(recordSample(open, sample, T0 + 1).samples).toEqual([]);
  });

  test('samples older than the age cap are pruned — a paused session cannot carry stale physiology forward', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 5 });
    const later = T0 + MAX_SAMPLE_AGE_MS + 10_000;
    s = recordSample(s, { atMs: later, value: 90, trend: 0.01 }, later);
    expect(s.samples).toEqual([{ atMs: later, value: 90, trend: 0.01 }]);
  });

  test('the buffer is capped and drops the OLDEST first (S10: flat memory under a fast pusher)', () => {
    const s = feed(openWindow(createPlayWindowState(), CTX, T0), { from: T0, n: MAX_SAMPLES + 200, step: 100 });
    expect(s.samples).toHaveLength(MAX_SAMPLES);
    expect(s.samples[s.samples.length - 1].atMs).toBe(T0 + (MAX_SAMPLES + 199) * 100);
  });

  test('is pure — the caller\'s state is never mutated', () => {
    const open = openWindow(createPlayWindowState(), CTX, T0);
    const before = JSON.stringify(open);
    recordSample(open, { atMs: T0 + 1, value: 70, trend: 0 }, T0 + 1);
    noteEvent(open, { type: 'skip', positionMs: 1_000, trackKey: null }, T0 + 1);
    expect(JSON.stringify(open)).toBe(before);
  });

  test('re-opening on a fresh serve discards the previous playlist\'s samples and pending events', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 5 });
    s = noteEvent(s, { type: 'save', positionMs: null, trackKey: 'mbid:a' }, T0 + 5_000).state;
    const reopened = openWindow(s, { ...CTX, stateId: 'deep-focus' }, T0 + 6_000);
    expect(reopened.samples).toEqual([]);
    expect(reopened.pendingEvents).toEqual([]);
    expect(reopened.openedAtMs).toBe(T0 + 6_000);
    expect(reopened.context.stateId).toBe('deep-focus');
  });
});

describe('playWindow — which events end a play', () => {
  test('`skip` and `complete` are terminal; `save` is not (a saved track keeps playing)', () => {
    expect([...TERMINAL_EVENT_TYPES].sort()).toEqual(['complete', 'skip']);
  });

  test('a `save` produces no play and stays pending for the terminal event to collect', () => {
    const open = openWindow(createPlayWindowState(), CTX, T0);
    const out = noteEvent(open, { type: 'save', positionMs: 5_000, trackKey: 'mbid:a' }, T0 + 5_000);
    expect(out.play).toBeNull();
    expect(out.state.pendingEvents.map((e) => e.type)).toEqual(['save']);
  });

  test('a terminal event carries EVERY event of the play — "completed AND saved" reaches the reward table together', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = noteEvent(s, { type: 'save', positionMs: 40_000, trackKey: 'mbid:a' }, T0 + 40_000).state;
    const out = noteEvent(s, { type: 'complete', positionMs: 200_000, trackKey: 'mbid:a' }, T0 + 200_000);
    expect(out.play.events.map((e) => e.type)).toEqual(['save', 'complete']);
  });

  test('the pending list is bounded, so a client re-sending `save` cannot grow the state', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    for (let i = 0; i < 50; i++) s = noteEvent(s, { type: 'save', positionMs: 1_000, trackKey: 'mbid:a' }, T0 + i).state;
    expect(s.pendingEvents.length).toBeLessThanOrEqual(MAX_PENDING_EVENTS);
  });

  test('a terminal event RESETS the window at the moment it fires — the next track starts now', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 100 });
    const out = noteEvent(s, { type: 'skip', positionMs: null, trackKey: null }, T0 + 100_000);
    expect(out.state.samples).toEqual([]);
    expect(out.state.pendingEvents).toEqual([]);
    expect(out.state.openedAtMs).toBe(T0 + 100_000);
    expect(out.state.context).toEqual(CTX); // same playlist ⇒ same context
  });
});

describe('playWindow — the window the samples are taken from', () => {
  test('without a reported position the window is everything since the serve', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 10 });
    const { play } = noteEvent(s, { type: 'complete', positionMs: null, trackKey: null }, T0 + 10_000);
    expect(play.samples).toHaveLength(10);
  });

  test('a reported position ANCHORS the window — samples from a track the client never reported are excluded', () => {
    // The serve was 10 minutes ago and the client only now reports a 2-minute play: the first
    // 8 minutes belong to tracks whose events were never sent, and attributing them here would
    // score this track on somebody else's physiology.
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 600 });                       // 600 s of readings, 1/s
    const { play } = noteEvent(s, { type: 'complete', positionMs: 120_000, trackKey: null }, T0 + 600_000);
    expect(play.samples).toHaveLength(120); // T0+480s … T0+599s inclusive
    expect(play.samples[0].atMs).toBe(T0 + 480_000);
  });

  test('the anchor never reaches back BEFORE the serve, however large the reported position', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0 + 5_000);
    s = feed(s, { from: T0 + 5_000, n: 10 });
    const { play } = noteEvent(s, { type: 'complete', positionMs: 3_600_000, trackKey: null }, T0 + 15_000);
    expect(play.samples).toHaveLength(10);
  });

  test('the engine receives ONLY `{atMs, value}` — the Kalman trend is window bookkeeping, not an observation', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 3, trend: 0.05 });
    const { play } = noteEvent(s, { type: 'skip', positionMs: null, trackKey: null }, T0 + 3_000);
    expect(Object.keys(play.samples[0]).sort()).toEqual(['atMs', 'value']);
  });
});

describe('playWindow — the counterfactual', () => {
  test('is the trend the filter held going INTO the track, not one measured during it', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 60, trend: 0.25 });            // pre-track: body already climbing
    s = feed(s, { from: T0 + 60_000, n: 180, trend: -0.4 });  // during the track
    const { play } = noteEvent(s, { type: 'complete', positionMs: 180_000, trackKey: null }, T0 + 240_000);
    expect(play.expectedSlope).toBe(0.25);
  });

  test('falls back to the first in-window sample when nothing precedes the anchor', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = feed(s, { from: T0, n: 5, trend: 0.11 });
    const { play } = noteEvent(s, { type: 'complete', positionMs: null, trackKey: null }, T0 + 5_000);
    expect(play.expectedSlope).toBe(0.11);
  });

  test('is null when the window saw no readings at all — the engine then abstains, it does not assume flat', () => {
    const open = openWindow(createPlayWindowState(), CTX, T0);
    const { play } = noteEvent(open, { type: 'skip', positionMs: 5_000, trackKey: null }, T0 + 5_000);
    expect(play.expectedSlope).toBeNull();
    expect(play.samples).toEqual([]);
  });
});

describe('playWindow — the play input handed to evaluatePlay', () => {
  test('carries the serve context so the reward has a bucket address', () => {
    const open = openWindow(createPlayWindowState(), CTX, T0);
    const { play } = noteEvent(open, { type: 'skip', positionMs: 1_000, trackKey: 'mbid:a' }, T0 + 1_000);
    expect(play).toMatchObject({
      stateId: 'acute-stress', targetBand: 'resting', hourOfDay: 21, archetype: 'meet-then-lower', recordingKey: 'mbid:a',
    });
  });

  test('an event on a NEVER-OPENED window still produces a play — Track B does not depend on Track A', () => {
    // ADR-0012 keeps the two stores apart precisely so one can be absent. A client that reports a
    // save before any serve on this socket still teaches the CC0 posterior; the bucket is null and
    // `evaluatePlay` refuses Track A on its own.
    const { play } = noteEvent(createPlayWindowState(), { type: 'complete', positionMs: 1_000, trackKey: 'mbid:a' }, T0);
    expect(play).toMatchObject({ stateId: null, targetBand: null, hourOfDay: null, archetype: null, recordingKey: 'mbid:a' });
  });

  test('a trackKey reported on an earlier event survives onto a terminal event that omits it', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = noteEvent(s, { type: 'save', positionMs: 10_000, trackKey: 'mbid:a' }, T0 + 10_000).state;
    const { play } = noteEvent(s, { type: 'complete', positionMs: 200_000, trackKey: null }, T0 + 200_000);
    expect(play.recordingKey).toBe('mbid:a');
  });

  test('a trackKey CHANGE discards the previous track\'s votes instead of scoring them here', () => {
    let s = openWindow(createPlayWindowState(), CTX, T0);
    s = noteEvent(s, { type: 'save', positionMs: 10_000, trackKey: 'mbid:a' }, T0 + 10_000).state;
    const { play } = noteEvent(s, { type: 'skip', positionMs: 5_000, trackKey: 'mbid:b' }, T0 + 200_000);
    expect(play.events.map((e) => e.type)).toEqual(['skip']);
    expect(play.recordingKey).toBe('mbid:b');
  });
});

describe('playWindow — contextFromTargets', () => {
  test('reads the state, the band the music was aimed at, the listener\'s own hour and the arc', () => {
    expect(contextFromTargets({
      stateId: 'steady-cardio', tempoBand: 'peak', hourOfDay: 7, trajectory: { archetype: 'warmup-peak-cooldown' },
    })).toEqual({ stateId: 'steady-cardio', targetBand: 'peak', hourOfDay: 7, archetype: 'warmup-peak-cooldown' });
  });

  test('absents what the targets do not carry rather than substituting a default', () => {
    expect(contextFromTargets({ tempoBand: 'resting' }))
      .toEqual({ stateId: null, targetBand: 'resting', hourOfDay: null, archetype: null });
    expect(contextFromTargets(null))
      .toEqual({ stateId: null, targetBand: null, hourOfDay: null, archetype: null });
  });

  test('refuses a tempoBand outside the taxonomy\'s own vocabulary and a nonsense hour', () => {
    expect(contextFromTargets({ tempoBand: 'sprint', hourOfDay: 25 }))
      .toEqual({ stateId: null, targetBand: null, hourOfDay: null, archetype: null });
  });
});
