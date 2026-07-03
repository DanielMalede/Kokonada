// The cold lane holds COMMITTED user intent — the ≤3-tap emotion payload, the
// activity, and the free-text prompt. It is the only lane that persists across
// restarts. Its persist transform is a hard allowlist: biometrics can never enter
// the persisted blob, and a tampered/old blob can never inject extra fields.

import reducer, {
  addTap, setActivity, setTextPrompt, hydrate, resetEmotion,
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
