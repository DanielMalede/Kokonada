import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ApiResult } from '../../net/apiClient';
import type { WatchPairing, WatchStatus } from '../../health/watchPairingClient';

// T1 — the §10 Garmin watch PAIRING-CODE state machine (audit L-15). A tiny, framework-free store
// so the flow and its ONE hard invariant are unit-testable without React:
//
//   the store may hold ONLY the ephemeral 6-digit pairing code — never the long-lived whr_ device
//   token. That token is minted server-side and handed to the WATCH via the exchange endpoint; it
//   is never fetched, stored, or rendered on this client.
//
//   not_connected → generating → code_shown(code,expiresAt) → connected | expired | error
//
// The card owns the wall-clock timers (a 1s countdown + a status poll while a code is shown) and
// drives the store through poll()/checkExpiry(); the store stays pure and deterministic. `now` is
// injected so expiry is testable without fake timers.

export type WatchPairingPhase = 'not_connected' | 'generating' | 'code_shown' | 'connected' | 'expired' | 'error';

export interface WatchPairingDeps {
  requestPairing: () => Promise<ApiResult<WatchPairing>>;
  fetchStatus: () => Promise<ApiResult<WatchStatus>>;
  revoke: () => Promise<ApiResult<{ message: string }>>;
  // Forget the phone's cached whr_ on a RE-PAIR (revoke already clears it via the client). The
  // phone-BLE live-HR path holds a whr_ for the SAME single server slot, so a re-pair must not
  // leave a stale phone token behind — live-HR re-mints lazily on the next startLiveHr (D2-i).
  clearToken: () => Promise<void>;
  now: () => number;
}

export interface WatchPairingState {
  phase: WatchPairingPhase;
  code: string | null;      // the ephemeral pairing code ONLY — never a whr_ token
  expiresAt: number | null; // epoch ms
  lastSeenAt: string | null;
  hydrate(): Promise<void>;      // on mount: reflect an already-connected watch
  setUp(): Promise<void>;        // mint a pairing code (single-flight); a re-pair clears the phone token first
  poll(): Promise<void>;         // while a code is shown: has the watch exchanged it yet?
  checkExpiry(): void;           // TTL reached → expire and clear the code
  cancel(): void;                // dismiss the code
  disconnect(): Promise<void>;   // revoke the slot (+ phone token) → not_connected
}

const cleared = { code: null as string | null, expiresAt: null as number | null } as const;

export function createWatchPairingFlow(deps: WatchPairingDeps): StoreApi<WatchPairingState> {
  return createStore<WatchPairingState>((set, get) => ({
    phase: 'not_connected',
    code: null,
    expiresAt: null,
    lastSeenAt: null,

    async hydrate() {
      const res = await deps.fetchStatus();
      if (res.ok && res.data.connected) set({ phase: 'connected', lastSeenAt: res.data.lastSeenAt, ...cleared });
    },

    async setUp() {
      if (get().phase === 'generating') return; // single-flight — ignore a double tap
      const repair = get().phase === 'connected';
      set({ phase: 'generating' });
      // Re-pair: the fresh exchange will overwrite the server slot, so the phone's cached whr_ for
      // the old slot must be forgotten now (it re-mints lazily). A first-time set-up no-ops safely.
      if (repair) await deps.clearToken();
      const res = await deps.requestPairing();
      // Guard the parse: a malformed ISO → NaN, which would make checkExpiry (now >= NaN === false)
      // never fire — a never-expiring code — and render "Expires in NaNs". Fail closed to error.
      const expiresAt = res.ok ? Date.parse(res.data.expiresAt) : NaN;
      if (res.ok && Number.isFinite(expiresAt)) set({ phase: 'code_shown', code: res.data.code, expiresAt });
      else set({ phase: 'error', ...cleared });
    },

    async poll() {
      if (get().phase !== 'code_shown') return;
      const res = await deps.fetchStatus();
      if (res.ok && res.data.connected) set({ phase: 'connected', lastSeenAt: res.data.lastSeenAt, ...cleared });
    },

    checkExpiry() {
      const { phase, expiresAt } = get();
      if (phase === 'code_shown' && expiresAt != null && deps.now() >= expiresAt) {
        set({ phase: 'expired', ...cleared });
      }
    },

    cancel() {
      set({ phase: 'not_connected', ...cleared });
    },

    async disconnect() {
      const res = await deps.revoke(); // the client also clears the phone's cached whr_
      if (res.ok) set({ phase: 'not_connected', lastSeenAt: null, ...cleared });
    },
  }));
}

export type WatchPairingStore = StoreApi<WatchPairingState>;
