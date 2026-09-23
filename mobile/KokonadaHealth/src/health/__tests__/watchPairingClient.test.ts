import { apiGet, apiPost, apiDelete } from '../../net/apiClient';
import { clearWatchToken } from '../liveHrClient';
import { fetchWatchStatus, revokeWatchPairing } from '../watchPairingClient';

// T0 — the §10 live-HR DEVICE-CREDENTIAL REST seam. It uses the shared apiClient (auth +
// 401-refresh), NEVER raw fetch. The pairing-code half (requestWatchPairing → /watch/pair) was
// retired with the Garmin Connect IQ app, which was the only party that could redeem a code.
// What remains is status and revoke for the whr_ token the PHONE mints for its live-HR tiers;
// revoking additionally forgets the cached phone copy (liveHrClient Keychain slot) so a stale
// token can't outlive the revoked server slot.
//
// `apiPost` stays mocked deliberately: it is the guard for "this module no longer POSTs anything",
// asserted below.

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
    const status = await fetchWatchStatus();
    const revoke = await revokeWatchPairing();
    // No whr_ ever crosses this seam: the phone's copy is minted by liveHrClient, not here.
    expect(JSON.stringify([status, revoke])).not.toContain('whr_');
  });

  // Guard for the retired pairing seam. The Connect IQ app was the only party that could redeem a
  // pairing code, so re-introducing a POST here would be resurrecting a flow with no client.
  it('no longer POSTs anything — the pairing-code mint died with the Connect IQ app', async () => {
    await fetchWatchStatus();
    await revokeWatchPairing();
    expect(mockPost).not.toHaveBeenCalled();
  });
});
