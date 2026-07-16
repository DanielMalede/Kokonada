import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authHeaders, sameOriginAuth, setToken, getToken, clearToken } from '../lib/api';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); });

describe('sameOriginAuth flag (T4 — B2 same-domain auth prep)', () => {
  it('defaults to false (current cross-site topology unchanged)', () => {
    expect(sameOriginAuth()).toBe(false);
  });

  it('is true only when VITE_AUTH_SAME_ORIGIN is exactly "true"', () => {
    vi.stubEnv('VITE_AUTH_SAME_ORIGIN', 'true');
    expect(sameOriginAuth()).toBe(true);
  });

  it('treats any other value (including "1" or "TRUE") as false — no silent typo-enable', () => {
    vi.stubEnv('VITE_AUTH_SAME_ORIGIN', '1');
    expect(sameOriginAuth()).toBe(false);
    vi.stubEnv('VITE_AUTH_SAME_ORIGIN', 'TRUE');
    expect(sameOriginAuth()).toBe(false);
  });
});

describe('authHeaders() under the flag', () => {
  it('attaches Authorization: Bearer from the stored token by default (flag off)', () => {
    setToken('koko-jwt-xyz');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer koko-jwt-xyz' });
  });

  it('returns {} when same-origin mode is on, even if a token happens to be stored', () => {
    setToken('koko-jwt-xyz');
    vi.stubEnv('VITE_AUTH_SAME_ORIGIN', 'true');
    expect(authHeaders()).toEqual({});
  });

  it('returns {} by default when no token is stored', () => {
    expect(authHeaders()).toEqual({});
  });
});

describe('token storage primitives are untouched by the flag (still directly usable)', () => {
  it('setToken/getToken/clearToken keep working regardless of sameOriginAuth', () => {
    vi.stubEnv('VITE_AUTH_SAME_ORIGIN', 'true');
    setToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });
});
