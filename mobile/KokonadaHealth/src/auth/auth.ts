import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { BACKEND_URL, GOOGLE_WEB_CLIENT_ID } from '../health/config';
import { authSession } from './session';
import { AuthError, authErrorKindForStatus } from './authErrors';

// The Google Sign-In SDK rejects a network failure with CommonStatusCodes.NETWORK_ERROR (7) as its
// code string (google-signin's ErrorDto.kt); the library exports no constant for it.
const GOOGLE_NETWORK_ERROR = '7';

// C7: a native Google failure, typed. A cancel never gets here — v16 resolves it.
function googleFailure(e: unknown): AuthError {
  const message = (e as { message?: string } | null)?.message ?? 'Google sign-in failed';
  if (isErrorWithCode(e)) {
    if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return new AuthError('playServices', message);
    if (e.code === GOOGLE_NETWORK_ERROR) return new AuthError('network', message);
  }
  return new AuthError('unknown', message);
}

// RA-7: RN's fetch has no deadline (RN 0.86's Android OkHttp client is built with 0 ms timeouts) and
// AbortSignal.timeout is not on Hermes, so an exchange the network never answered left the sign-in
// screen busy for good. It is aborted after EXCHANGE_TIMEOUT_MS, and settles then even if the fetch
// ignores the abort: a `network` failure the screen words as such.
const EXCHANGE_TIMEOUT_MS = 15_000;

async function postWithDeadline(url: string, body: Record<string, unknown>, ms: number): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Sign-in request timed out')); }, ms);
  });
  try {
    return await Promise.race([
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// The provider-token exchange both providers share. Every failure is an AuthError whose kind comes
// from the backend's status; `message` keeps the server's text as before (never shown, C7).
async function exchange(path: string, body: Record<string, unknown>): Promise<{ token?: string; refreshToken?: string; user: KokonadaUser }> {
  let res: Response;
  try {
    res = await postWithDeadline(`${BACKEND_URL}${path}`, body, EXCHANGE_TIMEOUT_MS);
  } catch (e: any) {
    throw new AuthError('network', e?.message ?? 'Network request failed');
  }
  if (!res.ok) {
    // RA-11: the kind comes from the status whatever the body is (JSON null, a string, HTML).
    const failed: unknown = await res.json().catch(() => null);
    const serverText = (failed as { error?: unknown } | null)?.error;
    throw new AuthError(authErrorKindForStatus(res.status), (typeof serverText === 'string' && serverText) || `Auth failed (${res.status})`);
  }
  let answer: unknown;
  try {
    answer = await res.json();
  } catch (e: any) {
    throw new AuthError('unknown', e?.message ?? 'Unreadable sign-in response');
  }
  // RA-11: a 200 that names no account is no sign-in, so nothing is installed for it.
  const user = (answer as { user?: { id?: unknown } } | null)?.user;
  if (!user || typeof user !== 'object' || typeof user.id !== 'string' || !user.id) {
    throw new AuthError('unknown', 'Sign-in returned no account');
  }
  return answer as { token?: string; refreshToken?: string; user: KokonadaUser };
}

export interface KokonadaUser {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  wearableProvider?: string | null;
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  // webClientId MUST be the OAuth 2.0 *Web* client ID — it is the audience the
  // backend verifies in POST /api/auth/google (must equal backend GOOGLE_CLIENT_ID).
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
  configured = true;
}

// Google Sign-In → backend exchange → store JWT. Mirrors the web app's
// `POST /api/auth/google { idToken }` → `{ token, user }` contract. Returns null when the user
// CANCELS the Google sheet (C7): v16 resolves a cancel as { type: 'cancelled' }, and a cancel is a
// normal action, not a failure, so the caller shows no error. Every failure throws an AuthError.
export async function signInWithGoogle(): Promise<KokonadaUser | null> {
  ensureConfigured();
  let result: any;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    result = await GoogleSignin.signIn();
  } catch (e) {
    throw googleFailure(e);
  }
  if (result?.type === 'cancelled') return null;
  // Return shape changed across versions: v13+ → { type:'success', data:{ idToken } },
  // older → { idToken }. Support both.
  const idToken: string | undefined = result?.data?.idToken ?? result?.idToken;
  if (!idToken) throw new AuthError('unknown', 'Google sign-in returned no idToken');

  // client:'mobile' makes the backend issue a short-lived access token PLUS a
  // rotating refresh token (handleSso → tokenService.issueSession). Without it the
  // backend falls back to the legacy 7-day cookie token and returns no refresh,
  // leaving AuthSession empty and the socket unauthenticated. (QA4 Suspect #1)
  const { token, refreshToken, user } = await exchange('/api/auth/google', { idToken, platform: 'android', client: 'mobile' });
  // Install into the single AuthSession token plane — the socket (sync getAccessToken)
  // and the REST apiClient both read from it. client:'mobile' normally returns a
  // rotating pair; defensively, if the backend ever returns an access token WITHOUT a
  // refresh (rollback/misconfig), still install it so the session isn't left silently
  // empty — it authenticates until expiry, then a 401 triggers a clean re-login rather
  // than a broken no-auth state. Since the legacy tokenStore fallback was removed, this
  // guard is the only thing between "no refresh" and "no session". (QA4 Squad 2)
  if (token) {
    await authSession.setSession({ access: token, refresh: refreshToken ?? '' });
  }
  return user as KokonadaUser;
}

// Sign in with Apple → backend exchange → store JWT. Apple App Store Guideline 4.8 requires
// this privacy-forward option wherever a third-party login (Google) is offered on iOS. The
// contract mirrors signInWithGoogle exactly: exchange the provider identity token at
// POST /api/auth/apple with client:'mobile' (issues the rotating {access,refresh} pair the
// socket needs) → install into the single AuthSession token plane. Apple returns the email
// only on first grant and may hand back a private-relay address — the backend accepts it.
// Returns null when the user deliberately CANCELS the Apple sheet — a cancel is a normal
// action, not a failure, so the caller shows no error. Any other ASAuthorization failure is
// surfaced as a friendly, throwable message.
export async function signInWithApple(): Promise<KokonadaUser | null> {
  let resp;
  try {
    resp = await appleAuth.performRequest({
      requestedOperation: appleAuth.Operation.LOGIN,
      requestedScopes: [appleAuth.Scope.FULL_NAME, appleAuth.Scope.EMAIL],
    });
  } catch (e: any) {
    // 1001 CANCELED — the user backed out. Silent no-op (no error banner, no network).
    if (e?.code === appleAuth.Error.CANCELED) return null;
    // Everything else (1000/1002/1003/1004) is an actual failure — one friendly message.
    throw new AuthError('unknown', 'Apple sign-in could not be completed. Please try again.');
  }

  const identityToken = resp?.identityToken;
  if (!identityToken) throw new AuthError('unknown', 'Apple sign-in returned no identity token');

  const { token, refreshToken, user } = await exchange('/api/auth/apple', { identityToken, platform: 'ios', client: 'mobile' });
  if (token) {
    await authSession.setSession({ access: token, refresh: refreshToken ?? '' });
  }
  return user as KokonadaUser;
}

export async function isLoggedIn(): Promise<boolean> {
  // Hydrate the in-memory token plane from the Keychain and report whether a session
  // exists. bootstrap() is the same session check the prod ignition uses.
  return authSession.bootstrap();
}

export async function signOut(): Promise<void> {
  try { await GoogleSignin.signOut(); } catch { /* ignore */ }
  await authSession.clear();
}
