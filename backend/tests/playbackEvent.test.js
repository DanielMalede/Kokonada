'use strict';

// W4-011 (wiring half) — §0.4 S7: `playback_event` is the FIRST socket event in this repo that
// carries a client-chosen identifier into a learned artifact, so it gets the tap-buffer's hard
// allowlist treatment rather than the shape-tolerant handling the older events grew up with.
//
// Every pin here is about REFUSAL. The engine that consumes these events (feedbackLoop) is
// deliberately forgiving — a missing `positionMs` becomes the milder claim, an unknown type is
// ignored — which means a malformed payload does not announce itself downstream. This boundary
// is where it has to be caught.

const {
  PLAYBACK_EVENT_TYPES,
  MAX_POSITION_MS,
  MAX_TRACK_KEY_LENGTH,
  MAX_PAYLOAD_KEYS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  sanitizePlaybackEvent,
  createRateLimitState,
  admitPlaybackEvent,
} = require('../app/agents/runtime/learning/playbackEvent');

describe('playbackEvent — S7 boundary', () => {
  test('the type enum is closed and matches the three types the reward table scores', () => {
    expect(PLAYBACK_EVENT_TYPES).toEqual(['skip', 'complete', 'save']);
    expect(Object.isFrozen(PLAYBACK_EVENT_TYPES)).toBe(true);
  });

  test('a minimal valid event keeps its type and absents everything it did not send', () => {
    expect(sanitizePlaybackEvent({ type: 'skip' })).toEqual({ type: 'skip', positionMs: null, trackKey: null });
  });

  test('a full valid event survives intact', () => {
    expect(sanitizePlaybackEvent({ type: 'complete', positionMs: 180_000, trackKey: 'mbid:9f4a-1' }))
      .toEqual({ type: 'complete', positionMs: 180_000, trackKey: 'mbid:9f4a-1' });
  });

  test.each([
    ['an unknown type', { type: 'like' }],
    ['a type that is not a string', { type: ['skip'] }],
    ['a numeric type', { type: 1 }],
    ['no type at all', { positionMs: 10 }],
    ['null', null],
    ['undefined', undefined],
    ['an array', ['skip']],
    ['a bare string', 'skip'],
    ['a number', 7],
  ])('refuses %s', (_label, raw) => {
    expect(sanitizePlaybackEvent(raw)).toBeNull();
  });

  test('type is matched exactly — no trimming, no case folding, no prototype keys', () => {
    expect(sanitizePlaybackEvent({ type: ' skip' })).toBeNull();
    expect(sanitizePlaybackEvent({ type: 'SKIP' })).toBeNull();
    expect(sanitizePlaybackEvent({ type: 'toString' })).toBeNull();
    expect(sanitizePlaybackEvent({ type: 'constructor' })).toBeNull();
  });

  test('unknown fields are DROPPED rather than carried', () => {
    const out = sanitizePlaybackEvent({
      type: 'save', userId: 'someone-else', heartRate: 142, __proto__: { polluted: true }, nested: { deep: [1, 2] },
    });
    expect(out).toEqual({ type: 'save', positionMs: null, trackKey: null });
    expect(Object.keys(out).sort()).toEqual(['positionMs', 'trackKey', 'type']);
  });

  test('a payload with more keys than the cap is refused whole, not trimmed', () => {
    const fat = { type: 'skip' };
    for (let i = 0; i < MAX_PAYLOAD_KEYS; i++) fat[`k${i}`] = i;
    expect(Object.keys(fat).length).toBeGreaterThan(MAX_PAYLOAD_KEYS);
    expect(sanitizePlaybackEvent(fat)).toBeNull();

    const atCap = { type: 'skip' };
    for (let i = 0; i < MAX_PAYLOAD_KEYS - 1; i++) atCap[`k${i}`] = i;
    expect(sanitizePlaybackEvent(atCap)).toEqual({ type: 'skip', positionMs: null, trackKey: null });
  });

  describe('positionMs', () => {
    test.each([
      ['a negative position', -1],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity],
      ['a numeric STRING (no coercion — Number("") === 0 is the repo\'s recurring defect)', '1000'],
      ['an empty string', ''],
      ['null', null],
      ['an array', [1000]],
      ['a boolean', true],
      ['beyond the cap', MAX_POSITION_MS + 1],
    ])('absents %s instead of trusting it', (_label, positionMs) => {
      expect(sanitizePlaybackEvent({ type: 'skip', positionMs })).toEqual({ type: 'skip', positionMs: null, trackKey: null });
    });

    test('zero is a real position (a skip at the very first millisecond)', () => {
      expect(sanitizePlaybackEvent({ type: 'skip', positionMs: 0 }).positionMs).toBe(0);
    });

    test('the cap itself is admitted, and a fractional position is floored to a whole millisecond', () => {
      expect(sanitizePlaybackEvent({ type: 'skip', positionMs: MAX_POSITION_MS }).positionMs).toBe(MAX_POSITION_MS);
      expect(sanitizePlaybackEvent({ type: 'skip', positionMs: 29_999.7 }).positionMs).toBe(29_999);
    });
  });

  describe('trackKey', () => {
    test('a key longer than the cap is absented, not truncated (a truncated key names a different recording)', () => {
      const long = `mbid:${'a'.repeat(MAX_TRACK_KEY_LENGTH)}`;
      expect(long.length).toBeGreaterThan(MAX_TRACK_KEY_LENGTH);
      expect(sanitizePlaybackEvent({ type: 'save', trackKey: long }).trackKey).toBeNull();
    });

    test.each([
      ['a non-string', 12345],
      ['an object', { key: 'mbid:x' }],
      ['an empty string', ''],
      ['whitespace', 'mbid: 9f4a'],
      ['a newline (log-injection shape)', 'mbid:9f4a\n[feedback] r=1'],
      ['a null byte', 'mbid:9f4a\u0000'],
      ['a trailing space', 'mbid:9f4a '],
    ])('absents %s', (_label, trackKey) => {
      expect(sanitizePlaybackEvent({ type: 'save', trackKey }).trackKey).toBeNull();
    });

    test('a non-CC0 key is ADMITTED here and refused downstream — this layer is shape, ADR-0012 is policy', () => {
      // Deliberate: the boundary must not become a second, drifting copy of the compliance gate.
      // `spotify:` keys reach the engine and are refused there and again at the repository.
      expect(sanitizePlaybackEvent({ type: 'save', trackKey: 'spotify:track:abc' }).trackKey).toBe('spotify:track:abc');
    });
  });
});

