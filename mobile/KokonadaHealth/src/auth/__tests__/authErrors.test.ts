// C7 (B1 charter §6 item 5): a sign-in failure is a typed AuthError, and the sign-in screen shows
// its own short, neutral words for each kind — never the server's text, never a legal or health
// claim. The statuses are the backend's (backend/app/controllers/authController.js handleSso and
// the authLimiter on POST /api/auth/google and /apple): 400 a missing token, 401 a token the
// provider does not verify (via the error handler), 422 an account that shared no email, 429 the
// rate limit, 5xx a fault.

import * as authErrors from '../authErrors';
import {
  AuthError, authErrorKindForStatus, googleErrorCode, googleErrorKind, refusalKind, GOOGLE_STATUS, type AuthErrorKind,
} from '../authErrors';
import { parseRetryAfter, SERVER_WAIT_DEFAULT_HOLD_SEC, SERVER_WAIT_MAX_SEC } from '../../net/serverWait';
import { signInErrorMessage } from '../signInWords';

const KINDS: AuthErrorKind[] = ['network', 'playServices', 'noEmail', 'rateLimited', 'rejected', 'server', 'unknown'];

// ARCH-309-5: the kind, the class and the status mapping are shared by v1 and v2; the words are the v1
// sign-in screen's own, in src/auth/signInWords.ts, so a v2 screen brings words of its own.
describe('authErrors holds no screen\'s words', () => {
  it('exports the class and the status mapping, and nothing a screen shows', () => {
    expect(Object.keys(authErrors).sort()).toEqual([
      'AuthError', 'GOOGLE_STATUS', 'authErrorKindForStatus', 'googleErrorCode', 'googleErrorKind', 'refusalKind',
    ]);
  });
});

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
    ['network', 'Couldn\'t connect. Check your connection and try again.'],
    ['playServices', 'Sign-in needs Google Play services. Update it, then try again.'],
    ['noEmail', 'This account didn\'t share an email address. Try another account.'],
    ['rateLimited', 'Too many attempts. Try again in 15 minutes.'], // the authLimiter's window
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

// C7 (P11 charter §2): the native codes are literals owned here, never read from the library at run
// time (jest.setup.js's global mock has no statusCodes, and a release reads them from the native
// module). DEVELOPER_ERROR maps to `unknown` (the `generic` key). The values are the Android module's:
// RNGoogleSigninModule.java constants, PromiseWrapper.ASYNC_OP_IN_PROGRESS, and Play services'
// CommonStatusCodes (NETWORK_ERROR 7, DEVELOPER_ERROR 10) and GoogleSignInStatusCodes (12501).
describe('GOOGLE_STATUS — the native codes, as literals', () => {
  it('holds the Android values', () => {
    expect(GOOGLE_STATUS).toEqual({
      SIGN_IN_CANCELLED: '12501',
      IN_PROGRESS: 'ASYNC_OP_IN_PROGRESS',
      PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
      DEVELOPER_ERROR: '10',
      NETWORK_ERROR: '7',
    });
    expect(Object.isFrozen(GOOGLE_STATUS)).toBe(true);
  });

  it.each([
    [{ code: 'PLAY_SERVICES_NOT_AVAILABLE' }, 'playServices'],
    [{ code: '7' }, 'network'],
    [{ code: '10' }, 'unknown'],
    [{ code: '12501' }, 'unknown'],
    [{ code: 'ASYNC_OP_IN_PROGRESS' }, 'unknown'],
    [{ code: 7 }, 'unknown'], // a number is no native code
    [new Error('no code'), 'unknown'],
    [null, 'unknown'],
    ['PLAY_SERVICES_NOT_AVAILABLE', 'unknown'],
  ] as const)('%p is %s', (e, kind) => {
    expect(googleErrorKind(e)).toBe(kind);
  });

  it('googleErrorCode reads a string code and nothing else', () => {
    expect(googleErrorCode(Object.assign(new Error('x'), { code: '10' }))).toBe('10');
    expect(googleErrorCode({ code: 10 })).toBeNull();
    expect(googleErrorCode(undefined)).toBeNull();
  });
});

// C7 (RA-155): on 409 and 422 only, the body's `code` is read first. Pin: shadow.authRefusalCodes.
describe('refusalKind — refusals read by their code', () => {
  it.each([
    [409, { code: 'terms_version_mismatch' }, 'termsOutdated'],
    [409, { code: 'age_consent_mismatch' }, 'termsOutdated'],
    [409, { code: 'recording_off' }, 'termsOutdated'],
    [422, { code: 'attestation_required' }, 'attestationRequired'],
    [409, { code: 'attestation_required' }, 'attestationRequired'],
    [422, { code: 'no_email', error: 'x' }, 'noEmail'],
    [422, { error: 'no email' }, 'noEmail'], // a v1 server
    [422, null, 'noEmail'],
    [409, { error: 'conflict' }, 'unknown'],
    [409, null, 'unknown'],
    [409, { code: 'something_new' }, 'unknown'],
    [422, { code: 'something_new' }, 'unknown'],
    [409, { code: 42 }, 'unknown'],
    [401, { code: 'terms_version_mismatch' }, 'rejected'], // the code is read on 409 and 422 only
    [400, { code: 'attestation_required' }, 'rejected'],
    [429, { code: 'recording_off' }, 'rateLimited'],
    [500, { code: 'no_email' }, 'server'],
    [404, 'not json', 'unknown'],
  ] as const)('%i %p is %s', (status, body, kind) => {
    expect(refusalKind(status, body)).toBe(kind);
  });
});

// C7 (RA-160, RA-170; DEC-196 F-WAIT B, DEC-197): the wait table. Seconds, unclamped up to 900 s (the
// auth limiter's 15-minute window); garbage gives no number and a 60 s hold; above 900 gives no number
// and a 900 s hold.
describe('parseRetryAfter — the wait table', () => {
  it('the bounds are 900 s and a 60 s default hold', () => {
    expect(SERVER_WAIT_MAX_SEC).toBe(900);
    expect(SERVER_WAIT_DEFAULT_HOLD_SEC).toBe(60);
  });

  it.each([
    ['900', { retryAfterSec: 900, holdSec: 900 }],
    ['30', { retryAfterSec: 30, holdSec: 30 }],
    ['1', { retryAfterSec: 1, holdSec: 1 }],
    [' 45 ', { retryAfterSec: 45, holdSec: 45 }],
    ['901', { holdSec: 900 }],
    ['86400', { holdSec: 900 }],
    ['0', { holdSec: 60 }],
    ['-5', { holdSec: 60 }],
    ['1.5', { holdSec: 60 }],
    ['1e3', { holdSec: 60 }],
    ['abc', { holdSec: 60 }],
    ['Wed, 21 Oct 2026 07:28:00 GMT', { holdSec: 60 }],
    ['', { holdSec: 60 }],
    [null, { holdSec: 60 }],
    [undefined, { holdSec: 60 }],
    [30, { holdSec: 60 }], // a header value is a string
  ] as const)('Retry-After %p gives %p', (header, wait) => {
    expect(parseRetryAfter(header)).toEqual(wait);
  });
});
