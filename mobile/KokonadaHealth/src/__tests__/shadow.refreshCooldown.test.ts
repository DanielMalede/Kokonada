// PR #309 review (shadow): the refresh, as the phone makes it — the real AuthSession over the real
// keychainSession.refreshEndpoint, with only `fetch` (the network) and the Keychain faked.
//
// RA-7 (S2): React Native's fetch has no deadline: RN 0.86's Android OkHttp client is built with 0 ms
// connect, read and write timeouts (OkHttpClientProvider.kt:52-54), and AbortSignal.timeout is not on
// Hermes. A refresh that never answers held AuthSession's single flight for good: every later refresh
// joined it, the REST client and the socket waited on it forever, and the session could never recover.
//
// RA-2 (S2): an `unavailable` refresh was retried by EVERY next trigger (each REST 401, each socket
// open), ignoring Retry-After — and POST /api/auth/refresh shares the authLimiter (10 per 15 min per IP,
// backend/app/middleware/rateLimiter.js:23-25) with sign-in itself. After an unavailable answer no
// request goes out until the server's wait (a 429's Retry-After or RateLimit-Reset) has passed, or else
// an exponential backoff with jitter, capped at 60 s.

import { AuthSession } from '../auth/authSession';
import { keychainSession } from '../auth/session';

const realFetch = (globalThis as any).fetch;
afterEach(() => {
  (globalThis as any).fetch = realFetch;
  jest.useRealTimers();
});

async function heldSession() {
  const session = new AuthSession(keychainSession);
  await session.setSession({ access: 'acc-1', refresh: 'krt-1' });
  return session;
}

// A request the network never answers: it settles only when its signal aborts it, as RN's fetch does.
const hangsUntilAborted = () => jest.fn((_url: string, init: { signal?: AbortSignal } = {}) => new Promise((_resolve, reject) => {
  init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
}));

describe('a refresh the network never answers (RA-7)', () => {
  it('is aborted, resolves null within 30 s, and the session stands', async () => {
    jest.useFakeTimers();
    const fetch = hangsUntilAborted();
    (globalThis as any).fetch = fetch;
    const session = await heldSession();
    const settled = jest.fn();
    void session.refresh().then(settled);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(settled).toHaveBeenCalledWith(null);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(session.hasSession()).toBe(true);
    expect(session.getAccessToken()).toBe('acc-1');
  });

  it('settles even when the fetch ignores the abort, and the session stands', async () => {
    jest.useFakeTimers();
    (globalThis as any).fetch = jest.fn(() => new Promise(() => {})); // deaf to the signal too
    const session = await heldSession();
    const settled = jest.fn();
    void session.refresh().then(settled);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(settled).toHaveBeenCalledWith(null);
    expect(session.hasSession()).toBe(true);
  });
});

// A response as RN's fetch gives it: the real Headers class (case-insensitive get).
const response = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body });
const rotated = () => response(200, { token: 'acc-2', refreshToken: 'krt-2' });

describe('an unavailable refresh is not retried by every next trigger (RA-2)', () => {
  it('a 429 with Retry-After: 120 holds every refresh for 120 s without a request, keeps the session, then refreshes', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(async () => response(429, { error: 'Too many authentication attempts' }, { 'Retry-After': '120', 'RateLimit-Reset': '120' }));
    (globalThis as any).fetch = fetch;
    const session = await heldSession();
    expect(await session.refresh()).toBeNull(); // the 429
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(10_000);
      expect(await session.refresh()).toBeNull(); // 4 more triggers within 50 s
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(session.hasSession()).toBe(true);
    expect(session.getAccessToken()).toBe('acc-1');

    fetch.mockImplementation(async () => rotated());
    await jest.advanceTimersByTimeAsync(79_999); // 119.999 s after the 429
    expect(await session.refresh()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(await session.refresh()).toBe('acc-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a 429 with RateLimit-Reset only is held for that many seconds', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(async () => response(429, null, { 'RateLimit-Reset': '90' }));
    (globalThis as any).fetch = fetch;
    const session = await heldSession();
    await session.refresh();
    await jest.advanceTimersByTimeAsync(89_000);
    await session.refresh();
    expect(fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1_000);
    await session.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  // The gap the session waits after each failure in a row, with the jitter at its top (random 1).
  async function gapsBetweenRequests(random: number, failures: number): Promise<number[]> {
    const fetch = jest.fn(async () => { throw new TypeError('Network request failed'); });
    (globalThis as any).fetch = fetch;
    const session = new AuthSession({ ...keychainSession, random: () => random });
    await session.setSession({ access: 'acc-1', refresh: 'krt-1' });
    const gaps: number[] = [];
    await session.refresh();
    let last = Date.now();
    while (gaps.length < failures) {
      await jest.advanceTimersByTimeAsync(250);
      const before = fetch.mock.calls.length;
      await session.refresh();
      if (fetch.mock.calls.length > before) { gaps.push(Date.now() - last); last = Date.now(); }
    }
    return gaps;
  }

  it('any other unavailable answer backs off exponentially, capped at 60 s', async () => {
    jest.useFakeTimers();
    expect(await gapsBetweenRequests(1, 7)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);
  });

  it('with jitter: each wait is drawn between half its ceiling and the ceiling', async () => {
    jest.useFakeTimers();
    expect(await gapsBetweenRequests(0, 3)).toEqual([1_000, 2_000, 4_000]);
  });

  it('a rotation ends the backoff: the next failure waits the first step again', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(async () => { throw new TypeError('Network request failed'); });
    (globalThis as any).fetch = fetch;
    const session = new AuthSession({ ...keychainSession, random: () => 1 });
    await session.setSession({ access: 'acc-1', refresh: 'krt-1' });
    await session.refresh(); // 1st failure: 2 s
    await jest.advanceTimersByTimeAsync(2_000);
    await session.refresh(); // 2nd failure: 4 s
    await jest.advanceTimersByTimeAsync(4_000);
    fetch.mockImplementationOnce(async () => rotated() as any);
    expect(await session.refresh()).toBe('acc-2');
    await session.refresh(); // a failure after the rotation
    const requests = fetch.mock.calls.length;
    await jest.advanceTimersByTimeAsync(1_999);
    await session.refresh();
    expect(fetch.mock.calls.length).toBe(requests);
    await jest.advanceTimersByTimeAsync(1);
    await session.refresh();
    expect(fetch.mock.calls.length).toBe(requests + 1);
  });

  it('a Retry-After beyond the 15-minute window of the limiter is held 15 minutes at most; one that is not a wait falls back to the backoff', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(async () => response(429, null, { 'Retry-After': '999999' }));
    (globalThis as any).fetch = fetch;
    const session = await heldSession();
    await session.refresh();
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    fetch.mockImplementation(async () => response(429, null, { 'Retry-After': 'soon' }));
    await session.refresh();
    expect(fetch).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(60_000); // the backoff's ceiling, whatever the jitter
    await session.refresh();
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('a new session is never held by the wait of the one before it', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn(async () => response(429, null, { 'Retry-After': '600' }));
    (globalThis as any).fetch = fetch;
    const session = await heldSession();
    await session.refresh();
    await session.clear();
    await session.setSession({ access: 'b-acc', refresh: 'b-krt' });
    fetch.mockImplementation(async () => rotated());
    expect(await session.refresh()).toBe('acc-2');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
