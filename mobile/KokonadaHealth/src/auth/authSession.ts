// In-memory holder for the Kokonada session tokens. Bridges the async Keychain to
// the SYNCHRONOUS getAccessToken() the socket client requires, and owns the
// rotating-refresh flow. Refresh is single-flight so concurrent callers (the
// socket's auth_expired handler racing an HTTP 401) can't double-rotate a token
// and get its whole family revoked.

export interface TokenPair {
  access: string;
  refresh: string;
}

// The refresh endpoint's answer (C1). Only the server's dead-family answer is `dead`; anything
// that is not a verdict — a thrown fetch, a timeout, a 5xx, a 429, an unreadable body — is
// `unavailable`, and the session survives it.
export type RefreshOutcome =
  | { kind: 'ok'; tokens: TokenPair }
  | { kind: 'dead' }
  | { kind: 'unavailable' };

// `dead`: the server refused the refresh family (or an access-only session's access was refused);
// `cleared`: clear() ended it (sign-out, account deletion, a withdrawal teardown).
export type SessionEndReason = 'dead' | 'cleared';
export interface SessionEvent { type: 'ended'; reason: SessionEndReason }

const isToken = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// RA-11: whatever the endpoint hands back, refresh() reads a verdict it can use, or `unavailable` —
// never a throw (refresh() promises never to reject), and never a malformed `ok` installed as the
// live session.
function readOutcome(answer: unknown): RefreshOutcome {
  const a = answer as { kind?: unknown; tokens?: { access?: unknown; refresh?: unknown } } | null | undefined;
  if (a?.kind === 'dead') return { kind: 'dead' };
  if (a?.kind === 'ok') {
    const access = a.tokens?.access;
    const refresh = a.tokens?.refresh;
    if (isToken(access) && isToken(refresh)) return { kind: 'ok', tokens: { access, refresh } };
  }
  return { kind: 'unavailable' };
}

export interface AuthSessionDeps {
  loadTokens: () => Promise<TokenPair | null>;
  saveTokens: (t: TokenPair) => Promise<void>;
  clearTokens: () => Promise<void>;
  // POST /api/auth/refresh { refreshToken } → ok with the rotated pair, dead on a 401, else unavailable.
  refreshEndpoint: (refreshToken: string) => Promise<RefreshOutcome>;
}

export class AuthSession {
  private tokens: TokenPair | null = null;
  private inFlightRefresh: Promise<string | null> | null = null;
  // Bumped whenever the held session is replaced or ended, so a refresh answer that lands after a
  // sign-out (or a sign-in as another account) can never install or clear the newer session.
  private epoch = 0;
  private readonly listeners = new Set<(event: SessionEvent) => void>();

  constructor(private readonly deps: AuthSessionDeps) {}

  async bootstrap(): Promise<boolean> {
    this.tokens = await this.deps.loadTokens();
    return this.tokens !== null;
  }

  getAccessToken(): string | null {
    return this.tokens?.access ?? null;
  }

  // True while a token pair is held. An `unavailable` refresh keeps it; only `dead` or clear() end it.
  hasSession(): boolean {
    return this.tokens !== null;
  }

  // Listen for the session ending. Returns the unsubscribe.
  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async setSession(pair: TokenPair): Promise<void> {
    this.epoch += 1;
    this.inFlightRefresh = null; // a new session never joins the old one's refresh
    this.tokens = pair;
    await this.deps.saveTokens(pair);
  }

  // Returns the fresh access token, or null. Null with hasSession() still true means the server
  // could not be reached for a verdict (unavailable): the session stands and a later call retries.
  // Never rejects: the REST client and the socket await it without a catch of their own.
  async refresh(): Promise<string | null> {
    if (this.inFlightRefresh) return this.inFlightRefresh; // single-flight
    if (!this.tokens) return null;
    const refreshToken = this.tokens.refresh;
    // An access-only session is refreshed only after its access was refused; with no refresh
    // token it can never recover, so it is dead.
    if (!refreshToken) { await this.endQuietly('dead'); return null; }

    const flight = this.rotate(refreshToken, this.epoch);
    this.inFlightRefresh = flight;
    const settle = () => { if (this.inFlightRefresh === flight) this.inFlightRefresh = null; };
    flight.then(settle, settle); // both paths handled: this promise cannot reject
    return flight;
  }

  async clear(): Promise<void> {
    await this.end('cleared');
  }

  private async rotate(refreshToken: string, epoch: number): Promise<string | null> {
    let outcome: RefreshOutcome;
    try {
      outcome = readOutcome(await this.deps.refreshEndpoint(refreshToken));
    } catch {
      outcome = { kind: 'unavailable' }; // a throw is not the server's verdict
    }
    if (epoch !== this.epoch) return null; // the session changed while this answer was in flight
    if (outcome.kind === 'dead') { await this.endQuietly('dead'); return null; }
    if (outcome.kind !== 'ok') return null;
    this.tokens = outcome.tokens; // the rotated pair IS the live session from here on
    try { await this.deps.saveTokens(outcome.tokens); } catch { /* it works this run; persistence is best-effort */ }
    return outcome.tokens.access;
  }

  private async endQuietly(reason: SessionEndReason): Promise<void> {
    try { await this.end(reason); } catch { /* ended in memory; a Keychain failure must not make refresh throw */ }
  }

  private async end(reason: SessionEndReason): Promise<void> {
    const held = this.tokens !== null;
    this.epoch += 1;
    this.inFlightRefresh = null;
    this.tokens = null;
    try {
      await this.deps.clearTokens();
    } finally {
      if (held) {
        for (const listener of [...this.listeners]) {
          try { listener({ type: 'ended', reason }); } catch { /* a listener never breaks the session */ }
        }
      }
    }
  }
}
