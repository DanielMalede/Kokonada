// KokonadaSocket needs a SYNCHRONOUS getAccessToken(), but the Kokonada session
// tokens live in the async Keychain. AuthSession bridges that: it loads tokens into
// memory once at bootstrap, hands out the access token synchronously, and refreshes
// via the backend's rotating-refresh endpoint. Concurrent refresh calls (the socket
// auth_expired path racing an HTTP 401) must collapse into a SINGLE in-flight
// request so a token can't be double-rotated and its family burned.
//
// C1 (B1 charter §6 item 1): the refresh answer is ok | dead | unavailable. Only the server's
// dead-family answer (401 from POST /api/auth/refresh, backend/app/controllers/authController.js
// `refresh`) ends the session; a thrown fetch, a timeout, a 5xx or a 429 is `unavailable` and keeps
// it, so a phone that loses the network mid-refresh is never signed out.

import { AuthSession, type RefreshOutcome, type SessionEvent } from '../authSession';
import { keychainSession } from '../session';
import { BACKEND_URL } from '../../health/config';

const ok = (access: string, refresh: string): RefreshOutcome => ({ kind: 'ok', tokens: { access, refresh } });

function build(overrides: any = {}) {
  const stored = { value: 'stored' in overrides ? overrides.stored : { access: 'access-1', refresh: 'krt-1' } };
  const saved: Array<{ access: string; refresh: string } | null> = [];
  const deps = {
    loadTokens: jest.fn(async () => stored.value),
    saveTokens: jest.fn(async (t: any) => { saved.push(t); stored.value = t; }),
    clearTokens: jest.fn(async () => { stored.value = null; }),
    refreshEndpoint: overrides.refreshEndpoint
      ?? jest.fn(async (_refresh: string): Promise<RefreshOutcome> => ok('access-2', 'krt-2')),
    ...('now' in overrides ? { now: overrides.now } : {}),
  };
  const session = new AuthSession(deps);
  return { session, deps, saved, stored };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('AuthSession — bootstrap & sync access', () => {
  it('loads tokens from storage and exposes the access token synchronously', async () => {
    const { session } = build();
    expect(session.getAccessToken()).toBeNull(); // nothing loaded yet
    expect(await session.bootstrap()).toBe(true);
    expect(session.getAccessToken()).toBe('access-1'); // now synchronous
    expect(session.hasSession()).toBe(true);
  });

  it('bootstrap with no stored tokens leaves the session logged out', async () => {
    const { session } = build({ stored: null });
    expect(await session.bootstrap()).toBe(false);
    expect(session.getAccessToken()).toBeNull();
    expect(session.hasSession()).toBe(false);
  });
});

// SA309-3 (S3): bootstrap() reloaded the Keychain over whatever it held. A held pair is newer than the
// stored one (a rotation's save is best-effort), so a reload re-presents a spent refresh token and the
// server revokes the family; and a slow load that answers after a sign-in installed the old account.
describe('AuthSession — bootstrap never replaces a session it did not load (SA309-3)', () => {
  it('bootstrap() while a session is held keeps it, and the refresh in flight still installs its answer', async () => {
    const answer = deferred<RefreshOutcome>();
    const { session, deps, stored } = build({ refreshEndpoint: jest.fn(() => answer.promise) });
    await session.bootstrap();
    const flight = session.refresh(); // the server is rotating krt-1
    stored.value = { access: 'access-0', refresh: 'krt-0' }; // an older pair still on disk
    expect(await session.bootstrap()).toBe(true);
    expect(session.getAccessToken()).toBe('access-1');
    answer.resolve(ok('access-2', 'krt-2'));
    expect(await flight).toBe('access-2');
    expect(session.getAccessToken()).toBe('access-2');
    expect(deps.loadTokens).toHaveBeenCalledTimes(1);
  });

  it('a Keychain load that answers after a sign-in never replaces the new session', async () => {
    const load = deferred<{ access: string; refresh: string } | null>();
    const { session, deps } = build();
    deps.loadTokens.mockImplementationOnce(() => load.promise);
    const booting = session.bootstrap();
    await session.setSession({ access: 'b-acc', refresh: 'b-krt' }); // the user signs in meanwhile
    load.resolve({ access: 'a-acc', refresh: 'a-krt' });
    expect(await booting).toBe(true);
    expect(session.getAccessToken()).toBe('b-acc');
  });

  it('a Keychain load that answers after a sign-in and a sign-out leaves the phone signed out', async () => {
    const load = deferred<{ access: string; refresh: string } | null>();
    const { session, deps } = build();
    deps.loadTokens.mockImplementationOnce(() => load.promise);
    const booting = session.bootstrap();
    await session.setSession({ access: 'b-acc', refresh: 'b-krt' });
    await session.clear();
    load.resolve({ access: 'a-acc', refresh: 'a-krt' });
    expect(await booting).toBe(false);
    expect(session.getAccessToken()).toBeNull();
    expect(session.hasSession()).toBe(false);
  });
});

// RA-4: the boot reads the epoch before GET /api/auth/me; a change by the time /me answers means a
// sign-in or a sign-out landed meanwhile and owns the session.
describe('AuthSession — the session epoch (RA-4)', () => {
  it('moves when a session is installed or ended, and stays through a rotation', async () => {
    const { session } = build();
    await session.bootstrap();
    const booted = session.sessionEpoch();
    expect(await session.refresh()).toBe('access-2');
    expect(session.sessionEpoch()).toBe(booted); // a rotation is the same session
    await session.setSession({ access: 'b-acc', refresh: 'b-krt' });
    expect(session.sessionEpoch()).toBe(booted + 1);
    await session.clear();
    expect(session.sessionEpoch()).toBe(booted + 2);
  });

  it('an unavailable refresh keeps the epoch, and a dead one moves it', async () => {
    const kept = build({ refreshEndpoint: jest.fn(async (): Promise<RefreshOutcome> => ({ kind: 'unavailable' })) });
    await kept.session.bootstrap();
    const e = kept.session.sessionEpoch();
    await kept.session.refresh();
    expect(kept.session.sessionEpoch()).toBe(e);

    const ended = build({ refreshEndpoint: jest.fn(async (): Promise<RefreshOutcome> => ({ kind: 'dead' })) });
    await ended.session.bootstrap();
    const d = ended.session.sessionEpoch();
    await ended.session.refresh();
    expect(ended.session.sessionEpoch()).toBe(d + 1);
  });
});

describe('AuthSession — refresh (rotating token)', () => {
  it('rotates the token, updates the in-memory access, and persists the new pair', async () => {
    const { session, deps, saved } = build();
    await session.bootstrap();
    const next = await session.refresh();
    expect(next).toBe('access-2');
    expect(session.getAccessToken()).toBe('access-2');
    expect(deps.refreshEndpoint).toHaveBeenCalledWith('krt-1');
    expect(saved[saved.length - 1]).toEqual({ access: 'access-2', refresh: 'krt-2' });
  });

  it('a dead answer (401: the family is revoked) clears memory and storage, returns null, and ends the session once', async () => {
    const refreshEndpoint = jest.fn(async (): Promise<RefreshOutcome> => ({ kind: 'dead' }));
    const { session, deps, stored } = build({ refreshEndpoint });
    await session.bootstrap();
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    expect(await session.refresh()).toBeNull();
    expect(session.getAccessToken()).toBeNull();
    expect(session.hasSession()).toBe(false);
    expect(deps.clearTokens).toHaveBeenCalledTimes(1);
    expect(stored.value).toBeNull();
    expect(events).toEqual([expect.objectContaining({ type: 'ended', reason: 'dead' })]);
  });

  it('C1: an unavailable answer (offline, timeout, 5xx, 429) returns null and KEEPS the session in memory and storage', async () => {
    const refreshEndpoint = jest.fn(async (): Promise<RefreshOutcome> => ({ kind: 'unavailable' }));
    const clock = { t: 0 };
    const { session, deps, stored } = build({ refreshEndpoint, now: () => clock.t });
    await session.bootstrap();
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    expect(await session.refresh()).toBeNull();
    expect(session.getAccessToken()).toBe('access-1');
    expect(session.hasSession()).toBe(true);
    expect(deps.clearTokens).not.toHaveBeenCalled();
    expect(stored.value).toEqual({ access: 'access-1', refresh: 'krt-1' });
    expect(events).toEqual([]);

    // The network comes back: the same refresh token still rotates, once the backoff after the
    // unavailable answer has passed (RA-2; its ceiling is 60 s).
    clock.t = 60_000;
    refreshEndpoint.mockResolvedValueOnce(ok('access-2', 'krt-2'));
    expect(await session.refresh()).toBe('access-2');
    expect(refreshEndpoint).toHaveBeenLastCalledWith('krt-1');
  });

  it('SINGLE-FLIGHT: concurrent refresh calls hit the endpoint exactly once', async () => {
    const answer = deferred<RefreshOutcome>();
    const refreshEndpoint = jest.fn(() => answer.promise);
    const { session, deps } = build({ refreshEndpoint });
    await session.bootstrap();

    const a = session.refresh();
    const b = session.refresh();
    const c = session.refresh();
    answer.resolve(ok('access-9', 'krt-9'));
    const [ra, rb, rc] = await Promise.all([a, b, c]);

    expect(deps.refreshEndpoint).toHaveBeenCalledTimes(1); // not rotated 3×
    expect([ra, rb, rc]).toEqual(['access-9', 'access-9', 'access-9']);
    expect(session.getAccessToken()).toBe('access-9');
  });

  it('a Keychain that fails to save the rotated pair: refresh still returns the fresh access and never rejects', async () => {
    const { session, deps } = build();
    await session.bootstrap();
    deps.saveTokens.mockRejectedValueOnce(new Error('keystore locked'));
    await expect(session.refresh()).resolves.toBe('access-2'); // the server already rotated: this pair is live
    expect(session.getAccessToken()).toBe('access-2');
    expect(deps.clearTokens).not.toHaveBeenCalled();
  });

  it('refresh without a stored refresh token returns null without calling the endpoint', async () => {
    const { session, deps } = build({ stored: null });
    await session.bootstrap();
    expect(await session.refresh()).toBeNull();
    expect(deps.refreshEndpoint).not.toHaveBeenCalled();
  });

  // An access-only session (the login's defensive install when the backend omits a refresh,
  // auth.ts) is refreshed only after its access token was refused; with no refresh token it can
  // never recover, so it is dead — the caller no longer clears it for us (C2, C4).
  it('an access-only session whose access was refused cannot recover: refresh ends it as dead', async () => {
    const { session, deps } = build({ stored: { access: 'acc-only', refresh: '' } });
    await session.bootstrap();
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    expect(await session.refresh()).toBeNull();
    expect(deps.refreshEndpoint).not.toHaveBeenCalled();
    expect(session.getAccessToken()).toBeNull();
    expect(deps.clearTokens).toHaveBeenCalledTimes(1);
    expect(events).toEqual([expect.objectContaining({ type: 'ended', reason: 'dead' })]);
  });

  // REVERSED deliberately (C1): this pinned that a throwing endpoint CLEARS the session. A throw
  // is not the server's dead-family answer — it is a fetch that never reached a verdict — so it
  // is `unavailable`: the session stays, and the next refresh can still rotate it.
  it('FUZZ: a refresh endpoint that throws is treated as unavailable: never propagates, and keeps the session', async () => {
    const refreshEndpoint = jest.fn(async (): Promise<RefreshOutcome> => { throw new Error('network down'); });
    const { session, deps } = build({ refreshEndpoint });
    await session.bootstrap();
    await expect(session.refresh()).resolves.toBeNull();
    expect(session.getAccessToken()).toBe('access-1');
    expect(deps.clearTokens).not.toHaveBeenCalled();
  });

  it.each([
    ['ok', ok('a-2', 'a-krt-2')],
    ['dead', { kind: 'dead' } as RefreshOutcome],
  ])('an %s answer that lands after a sign-out and a new sign-in never touches the new session', async (_l, outcome) => {
    const first = deferred<RefreshOutcome>();
    const refreshEndpoint = jest.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => ok('b-2', 'b-krt-2'));
    const { session, deps, stored } = build({ refreshEndpoint });
    await session.bootstrap();
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));

    const stale = session.refresh(); // A's refresh is in flight…
    await session.clear(); // …the user signs out…
    await session.setSession({ access: 'b-acc', refresh: 'b-krt' }); // …and account B signs in
    expect(await session.refresh()).toBe('b-2'); // B's refresh is its own flight, never A's
    expect(refreshEndpoint).toHaveBeenLastCalledWith('b-krt');

    first.resolve(outcome); // A's answer arrives late
    expect(await stale).toBeNull();
    expect(session.getAccessToken()).toBe('b-2');
    expect(stored.value).toEqual({ access: 'b-2', refresh: 'b-krt-2' });
    expect(deps.clearTokens).toHaveBeenCalledTimes(1); // the sign-out only
    expect(events).toEqual([expect.objectContaining({ type: 'ended', reason: 'cleared' })]);
  });
});

