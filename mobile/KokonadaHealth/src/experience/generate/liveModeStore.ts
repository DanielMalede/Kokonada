import { createStore } from 'zustand/vanilla';

// The dual-path preference (Part 2b): Manual (default) vs Live Biometric. It is a
// PERSISTED user choice, so it can't live in the ephemeral warmStore, and the cold
// emotionSlice is a sealed taps/activity/prompt contract — hence its own tiny store
// behind the KVBackend port (encrypted MMKV in prod, an in-memory fake in tests).
// Manual → mood/activity/prompt drives an on-the-fly generation. Live → HR band
// shifts drive auto-recalibration served from the precompiled buffer (Part 3).

export const LIVE_MODE_KEY = 'koko.liveMode';

interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface LiveModeState {
  liveMode: boolean;
  setLiveMode(on: boolean): void;
  hydrate(): void; // read the persisted value (call once after the KV backend is ready)
}

export function createLiveModeStore(kv?: KV) {
  return createStore<LiveModeState>((set) => ({
    liveMode: false,
    setLiveMode(on: boolean) {
      const v = !!on;
      set({ liveMode: v });
      try { kv?.set(LIVE_MODE_KEY, v ? '1' : '0'); } catch { /* persistence is best-effort */ }
    },
    hydrate() {
      try {
        const raw = kv?.getString(LIVE_MODE_KEY);
        if (raw != null) set({ liveMode: raw === '1' });
      } catch { /* a corrupt/unavailable store just keeps the default */ }
    },
  }));
}

// Prod singleton. The encrypted KV is created async at bootstrap, so the singleton
// reads/writes through a late-bound reference; bindLiveModeKV() attaches it + hydrates
// (mirrors coldPersistence). Until then it is an in-memory Manual default.
let _boundKv: KV | undefined;
export const liveModeStore = createLiveModeStore({
  getString: (k) => _boundKv?.getString(k),
  set: (k, v) => { _boundKv?.set(k, v); },
});
export function bindLiveModeKV(kv: KV): void {
  _boundKv = kv;
  liveModeStore.getState().hydrate();
}
