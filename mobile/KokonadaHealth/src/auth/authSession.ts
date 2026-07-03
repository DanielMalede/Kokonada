// In-memory holder for the Kokonada session tokens. Bridges the async Keychain to
// the SYNCHRONOUS getAccessToken() the socket client requires, and owns the
// rotating-refresh flow. Refresh is single-flight so concurrent callers (the
// socket's auth_expired handler racing an HTTP 401) can't double-rotate a token
// and get its whole family revoked.

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface AuthSessionDeps {
  loadTokens: () => Promise<TokenPair | null>;
  saveTokens: (t: TokenPair) => Promise<void>;
  clearTokens: () => Promise<void>;
  // POST /api/auth/refresh { refreshToken } → new pair, or null on 401 (dead family).
  refreshEndpoint: (refreshToken: string) => Promise<TokenPair | null>;
}

export class AuthSession {
  private tokens: TokenPair | null = null;
  private inFlightRefresh: Promise<string | null> | null = null;

  constructor(private readonly deps: AuthSessionDeps) {}

  async bootstrap(): Promise<boolean> {
    this.tokens = await this.deps.loadTokens();
    return this.tokens !== null;
  }

  getAccessToken(): string | null {
    return this.tokens?.access ?? null;
  }

  async setSession(pair: TokenPair): Promise<void> {
    this.tokens = pair;
    await this.deps.saveTokens(pair);
  }

  async refresh(): Promise<string | null> {
    if (this.inFlightRefresh) return this.inFlightRefresh; // single-flight
    const refreshToken = this.tokens?.refresh;
    if (!refreshToken) return null;

    this.inFlightRefresh = (async () => {
      try {
        const next = await this.deps.refreshEndpoint(refreshToken);
        if (!next) { await this.clear(); return null; }
        this.tokens = next;
        await this.deps.saveTokens(next);
        return next.access;
      } catch {
        await this.clear();
        return null;
      } finally {
        this.inFlightRefresh = null;
      }
    })();

    return this.inFlightRefresh;
  }

  async clear(): Promise<void> {
    this.tokens = null;
    await this.deps.clearTokens();
  }
}