describe('AuthSession — logout and the ended signal', () => {
  it('clear() wipes memory and storage', async () => {
    const { session, deps } = build();
    await session.bootstrap();
    await session.clear();
    expect(session.getAccessToken()).toBeNull();
    expect(deps.clearTokens).toHaveBeenCalled();
  });

  it('setSession installs a fresh pair after login (used by the login flow)', async () => {
    const { session, deps } = build({ stored: null });
    await session.bootstrap();
    await session.setSession({ access: 'login-access', refresh: 'login-krt' });
    expect(session.getAccessToken()).toBe('login-access');
    expect(deps.saveTokens).toHaveBeenCalledWith({ access: 'login-access', refresh: 'login-krt' });
  });

  it('clear() ends a held session (reason cleared); with no session it fires nothing; unsubscribe stops delivery', async () => {
    const { session } = build();
    await session.bootstrap();
    const heard: SessionEvent[] = [];
    const later: SessionEvent[] = [];
    const off = session.subscribe((e) => heard.push(e));
    session.subscribe((e) => later.push(e));
    await session.clear();
    await session.clear(); // nothing held any more: no second event
    expect(heard).toEqual([expect.objectContaining({ type: 'ended', reason: 'cleared' })]);

    off();
    await session.setSession({ access: 'x', refresh: 'y' });
    await session.clear();
    expect(heard).toHaveLength(1);
    expect(later).toEqual([expect.objectContaining({ type: 'ended', reason: 'cleared' }), expect.objectContaining({ type: 'ended', reason: 'cleared' })]);
  });

  it('a listener that throws never breaks the session: the end completes and the other listeners still hear it', async () => {
    const refreshEndpoint = jest.fn(async (): Promise<RefreshOutcome> => ({ kind: 'dead' }));
    const { session, deps } = build({ refreshEndpoint });
    await session.bootstrap();
    const heard: SessionEvent[] = [];
    session.subscribe(() => { throw new Error('listener bug'); });
    session.subscribe((e) => heard.push(e));
    await expect(session.refresh()).resolves.toBeNull();
    expect(deps.clearTokens).toHaveBeenCalledTimes(1);
    expect(heard).toEqual([expect.objectContaining({ type: 'ended', reason: 'dead' })]);
  });

  it('a Keychain that fails to clear still ends the session in memory and tells the listeners', async () => {
    const refreshEndpoint = jest.fn(async (): Promise<RefreshOutcome> => ({ kind: 'dead' }));
    const { session, deps } = build({ refreshEndpoint });
    deps.clearTokens.mockRejectedValueOnce(new Error('keystore locked'));
    await session.bootstrap();
    const heard: SessionEvent[] = [];
    session.subscribe((e) => heard.push(e));
    await expect(session.refresh()).resolves.toBeNull();
    expect(session.getAccessToken()).toBeNull();
    expect(heard).toEqual([expect.objectContaining({ type: 'ended', reason: 'dead' })]);
  });
});

