// A11 Task 1 — the shared REST client. Every authenticated backend call routes
// through here: it injects the AuthSession access token, and on a 401 it performs a
// SINGLE-FLIGHT refresh (delegated to AuthSession) then retries exactly once. It
// never throws — a network failure or a bad body becomes a typed {ok:false} result.

import { ApiClient } from '../apiClient';
import { AuthSession, type RefreshOutcome, type SessionEvent } from '../../auth/authSession';

function jsonRes(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('ApiClient — auth injection + 401 refresh-retry', () => {
  it('injects the Bearer access token and returns parsed data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ items: [1, 2] }));
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => 'acc-1', refresh: async () => null, fetchImpl: fetchImpl as any,
    });
    const res = await client.get<{ items: number[] }>('/api/sessions');
    expect(res).toEqual({ ok: true, data: { items: [1, 2] } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.test/api/sessions');
    expect(init.headers.Authorization).toBe('Bearer acc-1');
  });

  it('on 401 refreshes once and retries with the fresh token (success)', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonRes({ error: 'expired' }, 401))
      .mockResolvedValueOnce(jsonRes({ ok: true }, 200));
    const refresh = jest.fn().mockResolvedValue('acc-2');
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => 'acc-1', refresh, fetchImpl: fetchImpl as any,
    });
    const res = await client.get('/api/pulse/state');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1][1] as any).headers.Authorization).toBe('Bearer acc-2');
    expect(res.ok).toBe(true);
  });

  it('a failed refresh (dead family) returns {ok:false, status:401} and does NOT retry', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ error: 'expired' }, 401));
    const refresh = jest.fn().mockResolvedValue(null);
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => 'acc-1', refresh, fetchImpl: fetchImpl as any,
    });
    const res = await client.get('/api/sessions');
    expect(res).toEqual({ ok: false, status: 401, error: expect.any(String) });
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no retry
  });

  it('a non-401 error status returns {ok:false, status}', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ error: 'boom' }, 500));
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => 'acc', refresh: async () => null, fetchImpl: fetchImpl as any,
    });
    const res = await client.get('/api/sessions');
    expect(res.ok).toBe(false);
    expect((res as any).status).toBe(500);
  });

  it('a fetch that throws (airplane mode) becomes {ok:false}, never throws', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => 'acc', refresh: async () => null, fetchImpl: fetchImpl as any,
    });
    await expect(client.get('/api/sessions')).resolves.toEqual({ ok: false, error: expect.any(String) });
  });

  it('malformed JSON becomes {ok:false}', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad'); } });
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => 'acc', refresh: async () => null, fetchImpl: fetchImpl as any,
    });
    const res = await client.get('/api/sessions');
    expect(res.ok).toBe(false);
  });

  it('DELETE and POST route through the same auth + retry path', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ message: 'ok' }));
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => 'acc', refresh: async () => null, fetchImpl: fetchImpl as any,
    });
    await client.delete('/api/auth/account');
    await client.post('/api/x', { a: 1 });
    expect(fetchImpl.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchImpl.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ a: 1 });
  });
});

describe('ApiClient — single-flight refresh via AuthSession (concurrent 401s)', () => {
  it('two concurrent 401s trigger exactly ONE refresh-endpoint call', async () => {
    let refreshCalls = 0;
    const auth = new AuthSession({
      loadTokens: async () => ({ access: 'acc-1', refresh: 'krt-1' }),
      saveTokens: async () => {},
      clearTokens: async () => {},
      refreshEndpoint: async () => { refreshCalls++; return { kind: 'ok' as const, tokens: { access: 'acc-2', refresh: 'krt-2' } }; },
    });
    await auth.bootstrap();
    const fetchImpl = jest.fn().mockImplementation((_url, init: any) =>
      Promise.resolve(init.headers.Authorization === 'Bearer acc-2' ? jsonRes({ ok: true }) : jsonRes({}, 401)));
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => auth.getAccessToken(), refresh: () => auth.refresh(), fetchImpl: fetchImpl as any,
    });
    const [a, b] = await Promise.all([client.get('/a'), client.get('/b')]);
    expect(refreshCalls).toBe(1); // AuthSession collapsed the concurrent refreshes
    expect(a.ok && b.ok).toBe(true);
  });
});

