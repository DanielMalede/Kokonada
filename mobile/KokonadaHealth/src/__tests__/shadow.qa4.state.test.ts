// ─────────────────────────────────────────────────────────────────────────────
// QA4 — AGENT Q3: CRYPTOGRAPHY & STATE (mobile surface)
// SecureStore's biometric denylist + fail-soft contract, ColdPersistence's
// detach-before-wipe ordering, the persist allowlist under a poisoned-blob corpus,
// and proof that no token ever reaches the persisted cold blob.
// ─────────────────────────────────────────────────────────────────────────────

import { configureStore } from '@reduxjs/toolkit';
import { SecureStore } from '../storage/secureStore';
import { ColdPersistence } from '../state/cold/coldPersistence';
import emotionReducer, {
  serializeForPersist, deserializeForPersist, setTextPrompt, addTap,
} from '../state/cold/emotionSlice';

function fakeBackend(overrides: any = {}) {
  const m = new Map<string, string>();
  return {
    encrypted: true,
    getString: (k: string) => m.get(k),
    set: (k: string, v: string) => { m.set(k, v); },
    delete: (k: string) => { m.delete(k); },
    getAllKeys: () => [...m.keys()],
    clearAll: () => m.clear(),
    _map: m,
    ...overrides,
  };
}
const reversibleCipher = { encrypt: (s: string) => `E(${s})`, decrypt: (s: string) => s.replace(/^E\(|\)$/g, '') };

describe('Q3 — SecureStore biometric denylist (raw HR can never reach disk)', () => {
  it.each(['bio:baseline', 'hr:latest', 'biometric:log', 'BIO:x', 'Hr:x', 'biometric :spaced'])(
    'refuses to persist forbidden key %p',
    (key) => {
      const s = new SecureStore({ backend: fakeBackend(), cipher: reversibleCipher });
      expect(s.setItem(key, '88')).toBe(false);
      expect(s.getItem(key)).toBeNull();
    },
  );

  it('DOCUMENTED gap: a namespaced key (cold:v1:bio:x) is NOT caught by the start-anchored denylist', () => {
    // ACCEPTED, not a live vuln: no code path ever constructs such a key (all persisted
    // keys are `cold.emotion.<userId>`). Pinned so any future change to the denylist
    // scope is a conscious decision, not an accident.
    const s = new SecureStore({ backend: fakeBackend(), cipher: reversibleCipher });
    expect(s.setItem('cold:v1:bio:x', 'v')).toBe(true);
  });

  it('refuses a non-encrypted backend outright', () => {
    expect(() => new SecureStore({ backend: fakeBackend({ encrypted: false }), cipher: reversibleCipher }))
      .toThrow(/encrypted/i);
  });

  it('is fail-soft: a throwing backend degrades to false/null, never throws', () => {
    const boom = fakeBackend({ set: () => { throw new Error('disk full'); }, getString: () => { throw new Error('io'); } });
    const s = new SecureStore({ backend: boom, cipher: reversibleCipher });
    expect(s.setItem('cold.emotion.u1', 'x')).toBe(false);
    expect(s.getItem('cold.emotion.u1')).toBeNull();
  });
});

describe('Q3 — ColdPersistence wipe ordering (zero bytes after logout)', () => {
  it('detaches the writer BEFORE resetting, so the reset dispatch cannot re-persist', () => {
    const store = configureStore({ reducer: { emotion: emotionReducer } });
    const backend = fakeBackend();
    const secure = new SecureStore({ backend, cipher: reversibleCipher });
    const cp = new ColdPersistence({ store, secure, getUserId: () => 'u1', throttleMs: 0 });
    cp.rehydrate();
    cp.attach();
    store.dispatch(setTextPrompt('leaving now'));
    expect(backend.getString('cold.emotion.u1')).toBeDefined(); // was persisted

    const setSpy = jest.spyOn(backend, 'set');
    cp.wipe();
    // clearAll happened; the resetEmotion dispatch must NOT have triggered another write.
    expect(setSpy).not.toHaveBeenCalled();
    expect(backend._map.size).toBe(0);
    expect(store.getState().emotion).toEqual({ taps: [], activity: null, textPrompt: '' });
  });

  it('a write for a logged-out user (no id) never spills to a global key', () => {
    const store = configureStore({ reducer: { emotion: emotionReducer } });
    const backend = fakeBackend();
    const secure = new SecureStore({ backend, cipher: reversibleCipher });
    const cp = new ColdPersistence({ store, secure, getUserId: () => null, throttleMs: 0 });
    cp.attach();
    store.dispatch(setTextPrompt('should not persist'));
    expect(backend._map.size).toBe(0);
    cp.detach();
  });
});

describe('Q3 — persist allowlist under a poisoned-blob corpus (never throws, always bounded)', () => {
  const validBlob = serializeForPersist({ taps: [{ x: 0.1, y: 0.2 }], activity: 'running', textPrompt: 'hi' });
  const corpus = [
    '', 'null', 'true', '42', '[]', '[1,2,3]', '{}', 'not json at all', '{"taps":',
    '{"__proto__":{"polluted":true}}',
    '{"taps":[{"x":"1e2","y":{}},{"x":1,"y":2}]}',
    JSON.stringify({ taps: Array.from({ length: 400 }, () => ({ x: 0, y: 0 })), activity: 'x', textPrompt: 'y' }),
    JSON.stringify({ accessToken: 'leak', isAdmin: true, taps: [], activity: null, textPrompt: '' }),
    validBlob.slice(0, 12), validBlob.slice(0, 20),
  ];

  it('yields a sanitized allowlist shape (or defaults) for every hostile blob', () => {
    for (const raw of corpus) {
      const out = deserializeForPersist(raw);
      expect(({} as any).polluted).toBeUndefined();     // no prototype pollution
      expect(Object.keys(out).every((k) => ['taps', 'activity', 'textPrompt'].includes(k))).toBe(true);
      if (out.taps) expect(out.taps.length).toBeLessThanOrEqual(3); // never grows past cap
      if ('activity' in out) expect(out.activity === null || typeof out.activity === 'string').toBe(true);
      expect((out as any).accessToken).toBeUndefined(); // foreign fields refused
      expect((out as any).isAdmin).toBeUndefined();
    }
  });
});

describe('Q3 — no token / secret ever reaches the persisted cold blob', () => {
  it('serializeForPersist projects ONLY taps/activity/textPrompt', () => {
    const stateWithJunk: any = {
      taps: [{ x: 0.5, y: 0.5 }], activity: 'focus', textPrompt: 'go',
      accessToken: 'secret', refresh: 'krt', liveHr: 88,
    };
    const parsed = JSON.parse(serializeForPersist(stateWithJunk));
    expect(Object.keys(parsed).sort()).toEqual(['activity', 'taps', 'textPrompt']);
    expect(JSON.stringify(parsed)).not.toMatch(/secret|krt|88/);
  });

  it('a sanitized textPrompt caps a 50k paste before it can be persisted', () => {
    const store = configureStore({ reducer: { emotion: emotionReducer } });
    store.dispatch(setTextPrompt('p'.repeat(50000)));
    for (let i = 0; i < 5; i++) store.dispatch(addTap({ x: 0, y: 0 }));
    const blob = serializeForPersist(store.getState().emotion);
    expect(JSON.parse(blob).textPrompt.length).toBeLessThanOrEqual(500);
    expect(JSON.parse(blob).taps.length).toBe(3);
  });
});
