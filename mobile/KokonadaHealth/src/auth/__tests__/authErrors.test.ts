// C7 (B1 charter §6 item 5): a sign-in failure is a typed AuthError, and the sign-in screen shows
// its own short, neutral words for each kind — never the server's text, never a legal or health
// claim. The statuses are the backend's (backend/app/controllers/authController.js handleSso and
// the authLimiter on POST /api/auth/google and /apple): 400 a missing token, 401 a token the
// provider does not verify (via the error handler), 422 an account that shared no email, 429 the
// rate limit, 5xx a fault.

import { AuthError, authErrorKindForStatus, signInErrorMessage, type AuthErrorKind } from '../authErrors';

const KINDS: AuthErrorKind[] = ['network', 'playServices', 'noEmail', 'rateLimited', 'rejected', 'server', 'unknown'];

describe('AuthError', () => {
  it('is an Error that carries its kind and keeps its message', () => {
    const e = new AuthError('rejected', 'bad token');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.kind).toBe('rejected');
    expect(e.message).toBe('bad token');
    expect(e.name).toBe('AuthError');
  });
});

describe('authErrorKindForStatus — the backend statuses', () => {
  it.each([
    [422, 'noEmail'],
    [429, 'rateLimited'],
    [400, 'rejected'],
    [401, 'rejected'],
    [500, 'server'],
    [502, 'server'],
    [503, 'server'],
    [403, 'unknown'],
    [404, 'unknown'],
    [409, 'unknown'],
  ] as const)('%i is %s', (status, kind) => {
    expect(authErrorKindForStatus(status)).toBe(kind);
  });
});

describe('signInErrorMessage — the screen\'s own words', () => {
  // Pinned word for word, so a copy change is a deliberate edit with its own review.
  it.each([
    ['network', 'No connection. Check your network and try again.'],
    ['playServices', 'Google Play services isn\'t available on this device.'],
    ['noEmail', 'This account didn\'t share an email address. Try another account.'],
    ['rateLimited', 'Too many attempts. Try again in a few minutes.'],
    ['rejected', 'Sign-in wasn\'t accepted. Try again.'],
    ['server', 'Sign-in isn\'t available right now. Try again soon.'],
    ['unknown', 'Sign-in failed. Try again.'],
  ] as const)('%s → "%s"', (kind, words) => {
    expect(signInErrorMessage(new AuthError(kind, 'server text that must never show'))).toBe(words);
  });

  it('every kind has words of its own', () => {
    const all = KINDS.map((k) => signInErrorMessage(new AuthError(k, 'x')));
    expect(new Set(all).size).toBe(KINDS.length);
  });

  it.each([
    ['a plain Error carrying server text', new Error('Your account did not share an email address, which is required to sign up.')],
    ['a string', 'boom'],
    ['undefined', undefined],
    ['null', null],
    ['an AuthError with a kind it does not know', Object.assign(new AuthError('unknown', 'x'), { kind: 'weird' })],
  ])('%s shows the unknown words, never its own text', (_l, e) => {
    expect(signInErrorMessage(e)).toBe('Sign-in failed. Try again.');
  });

  it('no message names the law, a consent, a health state or a condition', () => {
    for (const k of KINDS) {
      expect(signInErrorMessage(new AuthError(k, 'x'))).not.toMatch(/law|legal|consent|privacy|health|heart|medical|condition|diagnos|GDPR|terms/i);
    }
  });
});