// C1 through the unchanged client: a 401 whose refresh the server cannot answer is still a
// {ok:false, status:401} to the caller, but the session survives it; only a dead answer ends it.
describe('ApiClient — a 401 over a real AuthSession: unavailable keeps the session, dead ends it', () => {
  function sessionWith(answer: 'dead' | 'unavailable') {
    const stored: { value: { access: string; refresh: string } | null } = { value: { access: 'acc-1', refresh: 'krt-1' } };
    const auth = new AuthSession({
      loadTokens: async () => stored.value,
      saveTokens: async (t) => { stored.value = t; },
      clearTokens: async () => { stored.value = null; },
      refreshEndpoint: async () => ({ kind: answer }),
    });
    return { auth, stored };
  }

  it.each([
    ['unavailable', true],
    ['dead', false],
  ] as const)('refresh %s: {ok:false, status:401}, no retry, session kept = %s', async (answer, kept) => {
    const { auth, stored } = sessionWith(answer);
    await auth.bootstrap();
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ error: 'expired' }, 401));
    const client = new ApiClient({
      baseUrl: 'https://api.test', getAccessToken: () => auth.getAccessToken(), refresh: () => auth.refresh(), fetchImpl: fetchImpl as any,
    });
    await expect(client.get('/api/auth/me')).resolves.toEqual({ ok: false, status: 401, error: expect.any(String) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(auth.hasSession()).toBe(kept);
    expect(stored.value !== null).toBe(kept);
  });
});

// ── C1 delta (B1 P1 charter §2, apiClient) ──────────────────────────────────────────────────────────
// Over a real AuthSession: only fetch (the network) is faked.
function realSession(answer: RefreshOutcome) {
  const stored: { value: { access: string; refresh: string } | null } = { value: { access: 'acc-1', refresh: 'krt-1' } };
  const auth = new AuthSession({
    loadTokens: async () => stored.value,
    saveTokens: async (t) => { stored.value = t; },
    clearTokens: async () => { stored.value = null; },
    refreshEndpoint: async () => answer,
  });
  return { auth, stored };
}

const clientOver = (auth: AuthSession, fetchImpl: jest.Mock, extra: Record<string, unknown> = {}) => new ApiClient({
  baseUrl: 'https://api.test',
  getAccessToken: () => auth.getAccessToken(),
  refresh: () => auth.refresh(),
  session: auth,
  fetchImpl: fetchImpl as any,
  ...extra,
});

describe('ApiClient C1 — a 401 whose refresh returned null while the session is held', () => {
  it('returns {ok:false, status:401, sessionKept:true} and keeps the session', async () => {
    const { auth } = realSession({ kind: 'unavailable' });
    await auth.bootstrap();
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ error: 'expired' }, 401));
    const res = await clientOver(auth, fetchImpl).get('/api/auth/me');
    expect(res).toEqual({ ok: false, status: 401, sessionKept: true, error: 'unauthorized' });
    expect(auth.hasSession()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a dead refresh is a bare 401: the session is gone, so nothing says it was kept', async () => {
    const { auth } = realSession({ kind: 'dead' });
    await auth.bootstrap();
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ error: 'expired' }, 401));
    const res = await clientOver(auth, fetchImpl).get('/api/auth/me');
    expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    expect(auth.hasSession()).toBe(false);
  });
});

