// shadow.c1CrossSessionRetry (RA-2, #320). A request sent under session A whose 401 lands after session B
// was installed is never refreshed or retried on B. Before the fix apiClient read the epoch only after the
// 401, so B was rotated and A's body (for example A's health samples) was re-sent with B's token.
import { ApiClient } from '../net/apiClient';
import { AuthSession, type StoredSession } from '../auth/authSession';

const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function plane() {
  let stored: StoredSession | null = null;
  const refreshEndpoint = jest.fn(async (refresh: string) => ({
    kind: 'ok' as const, tokens: { access: `${refresh}-acc-2`, refresh: `${refresh}-2` },
  }));
  const auth = new AuthSession({
    loadTokens: async () => stored,
    saveTokens: async (t) => { stored = t; },
    clearTokens: async () => { stored = null; },
    refreshEndpoint,
  });
  return { auth, refreshEndpoint };
}

const clientOver = (auth: AuthSession, fetchImpl: jest.Mock) => new ApiClient({
  baseUrl: 'https://api.test', getAccessToken: () => auth.getAccessToken(), refresh: () => auth.refresh(), session: auth, fetchImpl: fetchImpl as any,
});

describe('shadow.c1CrossSessionRetry', () => {
  it('a 401 that lands after another account signed in: no refresh, no retry, B untouched', async () => {
    const { auth, refreshEndpoint } = plane();
    await auth.setSession({ v: 2, access: 'a-acc', refresh: 'a-krt', uid: 'a'.repeat(24) });
    const sent: string[] = [];
    const fetchImpl = jest.fn(async (_url: string, init: any) => {
      sent.push(init.headers.Authorization);
      if (sent.length === 1) {
        await auth.setSession({ v: 2, access: 'b-acc', refresh: 'b-krt', uid: 'b'.repeat(24) });
        return reply(401, { error: 'Token revoked' });
      }
      return reply(200, { accepted: 1 });
    });
    const out = await clientOver(auth, fetchImpl).post('/api/integrations/health/batch', { platform: 'health_connect', samples: [{ t: 1 }] });
    expect(sent).toEqual(['Bearer a-acc']);
    expect(refreshEndpoint).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    expect(auth.getAccessToken()).toBe('b-acc');
    expect(auth.hasSession()).toBe(true);
  });

  it('a 401 that lands after a sign-out: no refresh, no retry', async () => {
    const { auth, refreshEndpoint } = plane();
    await auth.setSession({ v: 2, access: 'a-acc', refresh: 'a-krt', uid: 'a'.repeat(24) });
    const fetchImpl = jest.fn(async () => { await auth.clear(); return reply(401, { error: 'Token revoked' }); });
    const out = await clientOver(auth, fetchImpl).post('/api/integrations/health/batch', { samples: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refreshEndpoint).not.toHaveBeenCalled();
    expect(out).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('within one session a 401 still refreshes once and retries', async () => {
    const { auth, refreshEndpoint } = plane();
    await auth.setSession({ v: 2, access: 'a-acc', refresh: 'a-krt', uid: 'a'.repeat(24) });
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(reply(401, { error: 'Invalid or expired token' }))
      .mockResolvedValueOnce(reply(200, { accepted: 1 }));
    const out = await clientOver(auth, fetchImpl).post('/api/integrations/health/batch', { samples: [] });
    expect(refreshEndpoint).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[1][1] as any).headers.Authorization).toBe('Bearer a-krt-acc-2');
    expect(out).toEqual({ ok: true, data: { accepted: 1 } });
  });
});
