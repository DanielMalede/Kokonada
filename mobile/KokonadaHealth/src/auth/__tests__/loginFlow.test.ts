// Suspect #1 (QA4 — Crypto & State): the socket auth plane was DORMANT in prod.
// Google login wrote only tokenStore (the legacy single JWT), never populated
// AuthSession, and never asked the backend for the rotating {access,refresh} pair
// (the backend only returns it when the request body carries client:'mobile').
// Result: authSession.getAccessToken() was always null → startPlayback() gated the
// socket on authSession.bootstrap() → the socket NEVER connected in production.
// These tests pin the fix: login requests the mobile session and installs it.

import { signInWithGoogle } from '../auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

jest.mock('../session', () => ({
  authSession: { setSession: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../tokenStore', () => ({
  saveToken: jest.fn().mockResolvedValue(undefined),
  getToken: jest.fn().mockResolvedValue(null),
  clearToken: jest.fn().mockResolvedValue(undefined),
}));

import { authSession } from '../session';

const USER = { id: 'u1', displayName: 'Dan', email: 'd@x.io' };

function mockFetchOnce(body: any, ok = true, status = 200) {
  (globalThis as any).fetch = jest.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ data: { idToken: 'idtok-123' } });
});

describe('signInWithGoogle — token-plane unification (Suspect #1)', () => {
  it('requests the mobile session (client:"mobile") so the backend returns a refresh token', async () => {
    mockFetchOnce({ token: 'acc', refreshToken: 'ref', user: USER });
    await signInWithGoogle();

    const [, init] = ((globalThis as any).fetch as jest.Mock).mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(sentBody.client).toBe('mobile');
    expect(sentBody.idToken).toBe('idtok-123');
  });

  it('installs the rotating pair into AuthSession so the socket can authenticate', async () => {
    mockFetchOnce({ token: 'acc-9', refreshToken: 'ref-9', user: USER });
    const user = await signInWithGoogle();

    expect(authSession.setSession).toHaveBeenCalledWith({ access: 'acc-9', refresh: 'ref-9' });
    expect(user).toEqual(USER);
  });

  it('degrades gracefully if the backend omits a refresh token (never crashes login)', async () => {
    mockFetchOnce({ token: 'acc-only', user: USER });
    const user = await signInWithGoogle();
    // No refresh token → do not install a half-session, but login still succeeds.
    expect(authSession.setSession).not.toHaveBeenCalled();
    expect(user).toEqual(USER);
  });

  it('throws a clear error when the backend rejects the sign-in', async () => {
    mockFetchOnce({ error: 'bad token' }, false, 401);
    await expect(signInWithGoogle()).rejects.toThrow('bad token');
    expect(authSession.setSession).not.toHaveBeenCalled();
  });
});
