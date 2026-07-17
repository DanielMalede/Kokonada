import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import integrationsReducer from '../store/slices/integrationsSlice';
import WatchTokenCard from '../components/WatchTokenCard';

vi.mock('../lib/api', () => ({
  authHeaders: () => ({}),
  requestWatchPairingCode: vi.fn().mockResolvedValue({
    code: '123456',
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  }),
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

describe('WatchTokenCard — pairing-code flow (T5 / audit L-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a set-up button when not connected', async () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    await act(async () => {});
    expect(screen.getByRole('button', { name: /set up watch/i })).toBeInTheDocument();
  });

  it('shows a short-lived PAIRING CODE (not the long-lived device token) after clicking set up', async () => {
    const api = await import('../lib/api');
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));

    expect(await screen.findByText('123 456')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument();
    // The old long-lived-token-in-DOM path is gone entirely.
    expect(api.requestWatchPairingCode).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/whr_/)).not.toBeInTheDocument();
    // Regenerate/Disconnect must be hidden while a pairing code is on screen.
    expect(screen.queryByRole('button', { name: /re-pair/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it('tells the user the code is single-use and short-TTL', async () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));
    await screen.findByText('123 456');
    expect(screen.getByText(/expires in \d+s/i)).toBeInTheDocument();
    expect(screen.getByText(/can only be used once/i)).toBeInTheDocument();
  });

  it('cancelling clears the pairing code and returns to the set-up button', async () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));
    await screen.findByText('123 456');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(await screen.findByRole('button', { name: /set up watch/i })).toBeInTheDocument();
  });

  it('copies the pairing code (not a long-lived secret) to the clipboard', async () => {
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));
    await screen.findByText('123 456');
    fireEvent.click(screen.getByRole('button', { name: /copy code/i }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('123456'));
  });

  it('auto-clears the code once it expires', async () => {
    vi.useFakeTimers();
    const api = await import('../lib/api');
    vi.mocked(api.requestWatchPairingCode).mockResolvedValueOnce({
      code: '654321',
      expiresAt: new Date(Date.now() + 3_000).toISOString(),
    });
    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('654 321')).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(4_000); });

    expect(screen.queryByText('654 321')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up watch/i })).toBeInTheDocument();
  });

  it('polls watch/status while a code is showing and flips to Connected once the watch exchanges it', async () => {
    vi.useFakeTimers();
    const api = await import('../lib/api');
    vi.mocked(api.fetchWatchStatus)
      .mockResolvedValueOnce({ connected: false, lastSeenAt: null }) // initial mount hydrate
      .mockResolvedValueOnce({ connected: true, lastSeenAt: new Date().toISOString() }); // first poll tick

    render(<Provider store={buildStore()}><WatchTokenCard /></Provider>);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: /set up watch/i }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('123 456')).toBeInTheDocument();

    await act(async () => { vi.advanceTimersByTime(4_000); await Promise.resolve(); });

    expect(screen.queryByText('123 456')).not.toBeInTheDocument();
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it('shows a connected badge plus re-pair and disconnect when connected', async () => {
    const api = await import('../lib/api');
    const now = Date.now();
    const lastSeenAt = new Date(now - 30_000).toISOString();
    vi.mocked(api.fetchWatchStatus).mockResolvedValueOnce({ connected: true, lastSeenAt });
    render(
      <Provider store={buildStore({ watchConnected: true, watchLastSeenAt: lastSeenAt })}>
        <WatchTokenCard />
      </Provider>,
    );
    await act(async () => {});
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-pair/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
  });

  it('revokes the token on disconnect', async () => {
    const api = await import('../lib/api');
    const lastSeenAt = new Date().toISOString();
    vi.mocked(api.fetchWatchStatus).mockResolvedValueOnce({ connected: true, lastSeenAt });
    render(<Provider store={buildStore({ watchConnected: true, watchLastSeenAt: lastSeenAt })}><WatchTokenCard /></Provider>);
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    await waitFor(() => expect(api.revokeWatchToken).toHaveBeenCalled());
  });
});
