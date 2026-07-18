import { apiGet, apiPost, apiDelete, type ApiResult } from '../net/apiClient';
import { clearWatchToken } from './liveHrClient';

// §10 Profile — the Garmin watch PAIRING-CODE seam (audit L-15). The user reads a short-lived,
// single-use 6-digit code off the phone and types it on the watch; the watch exchanges it
// server-side for its own long-lived whr_ device token. That whr_ is NEVER fetched, stored, or
// rendered on this client — only the ephemeral pairing code is. All three calls ride the shared
// apiClient (session-JWT + single-flight 401-refresh), never raw fetch, so this inherits auth.

export interface WatchPairing {
  code: string;      // the ephemeral 6-digit pairing code — never a whr_ token
  expiresAt: string; // ISO — ~5 min TTL, single-use
}

export interface WatchStatus {
  connected: boolean;
  lastSeenAt: string | null; // updated on each HR ingest; null until the first ping
}

// POST /api/integrations/watch/pair — mints a fresh pairing code (createWatchPairing).
export function requestWatchPairing(): Promise<ApiResult<WatchPairing>> {
  return apiPost<WatchPairing>('/api/integrations/watch/pair');
}

// GET /api/integrations/watch/status — powers the connection badge + pairing poll.
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
