import { createConnectController, type ConnectControllerDeps } from '../connectController';
import { createConsentFlow } from '../../../health/consentStore';

// The wearable connect flow (T6), extracted off-React so its ONE compliance invariant is unit
// tested without the view: the OS Health Connect permission sheet (requestHealthPermissions) is
// NEVER reached until AFTER a server-acked current consent grant — and never at all if Health
// Connect is unavailable, the platform is unsupported, or the deny-twice throttle fires. The
// controller delegates the §11 gate to the REAL consentStore (createConsentFlow) — it must never
// re-implement that invariant. Decline / offline / background are all penalty-free (resolved stays
// false, the mood-only path is untouched).

const okStatus = (over: Record<string, unknown> = {}) =>
  ({ ok: true as const, data: { granted: false, currentVersion: 1, staleVersion: false, ...over } });

function makeDeps(over: Partial<ConnectControllerDeps> = {}) {
  const markResolved = jest.fn();
  const requestHealthPermissions = jest.fn().mockResolvedValue([{ recordType: 'HeartRate', accessType: 'read' }]);
  const syncMedicalProfile = jest.fn().mockResolvedValue({ synced: true, counts: { heartRate: 3, hrv: 0, sleep: 0, restingHeartRate: 0 } });
  const deps: ConnectControllerDeps = {
    checkAvailability: jest.fn().mockResolvedValue('available'),
    fetchConsentStatus: jest.fn().mockResolvedValue(okStatus()),
    grantConsent: jest.fn().mockResolvedValue(okStatus({ granted: true })),
    requestHealthPermissions,
    syncMedicalProfile,
    createConsentFlow,
    markResolved,
    ...over,
  };
  return { deps, markResolved, requestHealthPermissions, syncMedicalProfile };
}

describe('connectController — the wearable connect flow', () => {
  it('unsupported platform (non-Android) → "unsupported", never touches consent or the OS sheet', async () => {
    const { deps, markResolved, requestHealthPermissions } = makeDeps({ checkAvailability: jest.fn().mockResolvedValue('unsupported') });
    const outcome = await createConnectController(deps).begin();
    expect(outcome.kind).toBe('unsupported');
    expect(deps.fetchConsentStatus).not.toHaveBeenCalled();
    expect(requestHealthPermissions).not.toHaveBeenCalled();
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('Health Connect unavailable → "install-required", no consent wall, resolved stays false', async () => {
    const { deps, markResolved, requestHealthPermissions } = makeDeps({ checkAvailability: jest.fn().mockResolvedValue('install-required') });
    const outcome = await createConnectController(deps).begin();
    expect(outcome.kind).toBe('install-required');
    expect(deps.fetchConsentStatus).not.toHaveBeenCalled();
    expect(requestHealthPermissions).not.toHaveBeenCalled();
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('no current consent → presents the §11 wall (real consentStore at consent_required), OS sheet stays shut', async () => {
    const { deps, markResolved, requestHealthPermissions } = makeDeps();
    const outcome = await createConnectController(deps).begin();
    expect(outcome.kind).toBe('consent');
    if (outcome.kind !== 'consent') throw new Error('unreachable');
    expect(outcome.store.getState().flow).toBe('consent_required'); // seeded from the fetched status
    expect(requestHealthPermissions).not.toHaveBeenCalled(); // NOT until a grant
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('a STALE grant (granted but at an older consent version) re-opens the §11 wall — never the OS sheet directly', async () => {
    // Art.9 re-consent guard: when CONSENT_SCREEN_VERSION bumps past a prior grant, granted:true is
    // NOT a current grant. The short-circuit is `granted && !staleVersion`, so a stale grant must fall
    // to the wall (consent_stale), NOT invisibly open the OS sheet. Pins the `!staleVersion` clause so
    // a mutation dropping it cannot stay green.
    const { deps, markResolved, requestHealthPermissions } = makeDeps({ fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: true, staleVersion: true })) });
    const outcome = await createConnectController(deps).begin();
    expect(outcome.kind).toBe('consent');
    if (outcome.kind !== 'consent') throw new Error('unreachable');
    expect(outcome.store.getState().flow).toBe('consent_stale'); // re-confirm framing, not a short-circuit
    expect(requestHealthPermissions).not.toHaveBeenCalled(); // the OS sheet stays shut until a fresh grant
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('offline during the status read → still presents the wall UNSEEDED; the real store fails closed to submit_error', async () => {
    const { deps, requestHealthPermissions, markResolved } = makeDeps({ fetchConsentStatus: jest.fn().mockResolvedValue({ ok: false, error: 'offline' }) });
    const outcome = await createConnectController(deps).begin();
    expect(outcome.kind).toBe('consent');
    if (outcome.kind !== 'consent') throw new Error('unreachable');
    // Unseeded (idle) — a fail-closed store, NOT a mistaken "ready". The wall's own check() will
    // resolve it to submit_error against the offline fetch; the OS sheet never opens.
    expect(outcome.store.getState().flow).toBe('idle');
    await outcome.store.getState().check();
    expect(outcome.store.getState().flow).toBe('submit_error');
    expect(requestHealthPermissions).not.toHaveBeenCalled();
    expect(markResolved).not.toHaveBeenCalled();
  });

  it('already-consented (current grant) → invisible short-circuit: OS sheet + sync run, resolved marked', async () => {
    const { deps, markResolved, requestHealthPermissions, syncMedicalProfile } = makeDeps({ fetchConsentStatus: jest.fn().mockResolvedValue(okStatus({ granted: true })) });
    const outcome = await createConnectController(deps).begin();
    expect(outcome.kind).toBe('connected');
    expect(requestHealthPermissions).toHaveBeenCalledTimes(1);
    expect(markResolved).toHaveBeenCalledTimes(1);
    expect(syncMedicalProfile).toHaveBeenCalledWith({ minIntervalMs: 0 });
  });

  it('runSync deny-twice throttle (permissions resolve []) → "permission-blocked", resolved NOT marked, no sync', async () => {
    const { deps, markResolved, syncMedicalProfile } = makeDeps({ requestHealthPermissions: jest.fn().mockResolvedValue([]) });
    const outcome = await createConnectController(deps).runSync();
    expect(outcome.kind).toBe('permission-blocked');
    expect(markResolved).not.toHaveBeenCalled(); // no grant → no wearable → gate stays open
    expect(syncMedicalProfile).not.toHaveBeenCalled();
  });

  it('runSync granted-but-no-data → still "connected" (a wearable IS linked; data may arrive later), resolved marked', async () => {
    const { deps, markResolved } = makeDeps({ syncMedicalProfile: jest.fn().mockResolvedValue({ synced: false, reason: 'no-data' }) });
    const outcome = await createConnectController(deps).runSync();
    expect(outcome.kind).toBe('connected');
    expect(markResolved).toHaveBeenCalledTimes(1);
  });

  it('runSync granted but the upload FAILS (offline) → "sync-failed" — the grant still resolved the gate', async () => {
    const { deps, markResolved } = makeDeps({ syncMedicalProfile: jest.fn().mockResolvedValue({ synced: false, reason: 'error', error: 'network' }) });
    const outcome = await createConnectController(deps).runSync();
    expect(outcome.kind).toBe('sync-failed');
    // The permission WAS granted (a wearable is connected) — the transient upload failure does not
    // un-connect it, so the forward gate is honestly satisfied.
    expect(markResolved).toHaveBeenCalledTimes(1);
  });
});
