// C7: a sign-in failure, typed. `kind` is what the sign-in screen reads to choose its own words;
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

// The sign-in screen's own words, one per kind: short, neutral, and never the server's text.
const SIGN_IN_WORDS: Record<AuthErrorKind, string> = {
  network: 'No connection. Check your network and try again.',
  playServices: 'Google Play services isn\'t available on this device.',
  noEmail: 'This account didn\'t share an email address. Try another account.',
  rateLimited: 'Too many attempts. Try again in a few minutes.',
  rejected: 'Sign-in wasn\'t accepted. Try again.',
  server: 'Sign-in isn\'t available right now. Try again soon.',
  unknown: 'Sign-in failed. Try again.',
};

export function signInErrorMessage(error: unknown): string {
  const kind = error instanceof AuthError ? error.kind : 'unknown';
  return Object.prototype.hasOwnProperty.call(SIGN_IN_WORDS, kind) ? SIGN_IN_WORDS[kind] : SIGN_IN_WORDS.unknown;
}