// SA309-2 (S2): react-native-keychain 10.0.0 runs setGenericPassword in a coroutine on
// Dispatchers.Default under a mutex (KeychainModule.kt:132-183) and resetGenericPassword at once,
// without it (:318-336), so a reset issued after a save can complete BEFORE that save's write lands: a
// sign-out right after a rotation left the pair on disk, and a sign-in as B could end with A's pair
// stored. The fake native side completes each save only when the test lets it, in either order.
describe('keychainSession — every Keychain call lands in the order it was issued (SA309-2)', () => {
  const Keychain = require('react-native-keychain');
  let slot: string | null;
  let pendingSaves: Array<() => void>;
  beforeEach(() => {
    slot = null;
    pendingSaves = [];
    Keychain.getGenericPassword.mockImplementation(async () => (slot ? { password: slot } : false));
    Keychain.setGenericPassword.mockImplementation((_u: string, password: string) =>
      new Promise((resolve) => { pendingSaves.push(() => { slot = password; resolve(true); }); }));
    Keychain.resetGenericPassword.mockImplementation(async () => { slot = null; return true; });
  });
  afterEach(() => {
    Keychain.getGenericPassword.mockReset().mockResolvedValue(false);
    Keychain.setGenericPassword.mockReset().mockResolvedValue(true);
    Keychain.resetGenericPassword.mockReset().mockResolvedValue(true);
  });
  // Let the native side finish whatever it holds, oldest or newest first, until nothing is left.
  const drain = async (order: 'oldest' | 'newest') => {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setImmediate(r));
      const next = order === 'oldest' ? pendingSaves.shift() : pendingSaves.pop();
      if (next) next();
    }
  };

  it('a sign-out issued while a save is still on the native side lands last: nothing stays on disk', async () => {
    const session = new AuthSession(keychainSession);
    const saving = session.setSession({ access: 'a-acc', refresh: 'a-krt' });
    const clearing = session.clear(); // the user signs out at once
    await drain('oldest');
    await Promise.all([saving, clearing]);
    expect(slot).toBeNull();
  });

  it('save A, sign out, save B, whatever order the native side finishes them in: B is what is stored', async () => {
    const session = new AuthSession(keychainSession);
    const a = session.setSession({ access: 'a-acc', refresh: 'a-krt' });
    const cleared = session.clear();
    const b = session.setSession({ access: 'b-acc', refresh: 'b-krt' });
    await drain('newest');
    await Promise.all([a, cleared, b]);
    expect(JSON.parse(slot as string)).toEqual({ access: 'b-acc', refresh: 'b-krt' });
    expect(await keychainSession.loadTokens()).toEqual({ access: 'b-acc', refresh: 'b-krt' });
  });
});

