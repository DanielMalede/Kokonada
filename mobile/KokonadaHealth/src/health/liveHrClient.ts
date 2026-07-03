import * as Keychain from 'react-native-keychain';
import { BACKEND_URL } from './config';
import { apiPost } from '../net/apiClient';

// The live-HR path authenticates with an opaque WATCH DEVICE TOKEN (whr_…), the same
// contract the sideloaded Garmin watch app uses — decoupled from the session JWT so a
// long-lived background HR stream doesn't ride on the login token. The token is minted
// once via /watch/token (using the JWT) and cached in the Android Keystore.
const WATCH_TOKEN_SERVICE = 'com.kokonadahealth.watchToken';

/**
 * Return a usable watch device token, minting one on first use. Reuses the existing
 * POST /api/integrations/watch/token endpoint (issueWatchToken), which also flips the
 * user's wearableProvider to 'garmin' so the web UI shows the connection.
 */
export async function getWatchToken(): Promise<string> {
  const cached = await Keychain.getGenericPassword({ service: WATCH_TOKEN_SERVICE });
  if (cached && cached.password) return cached.password;

  // Mint via the shared apiClient so the session-JWT read comes from the unified
  // AuthSession plane and inherits its 401-refresh-retry. The minted value is the
  // opaque WATCH token — a distinct credential cached under WATCH_TOKEN_SERVICE.
  const res = await apiPost<{ token: string }>('/api/integrations/watch/token');
  if (!res.ok) throw new Error(`Watch token mint failed (${res.status ?? 401})`);
  const { token } = res.data;
  await Keychain.setGenericPassword('watch', token, { service: WATCH_TOKEN_SERVICE });
  return token;
}

/** Forget the cached watch token (e.g. on sign-out or a 401 from the ingest endpoint). */
export async function clearWatchToken(): Promise<void> {
  await Keychain.resetGenericPassword({ service: WATCH_TOKEN_SERVICE });
}

export interface PushResult {
  ok: boolean;
  status: number;
  rateLimited: boolean; // 429 → caller should back off before the next push
}

/**
 * POST one live HR reading to /api/integrations/watch/hr. Payload matches the watch
 * app exactly ({ heartRate, ts }), so it flows through watchHrIngest → the user's live
 * browser socket → real-time playlist adaptation with zero backend changes.
 */
export async function pushLiveHr(
  heartRate: number,
  watchToken: string,
  ts: Date = new Date(),
): Promise<PushResult> {
  const res = await fetch(`${BACKEND_URL}/api/integrations/watch/hr`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${watchToken}`,
    },
    body: JSON.stringify({ heartRate, ts: ts.toISOString() }),
  });
  return { ok: res.ok, status: res.status, rateLimited: res.status === 429 };
}
