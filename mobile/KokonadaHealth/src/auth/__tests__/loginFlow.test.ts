// Suspect #1 (QA4 — Crypto & State): the socket auth plane was DORMANT in prod.
// Google login wrote only the legacy single JWT, never populated AuthSession, and
// never asked the backend for the rotating {access,refresh} pair (the backend only
// returns it when the request body carries client:'mobile'). Result:
// authSession.getAccessToken() was always null → startPlayback() gated the socket on
// authSession.bootstrap() → the socket NEVER connected in production. These tests pin
// the fix: login requests the mobile session and installs it — and the token plane is
// now unified on AuthSession alone (the legacy JWT store has been removed).

import { signInWithGoogle, signInWithApple, signOut, isLoggedIn } from '../auth';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';

jest.mock('../session', () => ({
  authSession: {
    setSession: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    bootstrap: jest.fn().mockResolvedValue(false),
  },
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

  it('installs ONLY the AuthSession pair — one fetch, no legacy write', async () => {
    mockFetchOnce({ token: 'acc-1', refreshToken: 'ref-1', user: USER });
    await signInWithGoogle();
    // The unified plane means login hits the backend exactly once (the SSO exchange);
    // there is no second Keychain plane to dual-write anymore.
    expect(((globalThis as any).fetch as jest.Mock).mock.calls.length).toBe(1);
    expect(authSession.setSession).toHaveBeenCalledTimes(1);
  });

  it('installs an access-only session if the backend omits a refresh (never a silent no-auth state)', async () => {
    mockFetchOnce({ token: 'acc-only', user: USER });
    const user = await signInWithGoogle();
    // Defensive: without a refresh we still install the access token (refresh '') so the
    // session is never left empty now that the legacy tokenStore fallback is gone. It
    // authenticates until expiry, then a 401 triggers a clean re-login.
    expect(authSession.setSession).toHaveBeenCalledWith({ access: 'acc-only', refresh: '' });
    expect(user).toEqual(USER);
  });

  it('throws a clear error when the backend rejects the sign-in', async () => {
    mockFetchOnce({ error: 'bad token' }, false, 401);
    await expect(signInWithGoogle()).rejects.toThrow('bad token');
    expect(authSession.setSession).not.toHaveBeenCalled();
  });
});

describe('signInWithApple — Guideline 4.8 privacy-forward login (mobile session, mirrors Google)', () => {
  beforeEach(() => {
    (appleAuth.performRequest as jest.Mock).mockResolvedValue({
      identityToken: 'apple-idtok', authorizationCode: 'code', user: 'apple-sub', email: 'relay@privaterelay.appleid.com', nonce: 'n',
    });
  });

  it('exchanges the Apple identityToken at /api/auth/apple as a mobile session (client:"mobile", platform:"ios")', async () => {
    mockFetchOnce({ token: 'acc', refreshToken: 'ref', user: USER });
    await signInWithApple();

    const [url, init] = ((globalThis as any).fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/api/auth/apple');
    const body = JSON.parse(init.body);
    expect(body.identityToken).toBe('apple-idtok');
    expect(body.client).toBe('mobile');
    expect(body.platform).toBe('ios');
  });

  it('installs the rotating pair into AuthSession so the socket can authenticate', async () => {
    mockFetchOnce({ token: 'acc-a', refreshToken: 'ref-a', user: USER });
    const user = await signInWithApple();
    expect(authSession.setSession).toHaveBeenCalledWith({ access: 'acc-a', refresh: 'ref-a' });
    expect(user).toEqual(USER);
  });

  it('throws when Apple returns no identityToken (nothing to verify)', async () => {
    (appleAuth.performRequest as jest.Mock).mockResolvedValueOnce({ identityToken: null });
    await expect(signInWithApple()).rejects.toThrow(/identity token/i);
    expect(authSession.setSession).not.toHaveBeenCalled();
  });

  it('throws a clear error when the backend rejects the Apple sign-in', async () => {
    mockFetchOnce({ error: 'bad apple token' }, false, 401);
    await expect(signInWithApple()).rejects.toThrow('bad apple token');
    expect(authSession.setSession).not.toHaveBeenCalled();
  });

  it('treats a user CANCEL as a benign no-op — resolves null, no throw, no session, no network', async () => {
    (globalThis as any).fetch = jest.fn();
    (appleAuth.performRequest as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('The user canceled the authorization attempt.'), { code: appleAuth.Error.CANCELED }),
    );
    await expect(signInWithApple()).resolves.toBeNull();
    expect(authSession.setSession).not.toHaveBeenCalled();
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('maps a non-cancel ASAuthorization error to a friendly message', async () => {
    (appleAuth.performRequest as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('ASAuthorizationError 1004'), { code: appleAuth.Error.FAILED }),
    );
    await expect(signInWithApple()).rejects.toThrow(/apple sign-in/i);
    expect(authSession.setSession).not.toHaveBeenCalled();
  });
});

describe('signOut / isLoggedIn — routed through AuthSession', () => {
  it('signOut signs out of Google AND clears the AuthSession pair', async () => {
    await signOut();
    expect(GoogleSignin.signOut).toHaveBeenCalledTimes(1);
    expect(authSession.clear).toHaveBeenCalledTimes(1);
  });

  it('signOut still clears the session even if Google sign-out throws', async () => {
    (GoogleSignin.signOut as jest.Mock).mockRejectedValueOnce(new Error('play services'));
    await signOut();
    expect(authSession.clear).toHaveBeenCalledTimes(1);
  });

  it('isLoggedIn reflects a hydrated AuthSession', async () => {
    (authSession.bootstrap as jest.Mock).mockResolvedValueOnce(true);
    expect(await isLoggedIn()).toBe(true);
    (authSession.bootstrap as jest.Mock).mockResolvedValueOnce(false);
    expect(await isLoggedIn()).toBe(false);
  });
});
