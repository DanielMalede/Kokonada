import { createStore } from 'zustand/vanilla';

// The §4 Connect Services forward-gate flags (Decision 2 = A). Like onboardingStore, these
// are PERSISTED device preferences behind the KVBackend port (encrypted MMKV in prod, an
// in-memory fake in tests) — not warm biometric state, not the per-user cold slice.
//
// Two facts, both PER-userId so a shared device never leaks account A's choice to account B:
//   • resolved — the AppFlow routing gate: has this account, on this device, finished (or
//                escaped) Connect Services? Set by BOTH the mood-only path and a successful
//                wearable connect. One-way (there is no unresolve surface).
//   • moodOnly — the account chose the mood-only path (implies resolved). Distinguished from
//                resolved so the screen can honestly say "you're in mood-only mode".
//
// Unlike the cold slice these keys are NOT under the `cold.` prefix, so they survive logout's
// cold wipe — Connect state is a per-DEVICE-per-ACCOUNT preference, keyed by userId. A new
// account (or a returning account on a fresh install, whose Health-Connect grant is per-device)
// correctly re-sees Connect. Persistence is best-effort and never throws into render.

export const CONNECT_KEY_PREFIX = 'koko.connect';
export const resolvedKey = (uid: string): string => `${CONNECT_KEY_PREFIX}.${uid}.resolved`;
export const moodOnlyKey = (uid: string): string => `${CONNECT_KEY_PREFIX}.${uid}.moodOnly`;

interface KV {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

export interface ConnectState {
  resolved: boolean;
  moodOnly: boolean;
  markResolved(): void; // one-way: satisfies the forward gate (wearable-connect path)
  setMoodOnly(): void; // one-way: mood-only path (also satisfies the gate)
  hydrate(): void; // read the persisted flags for the CURRENT account (call after identity is known)
}

export function createConnectStore(kv?: KV, getUserId?: () => string | null) {
  return createStore<ConnectState>((set) => ({
    resolved: false,
    moodOnly: false,

    markResolved() {
      set({ resolved: true });
      const uid = getUserId?.();
      if (!uid) return; // no identity yet → in-memory only, nothing to key persistence on
      try { kv?.set(resolvedKey(uid), '1'); } catch { /* persistence is best-effort */ }
    },

    setMoodOnly() {
      set({ moodOnly: true, resolved: true });
      const uid = getUserId?.();
      if (!uid) return;
      try {
        kv?.set(moodOnlyKey(uid), '1');
        kv?.set(resolvedKey(uid), '1');
      } catch { /* persistence is best-effort */ }
    },

    hydrate() {
      const uid = getUserId?.();
      // No identity → defaults (also resets in-memory state so a prior account cannot bleed
      // through to the next one on the same device).
      if (!uid) { set({ resolved: false, moodOnly: false }); return; }
      try {
        const r = kv?.getString(resolvedKey(uid));
        const m = kv?.getString(moodOnlyKey(uid));
        set({ resolved: r === '1', moodOnly: m === '1' });
      } catch { set({ resolved: false, moodOnly: false }); }
    },
  }));
}

// Prod singleton. The encrypted KV + identity are known only at/after bootstrap, so the
// singleton reads/writes through late-bound references; bindConnectKV() attaches them and
// hydrates for the current account (mirrors onboardingStore/liveModeStore). Until bound it
// is an in-memory unresolved default.
let _boundKv: KV | undefined;
let _getUserId: (() => string | null) | undefined;
export const connectStore = createConnectStore(
  { getString: (k) => _boundKv?.getString(k), set: (k, v) => { _boundKv?.set(k, v); } },
  () => _getUserId?.() ?? null,
);
export function bindConnectKV(kv: KV, getUserId: () => string | null): void {
  _boundKv = kv;
  _getUserId = getUserId;
  connectStore.getState().hydrate();
}
