import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { BACKEND_URL, GOOGLE_WEB_CLIENT_ID } from '../health/config';
import { authSession } from './session';
import { SESSION_UID_PATTERN, type SessionRecord } from './authSession';
import {
  AuthError, authErrorKindForStatus, googleErrorCode, googleErrorKind, refusalKind, GOOGLE_STATUS, type SignInFailureKind,
} from './authErrors';
import { parseRetryAfter } from '../net/serverWait';

// C7: a native Google failure, typed by the literal codes authErrors.ts owns (never the library's
// run-time statusCodes). A cancel never gets here — v16 resolves it.
function googleFailure(e: unknown): AuthError {
  const message = (e as { message?: string } | null)?.message ?? 'Google sign-in failed';
  return new AuthError(googleErrorKind(e), message);
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

// ── C7 (B1 P11 charter §2): the v2 sign-in port's parts ─────────────────────────────────────────────
// The v2 adapter (src/app/adapters/signInAdapter.ts) composes them: it checks the age pass, raises the
// pending window, runs googleStep(), then exchangeGoogle(), then installs the record itself, after its
// abandon check. Every typed outcome carries the stage that produced it (RA-166 hole 1); only the
// adapter reads it. v1's signInWithGoogle above keeps its behaviour and its return shape.

export type SignInStage = 'google' | 'exchange';

export type GoogleStepOutcome =
  | { type: 'idToken'; stage: 'google'; idToken: string }
  | { type: 'cancelled'; stage: 'google' }
  | { type: 'failed'; stage: 'google'; kind: SignInFailureKind }
  // IN_PROGRESS is not a settle: no stage, nothing logged (RA-166 hole 3).
  | { type: 'inProgress' };

// Google's own step: hasPlayServices, then GoogleSignin.signIn(). No request is made here.
export async function googleStep(): Promise<GoogleStepOutcome> {
  let result: any;
  try {
    ensureConfigured();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    result = await GoogleSignin.signIn();
  } catch (e) {
    const code = googleErrorCode(e);
    if (code === GOOGLE_STATUS.IN_PROGRESS) return { type: 'inProgress' };
    if (code === GOOGLE_STATUS.SIGN_IN_CANCELLED) return { type: 'cancelled', stage: 'google' };
    // RA-172: its own code, and the code only (T1): never the error's text.
    if (code === GOOGLE_STATUS.DEVELOPER_ERROR) console.warn('[koko] auth google_developer_error');
    return { type: 'failed', stage: 'google', kind: googleErrorKind(e) };
  }
  if (result?.type === 'cancelled') return { type: 'cancelled', stage: 'google' };
  const idToken: unknown = result?.data?.idToken ?? result?.idToken;
  if (typeof idToken !== 'string' || !idToken) return { type: 'failed', stage: 'google', kind: 'unknown' };
  return { type: 'idToken', stage: 'google', idToken };
}

export interface AgeConsentSent { version: string; language: 'en' | 'he'; hash: string }

// What the exchange may carry beside the idToken. The adapter passes each only while its switch is on
// (DEC-194 item 69); this module sends exactly what it is given, field by field, so nothing else (a
// month, a year, a client time) can ride along.
export interface ExchangeSends {
  ageAttestation?: { over16: true };
  // Sent only with ageAttestation (P11 C7, RA-154).
  ageConsent?: AgeConsentSent;
  // termsVersion always travels with its termsLanguage (item 93, RA-169).
  terms?: { version: string; language: 'en' | 'he' };
}

export type ExchangeOutcome =
  | { type: 'exchanged'; stage: 'exchange'; record: SessionRecord; user: KokonadaUser; policyVersion?: number }
  | { type: 'failed'; stage: 'exchange'; kind: SignInFailureKind; retryAfterSec?: number; holdSec?: number };

type ExchangeFailure = Extract<ExchangeOutcome, { type: 'failed' }>;
const failed = (kind: SignInFailureKind): ExchangeFailure => ({ type: 'failed', stage: 'exchange', kind });

function exchangeBody(idToken: string, sends: ExchangeSends): Record<string, unknown> {
  const body: Record<string, unknown> = { idToken, platform: 'android', client: 'mobile' };
  if (sends.ageAttestation) {
    body.ageAttestation = { over16: true };
    const c = sends.ageConsent;
    if (c) body.ageConsent = { version: c.version, language: c.language, hash: c.hash };
  }
  if (sends.terms) {
    body.termsVersion = sends.terms.version;
    body.termsLanguage = sends.terms.language;
  }
  return body;
}

// RA-120 client half: what was sent must come back, compared strictly, or nothing is installed.
function echoHolds(answer: Record<string, any>, body: Record<string, unknown>): boolean {
  if (body.termsVersion !== undefined) {
    const t = answer.terms;
    if (!t || t.version !== body.termsVersion || t.language !== body.termsLanguage) return false;
  }
  if (body.ageAttestation !== undefined && answer.ageAttestation?.over16 !== true) return false;
  if (body.ageConsent !== undefined) {
    const sent = body.ageConsent as AgeConsentSent;
    const c = answer.ageConsent;
    if (!c || c.version !== sent.version || c.language !== sent.language || c.hash !== sent.hash) return false;
  }
  return true;
}

async function readExchange(res: Response, body: Record<string, unknown>): Promise<ExchangeOutcome> {
  if (!res.ok) {
    const failedBody: unknown = await res.json().catch(() => null);
    const kind = refusalKind(res.status, failedBody);
    if (kind === 'rateLimited') {
      const headers = (res as { headers?: { get?: (name: string) => string | null } }).headers;
      const wait = parseRetryAfter(typeof headers?.get === 'function' ? headers.get('Retry-After') : undefined);
      return { ...failed('rateLimited'), ...wait };
    }
    return failed(kind);
  }
  let parsed: unknown;
  try { parsed = await res.json(); } catch { return failed('server'); }
  // RA-144: a 200 with no token, no refresh or an id that is not 24 hex installs nothing.
  const a = (parsed !== null && typeof parsed === 'object') ? parsed as Record<string, any> : null;
  const user = a?.user;
  if (!a || typeof a.token !== 'string' || !a.token || typeof a.refreshToken !== 'string' || !a.refreshToken
    || !user || typeof user !== 'object' || typeof user.id !== 'string' || !SESSION_UID_PATTERN.test(user.id)) {
    return failed('server');
  }
  if (!echoHolds(a, body)) return failed('server');
  const policy = a.policy?.version;
  return {
    type: 'exchanged',
    stage: 'exchange',
    record: { v: 2, access: a.token, refresh: a.refreshToken, uid: user.id },
    user: user as KokonadaUser,
    ...(Number.isInteger(policy) && policy > 0 ? { policyVersion: policy as number } : {}),
  };
}

// The POST /api/auth/google exchange. No side effects: it installs nothing and writes nothing; the
// adapter installs `record`. Bounded at EXCHANGE_TIMEOUT_MS (body included); `signal` lets the adapter
// abort an abandoned attempt. A timeout or an abort is `network`.
export async function exchangeGoogle(idToken: string, sends: ExchangeSends = {}, signal?: AbortSignal): Promise<ExchangeOutcome> {
  if (signal?.aborted) return failed('network');
  const body = exchangeBody(idToken, sends);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const stop = new Promise<ExchangeOutcome>((resolve) => {
    const end = () => { controller.abort(); resolve(failed('network')); };
    timer = setTimeout(end, EXCHANGE_TIMEOUT_MS);
    onAbort = end;
    signal?.addEventListener('abort', end);
  });
  const run = (async (): Promise<ExchangeOutcome> => {
    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/api/auth/google`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal,
      });
    } catch {
      return failed('network');
    }
    return readExchange(res, body);
  })();
  try {
    return await Promise.race([run, stop]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
