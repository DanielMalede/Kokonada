import { createStore } from 'zustand/vanilla';
import type { ApiResult } from '../net/apiClient';
import type { ConsentStatus } from './consentApi';

// The Art.9 consent-wall state machine (audit H-9). A tiny, framework-free store so the flow —
// and the ONE compliance-critical invariant it protects — is unit-tested without React:
//
//   the OS Health Connect sheet may open ONLY after the server acks a CURRENT, non-stale grant.
//
// The store never opens the OS sheet itself; it only exposes the flow. The ConsentSheet reads
// `flow` and calls its onProceed callback (→ requestHealthPermissions) EXCLUSIVELY on the two
// server-acked terminal states, `ready` (an existing current grant) and `granted_ack` (a fresh
// 201 echo). Every other state — including submitting_grant and submit_error — keeps the OS
// sheet shut. A failed grant NEVER flips local state to granted.

export type ConsentFlow =
  | 'idle'
  | 'checking'
  | 'ready'            // server-acked current grant → short-circuit straight to the OS sheet
  | 'consent_required' // no record → first-time presentation
  | 'consent_stale'    // granted at an older version → re-confirm framing
  | 'submitting_grant' // POST in flight — both buttons locked, OS sheet stays shut
  | 'granted_ack'      // 201 echoed a current grant → the ONLY grant path to the OS sheet
  | 'submit_error'     // status read or grant POST failed → inline error + Retry, OS sheet shut
  | 'declined';        // user declined — no POST, mood-only path stays intact

export interface ConsentFlowDeps {
  fetchStatus: () => Promise<ApiResult<ConsentStatus>>;
  grant: () => Promise<ApiResult<ConsentStatus>>;
}

export interface ConsentFlowState {
  flow: ConsentFlow;
  status: ConsentStatus | null;
  // Seed the flow from a status the caller already fetched (avoids a redundant round trip when
  // ProfileScreen has just checked to decide short-circuit vs. show-the-wall).
  hydrate(status: ConsentStatus): void;
  check(): Promise<void>;
  submitGrant(): Promise<void>;
  decline(): void;
  retry(): Promise<void>;
}

// A granted, current status short-circuits; a granted-but-stale one re-prompts; anything else is
// a first-time presentation. This is the single mapping the gate trusts.
function flowForStatus(s: ConsentStatus): ConsentFlow {
  if (s.granted && !s.staleVersion) return 'ready';
  if (s.granted && s.staleVersion) return 'consent_stale';
  return 'consent_required';
}

export function createConsentFlow(deps: ConsentFlowDeps) {
  // What a Retry should repeat — set by whichever async action last ran.
  let pendingRetry: 'check' | 'grant' = 'check';

  return createStore<ConsentFlowState>((set, get) => ({
    flow: 'idle',
    status: null,

    hydrate(status: ConsentStatus) {
      set({ status, flow: flowForStatus(status) });
    },

    async check() {
      pendingRetry = 'check';
      set({ flow: 'checking' });
      const res = await deps.fetchStatus();
      if (!res.ok) {
        // Unknown consent state must NEVER read as "proceed" — fail closed to the error state.
        set({ flow: 'submit_error' });
        return;
      }
      set({ status: res.data, flow: flowForStatus(res.data) });
    },

    async submitGrant() {
      pendingRetry = 'grant';
      set({ flow: 'submitting_grant' });
      const res = await deps.grant();
      if (!res.ok) {
        // A failed/offline grant leaves `status` untouched — it does not flip to granted.
        set({ flow: 'submit_error' });
        return;
      }
      // Trust ONLY a server echo that confirms a current, non-stale grant (the backend echoes the
      // canonical status on the 201, so the POST response IS the re-check — no second GET).
      if (res.data.granted && !res.data.staleVersion) {
        set({ status: res.data, flow: 'granted_ack' });
      } else {
        set({ flow: 'submit_error' });
      }
    },

    decline() {
      set({ flow: 'declined' });
    },

    async retry() {
      if (pendingRetry === 'grant') return get().submitGrant();
      return get().check();
    },
  }));
}

export type ConsentFlowStore = ReturnType<typeof createConsentFlow>;
