import { ProfileController } from '../profileController';
import { wipeLocalSession, type SessionTeardownDeps } from '../sessionTeardown';
import { createCurrentUserStore } from '../../../auth/currentUser';

const okRes = (data: any) => ({ ok: true as const, data });
const errRes = (status?: number) => ({ ok: false as const, status, error: 'x' });

describe('ProfileController.loadProfile', () => {
  it('assembles /me + /integrations/status, tolerating a partial failure', async () => {
    const apiGet = jest.fn()
      .mockResolvedValueOnce(okRes({ id: 'u1', displayName: 'Dan', email: 'd@x.io' }))
      .mockResolvedValueOnce(errRes(500));
    const c = new ProfileController({ apiGet, apiPost: jest.fn(), apiDelete: jest.fn(), serverLogout: jest.fn(), clearLocal: jest.fn() } as any);
    const snap = await c.loadProfile();
    expect(snap.me?.displayName).toBe('Dan');
    expect(snap.integrations).toBeNull(); // degraded, not thrown
  });
});

describe('ProfileController.logout', () => {
  it('revokes server-side FIRST (best-effort), THEN wipes local state', async () => {
    const order: string[] = [];
    const serverLogout = jest.fn(async () => { order.push('server'); return okRes({}); });
    const clearLocal = jest.fn(async () => { order.push('local'); });
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete: jest.fn(), serverLogout, clearLocal } as any);
    await c.logout();
    expect(order).toEqual(['server', 'local']);
  });

  it('still wipes local even if the server logout fails (network down)', async () => {
    const clearLocal = jest.fn(async () => {});
    const serverLogout = jest.fn().mockRejectedValue(new Error('offline'));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete: jest.fn(), serverLogout, clearLocal } as any);
    await c.logout();
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });
});

describe('ProfileController.deleteAccount (SERVER-FIRST)', () => {
  it('wipes local ONLY after the server confirms erasure', async () => {
    const clearLocal = jest.fn(async () => {});
    const apiDelete = jest.fn().mockResolvedValue(okRes({ message: 'deleted' }));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete, serverLogout: jest.fn(), clearLocal } as any);
    const res = await c.deleteAccount();
    expect(res.ok).toBe(true);
    expect(apiDelete).toHaveBeenCalledWith('/api/auth/account');
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  it('on a failed delete: surfaces the error and does NOT wipe local (user stays signed in)', async () => {
    const clearLocal = jest.fn(async () => {});
    const apiDelete = jest.fn().mockResolvedValue(errRes(500));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete, serverLogout: jest.fn(), clearLocal } as any);
    const res = await c.deleteAccount();
    expect(res.ok).toBe(false);
    expect(clearLocal).not.toHaveBeenCalled();
  });
});

describe('ProfileController.getSpotifyConnectToken', () => {
  it('mints a single-use connect token via POST /connect-token', async () => {
    const apiPost = jest.fn().mockResolvedValue(okRes({ connectToken: 'ct-abc' }));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost, apiDelete: jest.fn(), serverLogout: jest.fn(), clearLocal: jest.fn() } as any);
    const ct = await c.getSpotifyConnectToken();
    expect(apiPost).toHaveBeenCalledWith('/api/integrations/connect-token');
    expect(ct).toBe('ct-abc');
  });

  it('returns null when the mint fails (so the screen opens no browser)', async () => {
    const apiPost = jest.fn().mockResolvedValue(errRes(401));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost, apiDelete: jest.fn(), serverLogout: jest.fn(), clearLocal: jest.fn() } as any);
    expect(await c.getSpotifyConnectToken()).toBeNull();
  });
});

describe('wipeLocalSession — safe ordering', () => {
  function spyDeps() {
    const calls: string[] = [];
    const rec = (name: string) => () => { calls.push(name); };
    const deps: SessionTeardownDeps = {
      disconnectSocket: rec('socket'),
      disposePlayer: rec('player'),
      clearAuthSession: rec('auth'),
      clearWatchToken: rec('watch'),
      clearLegacyToken: rec('legacy'),
      wipeColdPersistence: rec('cold'),
      resetWarm: rec('warm'),
      resetNowPlaying: rec('now'),
      resetPlaybackError: rec('err'),
      clearCurrentUser: rec('user'),
    };
    return { deps, calls };
  }

  it('severs the socket FIRST and drops the identity LAST', async () => {
    const { deps, calls } = spyDeps();
    await wipeLocalSession(deps);
    expect(calls[0]).toBe('socket');
    expect(calls[calls.length - 1]).toBe('user');
    expect(new Set(calls).size).toBe(10); // every step ran exactly once
  });

  it('a throwing step never blocks the remaining teardown (identity is still cleared)', async () => {
    const { deps, calls } = spyDeps();
    deps.wipeColdPersistence = () => { throw new Error('mmkv locked'); };
    await wipeLocalSession(deps);
    expect(calls).toContain('user'); // reached the end despite the mid-sequence throw
    expect(calls[0]).toBe('socket');
  });
});

describe('currentUser store', () => {
  it('holds and clears the logged-in identity', () => {
    const s = createCurrentUserStore();
    expect(s.getState().user).toBeNull();
    s.getState().setUser({ id: 'u1', displayName: 'Dan', email: 'd@x.io' });
    expect(s.getState().user?.id).toBe('u1');
    s.getState().clear();
    expect(s.getState().user).toBeNull();
  });
});
