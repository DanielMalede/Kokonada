import { apiGet, apiDelete, type ApiResult } from '../net/apiClient';
import { clearWatchToken } from './liveHrClient';

// §10 Profile — the live-HR DEVICE-CREDENTIAL seam. The Garmin Connect IQ watch app that this
// file was written for is retired, and with it the PAIRING-CODE flow (audit L-15): the watch was
// the only party that could ever redeem a code, and it never even had a field to type one into.
// What survives is the credential itself — the PHONE mints a whr_ device token via
// liveHrClient.getWatchToken (POST /watch/token) for both live-HR tiers, BLE and the 3-minute
// Health Connect fallback, and every reading rides it to POST /watch/hr.
//
// So the two calls below are status and REVOKE for that phone-held credential. The `/watch/*` route
// names are now a misnomer for a surface that no longer exists; they are deliberately NOT renamed
// here, because a deployed mobile binary pins those URLs and cannot be revved in lockstep with a
// backend deploy. Both calls ride the shared apiClient (session-JWT + single-flight 401-refresh),
// never raw fetch, so this inherits auth.

export interface WatchStatus {
  connected: boolean;
  lastSeenAt: string | null; // updated on each HR ingest; null until the first ping
}

// GET /api/integrations/watch/status — powers the live-HR connection badge.
export function fetchWatchStatus(): Promise<ApiResult<WatchStatus>> {
  return apiGet<WatchStatus>('/api/integrations/watch/status');
}

// DELETE /api/integrations/watch/token — revokes the server slot (watchToken + any in-flight
// watchPairing). It ALSO forgets the phone's cached whr_ (liveHrClient Keychain slot): the
// phone-BLE live-HR path holds a whr_ for the SAME single server slot, so a stale phone token
// must not outlive a revoke — live-HR re-mints lazily on the next startLiveHr (D2-i).
export async function revokeWatchPairing(): Promise<ApiResult<{ message: string }>> {
  const res = await apiDelete<{ message: string }>('/api/integrations/watch/token');
  await clearWatchToken();
  return res;
}
