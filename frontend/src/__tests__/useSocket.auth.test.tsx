import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';
import { store } from '../store';
import { setToken, clearToken } from '../lib/api';

const ioSpy = vi.fn(() => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), connected: true }));
vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => ioSpy(...args),
  Socket: class {},
}));

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;

// useSocket's module-level `socket` singleton persists across tests in the same
// file, so each test needs a fresh module instance to actually re-run initSocket.
async function freshUseSocket() {
  vi.resetModules();
  const mod = await import('../hooks/useSocket');
  return mod.useSocket;
}

beforeEach(() => { ioSpy.mockClear(); clearToken(); });
afterEach(() => { vi.unstubAllEnvs(); clearToken(); });

describe('useSocket handshake auth (T4 — B2 same-domain prep)', () => {
  it('sends the stored bearer token in handshake.auth by default (flag off)', async () => {
    setToken('koko-jwt-abc');
    const useSocket = await freshUseSocket();
    renderHook(() => useSocket(), { wrapper });

    expect(ioSpy).toHaveBeenCalledTimes(1);
    const [, opts] = ioSpy.mock.calls[0] as [string, { auth: { token?: string | null } }];
    expect(opts.auth).toEqual({ token: 'koko-jwt-abc' });
  });

  it('omits the token from handshake.auth when same-origin mode is on — cookie carries auth instead', async () => {
    setToken('koko-jwt-abc');
    vi.stubEnv('VITE_AUTH_SAME_ORIGIN', 'true');
    const useSocket = await freshUseSocket();
    renderHook(() => useSocket(), { wrapper });

    expect(ioSpy).toHaveBeenCalledTimes(1);
    const [, opts] = ioSpy.mock.calls[0] as [string, { auth: Record<string, unknown>; withCredentials: boolean }];
    expect(opts.auth).toEqual({});
    // withCredentials must stay true either way — that's what actually puts the
    // cookie on the wire once it's first-party post domain-migration.
    expect(opts.withCredentials).toBe(true);
  });
});