// The production endpoint (src/auth/session.ts) against the backend's contract: POST
// /api/auth/refresh answers 200 {token, refreshToken} or 401 {error:'Invalid refresh token'}
// (authController.js `refresh`); it sits behind authLimiter, so it can also answer 429, and any
// thrown error in rotate() is a 500 from the error handler.
describe('keychainSession.refreshEndpoint — the server answer, classified', () => {
  const realFetch = (globalThis as any).fetch;
  afterEach(() => { (globalThis as any).fetch = realFetch; });
  const answer = (status: number, body: unknown = {}) => {
    (globalThis as any).fetch = jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));
  };

  it('200 with a rotated pair is ok, and the request is POST /api/auth/refresh carrying the refresh token', async () => {
    answer(200, { token: 'acc-2', refreshToken: 'krt-2' });
    await expect(keychainSession.refreshEndpoint('krt-1')).resolves.toEqual(ok('acc-2', 'krt-2'));
    const [url, init] = (globalThis as any).fetch.mock.calls[0];
    expect(url).toBe(`${BACKEND_URL}/api/auth/refresh`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'krt-1' });
  });

  it('401 — the server\'s dead-family answer — is dead', async () => {
    answer(401, { error: 'Invalid refresh token' });
    await expect(keychainSession.refreshEndpoint('krt-1')).resolves.toEqual({ kind: 'dead' });
  });

  it.each([500, 502, 503, 504, 429, 400, 403, 404])('%i is unavailable: no proof the family is dead', async (status) => {
    answer(status, { error: 'x' });
    await expect(keychainSession.refreshEndpoint('krt-1')).resolves.toEqual({ kind: 'unavailable' });
  });

  // RA-2: the authLimiter's 429 says how long to wait (express-rate-limit 8, standardHeaders draft-6:
  // Retry-After and RateLimit-Reset, in seconds); the answer carries it so the session holds that long.
  describe('a 429 carries the server\'s wait (RA-2)', () => {
    const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);
    beforeEach(() => { jest.useFakeTimers({ now: NOW }); });
    afterEach(() => { jest.useRealTimers(); });
    const limited = (headers: Record<string, string>) => {
      (globalThis as any).fetch = jest.fn(async () => ({ ok: false, status: 429, headers: new Headers(headers), json: async () => ({ error: 'x' }) }));
    };

    it.each([
      ['Retry-After in seconds', { 'Retry-After': '120', 'RateLimit-Reset': '120' }, 120_000],
      ['Retry-After as an HTTP date', { 'Retry-After': new Date(NOW + 30_000).toUTCString() }, 30_000],
      ['RateLimit-Reset alone', { 'RateLimit-Reset': '90' }, 90_000],
    ])('%s', async (_l, headers, retryAfterMs) => {
      limited(headers);
      await expect(keychainSession.refreshEndpoint('krt-1')).resolves.toEqual({ kind: 'unavailable', retryAfterMs });
    });

    it.each([
      ['no header', {}],
      ['a Retry-After that is not a wait', { 'Retry-After': 'soon' }],
    ])('%s: unavailable with no wait of its own', async (_l, headers) => {
      limited(headers);
      const outcome = await keychainSession.refreshEndpoint('krt-1');
      expect(outcome).toEqual({ kind: 'unavailable' });
      expect('retryAfterMs' in outcome).toBe(false);
    });
  });

  it.each([
    ['offline', new TypeError('Network request failed')],
    ['timed out', new TypeError('Network request timed out')],
    ['aborted', Object.assign(new Error('Aborted'), { name: 'AbortError' })],
  ])('a fetch that throws (%s) is unavailable', async (_l, err) => {
    (globalThis as any).fetch = jest.fn(async () => { throw err; });
    await expect(keychainSession.refreshEndpoint('krt-1')).resolves.toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['an unreadable body (a captive portal\'s HTML)', { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }],
    ['a body without the pair', { ok: true, status: 200, json: async () => ({ token: 'acc-2' }) }],
  ])('a 200 with %s is unavailable, never installed', async (_l, res) => {
    (globalThis as any).fetch = jest.fn(async () => res);
    await expect(keychainSession.refreshEndpoint('krt-1')).resolves.toEqual({ kind: 'unavailable' });
  });
});

