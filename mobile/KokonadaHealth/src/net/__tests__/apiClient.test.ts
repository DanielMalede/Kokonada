// A11 Task 1 — the shared REST client. Every authenticated backend call routes
// through here: it injects the AuthSession access token, and on a 401 it performs a
// SINGLE-FLIGHT refresh (delegated to AuthSession) then retries exactly once. It
// never throws — a network failure or a bad body becomes a typed {ok:false} result.

import { ApiClient } from '../apiClient';
import { AuthSession } from '../../auth/authSession';

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
      refreshEndpoint: async () => { refreshCalls++; return { access: 'acc-2', refresh: 'krt-2' }; },
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
