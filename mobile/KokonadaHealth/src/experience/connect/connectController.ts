import type { Availability } from '../../health/healthConnect';
import type { ApiResult } from '../../net/apiClient';
import type { ConsentStatus } from '../../health/consentApi';
import type { ConsentFlowDeps, ConsentFlowStore } from '../../health/consentStore';
import type { HealthSyncResult } from '../../health/healthSync';

// The §4 wearable connect flow, extracted off-React so its compliance invariant is unit-testable
// without the view (mirrors the profileController pattern; the eventual dedupe seam with
// ProfileScreen.onSyncHealth is logged as a follow-up — see plan D2). The rule it protects:
//
//   the OS Health Connect permission sheet (requestHealthPermissions) may run ONLY after the
//   §11 Art.9 consent wall confirms a server-acked CURRENT grant — and never when Health Connect
//   is unavailable, the platform is unsupported, or Android's deny-twice throttle fires.
//
// The controller does NOT re-implement the consent gate — it delegates to the REAL consentStore
// (createConsentFlow), returning the store for the view to present in the §11 wall. The OS sheet
// is reached only via that wall's onProceed → runSync(); decline / offline / background all leave
// the forward gate open (markResolved is never called), so the mood-only path stays intact.

export type WearableOutcome =
  | { kind: 'unsupported' } // non-Android → wearable presented unavailable, not a broken CTA
  | { kind: 'install-required' } // HC missing/outdated → route to install, no wall
  | { kind: 'consent'; store: ConsentFlowStore } // present the §11 wall (seeded, or fail-closed idle)
  | { kind: 'connected'; result: HealthSyncResult } // a wearable is linked; gate resolved
  | { kind: 'permission-blocked' } // deny-twice throttle → deep-link to HC, gate NOT resolved
  | { kind: 'sync-failed'; result: HealthSyncResult }; // linked (gate resolved) but the upload failed

export interface ConnectControllerDeps {
  checkAvailability: () => Promise<Availability>;
  fetchConsentStatus: () => Promise<ApiResult<ConsentStatus>>;
  grantConsent: () => Promise<ApiResult<ConsentStatus>>;
  requestHealthPermissions: () => Promise<unknown[]>;
  syncMedicalProfile: (deps?: { minIntervalMs?: number }) => Promise<HealthSyncResult>;
  createConsentFlow: (deps: ConsentFlowDeps) => ConsentFlowStore;
  markResolved: () => void;
}

export interface ConnectController {
  // Entry: availability pre-check → current-grant short-circuit → present the §11 wall.
  begin(): Promise<WearableOutcome>;
  // Reached ONLY from the §11 wall's onProceed (a server-acked grant) or the invisible
  // short-circuit: request the OS sheet, resolve the gate on a real grant, then sync.
  runSync(): Promise<WearableOutcome>;
}

export function createConnectController(deps: ConnectControllerDeps): ConnectController {
  async function runSync(): Promise<WearableOutcome> {
    const granted = await deps.requestHealthPermissions();
    if (!Array.isArray(granted) || granted.length === 0) {
      // Android's deny-twice throttle suppresses the sheet (resolves []). NOT a connection —
      // the gate stays open; the view deep-links the user into Health Connect's own screen.
      return { kind: 'permission-blocked' };
    }
    // A wearable is now linked (a real permission grant). Satisfy the forward gate BEFORE the
    // sync — a transient upload failure must not un-connect an already-granted wearable.
    deps.markResolved();
    const result = await deps.syncMedicalProfile({ minIntervalMs: 0 });
    if (result.synced || result.reason === 'no-data') return { kind: 'connected', result };
    return { kind: 'sync-failed', result };
  }

  async function begin(): Promise<WearableOutcome> {
    const avail = await deps.checkAvailability();
    if (avail === 'unsupported') return { kind: 'unsupported' };
    if (avail !== 'available') return { kind: 'install-required' };

    const status = await deps.fetchConsentStatus();
    // A current, non-stale grant short-circuits straight to the OS sheet — invisible for an
    // already-consented user (no wall re-shown).
    if (status.ok && status.data.granted && !status.data.staleVersion) return runSync();

    // Otherwise present the §11 wall. Seed it from the fetched status when we have one; on an
    // offline/failed read leave it UNSEEDED (idle) so the store fails closed via its own check()
    // — an unknown consent state must never read as "proceed".
    const store = deps.createConsentFlow({ fetchStatus: deps.fetchConsentStatus, grant: deps.grantConsent });
    if (status.ok) store.getState().hydrate(status.data);
    return { kind: 'consent', store };
  }

  return { begin, runSync };
}
