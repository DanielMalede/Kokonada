import { monotonicNow } from '../net/serverWait';

// In-memory holder for the Kokonada session tokens. Bridges the async Keychain to
// the SYNCHRONOUS getAccessToken() the socket client requires, and owns the
// rotating-refresh flow. Refresh is single-flight so concurrent callers (the
// socket's auth_expired handler racing an HTTP 401) can't double-rotate a token
// and get its whole family revoked.

export interface TokenPair {
  access: string;
  refresh: string;
}

// C1 (B1 P1 charter §2): the one session record, one Keychain item. `uid` is the account's Mongo id;
// `age` is the age pass {over16, on} and nothing else (REG-P1-R2-1): the age consent's version,
// language and hash travel only in the sign-in exchange and are never written to the device. A stored
// pair without a uid reads as v1, and v1's sign-in still installs a bare pair (v1 call sites unchanged).
export interface AgePass { over16: true; on: string }
export interface SessionRecord extends TokenPair { v: 2; uid: string; age?: AgePass }
export type StoredSession = TokenPair | SessionRecord;

export const SESSION_UID_PATTERN = /^[a-f0-9]{24}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
// C1 (RA-118): `epoch` is the epoch of the session that ended, captured before the end moves it, so the
// event never names the next session.
export interface SessionEvent { type: 'ended'; reason: SessionEndReason; epoch: number }

const isToken = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function readAge(age: unknown): AgePass | undefined {
  const a = age as { over16?: unknown; on?: unknown } | null | undefined;
  if (a?.over16 === true && typeof a.on === 'string' && DAY_PATTERN.test(a.on)) return { over16: true, on: a.on };
  return undefined;
}

// What bootstrap() holds from a stored item: a v2 record only when its uid is well formed; any other
// pair keeps its tokens as v1, exactly as v1 installed whatever it loaded. A malformed age is dropped.
function readStored(stored: StoredSession | null): { tokens: TokenPair; uid: string | null; age: AgePass | null } | null {
  if (!stored) return null;
  const r = stored as Partial<SessionRecord> & { v?: unknown };
  if (r.v === 2 && typeof r.uid === 'string' && SESSION_UID_PATTERN.test(r.uid)) {
    return { tokens: { access: r.access as string, refresh: r.refresh as string }, uid: r.uid, age: readAge(r.age) ?? null };
  }
  if (r.v === 2) return { tokens: { access: r.access as string, refresh: r.refresh as string }, uid: null, age: null };
  return { tokens: stored, uid: null, age: null };
}

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
  loadTokens: () => Promise<StoredSession | null>;
  saveTokens: (t: StoredSession) => Promise<void>;
  clearTokens: () => Promise<void>;
  // POST /api/auth/refresh { refreshToken } → ok with the rotated pair, dead on a 401, else unavailable.
  refreshEndpoint: (refreshToken: string) => Promise<RefreshOutcome>;
  // Injectable for deterministic tests: the clock and the jitter (a number in [0, 1]).
  now?: () => number;
  random?: () => number;
}

export class AuthSession {
  private tokens: TokenPair | null = null;
  // C1: set only for a v2 record; null for a v1 pair. Ended with the tokens.
  private uid: string | null = null;
  private age: AgePass | null = null;
  private inFlightRefresh: Promise<string | null> | null = null;
  // Bumped whenever the held session is replaced or ended, so a refresh answer that lands after a
  // sign-out (or a sign-in as another account) can never install or clear the newer session.
  private epoch = 0;
  private readonly listeners = new Set<(event: SessionEvent) => void>();
  // RA-2: no refresh request goes out before this time, and how many unavailable answers came in a row.
  private holdUntil = 0;
  private holdLength = 0;
  private unavailableInARow = 0;

  constructor(private readonly deps: AuthSessionDeps) {}

  // C1 (RA-119): the hold runs on a monotonic source unless a clock is injected.
  private now(): number {
    return this.deps.now ? this.deps.now() : monotonicNow();
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
    this.holdLength = wait;
    this.holdUntil = this.now() + wait;
  }

  private endHold(): void {
    this.holdUntil = 0;
    this.holdLength = 0;
    this.unavailableInARow = 0;
  }

