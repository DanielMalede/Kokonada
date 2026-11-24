// Suspect #1 (QA4 — Crypto & State): the socket auth plane was DORMANT in prod.
// Google login wrote only the legacy single JWT, never populated AuthSession, and
// never asked the backend for the rotating {access,refresh} pair (the backend only
// returns it when the request body carries client:'mobile'). Result:
// authSession.getAccessToken() was always null → startPlayback() gated the socket on
// authSession.bootstrap() → the socket NEVER connected in production. These tests pin
// the fix: login requests the mobile session and installs it — and the token plane is
// now unified on AuthSession alone (the legacy JWT store has been removed).

import { signInWithGoogle, signInWithApple, signOut, isLoggedIn } from '../auth';
import { AuthError } from '../authErrors';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';

// google-signin 16.1.2 as the Android native module exports it (RNGoogleSigninModule
// getTypedExportedConstants; CommonStatusCodes.SIGN_IN_REQUIRED is 4), and isErrorWithCode as its
// functions.ts defines it. jest.setup.js's global mock has neither, so this file mocks it whole.
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: '12501',
    IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: '4',
    NULL_PRESENTER: 'NULL_PRESENTER',
  },
  isErrorWithCode: (error: any) => (error instanceof Error || (typeof error === 'object' && error != null)) && 'code' in error,
}));

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

// C7 (B1 charter §6 item 5): google-signin v16 RESOLVES a cancel as { type: 'cancelled', data: null }
// (src/translateNativeRejection.ts), so the old "no idToken" throw turned a deliberate back-out into
// an error banner. And every failure is now a typed AuthError: the screen picks its own words by
// kind, while `message` keeps what it carried before (the server's text, for diagnostics only).
describe('C7 — sign-in failures are typed, and a Google cancel is not a failure', () => {
  const kindOf = async (p: Promise<unknown>) => {
    const e = await p.then(() => null, (err) => err);
    expect(e).toBeInstanceOf(AuthError);
    return (e as AuthError).kind;
  };

  it('a cancelled Google sign-in resolves null: no error, no network request, no session', async () => {
    (globalThis as any).fetch = jest.fn();
    (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({ type: 'cancelled', data: null });
    await expect(signInWithGoogle()).resolves.toBeNull();
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
    expect(authSession.setSession).not.toHaveBeenCalled();
  });

  it('v16\'s success shape { type: "success", data: { idToken } } signs in', async () => {
    mockFetchOnce({ token: 'acc', refreshToken: 'ref', user: USER });
    (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({ type: 'success', data: { idToken: 'idtok-16', user: {} } });
    await expect(signInWithGoogle()).resolves.toEqual(USER);
    expect(JSON.parse(((globalThis as any).fetch as jest.Mock).mock.calls[0][1].body).idToken).toBe('idtok-16');
  });

  it('a success with no idToken is an unknown AuthError, and nothing is sent', async () => {
    (globalThis as any).fetch = jest.fn();
    (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({ type: 'success', data: { idToken: null } });
    expect(await kindOf(signInWithGoogle())).toBe('unknown');
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it('no Google Play services (hasPlayServices rejects PLAY_SERVICES_NOT_AVAILABLE) is playServices', async () => {
    (GoogleSignin.hasPlayServices as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('Play services not available'), { code: 'PLAY_SERVICES_NOT_AVAILABLE' }),
    );
    expect(await kindOf(signInWithGoogle())).toBe('playServices');
    expect(GoogleSignin.signIn).not.toHaveBeenCalled();
  });

  it('the native Google sign-in failing on the network (CommonStatusCodes.NETWORK_ERROR, "7") is network', async () => {
    (GoogleSignin.signIn as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('NETWORK_ERROR'), { code: '7' }));
    expect(await kindOf(signInWithGoogle())).toBe('network');
  });

  it('any other native Google failure is unknown', async () => {
    (GoogleSignin.signIn as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('DEVELOPER_ERROR'), { code: '10' }));
    expect(await kindOf(signInWithGoogle())).toBe('unknown');
  });

  it('the token exchange failing to reach the server (fetch throws) is network, and no session is installed', async () => {
    (globalThis as any).fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
    expect(await kindOf(signInWithGoogle())).toBe('network');
    expect(authSession.setSession).not.toHaveBeenCalled();
  });

  it.each([
    [422, 'noEmail', 'Your account did not share an email address, which is required to sign up.'],
    [429, 'rateLimited', 'Too many authentication attempts — please try again in 15 minutes'],
    [400, 'rejected', 'idToken is required'],
    [401, 'rejected', 'Invalid token'],
    [500, 'server', 'Internal server error'],
    [503, 'server', undefined],
    [404, 'unknown', undefined],
  ] as const)('the exchange answering %i is %s; message keeps what it carried before', async (status, kind, serverText) => {
    mockFetchOnce(serverText ? { error: serverText } : {}, false, status);
    const e = await signInWithGoogle().then(() => null, (err) => err);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.kind).toBe(kind);
    expect(e.message).toBe(serverText ?? `Auth failed (${status})`);
    expect(authSession.setSession).not.toHaveBeenCalled();
  });

  // RA-7 (S2): RN's fetch has no deadline (RN 0.86's Android OkHttp client: 0 ms timeouts), so an
  // exchange the network never answered left the sign-in screen busy for good.
  it('a token exchange the network never answers is aborted and is network within 30 s, and no session is installed', async () => {
    jest.useFakeTimers();
    try {
      const fetch = jest.fn((_url: string, init: { signal?: AbortSignal } = {}) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      }));
      (globalThis as any).fetch = fetch;
      const attempt = signInWithGoogle().then(() => null, (err) => err);
      await jest.advanceTimersByTimeAsync(30_000);
      const e = await Promise.race([attempt, Promise.resolve('still waiting')]);
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).kind).toBe('network');
      expect((fetch.mock.calls[0] as any[])[1].signal.aborted).toBe(true);
      expect(authSession.setSession).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a 200 whose body cannot be read is unknown, and no session is installed', async () => {
    (globalThis as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    expect(await kindOf(signInWithGoogle())).toBe('unknown');
    expect(authSession.setSession).not.toHaveBeenCalled();
  });

  describe('Apple, through the same exchange', () => {
    beforeEach(() => {
      (appleAuth.performRequest as jest.Mock).mockResolvedValue({ identityToken: 'apple-idtok' });
    });

    it('a 422 (no email shared) is noEmail', async () => {
      mockFetchOnce({ error: 'Your account did not share an email address, which is required to sign up.' }, false, 422);
      expect(await kindOf(signInWithApple())).toBe('noEmail');
    });

    it('offline is network', async () => {
      (globalThis as any).fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed'));
      expect(await kindOf(signInWithApple())).toBe('network');
    });

    it('a non-cancel ASAuthorization failure and a missing identity token are unknown', async () => {
      (appleAuth.performRequest as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('1004'), { code: appleAuth.Error.FAILED }));
      expect(await kindOf(signInWithApple())).toBe('unknown');
      (appleAuth.performRequest as jest.Mock).mockResolvedValueOnce({ identityToken: null });
      expect(await kindOf(signInWithApple())).toBe('unknown');
    });
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
