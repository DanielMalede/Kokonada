// ─────────────────────────────────────────────────────────────────────────────
// SHADOW AUDIT — Sprint A11 (mobile). Cross-cutting attacks on the new REST surface,
// the account-deletion teardown, and the pulse store under a foreground storm.
// ─────────────────────────────────────────────────────────────────────────────

import { ApiClient } from '../net/apiClient';
import { ProfileController } from '../experience/profile/profileController';
import { createPulseStateStore } from '../experience/pulse/pulseStateStore';
import { SessionsFeed } from '../experience/history/sessionsFeed';

const jsonRes = (body: any, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('A11 shadow — apiClient cannot loop on a persistently-401 endpoint', () => {
  it('refreshes ONCE and retries ONCE; a still-401 retry returns {ok:false}, no storm', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonRes({}, 401))  // initial
      .mockResolvedValueOnce(jsonRes({}, 401)); // retry (fresh token still rejected)
    const refresh = jest.fn().mockResolvedValue('acc-2');
    const client = new ApiClient({ baseUrl: 'https://x', getAccessToken: () => 'acc-1', refresh, fetchImpl: fetchImpl as any });
    const res = await client.get('/api/pulse/state');
    expect(res.ok).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);     // never a second refresh
    expect(fetchImpl).toHaveBeenCalledTimes(2);    // original + exactly one retry
  });
});

describe('A11 shadow — account deletion teardown', () => {
  const okDelete = () => Promise.resolve({ ok: true as const, data: {} });

  it('SERVER-FIRST: a failed delete leaves the session fully intact (no local wipe)', async () => {
    const clearLocal = jest.fn(async () => {});
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete: async () => ({ ok: false, status: 503, error: 'down' }), serverLogout: jest.fn(), clearLocal } as any);
    const res = await c.deleteAccount();
    expect(res.ok).toBe(false);
    expect(clearLocal).not.toHaveBeenCalled();
  });

  it('is idempotent — re-running the teardown after a confirmed delete never throws', async () => {
    let wipes = 0;
    const clearLocal = jest.fn(async () => { wipes += 1; }); // wipeLocalSession is best-effort/idempotent
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete: okDelete, serverLogout: jest.fn(), clearLocal } as any);
    await c.deleteAccount();
    await c.deleteAccount(); // e.g. a killed-then-relaunched double action
    expect(wipes).toBe(2);
  });

  it('logout revokes server-side even when the network is down, then still wipes local', async () => {
    const order: string[] = [];
    const c = new ProfileController({
      apiGet: jest.fn(), apiPost: jest.fn(),
      apiDelete: jest.fn(),
      serverLogout: async () => { order.push('server'); throw new Error('offline'); },
      clearLocal: async () => { order.push('local'); },
    } as any);
    await c.logout();
    expect(order).toEqual(['server', 'local']);
  });
});

describe('A11 shadow — pulse store under a foreground storm', () => {
  it('10 concurrent refreshes (rapid AppState flaps) fire exactly ONE fetch', async () => {
    let calls = 0;
    let resolve!: (v: any) => void;
    const store = createPulseStateStore(() => { calls += 1; return new Promise((r) => { resolve = r; }); });
    // Fire all 10 synchronously WITHOUT awaiting — the first sets loading and holds the
    // one in-flight fetch; the other 9 are single-flighted away by the loading guard.
    const pending = Array.from({ length: 10 }, () => store.getState().refresh());
    expect(calls).toBe(1);
    resolve({ ok: true, data: null });
    await Promise.all(pending);
  });
});

describe('A11 shadow — history feed racing a logout', () => {
  it('a 401 mid-pagination surfaces cleanly with no retry loop and no partial state', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ ok: false, status: 401, error: 'unauthorized' });
    const feed = new SessionsFeed(fetchPage);
    await feed.loadMore();
    await feed.loadMore();
    await feed.refresh();
    expect(feed.getState().items).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(3); // each a deliberate action, never an auto-retry storm
    expect(feed.getState().reachedEnd).toBe(false);
  });
});
