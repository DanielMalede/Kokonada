// PR #309 review (shadow): the contracts the auth plane promises its callers, held under answers no
// well-behaved server gives. RA-11 (S3): AuthSession.refresh() NEVER rejects (the REST client and the
// socket await it without a catch of their own) and never installs a malformed pair; a sign-in failure
// is ALWAYS an AuthError of its status's kind (the sign-in screen picks its words by kind), and a 200
// that carries no account installs nothing.

import { AuthSession, type AuthSessionDeps, type RefreshOutcome } from '../auth/authSession';
import { signInWithGoogle } from '../auth/auth';
import { AuthError } from '../auth/authErrors';
import { authSession } from '../auth/session';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

const realFetch = (globalThis as any).fetch;
afterEach(() => { (globalThis as any).fetch = realFetch; });

function heldSession(answer: unknown) {
  const stored: { value: { access: string; refresh: string } | null } = { value: { access: 'acc-1', refresh: 'krt-1' } };
  const deps: AuthSessionDeps = {
    loadTokens: async () => stored.value,
    saveTokens: async (t) => { stored.value = t; },
    clearTokens: async () => { stored.value = null; },
    refreshEndpoint: async () => answer as RefreshOutcome,
  };
  return { session: new AuthSession(deps), stored };
}

describe('AuthSession.refresh() never rejects and never installs a malformed answer (RA-11)', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['ok without tokens', { kind: 'ok' }],
    ['ok with an empty access token', { kind: 'ok', tokens: { access: '', refresh: 'krt-2' } }],
    ['ok with an empty refresh token', { kind: 'ok', tokens: { access: 'acc-2', refresh: '' } }],
    ['ok with tokens that are not strings', { kind: 'ok', tokens: { access: 42, refresh: {} } }],
    ['a kind it does not know', { kind: 'maybe' }],
  ])('the endpoint answers %s: refresh() resolves null and the held pair stays, in memory and stored', async (_l, answer) => {
    const { session, stored } = heldSession(answer);
    await session.bootstrap();
    await expect(session.refresh()).resolves.toBeNull();
    expect(session.getAccessToken()).toBe('acc-1');
    expect(session.hasSession()).toBe(true);
    expect(stored.value).toEqual({ access: 'acc-1', refresh: 'krt-1' });
  });
});

describe('a sign-in failure is an AuthError of its status\'s kind, whatever its body (RA-11)', () => {
  beforeEach(() => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ type: 'success', data: { idToken: 'idtok' } });
  });
  const answer = (status: number, body: unknown) => {
    (globalThis as any).fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
  };
  const failure = () => signInWithGoogle().then(() => null, (e) => e);

  it.each([
    [429, 'rateLimited'],
    [422, 'noEmail'],
    [401, 'rejected'],
    [503, 'server'],
  ] as const)('a %i whose body is JSON null is %s', async (status, kind) => {
    answer(status, null);
    const e = await failure();
    expect(e).toBeInstanceOf(AuthError);
    expect(e.kind).toBe(kind);
    expect(e.message).toBe(`Auth failed (${status})`);
  });

  it.each([
    ['null', null],
    ['a token but no account', { token: 'acc-x', refreshToken: 'krt-x' }],
    ['an account without an id', { token: 'acc-x', refreshToken: 'krt-x', user: { displayName: 'X' } }],
  ])('a 200 whose body is %s is an unknown AuthError, and no session is installed', async (_l, body) => {
    const setSession = jest.spyOn(authSession, 'setSession');
    answer(200, body);
    const e = await failure();
    expect(e).toBeInstanceOf(AuthError);
    expect(e.kind).toBe('unknown');
    expect(setSession).not.toHaveBeenCalled();
    setSession.mockRestore();
  });
});

// Security L2 (S2): the sign-out sent no refresh token, so the server never revoked the session's
// refresh family (backend/app/controllers/authController.js `logout`: a presented refresh token takes
// its whole rotation family down with it): a refresh token copied off the phone went on minting access
// tokens after the sign-out. The logout carries the held refresh token, read before the local wipe.
describe('a sign-out revokes the refresh family on the server (security L2)', () => {
  const signOutThroughProfile = async (pair: { access: string; refresh: string }) => {
    jest.doMock('../experience/playback/playbackServices', () => ({
      player: { dispose: jest.fn(async () => {}) },
      kokoSocket: { disconnect: jest.fn() },
      orchestrator: { clear: jest.fn(), resume: jest.fn() },
    }));
    let profile: any;
    let session: any;
    jest.isolateModules(() => {
      profile = require('../experience/profile/profileServices');
      session = require('../auth/session');
    });
    await session.authSession.setSession(pair);
    const sent: Array<{ method: string; path: string; body: unknown; heldAtSend: boolean }> = [];
    (globalThis as any).fetch = jest.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
      const path = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
      sent.push({ method: init.method ?? 'GET', path, body: init.body ? JSON.parse(init.body) : undefined, heldAtSend: session.authSession.hasSession() });
      return { ok: true, status: 200, json: async () => ({ message: 'Logged out successfully' }) };
    });
    await profile.profileController.logout();
    jest.dontMock('../experience/playback/playbackServices');
    return { logout: sent.find((r) => r.method === 'POST' && r.path === '/api/auth/logout'), session: session.authSession };
  };

  it('POST /api/auth/logout carries the held refresh token, sent while the session is still held, and the session is cleared after it', async () => {
    const { logout, session } = await signOutThroughProfile({ access: 'acc-1', refresh: 'krt-1' });
    expect(logout?.body).toEqual({ refreshToken: 'krt-1' });
    expect(logout?.heldAtSend).toBe(true);
    expect(session.hasSession()).toBe(false);
  });

  it('an access-only session (no refresh token) sends no refresh token field', async () => {
    const { logout } = await signOutThroughProfile({ access: 'acc-only', refresh: '' });
    expect(logout).toBeDefined();
    expect(logout?.body).toBeUndefined();
  });
});
