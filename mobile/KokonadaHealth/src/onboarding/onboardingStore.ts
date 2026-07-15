import { createStore } from 'zustand/vanilla';

// The one-shot "has this device seen the FTUE?" flag. It is a PERSISTED device
// preference, not ephemeral biometric state, so — exactly like liveModeStore — it lives
// behind the KVBackend port (encrypted MMKV in prod, an in-memory fake in tests) rather
// than in the never-persisted warmStore or the per-user cold slice.
//
// The defining invariant: markSeen() is ONE-WAY. Once true it stays true forever; there
// is deliberately NO unset/reset. The App route machine relies on this so a LOGOUT
// resolves to Sign-in, never back to Onboarding, and so logout teardown never has to
// (and never does) wipe it.

export const ONBOARDING_SEEN_KEY = 'koko.onboarding.seen';

interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface OnboardingState {
  seen: boolean;
  markSeen(): void;
  hydrate(): void; // read the persisted value (call once after the KV backend is ready)
}

export function createOnboardingStore(kv?: KV) {
  return createStore<OnboardingState>((set) => ({
    seen: false,
    markSeen() {
      set({ seen: true });
      try { kv?.set(ONBOARDING_SEEN_KEY, '1'); } catch { /* persistence is best-effort */ }
    },
    hydrate() {
      try {
        const raw = kv?.getString(ONBOARDING_SEEN_KEY);
        if (raw != null) set({ seen: raw === '1' });
      } catch { /* a corrupt/unavailable store just keeps the default (unseen) */ }
    },
  }));
}

// Prod singleton. The encrypted KV is created async at bootstrap, so the singleton
// reads/writes through a late-bound reference; bindOnboardingKV() attaches it + hydrates
// (mirrors liveModeStore/coldPersistence). Until then it is an in-memory `unseen` default.
let _boundKv: KV | undefined;
export const onboardingStore = createOnboardingStore({
  getString: (k) => _boundKv?.getString(k),
  set: (k, v) => { _boundKv?.set(k, v); },
});
export function bindOnboardingKV(kv: KV): void {
  _boundKv = kv;
  onboardingStore.getState().hydrate();
}
