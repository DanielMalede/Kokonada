// shadow.authRefusalCodes (B1 P11 charter §2 C7, RA-155): refusals are read by their code, through the
// real exchange, as the phone makes it — only `fetch` (the network) is faked. On 409 and 422 only, the
// body's `code` is read first; v1's signInWithGoogle keeps v1's mapping (it never sends what these
// codes refuse).

import { exchangeGoogle, signInWithGoogle } from '../auth/auth';
import { AuthError } from '../auth/authErrors';
import { authSession } from '../auth/session';
import { GoogleSignin } from '@react-native-google-signin/google-signin';

const realFetch = (globalThis as any).fetch;
afterEach(async () => {
  (globalThis as any).fetch = realFetch;
  await authSession.clear();
});

const refusal = (status: number, body: unknown) => {
  (globalThis as any).fetch = jest.fn().mockResolvedValue({
    ok: false, status, headers: { get: () => null }, json: async () => body,
  });
};

describe('shadow.authRefusalCodes — the v2 exchange', () => {
  it.each([
    [409, { error: 'x', code: 'terms_version_mismatch' }, 'termsOutdated'],
    [409, { error: 'x', code: 'age_consent_mismatch' }, 'termsOutdated'],
    [409, { error: 'x', code: 'recording_off' }, 'termsOutdated'],
    [422, { error: 'x', code: 'attestation_required' }, 'attestationRequired'],
    [422, { error: 'x', code: 'no_email' }, 'noEmail'],
    [422, { error: 'Your account did not share an email address' }, 'noEmail'], // a v1 server
    [409, { error: 'x' }, 'unknown'],
    [409, null, 'unknown'],
  ] as const)('%i %p is %s at the exchange stage, and installs nothing', async (status, body, kind) => {
    refusal(status, body);
    await expect(exchangeGoogle('idtok', { terms: { version: '1', language: 'en' } }))
      .resolves.toEqual({ type: 'failed', stage: 'exchange', kind });
    expect(authSession.hasSession()).toBe(false);
  });

  it('a code on any other status is not read', async () => {
    refusal(401, { code: 'terms_version_mismatch' });
    await expect(exchangeGoogle('idtok')).resolves.toEqual({ type: 'failed', stage: 'exchange', kind: 'rejected' });
  });
});

describe('shadow.authRefusalCodes — v1 is unchanged', () => {
  beforeEach(() => {
    (GoogleSignin.signIn as jest.Mock).mockResolvedValue({ data: { idToken: 'idtok' } });
  });

  it.each([
    [409, { code: 'terms_version_mismatch' }, 'unknown'],
    [422, { code: 'attestation_required' }, 'noEmail'],
    [422, { error: 'no email' }, 'noEmail'],
  ] as const)('v1 maps %i %p by its status alone: %s', async (status, body, kind) => {
    refusal(status, body);
    const err = await signInWithGoogle().catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err.kind).toBe(kind);
    expect(authSession.hasSession()).toBe(false);
  });
});
