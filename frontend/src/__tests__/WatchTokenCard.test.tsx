import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import integrationsReducer from '../store/slices/integrationsSlice';
import WatchTokenCard from '../components/WatchTokenCard';

vi.mock('../lib/api', () => ({
  authHeaders: () => ({}),
  issueWatchToken: vi.fn().mockResolvedValue('whr_generated_token'),
  revokeWatchToken: vi.fn().mockResolvedValue(undefined),
  fetchWatchStatus: vi.fn().mockResolvedValue({ connected: false, lastSeenAt: null }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function buildStore(watchOverrides = {}) {
  return configureStore({
    reducer: { integrations: integrationsReducer },
    preloadedState: {
      integrations: {
        musicProvider: null, biometricProvider: null, moodOnly: false, status: 'idle',
        watchToken: null, watchConnected: false, watchLastSeenAt: null, watchStatus: 'idle',
        ...watchOverrides,
      },
    } as never,
  });
}

describe('WatchTokenCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it('shows a set-up button when not connected', () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    expect(screen.getByRole('button', { name: /set up watch/i })).toBeInTheDocument();
  });

  it('generates and displays the token after clicking set up', async () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));
    expect(await screen.findByText('whr_generated_token')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('copies the token to the clipboard', async () => {
    render(<Provider store={buildStore({ watchToken: 'whr_generated_token', watchConnected: true })}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('whr_generated_token'));
  });

  it('shows a connected badge plus regenerate and disconnect when connected', () => {
    const now = Date.now();
    render(
      <Provider store={buildStore({ watchConnected: true, watchLastSeenAt: new Date(now - 30_000).toISOString() })}>
        <WatchTokenCard />
      </Provider>,
    );
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('revokes the token on disconnect', async () => {
    const api = await import('../lib/api');
    render(<Provider store={buildStore({ watchConnected: true, watchLastSeenAt: new Date().toISOString() })}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    await waitFor(() => expect(api.revokeWatchToken).toHaveBeenCalled());
  });
});
