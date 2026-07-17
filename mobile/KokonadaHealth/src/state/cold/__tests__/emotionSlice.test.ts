// The cold lane holds COMMITTED user intent — the ≤3-tap emotion payload, the
// activity, and the free-text prompt. It is the only lane that persists across
// restarts. Its persist transform is a hard allowlist: biometrics can never enter
// the persisted blob, and a tampered/old blob can never inject extra fields.

import reducer, {
  addTap, setActivity, setTextPrompt, hydrate, resetEmotion, undoTap, clearTaps,
  serializeForPersist, deserializeForPersist,
  type EmotionState,
} from '../emotionSlice';

const initial: EmotionState = reducer(undefined, { type: '@@INIT' });

describe('emotionSlice — committed intent', () => {
  it('starts empty', () => {
    expect(initial).toEqual({ taps: [], activity: null, textPrompt: '' });
  });

  it('addTap appends circumplex coordinates', () => {
    const s = reducer(initial, addTap({ x: 0.5, y: -0.2 }));
    expect(s.taps).toEqual([{ x: 0.5, y: -0.2 }]);
  });

  it('caps the tap ring buffer at 3, dropping the oldest (≤3-tap contract)', () => {
    let s = initial;
    for (const x of [0.1, 0.2, 0.3, 0.4]) s = reducer(s, addTap({ x, y: 0 }));
    expect(s.taps).toHaveLength(3);
    expect(s.taps.map((t) => t.x)).toEqual([0.2, 0.3, 0.4]); // oldest (0.1) evicted
  });

  it('setActivity and re-selecting to null toggle activity', () => {
    let s = reducer(initial, setActivity('running'));
    expect(s.activity).toBe('running');
    s = reducer(s, setActivity(null));
    expect(s.activity).toBeNull();
  });

  it('setTextPrompt stores the free-text vibe', () => {
    const s = reducer(initial, setTextPrompt('rainy sunday'));
    expect(s.textPrompt).toBe('rainy sunday');
  });

  it('resetEmotion clears everything (logout)', () => {
    let s = reducer(initial, addTap({ x: 1, y: 1 }));
    s = reducer(s, setActivity('working'));
    s = reducer(s, setTextPrompt('focus'));
    expect(reducer(s, resetEmotion())).toEqual(initial);
  });
});

describe('emotionSlice — undoTap / clearTaps (§5 quiet, forgiving remove — never resetEmotion)', () => {
  it('undoTap pops the most-recent tap only', () => {
    let s = initial;
    for (const x of [0.1, 0.2, 0.3]) s = reducer(s, addTap({ x, y: 0 }));
    s = reducer(s, undoTap());
    expect(s.taps).toEqual([{ x: 0.1, y: 0 }, { x: 0.2, y: 0 }]); // 0.3 removed
  });

  it('undoTap on an empty tap list is a no-op (never underflows)', () => {
    const s = reducer(initial, undoTap());
    expect(s.taps).toEqual([]);
    expect(s).toEqual(initial);
  });

  it('three addTap then two undoTap leaves only the first', () => {
    let s = initial;
    for (const x of [0.1, 0.2, 0.3]) s = reducer(s, addTap({ x, y: 0 }));
    s = reducer(s, undoTap());
    s = reducer(s, undoTap());
    expect(s.taps).toEqual([{ x: 0.1, y: 0 }]);
  });

  it('undoTap preserves the activity and the text prompt (it is NOT resetEmotion)', () => {
    let s = reducer(initial, setActivity('running'));
    s = reducer(s, setTextPrompt('rainy'));
    s = reducer(s, addTap({ x: 0.4, y: 0.4 }));
    s = reducer(s, undoTap());
    expect(s.taps).toEqual([]);
    expect(s.activity).toBe('running');
    expect(s.textPrompt).toBe('rainy');
  });

  it('clearTaps empties ONLY the taps, preserving activity and prompt (≠ resetEmotion)', () => {
    let s = initial;
    for (const x of [0.1, 0.2, 0.3]) s = reducer(s, addTap({ x, y: 0 }));
    s = reducer(s, setActivity('focus'));
    s = reducer(s, setTextPrompt('deep work'));
    const cleared = reducer(s, clearTaps());
    expect(cleared).toEqual({ taps: [], activity: 'focus', textPrompt: 'deep work' });
    // and it is distinct from resetEmotion, which wipes activity + prompt too (logout/rehydrate)
    expect(reducer(s, resetEmotion())).toEqual({ taps: [], activity: null, textPrompt: '' });
  });

  it('undoTap / clearTaps can only SHRINK the ≤3-tap buffer — never grow it past the cap', () => {
    let s = initial;
    for (const x of [0.1, 0.2, 0.3, 0.4]) s = reducer(s, addTap({ x, y: 0 }));
    expect(s.taps).toHaveLength(3);
    s = reducer(s, undoTap());
    expect(s.taps).toHaveLength(2);
    s = reducer(s, clearTaps());
    expect(s.taps).toHaveLength(0);
  });

  it('undoTap returns a fresh taps array (aliasing-safe — no shared mutable reference)', () => {
    let s = initial;
    for (const x of [0.1, 0.2]) s = reducer(s, addTap({ x, y: 0 }));
    const before = s.taps;
    const after = reducer(s, undoTap()).taps;
    expect(after).not.toBe(before);      // new reference
    expect(before).toHaveLength(2);      // prior snapshot untouched
  });
});

