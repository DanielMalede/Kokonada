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

describe('ProfileController.disconnectYouTube', () => {
  it('calls DELETE /youtube/disconnect and returns the rebuild summary', async () => {
    const apiDelete = jest.fn().mockResolvedValue(okRes({ rebuilt: true, provider: 'spotify', library: 240 }));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete, serverLogout: jest.fn(), clearLocal: jest.fn() } as any);
    const res = await c.disconnectYouTube();
    expect(apiDelete).toHaveBeenCalledWith('/api/integrations/youtube/disconnect');
    expect(res).toEqual(okRes({ rebuilt: true, provider: 'spotify', library: 240 }));
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
      resetLiveMode: rec('liveMode'), // D-9 — persisted Live/Manual preference reset to Manual
      clearCurrentUser: rec('user'),
    };
    return { deps, calls };
  }

  it('severs the socket FIRST and drops the identity LAST', async () => {
    const { deps, calls } = spyDeps();
    await wipeLocalSession(deps);
    expect(calls[0]).toBe('socket');
    expect(calls[calls.length - 1]).toBe('user');
    expect(new Set(calls).size).toBe(11); // every step ran exactly once
  });

  it('D-9: resets the Live/Manual preference to Manual — the step before dropping identity', async () => {
    // Pins resetLiveMode so a removal of the D-9 step (which would leave next login on Live) is
    // caught. It must run just before clearCurrentUser (a persisted '0' → next login is Manual).
    const { deps, calls } = spyDeps();
    await wipeLocalSession(deps);
    expect(calls).toContain('liveMode');
    expect(calls[calls.length - 2]).toBe('liveMode');
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

// HX-2 M8: Disconnect Spotify is SERVER-FIRST, like account deletion. The device stops playing and
// forgets the queue only once the server has confirmed the erasure; a failed call leaves the user
// connected and playing, because they still are.
describe('ProfileController.disconnectSpotify (SERVER-FIRST)', () => {
  it('calls DELETE /api/integrations/spotify/disconnect, THEN clears local playback', async () => {
    const order: string[] = [];
    const apiDelete = jest.fn(async (path: string) => { order.push(`server ${path}`); return okRes({ message: 'Spotify disconnected' }); });
    const clearSpotifyPlayback = jest.fn(async () => { order.push('local'); });
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete, serverLogout: jest.fn(), clearLocal: jest.fn(), clearSpotifyPlayback } as any);

    const res = await c.disconnectSpotify();

    expect(res.ok).toBe(true);
    expect(order).toEqual(['server /api/integrations/spotify/disconnect', 'local']);
  });

  it('on a failed call: returns the error and leaves local playback alone', async () => {
    const clearSpotifyPlayback = jest.fn(async () => {});
    const apiDelete = jest.fn().mockResolvedValue(errRes(500));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete, serverLogout: jest.fn(), clearLocal: jest.fn(), clearSpotifyPlayback } as any);

    const res = await c.disconnectSpotify();

    expect(res.ok).toBe(false);
    expect(clearSpotifyPlayback).not.toHaveBeenCalled();
  });

  it('never signs the user out (a disconnect is not a logout)', async () => {
    const clearLocal = jest.fn(async () => {});
    const apiDelete = jest.fn().mockResolvedValue(okRes({ message: 'Spotify disconnected' }));
    const c = new ProfileController({ apiGet: jest.fn(), apiPost: jest.fn(), apiDelete, serverLogout: jest.fn(), clearLocal, clearSpotifyPlayback: jest.fn(async () => {}) } as any);

    await c.disconnectSpotify();

    expect(clearLocal).not.toHaveBeenCalled();
  });
});

describe('teardownSpotifyPlayback — safe ordering', () => {
  const { teardownSpotifyPlayback } = require('../spotifyTeardown');
  function recorders() {
    const calls: string[] = [];
    const rec = (name: string) => () => { calls.push(name); };
    return {
      calls,
      deps: { disposePlayer: rec('player'), clearQueue: rec('queue'), resetNowPlaying: rec('now'), markDisconnected: rec('status') },
    };
  }

  it('stops the player FIRST (audio and remote), then the queue, Now Playing, and the status last', async () => {
    const { deps, calls } = recorders();
    await teardownSpotifyPlayback(deps);
    expect(calls).toEqual(['player', 'queue', 'now', 'status']);
  });

  it('a throwing step never blocks the rest (the status still reads disconnected)', async () => {
    const { deps, calls } = recorders();
    deps.disposePlayer = () => { throw new Error('remote already gone'); };
    await teardownSpotifyPlayback(deps);
    expect(calls).toEqual(['queue', 'now', 'status']);
  });
});

// HX-2 round 1 (B1): the Profile reload is where the app learns that the account is linked to
// Spotify again (after an OAuth reconnect). That lifts the playback suspension Disconnect set.
describe('ProfileController.loadProfile — lifts the Spotify-disconnect suspension (B1)', () => {
  const deps = (over: Record<string, unknown> = {}) => ({
    apiGet: jest.fn(), apiPost: jest.fn(), apiDelete: jest.fn(), serverLogout: jest.fn(), clearLocal: jest.fn(),
    clearSpotifyPlayback: jest.fn(async () => {}), onSpotifyLinked: jest.fn(), ...over,
  });
  const statusGet = (spotifyConnected: boolean | undefined, ok = true) => jest.fn(async (path: string) => (
    path === '/api/auth/me' ? okRes({ id: 'u1' }) : ok ? okRes({ spotifyConnected }) : errRes(500)));

  it('the server reports Spotify linked → onSpotifyLinked, once', async () => {
    const d = deps({ apiGet: statusGet(true) });
    await new ProfileController(d as any).loadProfile();
    expect(d.onSpotifyLinked).toHaveBeenCalledTimes(1);
  });

  it.each([[false], [undefined]])('spotifyConnected=%p → no resume', async (v) => {
    const d = deps({ apiGet: statusGet(v as any) });
    await new ProfileController(d as any).loadProfile();
    expect(d.onSpotifyLinked).not.toHaveBeenCalled();
  });

  it('a failed status read → no resume (fail closed)', async () => {
    const d = deps({ apiGet: statusGet(true, false) });
    await new ProfileController(d as any).loadProfile();
    expect(d.onSpotifyLinked).not.toHaveBeenCalled();
  });

  it('a reload that STARTED before a successful disconnect cannot resume after it (stale status)', async () => {
    let releaseStatus!: () => void;
    const apiGet = jest.fn((path: string) => (path === '/api/auth/me'
      ? Promise.resolve(okRes({ id: 'u1' }))
      : new Promise((r) => { releaseStatus = () => r(okRes({ spotifyConnected: true })); })));
    const apiDelete = jest.fn(async () => okRes({ message: 'Spotify disconnected' }));
    const d = deps({ apiGet, apiDelete });
    const c = new ProfileController(d as any);

    const staleReload = c.loadProfile();      // status read in flight: the server still says linked
    await c.disconnectSpotify();              // …the disconnect completes first
    releaseStatus();
    await staleReload;

    expect(d.onSpotifyLinked).not.toHaveBeenCalled();
  });
});
