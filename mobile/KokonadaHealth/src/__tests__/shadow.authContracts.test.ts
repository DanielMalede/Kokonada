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