describe('ApiClient C1 — a 401 on a request retried with a just-rotated token', () => {
  it('ends the session as dead', async () => {
    const { auth, stored } = realSession({ kind: 'ok', tokens: { access: 'acc-2', refresh: 'krt-2' } });
    await auth.bootstrap();
    const ended: SessionEvent[] = [];
    auth.subscribe((e) => ended.push(e));
    const epoch = auth.sessionEpoch();
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ error: 'Token revoked' }, 401));
    const res = await clientOver(auth, fetchImpl).get('/api/pulse/state');
    expect(res).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[1][1] as any).headers.Authorization).toBe('Bearer acc-2');
    expect(ended).toEqual([{ type: 'ended', reason: 'dead', epoch }]);
    expect(auth.hasSession()).toBe(false);
    expect(stored.value).toBeNull();
  });

  it('never ends a newer session that was installed while the retry was in flight', async () => {
    const { auth } = realSession({ kind: 'ok', tokens: { access: 'acc-2', refresh: 'krt-2' } });
    await auth.bootstrap();
    let calls = 0;
    const fetchImpl = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 2) await auth.setSession({ access: 'other', refresh: 'other-r' }); // a sign-in landed meanwhile
      return jsonRes({ error: 'Token revoked' }, 401);
    });
    await clientOver(auth, fetchImpl).get('/api/pulse/state');
    expect(auth.getAccessToken()).toBe('other');
  });

  // The real constraint: a route may answer 401 for its own reason while the session is good, e.g. GET
  // /api/integrations/spotify/token's `code:'reconnect_required'` (backend integrationsController.js).
  // The auth middleware's 401s carry no `code` (backend/app/middleware/auth.js), so a 401 that carries
  // one is the route's answer, never a verdict on the session.
  it('a retried 401 that carries a route code is returned, and the session stands', async () => {
    const { auth } = realSession({ kind: 'ok', tokens: { access: 'acc-2', refresh: 'krt-2' } });
    await auth.bootstrap();
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({ error: 'reconnect', code: 'reconnect_required' }, 401));
    const res = await clientOver(auth, fetchImpl).get('/api/integrations/spotify/token');
    expect(res).toEqual({ ok: false, status: 401, error: 'request failed (401)' });
    expect(auth.hasSession()).toBe(true);
  });

  it('without a session binding the retried 401 stays the bare v1 answer', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(jsonRes({}, 401));
    const client = new ApiClient({ baseUrl: 'https://api.test', getAccessToken: () => 'a', refresh: async () => 'b', fetchImpl: fetchImpl as any });
    await expect(client.get('/x')).resolves.toEqual({ ok: false, status: 401, error: 'request failed (401)' });
  });
});

describe('ApiClient C1 — a per-request deadline of 15 s', () => {
  afterEach(() => { jest.useRealTimers(); });

  // A request the network never answers: it settles only if its signal aborts it, as RN's fetch does.
  const hanging = (aborted: AbortSignal[], ignoreAbort = false) => jest.fn().mockImplementation((_url: string, init: any) => {
    aborted.push(init.signal);
    return new Promise((_resolve, reject) => {
      if (!ignoreAbort) init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  });

  it.each([false, true])('a request that never answers settles as a network error at 15 s (fetch ignores the abort: %p)', async (ignoreAbort) => {
    jest.useFakeTimers();
    const signals: AbortSignal[] = [];
    const client = new ApiClient({ baseUrl: 'https://api.test', getAccessToken: () => 'a', refresh: async () => null, fetchImpl: hanging(signals, ignoreAbort) as any });
    let settled: unknown;
    void client.get('/api/sessions').then((r) => { settled = r; });
    await jest.advanceTimersByTimeAsync(14_999);
    expect(settled).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ ok: false, error: 'network error' });
    expect(signals[0].aborted).toBe(true);
  });

  it('the retry after a refresh has its own deadline', async () => {
    jest.useFakeTimers();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const fetchImpl = jest.fn().mockImplementation((url: string, init: any) => {
      calls += 1;
      return calls === 1 ? Promise.resolve(jsonRes({}, 401)) : hanging(signals)(url, init);
    });
    const client = new ApiClient({ baseUrl: 'https://api.test', getAccessToken: () => 'a', refresh: async () => 'b', fetchImpl: fetchImpl as any });
    let settled: unknown;
    void client.get('/x').then((r) => { settled = r; });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(settled).toEqual({ ok: false, error: 'network error' });
  });

  it('a timeout keeps the session', async () => {
    jest.useFakeTimers();
    const { auth } = realSession({ kind: 'unavailable' });
    await auth.bootstrap();
    const signals: AbortSignal[] = [];
    void clientOver(auth, hanging(signals)).get('/api/auth/me');
    await jest.advanceTimersByTimeAsync(15_000);
    expect(auth.hasSession()).toBe(true);
  });

  it('a body that never finishes is bounded by the same deadline', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => undefined) });
    const client = new ApiClient({ baseUrl: 'https://api.test', getAccessToken: () => 'a', refresh: async () => null, fetchImpl: fetchImpl as any });
    let settled: unknown;
    void client.get('/x').then((r) => { settled = r; });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(settled).toEqual({ ok: false, error: 'network error' });
  });
});
