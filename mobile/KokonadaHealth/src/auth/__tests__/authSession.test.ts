// KokonadaSocket needs a SYNCHRONOUS getAccessToken(), but the Kokonada session
// tokens live in the async Keychain. AuthSession bridges that: it loads tokens into
// memory once at bootstrap, hands out the access token synchronously, and refreshes
// via the backend's rotating-refresh endpoint. Concurrent refresh calls (the socket
// auth_expired path racing an HTTP 401) must collapse into a SINGLE in-flight
// request so a token can't be double-rotated and its family burned.

import { AuthSession } from '../authSession';

function build(overrides: any = {}) {
  const stored = { value: 'stored' in overrides ? overrides.stored : { access: 'access-1', refresh: 'krt-1' } };
  const saved: Array<{ access: string; refresh: string } | null> = [];
  const deps = {
    loadTokens: jest.fn(async () => stored.value),
    saveTokens: jest.fn(async (t: any) => { saved.push(t); stored.value = t; }),
    clearTokens: jest.fn(async () => { stored.value = null; }),
    refreshEndpoint: overrides.refreshEndpoint
      ?? jest.fn(async (_refresh: string) => ({ access: 'access-2', refresh: 'krt-2' })),
  };
  const session = new AuthSession(deps);
  return { session, deps, saved, stored };
}

describe('AuthSession — bootstrap & sync access', () => {
  it('loads tokens from storage and exposes the access token synchronously', async () => {
    const { session } = build();
    expect(session.getAccessToken()).toBeNull(); // nothing loaded yet
    expect(await session.bootstrap()).toBe(true);
    expect(session.getAccessToken()).toBe('access-1'); // now synchronous
  });

  it('bootstrap with no stored tokens leaves the session logged out', async () => {
    const { session } = build({ stored: null });
    expect(await session.bootstrap()).toBe(false);
    expect(session.getAccessToken()).toBeNull();
  });
});

describe('AuthSession — refresh (rotating token)', () => {
  it('rotates the token, updates the in-memory access, and persists the new pair', async () => {
    const { session, deps, saved } = build();
    await session.bootstrap();
    const next = await session.refresh();
    expect(next).toBe('access-2');
    expect(session.getAccessToken()).toBe('access-2');
    expect(deps.refreshEndpoint).toHaveBeenCalledWith('krt-1');
    expect(saved[saved.length - 1]).toEqual({ access: 'access-2', refresh: 'krt-2' });
  });

  it('a failed refresh (revoked family) clears the session and returns null', async () => {
    const refreshEndpoint = jest.fn(async () => null); // 401 from /auth/refresh
    const { session, deps } = build({ refreshEndpoint });
    await session.bootstrap();
    expect(await session.refresh()).toBeNull();
    expect(session.getAccessToken()).toBeNull();
    expect(deps.clearTokens).toHaveBeenCalled();
  });

  it('SINGLE-FLIGHT: concurrent refresh calls hit the endpoint exactly once', async () => {
    let resolveIt: (v: any) => void = () => {};
    const refreshEndpoint = jest.fn(() => new Promise((r) => { resolveIt = r; }));
    const { session, deps } = build({ refreshEndpoint });
    await session.bootstrap();

    const a = session.refresh();
    const b = session.refresh();
    const c = session.refresh();
    resolveIt({ access: 'access-9', refresh: 'krt-9' });
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    expect(deps.refreshEndpoint).toHaveBeenCalledTimes(1); // not rotated 3×
    expect([ra, rb, rc]).toEqual(['access-9', 'access-9', 'access-9']);
    expect(session.getAccessToken()).toBe('access-9');
  });

  it('refresh without a stored refresh token returns null without calling the endpoint', async () => {
    const { session, deps } = build({ stored: null });
    await session.bootstrap();
    expect(await session.refresh()).toBeNull();
    expect(deps.refreshEndpoint).not.toHaveBeenCalled();
  });

  it('FUZZ: a refresh endpoint that throws is treated as a failed refresh, never propagates', async () => {
    const refreshEndpoint = jest.fn(async () => { throw new Error('network down'); });
    const { session } = build({ refreshEndpoint });
    await session.bootstrap();
    await expect(session.refresh()).resolves.toBeNull();
    expect(session.getAccessToken()).toBeNull();
  });
});

describe('AuthSession — logout', () => {
  it('clear() wipes memory and storage', async () => {
    const { session, deps } = build();
    await session.bootstrap();
    await session.clear();
    expect(session.getAccessToken()).toBeNull();
    expect(deps.clearTokens).toHaveBeenCalled();
  });

  it('setSession installs a fresh pair after login (used by the login flow)', async () => {
    const { session, deps } = build({ stored: null });
    await session.bootstrap();
    await session.setSession({ access: 'login-access', refresh: 'login-krt' });
    expect(session.getAccessToken()).toBe('login-access');
    expect(deps.saveTokens).toHaveBeenCalledWith({ access: 'login-access', refresh: 'login-krt' });
  });
});
