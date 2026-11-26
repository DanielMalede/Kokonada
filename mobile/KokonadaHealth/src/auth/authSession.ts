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
// `unavailable`, and the session survives it. RA-2: an unavailable answer can carry the server's own
// wait (a 429's Retry-After or RateLimit-Reset), in milliseconds.
export type RefreshOutcome =
  | { kind: 'ok'; tokens: TokenPair }
  | { kind: 'dead' }
  | { kind: 'unavailable'; retryAfterMs?: number };

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
  const wait = (a as { retryAfterMs?: unknown } | null | undefined)?.retryAfterMs;
  if (a?.kind === 'unavailable' && typeof wait === 'number' && Number.isFinite(wait) && wait >= 0) {
    return { kind: 'unavailable', retryAfterMs: wait };
  }
  return { kind: 'unavailable' };
}

// RA-2: after an unavailable answer, how long refresh() sends nothing. Every trigger (each REST 401,
// each socket open) used to retry at once, against an endpoint that shares the authLimiter (10 per
// 15 min per IP) with sign-in itself. The server's own wait is honoured up to that limiter's window
// (authLimiter.windowMs, backend/app/middleware/rateLimiter.js:24): a longer one is not ours to trust.
// Anything else backs off exponentially from 2 s, with equal jitter, capped at 60 s.
const BACKOFF_FIRST_MS = 2_000;
const BACKOFF_CAP_MS = 60_000;
const MAX_SERVER_WAIT_MS = 15 * 60_000;

export interface AuthSessionDeps {
  loadTokens: () => Promise<TokenPair | null>;
  saveTokens: (t: TokenPair) => Promise<void>;
  clearTokens: () => Promise<void>;
  // POST /api/auth/refresh { refreshToken } → ok with the rotated pair, dead on a 401, else unavailable.
  refreshEndpoint: (refreshToken: string) => Promise<RefreshOutcome>;
  // Injectable for deterministic tests: the clock and the jitter (a number in [0, 1]).
  now?: () => number;
  random?: () => number;
}

export class AuthSession {
  private tokens: TokenPair | null = null;
  private inFlightRefresh: Promise<string | null> | null = null;
  // Bumped whenever the held session is replaced or ended, so a refresh answer that lands after a
  // sign-out (or a sign-in as another account) can never install or clear the newer session.
  private epoch = 0;
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  // RA-2: no refresh request goes out before this time, and how many unavailable answers came in a row.
  private holdUntil = 0;
  private unavailableInARow = 0;

  constructor(private readonly deps: AuthSessionDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private holdAfterUnavailable(retryAfterMs?: number): void {
    this.unavailableInARow += 1;
    let wait: number;
    if (retryAfterMs !== undefined) {
      wait = Math.min(retryAfterMs, MAX_SERVER_WAIT_MS);
    } else {
      const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_FIRST_MS * 2 ** (this.unavailableInARow - 1));
      const jitter = Math.min(1, Math.max(0, this.deps.random ? this.deps.random() : Math.random()));
      wait = ceiling / 2 + jitter * (ceiling / 2);
    }
    this.holdUntil = this.now() + wait;
  }

  private endHold(): void {
    this.holdUntil = 0;
    this.unavailableInARow = 0;
  }

  // Recovers the stored session at launch. SA309-3: a held session is newer than anything the Keychain
  // can give back (a rotation's save is best-effort), so it is never replaced — a reload would
  // re-present a spent refresh token, and the server revokes the family on that. A load that answers
  // after a sign-in or a sign-out (the epoch moved) installs nothing either.
  async bootstrap(): Promise<boolean> {
    if (this.tokens) return true;
    const epoch = this.epoch;
    const loaded = await this.deps.loadTokens();
    if (epoch === this.epoch && !this.tokens) this.tokens = loaded;
    return this.tokens !== null;
  }

  getAccessToken(): string | null {
    return this.tokens?.access ?? null;
  }

  // True while a token pair is held. An `unavailable` refresh keeps it; only `dead` or clear() end it.
  hasSession(): boolean {
    return this.tokens !== null;
  }

  // Security L2: the sign-out hands the held refresh token to POST /api/auth/logout, which revokes its
  // whole family on the server. Null for an access-only session, and once the session has ended.
  getRefreshToken(): string | null {
    return this.tokens?.refresh || null;
  }

  // RA-4: which session this is. It moves when a session is installed (setSession) or ended (a dead
  // refresh, clear()), never on a rotation: a caller that read it before an await can tell whether a
  // sign-in or a sign-out landed meanwhile.
  sessionEpoch(): number {
    return this.epoch;
  }

  // Listen for the session ending. Returns the unsubscribe.
  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async setSession(pair: TokenPair): Promise<void> {
    this.epoch += 1;
    this.inFlightRefresh = null; // a new session never joins the old one's refresh
    this.endHold(); // ...nor waits out the old one's hold
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
    // RA-2: inside the hold after an unavailable answer, nothing is sent: the session stands, and a call
    // after the hold asks again.
    if (this.now() < this.holdUntil) return null;

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
    if (outcome.kind !== 'ok') { this.holdAfterUnavailable(outcome.retryAfterMs); return null; }
    this.endHold();
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
    this.endHold();
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