describe('emotionSlice — persist allowlist (biometrics can never persist)', () => {
  it('serializes only taps/activity/textPrompt', () => {
    const state: EmotionState = { taps: [{ x: 0.1, y: 0.2 }], activity: 'running', textPrompt: 'go' };
    const parsed = JSON.parse(serializeForPersist(state));
    expect(Object.keys(parsed).sort()).toEqual(['activity', 'taps', 'textPrompt']);
  });

  it('deserialize strips ANY field outside the allowlist (tampered blob defense)', () => {
    const poisoned = JSON.stringify({
      taps: [{ x: 0, y: 0 }],
      activity: 'resting',
      textPrompt: 'ok',
      heartRate: 88,          // injected biometric
      liveHr: 91,             // injected biometric
      __proto__: { admin: true },
      isPremium: true,        // privilege injection
    });
    const out = deserializeForPersist(poisoned);
    expect(Object.keys(out).sort()).toEqual(['activity', 'taps', 'textPrompt']);
    expect((out as any).heartRate).toBeUndefined();
    expect((out as any).liveHr).toBeUndefined();
    expect((out as any).isPremium).toBeUndefined();
  });

  it('hydrate merges a persisted partial back into state', () => {
    const s = reducer(initial, hydrate({ taps: [{ x: 0.9, y: 0.9 }], activity: 'dancing', textPrompt: 'hype' }));
    expect(s).toEqual({ taps: [{ x: 0.9, y: 0.9 }], activity: 'dancing', textPrompt: 'hype' });
  });

  it('deserialize returns empty intent for garbage/corrupt JSON (never throws)', () => {
    expect(deserializeForPersist('%%%not json%%%')).toEqual({});
    expect(deserializeForPersist('null')).toEqual({});
    expect(deserializeForPersist('[1,2,3]')).toEqual({});
    expect(deserializeForPersist('')).toEqual({});
  });

  it('deserialize coerces a malformed taps field to a safe empty array', () => {
    const out = deserializeForPersist(JSON.stringify({ taps: 'not-an-array', activity: 5, textPrompt: {} }));
    expect(out.taps).toEqual([]);
    expect(out.activity).toBeNull();     // non-string coerced
    expect(out.textPrompt).toBe('');     // non-string coerced
  });

  it('deserialize hard-caps an oversized persisted taps array at 3', () => {
    const out = deserializeForPersist(JSON.stringify({ taps: Array.from({ length: 50 }, (_, i) => ({ x: i, y: i })) }));
    expect(out.taps).toHaveLength(3);
  });
});
