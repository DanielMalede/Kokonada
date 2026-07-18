import { createWatchPairingFlow, type WatchPairingDeps } from '../watchPairingStore';

// T1 — the §10 watch pairing state machine (audit L-15). A framework-free store so the flow and
// its ONE hard invariant are unit-tested without React:
//   not_connected → generating → code_shown(code,expiresAt) → connected | expired | error
// The store NEVER surfaces a whr_ device token — it only ever holds the ephemeral pairing code.

const CODE = { code: '123456', expiresAt: '2026-01-01T00:05:00.000Z' };
const EXPIRES_MS = Date.parse(CODE.expiresAt);
const BEFORE = EXPIRES_MS - 1000;
const AFTER = EXPIRES_MS + 1000;

function makeDeps(over: Partial<WatchPairingDeps> = {}): WatchPairingDeps {
  return {
    requestPairing: jest.fn().mockResolvedValue({ ok: true, data: CODE }),
    fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: false, lastSeenAt: null } }),
    revoke: jest.fn().mockResolvedValue({ ok: true, data: { message: 'Watch disconnected' } }),
    clearToken: jest.fn().mockResolvedValue(undefined),
    now: () => BEFORE,
    ...over,
  };
}

describe('watchPairingStore', () => {
  it('starts not_connected with no code', () => {
    const store = createWatchPairingFlow(makeDeps());
    expect(store.getState().phase).toBe('not_connected');
    expect(store.getState().code).toBeNull();
  });

  it('setUp mints and shows the 6-digit code + expiry, going generating → code_shown', async () => {
    const store = createWatchPairingFlow(makeDeps());
    await store.getState().setUp();
    expect(store.getState().phase).toBe('code_shown');
    expect(store.getState().code).toBe('123456');
    expect(store.getState().expiresAt).toBe(EXPIRES_MS);
  });

  it('setUp is single-flight — a second call while generating does not double-request', async () => {
    let resolve!: (v: unknown) => void;
    const requestPairing = jest.fn().mockImplementation(() => new Promise((r) => { resolve = r; }));
    const store = createWatchPairingFlow(makeDeps({ requestPairing }));
    const p1 = store.getState().setUp();
    expect(store.getState().phase).toBe('generating');
    const p2 = store.getState().setUp(); // ignored — already in flight
    resolve({ ok: true, data: CODE });
    await Promise.all([p1, p2]);
    expect(requestPairing).toHaveBeenCalledTimes(1);
  });

  it('setUp on a failed mint goes to error, not code_shown', async () => {
    const store = createWatchPairingFlow(makeDeps({ requestPairing: jest.fn().mockResolvedValue({ ok: false, error: 'offline' }) }));
    await store.getState().setUp();
    expect(store.getState().phase).toBe('error');
    expect(store.getState().code).toBeNull();
  });

  it('rejects a malformed (non-finite) expiry rather than showing a never-expiring code', async () => {
    // A bad ISO → Date.parse → NaN → checkExpiry (now >= NaN) is always false → the code would
    // never expire and the card would render "Expires in NaNs". Fail closed to error instead.
    const store = createWatchPairingFlow(makeDeps({
      requestPairing: jest.fn().mockResolvedValue({ ok: true, data: { code: '123456', expiresAt: 'not-a-date' } }),
    }));
    await store.getState().setUp();
    expect(store.getState().phase).toBe('error');
    expect(store.getState().code).toBeNull();
    expect(store.getState().expiresAt).toBeNull();
  });

  it('checkExpiry auto-expires the code at its TTL and clears it', async () => {
    const store = createWatchPairingFlow(makeDeps({ now: () => AFTER }));
    await store.getState().setUp();
    store.getState().checkExpiry();
    expect(store.getState().phase).toBe('expired');
    expect(store.getState().code).toBeNull();
  });

  it('checkExpiry leaves a still-valid code shown', async () => {
    const store = createWatchPairingFlow(makeDeps({ now: () => BEFORE }));
    await store.getState().setUp();
    store.getState().checkExpiry();
    expect(store.getState().phase).toBe('code_shown');
  });

  it('poll flips to connected when the watch has exchanged the code', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: '2026-01-01T00:01:00.000Z' } });
    const store = createWatchPairingFlow(makeDeps({ fetchStatus }));
    await store.getState().setUp();
    await store.getState().poll();
    expect(store.getState().phase).toBe('connected');
    expect(store.getState().lastSeenAt).toBe('2026-01-01T00:01:00.000Z');
  });

  it('poll does nothing when not showing a code', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: null } });
    const store = createWatchPairingFlow(makeDeps({ fetchStatus }));
    await store.getState().poll(); // phase is not_connected
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(store.getState().phase).toBe('not_connected');
  });

  it('hydrate reflects an already-connected watch on mount', async () => {
    const fetchStatus = jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: '2026-01-01T00:02:00.000Z' } });
    const store = createWatchPairingFlow(makeDeps({ fetchStatus }));
    await store.getState().hydrate();
    expect(store.getState().phase).toBe('connected');
  });

  it('cancel clears the code and returns to not_connected', async () => {
    const store = createWatchPairingFlow(makeDeps());
    await store.getState().setUp();
    store.getState().cancel();
    expect(store.getState().phase).toBe('not_connected');
    expect(store.getState().code).toBeNull();
  });

  it('disconnect revokes (which clears the phone whr_) and returns to not_connected', async () => {
    const revoke = jest.fn().mockResolvedValue({ ok: true, data: { message: 'Watch disconnected' } });
    const store = createWatchPairingFlow(makeDeps({ revoke, fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: null } }) }));
    await store.getState().hydrate();
    expect(store.getState().phase).toBe('connected');
    await store.getState().disconnect();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(store.getState().phase).toBe('not_connected');
  });

  it('re-pair (setUp while connected) clears the stale phone whr_ before minting a fresh code', async () => {
    const clearToken = jest.fn().mockResolvedValue(undefined);
    const store = createWatchPairingFlow(makeDeps({ clearToken, fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: null } }) }));
    await store.getState().hydrate();
    expect(store.getState().phase).toBe('connected');
    await store.getState().setUp(); // re-pair
    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(store.getState().phase).toBe('code_shown');
  });

  it('NEVER surfaces a whr_ token anywhere in its observable state — even if the server leaks one', async () => {
    // ADVERSARIAL: the mint/status payloads carry an extra whr_ device-token field. The store must
    // copy ONLY code/expiresAt/lastSeenAt — a naive spread of res.data would land the token in
    // state and this guard would (correctly) fail. Today it must not.
    const LEAK = 'whr_LEAKED_must_never_surface';
    const store = createWatchPairingFlow(makeDeps({
      requestPairing: jest.fn().mockResolvedValue({ ok: true, data: { ...CODE, token: LEAK, deviceToken: LEAK } }),
      fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: null, token: LEAK } }),
    }));
    await store.getState().setUp();
    await store.getState().poll();
    const serialisable = { ...store.getState() };
    // Drop the action functions; assert the DATA the store exposes is whr_-free.
    for (const k of Object.keys(serialisable)) {
      if (typeof (serialisable as Record<string, unknown>)[k] === 'function') delete (serialisable as Record<string, unknown>)[k];
    }
    expect(JSON.stringify(serialisable)).not.toContain('whr_');
  });
});
