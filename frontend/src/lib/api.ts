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

/** `?token=…` suffix for top-level navigations (OAuth connect) that can't set headers. */
export function tokenQuery(): string {
  const t = getToken();
  return t ? `?token=${encodeURIComponent(t)}` : '';
}
