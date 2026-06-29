import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import DisconnectButton from '../components/DisconnectButton';
import integrationsReducer from '../store/slices/integrationsSlice';
import authReducer from '../store/slices/authSlice';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../lib/api', () => ({
  disconnectProvider: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
}));

function buildStore() {
  return configureStore({
    reducer: { integrations: integrationsReducer, auth: authReducer },
    preloadedState: { integrations: { musicProvider: 'spotify', biometricProvider: null } } as never,
  });
}

describe('DisconnectButton', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirms, calls the disconnect API, and clears the provider in state', async () => {
    const { disconnectProvider } = await import('../lib/api');
    const store = buildStore();
    render(
      <Provider store={store}>
        <MemoryRouter><DisconnectButton kind="spotify" /></MemoryRouter>
      </Provider>,
    );

    // Open the confirm dialog…
    fireEvent.click(screen.getByRole('button', { name: /disconnect spotify/i }));
    // …then confirm.
    fireEvent.click(await screen.findByRole('button', { name: /^disconnect$/i }));

    await waitFor(() => expect(disconnectProvider).toHaveBeenCalledWith(expect.any(String), 'spotify'));
    await waitFor(() => expect(store.getState().integrations.musicProvider).toBeNull());
  });
});
