// shadow.c1ErasureDeadline (RA-4, #320). An erasure the server completes after 15 s is the server's
// answer, never a network error the screen reports as a failed deletion. The two synchronous erasure
// calls get a 60 s deadline; every other call keeps 15 s. Through the production singletons, with only
// fetch faked.
import { apiDelete, apiGet, apiPost } from '../net/apiClient';

const answerAt = (ms: number) => jest.fn(() => new Promise((resolve) => setTimeout(
  () => resolve({ ok: true, status: 200, json: async () => ({ message: 'done' }) }), ms)));

describe('shadow.c1ErasureDeadline', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { (globalThis as any).fetch = realFetch; jest.useRealTimers(); });

  const erasures = [
    ['DELETE /api/auth/account', () => apiDelete('/api/auth/account')],
    ['POST /api/consent/withdraw', () => apiPost('/api/consent/withdraw', { purpose: 'health_biometric_processing' })],
  ] as const;

  it.each(erasures)('%s answered at 20 s settles as the answer', async (_name, call) => {
    jest.useFakeTimers();
    (globalThis as any).fetch = answerAt(20_000);
    let settled: unknown;
    void call().then((r) => { settled = r; });
    await jest.advanceTimersByTimeAsync(20_000);
    expect(settled).toEqual({ ok: true, data: { message: 'done' } });
  });

  it.each(erasures)('%s that never answers is a network error at 60 s, not before', async (_name, call) => {
    jest.useFakeTimers();
    (globalThis as any).fetch = jest.fn(() => new Promise(() => undefined));
    let settled: unknown;
    void call().then((r) => { settled = r; });
    await jest.advanceTimersByTimeAsync(59_999);
    expect(settled).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toEqual({ ok: false, error: 'network error' });
  });

  it.each([
    ['GET /api/auth/account', () => apiGet('/api/auth/account')],
    ['POST /api/auth/account', () => apiPost('/api/auth/account')],
    ['DELETE /api/auth/account/x', () => apiDelete('/api/auth/account/x')],
    ['GET /api/consent/withdraw', () => apiGet('/api/consent/withdraw')],
  ] as const)('%s keeps the 15 s deadline', async (_name, call) => {
    jest.useFakeTimers();
    (globalThis as any).fetch = answerAt(20_000);
    let settled: unknown;
    void call().then((r) => { settled = r; });
    await jest.advanceTimersByTimeAsync(15_000);
    expect(settled).toEqual({ ok: false, error: 'network error' });
  });
});
