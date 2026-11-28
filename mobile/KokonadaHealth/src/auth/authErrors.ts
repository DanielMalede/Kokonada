// C7: a sign-in failure, typed. `kind` is what a sign-in screen reads to choose its own words (v1's are
// in ./signInWords, ARCH-309-5: this module holds no screen's words);
// `message` keeps what the failure carried (the server's text, for diagnostics) and is never shown.
//
// The kinds follow the backend's answers to POST /api/auth/google and /apple
// (backend/app/controllers/authController.js handleSso; authLimiter in middleware/rateLimiter.js):
// 400 a missing token and 401 a token the provider does not verify are `rejected`, 422 an account
// that shared no email is `noEmail`, 429 the rate limit is `rateLimited`, 5xx is `server`.
export type AuthErrorKind = 'network' | 'playServices' | 'noEmail' | 'rateLimited' | 'rejected' | 'server' | 'unknown';

export class AuthError extends Error {
  readonly kind: AuthErrorKind;

  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
    Object.setPrototypeOf(this, AuthError.prototype); // instanceof holds through any ES5 down-levelling
  }
}

export function authErrorKindForStatus(status: number): AuthErrorKind {
  if (status === 422) return 'noEmail';
  if (status === 429) return 'rateLimited';
  if (status === 400 || status === 401) return 'rejected';
  if (status >= 500) return 'server';
  return 'unknown';
}

// C7 (B1 P11 charter §2): the v2 sign-in port's failure kinds. v1's AuthErrorKind is unchanged (its
// screen words are keyed by it); the two refusal kinds exist only on the v2 port's outcome.
export type SignInFailureKind = AuthErrorKind | 'termsOutdated' | 'attestationRequired';

// C7: Google Sign-In's native codes, as literals owned here. They are never read from the library at
// run time: `statusCodes` comes from the native module's constants (jest.setup.js's global mock has
// none), and NETWORK_ERROR and DEVELOPER_ERROR are not exported at all. Android values, from
// @react-native-google-signin/google-signin 16.1.2: RNGoogleSigninModule.java's constants,
// PromiseWrapper.ASYNC_OP_IN_PROGRESS, Play services' CommonStatusCodes (NETWORK_ERROR 7,
// DEVELOPER_ERROR 10) and GoogleSignInStatusCodes.SIGN_IN_CANCELLED (12501), each as its string.
export const GOOGLE_STATUS = Object.freeze({
  SIGN_IN_CANCELLED: '12501',
  IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
  PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  DEVELOPER_ERROR: '10',
  NETWORK_ERROR: '7',
});

/** The native code a Google Sign-In rejection carries, or null. */
export function googleErrorCode(e: unknown): string | null {
  const code = (e !== null && typeof e === 'object') ? (e as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : null;
}

/** A native Google failure's kind. DEVELOPER_ERROR is `unknown` (the `generic` key, P11-7). */
export function googleErrorKind(e: unknown): AuthErrorKind {
  const code = googleErrorCode(e);
  if (code === GOOGLE_STATUS.PLAY_SERVICES_NOT_AVAILABLE) return 'playServices';
  if (code === GOOGLE_STATUS.NETWORK_ERROR) return 'network';
  return 'unknown';
}

// C7 (RA-155): a failed exchange's kind. On 409 and 422 only, the body's `code` is read first
// (backend LG-B1-1's refusal codes); every other status keeps v1's mapping.
export function refusalKind(status: number, body: unknown): SignInFailureKind {
  if (status === 409 || status === 422) {
    const code = (body !== null && typeof body === 'object') ? (body as { code?: unknown }).code : undefined;
    if (code === 'terms_version_mismatch' || code === 'age_consent_mismatch' || code === 'recording_off') return 'termsOutdated';
    if (code === 'attestation_required') return 'attestationRequired';
    if (code === 'no_email') return 'noEmail';
    if (code === undefined) return status === 422 ? 'noEmail' : 'unknown';
    return 'unknown';
  }
  return authErrorKindForStatus(status);
}
