// Token-based auth for the web client. On the cross-site Vercel↔Railway deploy
// the HTTP-only auth cookie is a third-party cookie that browsers block, so we
// also keep the JWT (returned in the login response body) in localStorage and
// send it as a Bearer header / query param. Cookies still work locally and are
// kept as a fallback.
//
// B2 same-domain auth prep (Wave 5 / T4, code only — the actual DNS/reverse-proxy
// cutover that puts the SPA + API on one registrable domain is a separate,
// human-gated step): once that migration lands, the httpOnly cookie becomes
// first-party and browsers stop blocking it, so the localStorage bearer-token
// workaround above is no longer needed — and is a residual XSS surface as long as
// it stays around (any injected script can read `koko-token`). Flip
// VITE_AUTH_SAME_ORIGIN=true post-migration to stop reading/writing that token
// entirely and rely solely on the credentialed cookie. Defaults to OFF so nothing
// changes on the CURRENT cross-site topology — flipping this before the domain
// migration would break every fetch/socket call (the cookie is blocked cross-site,
// which is exactly why the workaround exists).
export function sameOriginAuth(): boolean {
  return import.meta.env.VITE_AUTH_SAME_ORIGIN === 'true';
}

const TOKEN_KEY = 'koko-token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable — fall back to cookie auth */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Authorization header for authenticated fetch() calls (empty when no token, or
 * when running in same-origin mode — see sameOriginAuth() above, where auth is
 * carried solely by the credentialed httpOnly cookie).
 */
export function authHeaders(): Record<string, string> {
  if (sameOriginAuth()) return {};
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/**
 * Builds an authenticated OAuth-connect URL for a top-level navigation that cannot
 * send an Authorization header. Instead of leaking the long-lived session JWT in
 * the URL, we mint a short-lived (120s) single-use connect token server-side and
 * pass that as ?ct=. Falls back to the plain URL (cookie auth) if minting fails. (audit F1)
 */
export async function buildConnectUrl(backendUrl: string, path: string): Promise<string> {
  const base = `${backendUrl}${path}`;
  try {
    const res = await fetch(`${backendUrl}/api/integrations/connect-token`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
    });
    if (!res.ok) return base;
    const { connectToken } = await res.json();
    return connectToken ? `${base}?ct=${encodeURIComponent(connectToken)}` : base;
  } catch {
    return base;
  }
}

/**
 * Disconnects a connected music/biometric provider — revokes its stored token
 * server-side and clears the connection. The user's derived taste/biometric
 * profile is kept, so reconnecting is instant. Throws on a non-ok response.
 */
export async function disconnectProvider(
  backendUrl: string,
  provider: 'spotify' | 'youtube' | 'garmin',
): Promise<void> {
  const res = await fetch(`${backendUrl}/api/integrations/${provider}/disconnect`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`disconnect ${provider} failed: ${res.status}`);
}

/**
 * Logs out of Kokonada: best-effort server-side token revoke (denylists the JWT),
 * then ALWAYS clears the local session token so the user is signed out even if the
 * network call fails. Never throws — local sign-out must always succeed.
 */
export async function logout(backendUrl: string): Promise<void> {
  try {
    await fetch(`${backendUrl}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: authHeaders(),
    });
  } catch {
    /* offline / server error — the local token clear below still signs the user out */
  }
  clearToken();
}

/**
 * GDPR account deletion: permanently hard-deletes the account and all associated data
 * server-side, then clears the local token. Throws if the server rejects the delete so
 * the caller can surface an error (and NOT pretend the account is gone). On success the
 * local token is cleared exactly like logout.
 */
export async function deleteAccount(backendUrl: string): Promise<void> {
  const res = await fetch(`${backendUrl}/api/auth/account`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`deleteAccount failed: ${res.status}`);
  clearToken();
}

/** Mint a new watch device token (plaintext returned once). Throws on failure.
 *  Retained for non-browser/API callers — the web UI itself uses
 *  requestWatchPairingCode() below so the long-lived token is never rendered in
 *  the browser DOM or clipboard (audit L-15). */
export async function issueWatchToken(backendUrl: string): Promise<string> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/token`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`issueWatchToken failed: ${res.status}`);
  const { token } = await res.json();
  return token as string;
}

/**
 * Mints a short-lived, single-use pairing code (audit L-15) shown in the browser
 * INSTEAD of the long-lived watch device token. The sideloaded watch app exchanges
 * this code, server-side, for its own token — the long-lived secret never touches
 * the browser DOM or clipboard.
 */
export async function requestWatchPairingCode(
  backendUrl: string,
): Promise<{ code: string; expiresAt: string }> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/pair`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`requestWatchPairingCode failed: ${res.status}`);
  return res.json();
}

/** Revoke the current watch device token. Throws on failure. */
export async function revokeWatchToken(backendUrl: string): Promise<void> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/token`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`revokeWatchToken failed: ${res.status}`);
}

/**
 * Like (save) or unlike (remove) a track in the user's Spotify "Liked Songs"
 * (Bug 7). PUT to save, DELETE to remove. A 409 means the stored token predates
 * the user-library-modify scope — surfaced as a `reconnect`-flagged error so the
 * caller can prompt a Spotify reconnect.
 */
export async function setTrackSaved(backendUrl: string, id: string, saved: boolean): Promise<void> {
  const res = await fetch(`${backendUrl}/api/integrations/spotify/saved-tracks`, {
    method: saved ? 'PUT' : 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ids: [id] }),
  });
  if (res.status === 409) throw Object.assign(new Error('reconnect_required'), { reconnect: true });
  if (!res.ok) throw new Error(`setTrackSaved failed: ${res.status}`);
}

/** Fetch the liked-state map for the given track ids (Bug 7 heart state). */
export async function fetchTracksSaved(
  backendUrl: string,
  ids: string[],
): Promise<Record<string, boolean>> {
  const clean = ids.filter(Boolean);
  if (clean.length === 0) return {};
  const res = await fetch(
    `${backendUrl}/api/integrations/spotify/saved-tracks?ids=${encodeURIComponent(clean.join(','))}`,
    { method: 'GET', credentials: 'include', headers: authHeaders() },
  );
  if (!res.ok) throw new Error(`fetchTracksSaved failed: ${res.status}`);
  const data = await res.json();
  return (data.saved ?? {}) as Record<string, boolean>;
}

/**
 * Start Spotify playback of the given track URIs (jump-to-track from the queue).
 * Pass the Web Playback SDK `deviceId` on desktop; omit it on mobile so the backend
 * transfers playback to the user's active device. A 409 carries a reason: a missing
 * scope surfaces as a `reconnect`-flagged error; no active device as `noActiveDevice`.
 */
export async function playTracks(
  backendUrl: string,
  uris: string[],
  deviceId?: string | null,
): Promise<void> {
  const res = await fetch(`${backendUrl}/api/integrations/spotify/play`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(deviceId ? { uris, deviceId } : { uris }),
  });
  if (res.ok) return;
  if (res.status === 409) {
    const data = await res.json().catch(() => ({}));
    if (data.reason === 'no_active_device') throw Object.assign(new Error('no_active_device'), { noActiveDevice: true });
    throw Object.assign(new Error('reconnect_required'), { reconnect: true });
  }
  throw new Error(`playTracks failed: ${res.status}`);
}


/** Fetch watch connection status for the badge (hydrate on page load). */
export async function fetchWatchStatus(
  backendUrl: string,
): Promise<{ connected: boolean; lastSeenAt: string | null }> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/status`, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`fetchWatchStatus failed: ${res.status}`);
  return res.json();
}