// ── C1 delta (B1 P1 charter §2) ─────────────────────────────────────────────────────────────────────
const UID = '0123456789abcdef01234567';
const v2 = (over: Record<string, unknown> = {}) => ({ v: 2 as const, access: 'acc-v2', refresh: 'krt-v2', uid: UID, ...over });

describe('AuthSession C1 — `ended` carries the ended epoch (RA-118, shadow.endedEpoch)', () => {
  it('a clear names the session that ended, never the next one', async () => {
    const { session } = build({ stored: null });
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.setSession({ access: 'a', refresh: 'r' });
    const ended = session.sessionEpoch();
    await session.clear();
    expect(events).toEqual([{ type: 'ended', reason: 'cleared', epoch: ended }]);
    expect(session.sessionEpoch()).toBe(ended + 1);
  });

  it('a dead refresh names the session that died', async () => {
    const { session } = build({ refreshEndpoint: jest.fn(async () => ({ kind: 'dead' })) });
    await session.bootstrap();
    const ended = session.sessionEpoch();
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.refresh();
    expect(events).toEqual([{ type: 'ended', reason: 'dead', epoch: ended }]);
  });
});

describe('AuthSession C1 — one session record {v:2, access, refresh, uid, age?}', () => {
  it('setSession installs a v2 record, saves it as one item, and getSessionUid reads its uid', async () => {
    const { session, saved } = build({ stored: null });
    await session.setSession(v2({ age: { over16: true, on: '2026-11-28' } }));
    expect(session.getAccessToken()).toBe('acc-v2');
    expect(session.getSessionUid()).toBe(UID);
    expect(saved).toEqual([{ v: 2, access: 'acc-v2', refresh: 'krt-v2', uid: UID, age: { over16: true, on: '2026-11-28' } }]);
  });

  it('the age on the device stays {over16, on}: a consent riding on it is never written (REG-P1-R2-1)', async () => {
    const { session, saved } = build({ stored: null });
    const age = { over16: true, on: '2026-11-28', consent: { version: '1', language: 'en', hash: 'f'.repeat(64) }, month: 3, year: 2000 };
    await session.setSession(v2({ age }) as any);
    expect(saved[0]).toEqual({ v: 2, access: 'acc-v2', refresh: 'krt-v2', uid: UID, age: { over16: true, on: '2026-11-28' } });
    expect(JSON.stringify(saved[0])).not.toMatch(/consent|hash|language|month|year/);
  });

  it.each([
    ['an empty access', v2({ access: '' })],
    ['an empty refresh', v2({ refresh: '' })],
    ['a missing uid', v2({ uid: undefined })],
    ['a v1 uid', v2({ uid: 'u1' })],
    ['an uppercase uid', v2({ uid: UID.toUpperCase() })],
    ['a 23-hex uid', v2({ uid: UID.slice(1) })],
    ['a 25-hex uid', v2({ uid: UID + 'a' })],
    ['an age that is not a pass', v2({ age: { over16: false, on: '2026-11-28' } })],
    ['an age with no date', v2({ age: { over16: true } })],
    ['an age with a time in it', v2({ age: { over16: true, on: '2026-11-28T10:00:00Z' } })],
  ])('setSession refuses %s: it rejects and touches nothing', async (_l, record) => {
    const { session, deps } = build();
    await session.bootstrap();
    const epoch = session.sessionEpoch();
    await expect(session.setSession(record as any)).rejects.toThrow();
    expect(session.getAccessToken()).toBe('access-1');
    expect(session.getSessionUid()).toBeNull();
    expect(session.sessionEpoch()).toBe(epoch);
    expect(deps.saveTokens).not.toHaveBeenCalled();
  });

  it('v1 is unchanged: setSession({access, refresh}) saves the bare pair, and an access-only pair still installs', async () => {
    const { session, saved } = build({ stored: null });
    await session.setSession({ access: 'a', refresh: '' });
    expect(saved).toEqual([{ access: 'a', refresh: '' }]);
    expect(session.hasSession()).toBe(true);
    expect(session.getSessionUid()).toBeNull();
  });

  it('a rotation keeps uid and age', async () => {
    const { session, saved } = build({ stored: null });
    await session.setSession(v2({ age: { over16: true, on: '2026-11-28' } }));
    expect(await session.refresh()).toBe('access-2');
    expect(saved[1]).toEqual({ v: 2, access: 'access-2', refresh: 'krt-2', uid: UID, age: { over16: true, on: '2026-11-28' } });
    expect(session.getSessionUid()).toBe(UID);
  });

  it('a v1 rotation still saves the bare pair', async () => {
    const { session, saved } = build();
    await session.bootstrap();
    await session.refresh();
    expect(saved).toEqual([{ access: 'access-2', refresh: 'krt-2' }]);
  });

  it('bootstrap reads a stored v2 record with its uid', async () => {
    const { session, saved } = build({ stored: v2({ age: { over16: true, on: '2026-11-28' } }) });
    expect(await session.bootstrap()).toBe(true);
    expect(session.getSessionUid()).toBe(UID);
    await session.refresh();
    expect(saved[0]).toEqual({ v: 2, access: 'access-2', refresh: 'krt-2', uid: UID, age: { over16: true, on: '2026-11-28' } });
  });

  it('a stored pair without a uid reads as v1', async () => {
    const { session } = build({ stored: { access: 'p-acc', refresh: 'p-krt' } });
    expect(await session.bootstrap()).toBe(true);
    expect(session.getAccessToken()).toBe('p-acc');
    expect(session.getSessionUid()).toBeNull();
  });

  it('a stored v2 record with a malformed uid keeps its tokens and reads as v1', async () => {
    const { session, saved } = build({ stored: v2({ uid: 'not-a-uid' }) });
    expect(await session.bootstrap()).toBe(true);
    expect(session.getAccessToken()).toBe('acc-v2');
    expect(session.getSessionUid()).toBeNull();
    await session.refresh();
    expect(saved[0]).toEqual({ access: 'access-2', refresh: 'krt-2' });
  });

  it('a stored v2 record with a malformed age keeps its uid and drops the age', async () => {
    const { session, saved } = build({ stored: v2({ age: { over16: 'yes', on: 5 } }) });
    await session.bootstrap();
    expect(session.getSessionUid()).toBe(UID);
    await session.refresh();
    expect(saved[0]).toEqual({ v: 2, access: 'access-2', refresh: 'krt-2', uid: UID });
  });

  it('an end clears the uid with the tokens', async () => {
    const { session } = build({ stored: null });
    await session.setSession(v2());
    await session.clear();
    expect(session.getSessionUid()).toBeNull();
  });

  it('a later v1 sign-in drops the earlier v2 uid', async () => {
    const { session } = build({ stored: null });
    await session.setSession(v2());
    await session.setSession({ access: 'a', refresh: 'r' });
    expect(session.getSessionUid()).toBeNull();
  });
});

