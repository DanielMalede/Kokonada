// PR #309 review (shadow): the refresh, as the phone makes it — the real AuthSession over the real
// keychainSession.refreshEndpoint, with only `fetch` (the network) and the Keychain faked.
//
// RA-7 (S2): React Native's fetch has no deadline: RN 0.86's Android OkHttp client is built with 0 ms
// connect, read and write timeouts (OkHttpClientProvider.kt:52-54), and AbortSignal.timeout is not on
// Hermes. A refresh that never answers held AuthSession's single flight for good: every later refresh
// joined it, the REST client and the socket waited on it forever, and the session could never recover.

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
