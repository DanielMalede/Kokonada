import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import authReducer from '../store/slices/authSlice';
import LoginPage from '../pages/LoginPage';
import { clearToken, getToken } from '../lib/api';

function buildStore() {
  return configureStore({ reducer: { auth: authReducer } });
}

function renderLogin() {
  return render(
    <Provider store={buildStore()}>
      <MemoryRouter><LoginPage /></MemoryRouter>
    </Provider>,
  );
}

// jsdom/happy-dom never actually fetches remote <script src> tags, so the
// component's own onload handlers never fire on their own — dispatch 'load'
// manually once the Apple script element lands in the DOM, exactly like a real
// script tag would once it downloads.
async function fireAppleScriptLoad() {
  await waitFor(() => {
    const el = document.querySelector('script[src*="appleid.cdn-apple.com"]');
    expect(el).toBeTruthy();
  });
  const el = document.querySelector('script[src*="appleid.cdn-apple.com"]') as HTMLScriptElement;
  act(() => { el.dispatchEvent(new Event('load')); });
}

describe('LoginPage — B2 same-domain auth prep (T4)', () => {
  beforeEach(() => {
    clearToken();
    vi.stubEnv('VITE_APPLE_CLIENT_ID', 'apple-client-id');
    vi.stubEnv('VITE_APPLE_REDIRECT_URI', 'https://kokonada-frontend.vercel.app/auth/apple/callback');
    (window as unknown as { AppleID: unknown }).AppleID = {
      auth: {
        init: vi.fn(),
        signIn: vi.fn().mockResolvedValue({ authorization: { id_token: 'apple-id-token' } }),
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ token: 'koko-jwt-from-login', user: { id: 'u1' } }),
      }),
    );
  });

  afterEach(() => {
    clearToken();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete (window as unknown as { AppleID?: unknown }).AppleID;
  });

  it('stores the session token in localStorage by default (flag off — current cross-site topology)', async () => {
    renderLogin();
    await fireAppleScriptLoad();
    fireEvent.click(await screen.findByRole('button', { name: /continue with apple/i }));

    await waitFor(() => expect(getToken()).toBe('koko-jwt-from-login'));
  });

  it('never stores the session token when same-origin mode is on — the cookie is the only credential', async () => {
    vi.stubEnv('VITE_AUTH_SAME_ORIGIN', 'true');
    renderLogin();
    await fireAppleScriptLoad();
    fireEvent.click(await screen.findByRole('button', { name: /continue with apple/i }));

    // Give the async completeLogin() a tick to finish before asserting the negative.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(getToken()).toBeNull();
  });
});