  // Recovers the stored session at launch. SA309-3: a held session is newer than anything the Keychain
  // can give back (a rotation's save is best-effort), so it is never replaced — a reload would
  // re-present a spent refresh token, and the server revokes the family on that. A load that answers
  // after a sign-in or a sign-out (the epoch moved) installs nothing either.
  async bootstrap(): Promise<boolean> {
    if (this.tokens) return true;
    const epoch = this.epoch;
    const loaded = readStored(await this.deps.loadTokens());
    if (epoch === this.epoch && !this.tokens && loaded) {
      this.tokens = loaded.tokens;
      this.uid = loaded.uid;
      this.age = loaded.age;
    }
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

  // C1: the held record's uid; null for a v1 pair and once the session has ended.
  getSessionUid(): string | null {
    return this.tokens ? this.uid : null;
  }

  // C1: read-only. The ms left of the hold after an unavailable refresh, or null when none holds; for
  // the connection port's retryAfterMs. Reading it changes nothing.
  refreshHold(): number | null {
    const remaining = this.holdRemaining();
    return remaining > 0 ? remaining : null;
  }

  // Listen for the session ending. Returns the unsubscribe.
  subscribe(listener: (event: SessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // v1: a bare {access, refresh} pair, installed as before. C1: a {v:2, access, refresh, uid, age?}
  // record is validated first (non-empty tokens, a 24-hex uid, an age that is a pass with a day), and a
  // record that fails rejects before anything changes. Only {over16, on} of an age is kept.
  async setSession(input: TokenPair | SessionRecord): Promise<void> {
    let record: SessionRecord | null = null;
    if ((input as { v?: unknown }).v === 2) {
      const r = input as SessionRecord;
      if (!isToken(r.access) || !isToken(r.refresh)) throw new Error('session record: tokens required');
      if (typeof r.uid !== 'string' || !SESSION_UID_PATTERN.test(r.uid)) throw new Error('session record: malformed uid');
      const age = r.age === undefined ? undefined : readAge(r.age);
      if (r.age !== undefined && !age) throw new Error('session record: malformed age');
      record = { v: 2, access: r.access, refresh: r.refresh, uid: r.uid, ...(age ? { age } : {}) };
    }
    this.epoch += 1;
    this.inFlightRefresh = null; // a new session never joins the old one's refresh
    this.endHold(); // ...nor waits out the old one's hold
    if (record) {
      this.tokens = { access: record.access, refresh: record.refresh };
      this.uid = record.uid;
      this.age = record.age ?? null;
      await this.deps.saveTokens(record);
    } else {
      this.tokens = input;
      this.uid = null;
      this.age = null;
      await this.deps.saveTokens(input);
    }
  }

  // The item a held session is stored as: a v2 record keeps its uid and age through a rotation.
  private stored(tokens: TokenPair): StoredSession {
    if (this.uid === null) return tokens;
    return { v: 2, access: tokens.access, refresh: tokens.refresh, uid: this.uid, ...(this.age ? { age: this.age } : {}) };
  }

  // C1 (RA-119): a hold whose remaining time exceeds its own length is over, so a clock that stepped
  // back can never stretch it.
  private holdRemaining(): number {
    if (this.holdUntil === 0) return 0;
    const remaining = this.holdUntil - this.now();
    return remaining > this.holdLength ? 0 : remaining;
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
    if (this.holdRemaining() > 0) return null;

    const flight = this.rotate(refreshToken, this.epoch);
    this.inFlightRefresh = flight;
    const settle = () => { if (this.inFlightRefresh === flight) this.inFlightRefresh = null; };
    flight.then(settle, settle); // both paths handled: this promise cannot reject
    return flight;
  }

  // C1: `onlyIfEpoch` scopes the clear to one session: for any other epoch it is a no-op that leaves
  // the newer session, its Keychain item and its listeners untouched. Still Promise<void>, as v1 types it.
  async clear(opts: { onlyIfEpoch?: number } = {}): Promise<void> {
    if (opts.onlyIfEpoch !== undefined && opts.onlyIfEpoch !== this.epoch) return;
    await this.end('cleared');
  }

  // C1: the REST client's answer to a 401 on a request retried with a just-rotated token: the server
  // refused a token it has just issued, so the session is `dead`. Scoped like clear(); never rejects.
  async endAsDead(opts: { onlyIfEpoch?: number } = {}): Promise<boolean> {
    if (opts.onlyIfEpoch !== undefined && opts.onlyIfEpoch !== this.epoch) return false;
    if (!this.tokens) return false;
    await this.endQuietly('dead');
    return true;
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
    try { await this.deps.saveTokens(this.stored(outcome.tokens)); } catch { /* it works this run; persistence is best-effort */ }
    return outcome.tokens.access;
  }

  private async endQuietly(reason: SessionEndReason): Promise<void> {
    try { await this.end(reason); } catch { /* ended in memory; a Keychain failure must not make refresh throw */ }
  }

  private async end(reason: SessionEndReason): Promise<void> {
    const held = this.tokens !== null;
    const endedEpoch = this.epoch; // RA-118: captured before the end moves it
    this.epoch += 1;
    this.inFlightRefresh = null;
    this.endHold();
    this.tokens = null;
    this.uid = null;
    this.age = null;
    try {
      await this.deps.clearTokens();
    } finally {
      if (held) {
        for (const listener of [...this.listeners]) {
          try { listener({ type: 'ended', reason, epoch: endedEpoch }); } catch { /* a listener never breaks the session */ }
        }
      }
    }
  }
}
