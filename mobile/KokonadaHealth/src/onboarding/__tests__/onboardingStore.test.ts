// The WARM-lane one-shot "has the user seen onboarding?" flag. Unlike raw biometrics
// (never persisted), this IS a persisted device preference — so, like liveModeStore, it
// lives behind the KVBackend port (encrypted MMKV in prod, an in-memory fake here). Its
// defining property: markSeen() is ONE-WAY. Once true it stays true forever — that is the
// contract the App route machine leans on so a LOGOUT lands on Sign-in, never Onboarding.

import { createOnboardingStore, onboardingStore, bindOnboardingKV, ONBOARDING_SEEN_KEY } from '../onboardingStore';

interface FakeKV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  __map: Map<string, string>;
}
function makeKV(seed?: Record<string, string>): FakeKV {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return { __map: map, getString: (k) => map.get(k), set: (k, v) => { map.set(k, v); } };
}

describe('onboardingStore — one-shot persisted seen flag', () => {
  it('starts unseen (a fresh install shows onboarding)', () => {
    const s = createOnboardingStore(makeKV());
    expect(s.getState().seen).toBe(false);
  });

  it('markSeen flips seen true AND persists "1" under the namespaced key', () => {
    const kv = makeKV();
    const s = createOnboardingStore(kv);
    s.getState().markSeen();
    expect(s.getState().seen).toBe(true);
    expect(kv.__map.get(ONBOARDING_SEEN_KEY)).toBe('1');
  });

  it('markSeen is ONE-WAY — there is no unset/reset surface (stays true forever)', () => {
    const s = createOnboardingStore(makeKV());
    s.getState().markSeen();
    const api = s.getState() as Record<string, unknown>;
    expect(typeof api.markSeen).toBe('function');
    expect(api.unsee).toBeUndefined();
    expect(api.reset).toBeUndefined();
    expect(api.clear).toBeUndefined();
    // calling markSeen again is idempotent, never regresses to false
    s.getState().markSeen();
    expect(s.getState().seen).toBe(true);
  });

  it('hydrate reads a persisted "1" into seen=true (a returning, logged-out user skips onboarding)', () => {
    const s = createOnboardingStore(makeKV({ [ONBOARDING_SEEN_KEY]: '1' }));
    expect(s.getState().seen).toBe(false); // not yet hydrated
    s.getState().hydrate();
    expect(s.getState().seen).toBe(true);
  });

  it('hydrate treats a missing or "0" value as unseen', () => {
    const missing = createOnboardingStore(makeKV());
    missing.getState().hydrate();
    expect(missing.getState().seen).toBe(false);
    const zero = createOnboardingStore(makeKV({ [ONBOARDING_SEEN_KEY]: '0' }));
    zero.getState().hydrate();
    expect(zero.getState().seen).toBe(false);
  });

  it('a throwing KV never crashes hydrate/markSeen — persistence is best-effort', () => {
    const brittle = {
      getString: () => { throw new Error('mmkv unavailable'); },
      set: () => { throw new Error('disk full'); },
    };
    const s = createOnboardingStore(brittle);
    expect(() => s.getState().hydrate()).not.toThrow();
    expect(() => s.getState().markSeen()).not.toThrow();
    expect(s.getState().seen).toBe(true); // in-memory flip still happened
  });
});

describe('onboardingStore — bound prod singleton', () => {
  it('bindOnboardingKV attaches the late-bound KV and hydrates the singleton once', () => {
    const kv = makeKV({ [ONBOARDING_SEEN_KEY]: '1' });
    expect(onboardingStore.getState().seen).toBe(false);
    bindOnboardingKV(kv);
    expect(onboardingStore.getState().seen).toBe(true);
    // and a subsequent markSeen writes through the bound KV
    onboardingStore.getState().markSeen();
    expect(kv.__map.get(ONBOARDING_SEEN_KEY)).toBe('1');
  });
});