describe('AuthSession C1 — clear({onlyIfEpoch})', () => {
  it('ends the session when the epoch still matches', async () => {
    const { session, deps } = build();
    await session.bootstrap();
    const epoch = session.sessionEpoch();
    await session.clear({ onlyIfEpoch: epoch });
    expect(session.hasSession()).toBe(false);
    expect(deps.clearTokens).toHaveBeenCalledTimes(1);
  });

  it('a stale epoch is a no-op: the newer session, its Keychain item and its listeners are untouched', async () => {
    const { session, deps, stored } = build({ stored: null });
    await session.setSession({ access: 'a1', refresh: 'r1' });
    const old = session.sessionEpoch();
    await session.setSession(v2());
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.clear({ onlyIfEpoch: old });
    expect(session.getAccessToken()).toBe('acc-v2');
    expect(stored.value).toEqual(v2());
    expect(deps.clearTokens).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });

  it('clear() with no scope behaves as before', async () => {
    const { session } = build();
    await session.bootstrap();
    await session.clear();
    expect(session.hasSession()).toBe(false);
  });
});

describe('AuthSession C1 — endAsDead({onlyIfEpoch}) for a refused fresh token', () => {
  it('ends the matching session as dead', async () => {
    const { session } = build();
    await session.bootstrap();
    const epoch = session.sessionEpoch();
    const events: SessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    expect(await session.endAsDead({ onlyIfEpoch: epoch })).toBe(true);
    expect(events).toEqual([{ type: 'ended', reason: 'dead', epoch }]);
  });

  it('a stale epoch is a no-op', async () => {
    const { session, deps } = build();
    await session.bootstrap();
    const old = session.sessionEpoch();
    await session.setSession({ access: 'n', refresh: 'nr' });
    expect(await session.endAsDead({ onlyIfEpoch: old })).toBe(false);
    expect(session.getAccessToken()).toBe('n');
    expect(deps.clearTokens).not.toHaveBeenCalled();
  });
});

