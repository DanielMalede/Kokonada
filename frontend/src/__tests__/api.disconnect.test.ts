import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { disconnectProvider, logout, getToken, setToken } from '../lib/api';

const BACKEND = 'http://localhost:5000';

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('disconnectProvider', () => {
  it.each([
    ['spotify', `${BACKEND}/api/integrations/spotify/disconnect`],
    ['youtube', `${BACKEND}/api/integrations/youtube/disconnect`],
    ['garmin', `${BACKEND}/api/integrations/garmin/disconnect`],
  ] as const)('DELETEs the %s disconnect route', async (provider, url) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'disconnected' }) });
    vi.stubGlobal('fetch', fetchMock);

    await disconnectProvider(BACKEND, provider);

    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: 'DELETE' }));
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(disconnectProvider(BACKEND, 'spotify')).rejects.toThrow();
  });
});

describe('logout', () => {
  it('POSTs to the logout route and clears the stored token', async () => {
    setToken('koko-jwt-123');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Logged out successfully' }) });
    vi.stubGlobal('fetch', fetchMock);

    await logout(BACKEND);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BACKEND}/api/auth/logout`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(getToken()).toBeNull(); // session token cleared locally
  });

  it('still clears the token even if the server logout call fails', async () => {
    setToken('koko-jwt-123');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    await logout(BACKEND); // must not throw — local sign-out always succeeds

    expect(getToken()).toBeNull();
  });
});
