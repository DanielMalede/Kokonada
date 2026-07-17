import { createConsentFlow } from '../consentStore';
import type { ConsentStatus } from '../consentApi';

const status = (over: Partial<ConsentStatus> = {}): ConsentStatus => ({
  granted: false,
  currentVersion: 1,
  staleVersion: false,
  ...over,
});

function makeFlow(over: {
  fetchStatus?: jest.Mock;
  grant?: jest.Mock;
} = {}) {
  const fetchStatus = over.fetchStatus ?? jest.fn().mockResolvedValue({ ok: true, data: status() });
  const grant = over.grant ?? jest.fn().mockResolvedValue({ ok: true, data: status({ granted: true }) });
  const store = createConsentFlow({ fetchStatus, grant });
  return { store, fetchStatus, grant };
}

describe('consentStore (Art.9 consent flow state machine)', () => {
  it('starts idle', () => {
    expect(makeFlow().store.getState().flow).toBe('idle');
  });

  describe('hydrate — seed the flow from an already-fetched status (no network)', () => {
    it('granted + current → ready (short-circuit; the wall is never shown)', () => {
      const { store } = makeFlow();
      store.getState().hydrate(status({ granted: true, staleVersion: false }));
      expect(store.getState().flow).toBe('ready');
    });

    it('not granted → consent_required (first-time presentation)', () => {
      const { store } = makeFlow();
      store.getState().hydrate(status({ granted: false }));
      expect(store.getState().flow).toBe('consent_required');
    });

    it('granted + stale → consent_stale (re-confirm framing)', () => {
      const { store } = makeFlow();
      store.getState().hydrate(status({ granted: true, staleVersion: true }));
      expect(store.getState().flow).toBe('consent_stale');
    });
  });

  describe('check — hydrates from GET /status for each of the 3 status combinations', () => {
    it('resolves granted+current → ready', async () => {
      const { store, fetchStatus } = makeFlow({
        fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: status({ granted: true }) }),
      });
      await store.getState().check();
      expect(fetchStatus).toHaveBeenCalledTimes(1);
      expect(store.getState().flow).toBe('ready');
    });

    it('resolves not-granted → consent_required', async () => {
      const { store } = makeFlow({
        fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: status({ granted: false }) }),
      });
      await store.getState().check();
      expect(store.getState().flow).toBe('consent_required');
    });

    it('resolves granted+stale → consent_stale', async () => {
      const { store } = makeFlow({
        fetchStatus: jest.fn().mockResolvedValue({ ok: true, data: status({ granted: true, staleVersion: true }) }),
      });
      await store.getState().check();
      expect(store.getState().flow).toBe('consent_stale');
    });

    it('a failed/offline status read → submit_error (NEVER a silent proceed)', async () => {
      const { store } = makeFlow({
        fetchStatus: jest.fn().mockResolvedValue({ ok: false, error: 'network error' }),
      });
      await store.getState().check();
      expect(store.getState().flow).toBe('submit_error');
      expect(store.getState().status?.granted).not.toBe(true);
    });
  });

  describe('submitGrant — POST then re-derive the flow from the echoed status', () => {
    it('201 echo {granted:true, staleVersion:false} → granted_ack with granted status', async () => {
      const grant = jest.fn().mockResolvedValue({ ok: true, data: status({ granted: true }) });
      const { store } = makeFlow({ grant });
      store.getState().hydrate(status({ granted: false }));
      await store.getState().submitGrant();
      expect(grant).toHaveBeenCalledTimes(1);
      expect(store.getState().flow).toBe('granted_ack');
      expect(store.getState().status?.granted).toBe(true);
    });

    it('a failed/offline grant does NOT flip local state to granted (stays not-granted, submit_error)', async () => {
      const grant = jest.fn().mockResolvedValue({ ok: false, error: 'network error' });
      const { store } = makeFlow({ grant });
      store.getState().hydrate(status({ granted: false }));
      await store.getState().submitGrant();
      expect(store.getState().flow).toBe('submit_error');
      expect(store.getState().status?.granted).not.toBe(true);
    });

    it('a 201 that does NOT echo a current grant is treated as an error (never granted_ack)', async () => {
      const grant = jest.fn().mockResolvedValue({ ok: true, data: status({ granted: true, staleVersion: true }) });
      const { store } = makeFlow({ grant });
      store.getState().hydrate(status({ granted: false }));
      await store.getState().submitGrant();
      expect(store.getState().flow).toBe('submit_error');
    });

    it('locks into submitting_grant while the POST is in flight', async () => {
      let release!: (v: unknown) => void;
      const grant = jest.fn().mockReturnValue(new Promise((r) => { release = r; }));
      const { store } = makeFlow({ grant });
      store.getState().hydrate(status({ granted: false }));
      const p = store.getState().submitGrant();
      expect(store.getState().flow).toBe('submitting_grant');
      release({ ok: true, data: status({ granted: true }) });
      await p;
      expect(store.getState().flow).toBe('granted_ack');
    });
  });

  describe('retry — repeats whichever action failed', () => {
    it('after a failed check, retry re-runs the status read', async () => {
      const fetchStatus = jest.fn()
        .mockResolvedValueOnce({ ok: false, error: 'network error' })
        .mockResolvedValueOnce({ ok: true, data: status({ granted: false }) });
      const { store } = makeFlow({ fetchStatus });
      await store.getState().check();
      expect(store.getState().flow).toBe('submit_error');
      await store.getState().retry();
      expect(fetchStatus).toHaveBeenCalledTimes(2);
      expect(store.getState().flow).toBe('consent_required');
    });

    it('after a failed grant, retry re-POSTs the grant', async () => {
      const grant = jest.fn()
        .mockResolvedValueOnce({ ok: false, error: 'network error' })
        .mockResolvedValueOnce({ ok: true, data: status({ granted: true }) });
      const { store } = makeFlow({ grant });
      store.getState().hydrate(status({ granted: false }));
      await store.getState().submitGrant();
      expect(store.getState().flow).toBe('submit_error');
      await store.getState().retry();
      expect(grant).toHaveBeenCalledTimes(2);
      expect(store.getState().flow).toBe('granted_ack');
    });
  });

  it('decline moves to declined without any network call', () => {
    const { store, grant } = makeFlow();
    store.getState().hydrate(status({ granted: false }));
    store.getState().decline();
    expect(store.getState().flow).toBe('declined');
    expect(grant).not.toHaveBeenCalled();
  });
});
