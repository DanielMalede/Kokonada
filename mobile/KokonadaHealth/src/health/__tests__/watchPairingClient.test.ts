import { apiGet, apiPost, apiDelete } from '../../net/apiClient';
import { clearWatchToken } from '../liveHrClient';
import { requestWatchPairing, fetchWatchStatus, revokeWatchPairing } from '../watchPairingClient';

// T0 — the §10 watch pairing REST seam. It uses the shared apiClient (auth + 401-refresh),
// NEVER raw fetch, and mints ONLY the ephemeral pairing code — the long-lived whr_ device token
// is never fetched/rendered here (audit L-15). Revoking additionally forgets the phone's cached
// whr_ (liveHrClient Keychain slot) so a stale phone token can't outlive the revoked server slot.

jest.mock('../../net/apiClient', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));
jest.mock('../liveHrClient', () => ({ clearWatchToken: jest.fn().mockResolvedValue(undefined) }));

const mockGet = apiGet as jest.Mock;
const mockPost = apiPost as jest.Mock;
const mockDelete = apiDelete as jest.Mock;
const mockClear = clearWatchToken as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockPost.mockResolvedValue({ ok: true, data: { code: '123456', expiresAt: '2026-01-01T00:05:00.000Z' } });
  mockGet.mockResolvedValue({ ok: true, data: { connected: false, lastSeenAt: null } });
  mockDelete.mockResolvedValue({ ok: true, data: { message: 'Watch disconnected' } });
});

describe('watchPairingClient', () => {
  it('requestWatchPairing POSTs the pairing-code mint endpoint and returns { code, expiresAt }', async () => {
    const res = await requestWatchPairing();
    expect(mockPost).toHaveBeenCalledWith('/api/integrations/watch/pair');
    expect(res).toEqual({ ok: true, data: { code: '123456', expiresAt: '2026-01-01T00:05:00.000Z' } });
  });

  it('fetchWatchStatus GETs the status endpoint and returns { connected, lastSeenAt }', async () => {
    mockGet.mockResolvedValue({ ok: true, data: { connected: true, lastSeenAt: '2026-01-01T00:00:00.000Z' } });
    const res = await fetchWatchStatus();
    expect(mockGet).toHaveBeenCalledWith('/api/integrations/watch/status');
    expect(res).toEqual({ ok: true, data: { connected: true, lastSeenAt: '2026-01-01T00:00:00.000Z' } });
  });

  it('revokeWatchPairing DELETEs the token endpoint AND clears the cached phone whr_ token', async () => {
    const res = await revokeWatchPairing();
    expect(mockDelete).toHaveBeenCalledWith('/api/integrations/watch/token');
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('uses the shared apiClient (never raw fetch) — the whr_ token is never fetched or returned', async () => {
    const pair = await requestWatchPairing();
    const status = await fetchWatchStatus();
    const revoke = await revokeWatchPairing();
    // The mint returns only the ephemeral pairing code; no whr_ ever crosses this seam.
    expect(JSON.stringify([pair, status, revoke])).not.toContain('whr_');
    expect(mockPost).toHaveBeenCalledWith('/api/integrations/watch/pair');
  });
});