describe('playbackEvent — S7 per-socket rate limit', () => {
  const drain = (state, n, t0, stepMs = 1) => {
    let s = state;
    const verdicts = [];
    for (let i = 0; i < n; i++) {
      const out = admitPlaybackEvent(s, t0 + i * stepMs);
      s = out.state;
      verdicts.push(out.allowed);
    }
    return { state: s, verdicts };
  };

  test('admits up to the cap inside one window and refuses the next', () => {
    const { state, verdicts } = drain(createRateLimitState(), RATE_LIMIT_MAX, 1_000);
    expect(verdicts.every(Boolean)).toBe(true);
    expect(admitPlaybackEvent(state, 1_000 + RATE_LIMIT_MAX).allowed).toBe(false);
  });

  test('a REFUSED event does not extend the window — a flooder is not punished forever', () => {
    // The naive limiter records every arrival, so a client hammering the socket keeps its own
    // window permanently full and never recovers even after it stops.
    let { state } = drain(createRateLimitState(), RATE_LIMIT_MAX, 1_000);
    for (let i = 0; i < 500; i++) state = admitPlaybackEvent(state, 1_000 + i).state;
    expect(admitPlaybackEvent(state, 1_000 + RATE_LIMIT_WINDOW_MS).allowed).toBe(true);
  });

  test('the window slides — a paced client is never refused', () => {
    const { verdicts } = drain(createRateLimitState(), RATE_LIMIT_MAX * 4, 1_000, RATE_LIMIT_WINDOW_MS / RATE_LIMIT_MAX + 1);
    expect(verdicts.every(Boolean)).toBe(true);
  });

  test('the limiter state stays bounded under a sustained flood (S10: flat memory)', () => {
    let state = createRateLimitState();
    for (let i = 0; i < 5_000; i++) state = admitPlaybackEvent(state, 1_000 + i).state;
    expect(state.hits.length).toBeLessThanOrEqual(RATE_LIMIT_MAX);
  });

  test('is pure — the caller\'s state object is never mutated', () => {
    const state = createRateLimitState();
    const before = JSON.stringify(state);
    admitPlaybackEvent(state, 1_000);
    expect(JSON.stringify(state)).toBe(before);
  });

  test('a non-finite clock is refused rather than silently emptying the window', () => {
    const { state } = drain(createRateLimitState(), RATE_LIMIT_MAX, 1_000);
    expect(admitPlaybackEvent(state, NaN).allowed).toBe(false);
    expect(admitPlaybackEvent(state, undefined).allowed).toBe(false);
  });
});
