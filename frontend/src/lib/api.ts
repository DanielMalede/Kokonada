// Token-based auth for the web client. On the cross-site Vercel↔Railway deploy
// the HTTP-only auth cookie is a third-party cookie that browsers block, so we
// also keep the JWT (returned in the login response body) in localStorage and
// send it as a Bearer header / query param. Cookies still work locally and are
// kept as a fallback.

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

/** Authorization header for authenticated fetch() calls (empty when no token). */
export function authHeaders(): Record<string, string> {
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

/** Mint a new watch device token (plaintext returned once). Throws on failure. */
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

/** Revoke the current watch device token. Throws on failure. */
export async function revokeWatchToken(backendUrl: string): Promise<void> {
  const res = await fetch(`${backendUrl}/api/integrations/watch/token`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`revokeWatchToken failed: ${res.status}`);
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
