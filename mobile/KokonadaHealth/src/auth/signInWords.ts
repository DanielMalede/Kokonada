// The v1 sign-in screen's own words (C7), one per AuthError kind: short, neutral, and never the
// server's text. ARCH-309-5: they live here, apart from the shared AuthError (./authErrors), so a v2
// screen brings words of its own instead of inheriting v1's.
import { AuthError, type AuthErrorKind } from './authErrors';

// The designer's words (P2, #309 review) for network, playServices and rateLimited.
const SIGN_IN_WORDS: Record<AuthErrorKind, string> = {
  network: 'Couldn\'t connect. Check your connection and try again.',
  playServices: 'Sign-in needs Google Play services. Update it, then try again.',
  noEmail: 'This account didn\'t share an email address. Try another account.',
  // 15 minutes is the authLimiter's window (authLimiter.windowMs, backend/app/middleware/rateLimiter.js:24);
  // the words change with it.
  rateLimited: 'Too many attempts. Try again in 15 minutes.',
  rejected: 'Sign-in wasn\'t accepted. Try again.',
  server: 'Sign-in isn\'t available right now. Try again soon.',
  unknown: 'Sign-in failed. Try again.',
};

export function signInErrorMessage(error: unknown): string {
  const kind = error instanceof AuthError ? error.kind : 'unknown';
  return Object.prototype.hasOwnProperty.call(SIGN_IN_WORDS, kind) ? SIGN_IN_WORDS[kind] : SIGN_IN_WORDS.unknown;
}
