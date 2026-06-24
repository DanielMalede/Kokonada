import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { issueWatchToken, revokeWatchToken, fetchWatchStatus } from '../lib/api';

const BACKEND = 'http://localhost:5000';

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('watch API helpers', () => {
  it('issueWatchToken POSTs and returns the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ token: 'whr_abc' }) });
    vi.stubGlobal('fetch', fetchMock);

    const token = await issueWatchToken(BACKEND);

    expect(token).toBe('whr_abc');
    expect(fetchMock).toHaveBeenCalledWith(
      `${BACKEND}/api/integrations/watch/token`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('issueWatchToken throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(issueWatchToken(BACKEND)).rejects.toThrow();
  });

  it('revokeWatchToken DELETEs the token route', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: 'Watch disconnected' }) });
    vi.stubGlobal('fetch', fetchMock);

    await revokeWatchToken(BACKEND);

    expect(fetchMock).toHaveBeenCalledWith(
      `${BACKEND}/api/integrations/watch/token`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('fetchWatchStatus returns the parsed status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connected: true, lastSeenAt: '2026-06-24T17:00:00.000Z' }),
    }));

    const status = await fetchWatchStatus(BACKEND);
    expect(status).toEqual({ connected: true, lastSeenAt: '2026-06-24T17:00:00.000Z' });
  });
});