describe('AuthSession C1 — a read-only refreshHold()', () => {
  it('is null with no hold, the remaining ms inside one, and null after it', async () => {
    const clock = { t: 1_000_000 };
    const refreshEndpoint = jest.fn(async (): Promise<RefreshOutcome> => ({ kind: 'unavailable', retryAfterMs: 30_000 }));
    const { session } = build({ refreshEndpoint, now: () => clock.t });
    await session.bootstrap();
    expect(session.refreshHold()).toBeNull();
    await session.refresh();
    expect(session.refreshHold()).toBe(30_000);
    clock.t += 10_000;
    expect(session.refreshHold()).toBe(20_000);
    expect(session.refreshHold()).toBe(20_000); // reading changes nothing
    expect(await session.refresh()).toBeNull();
    expect(refreshEndpoint).toHaveBeenCalledTimes(1);
    clock.t += 20_000;
    expect(session.refreshHold()).toBeNull();
  });

  it('a new session has no hold', async () => {
    const clock = { t: 0 };
    const { session } = build({ refreshEndpoint: jest.fn(async () => ({ kind: 'unavailable', retryAfterMs: 30_000 })), now: () => clock.t });
    await session.bootstrap();
    await session.refresh();
    await session.setSession(v2());
    expect(session.refreshHold()).toBeNull();
  });
});
