import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import OfflineBanner from '../components/OfflineBanner';
import playerReducer from '../store/slices/playerSlice';

const reconnectSocketNow = vi.fn();
vi.mock('@/hooks/useSocket', () => ({
  reconnectSocketNow: () => reconnectSocketNow(),
}));

interface Partial {
  isOnline: boolean;
  reconnectAttempt: number;
  reconnectExhausted: boolean;
  offlineBuffer: unknown[];
}
function renderWith(p: Partial) {
  const store = configureStore({
    reducer: { player: playerReducer },
    preloadedState: { player: p } as never,
  });
  return render(<Provider store={store}><OfflineBanner /></Provider>);
}

const track = { id: '1', title: 't', artist: 'a', uri: 'u' };

describe('OfflineBanner', () => {
  beforeEach(() => reconnectSocketNow.mockClear());

  it('renders nothing while online', () => {
    const { container } = renderWith({ isOnline: true, reconnectAttempt: 0, reconnectExhausted: false, offlineBuffer: [] });
    expect(container.firstChild).toBeNull();
  });

  it('shows the live reconnect attempt and buffered-track count', () => {
    renderWith({ isOnline: false, reconnectAttempt: 2, reconnectExhausted: false, offlineBuffer: [track, track] });
    expect(screen.getByText(/attempt 2\/5/i)).toBeInTheDocument();
    expect(screen.getByText(/saved 2 tracks/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try now/i })).toBeNull();
  });

  it('offers a manual retry once automatic reconnects are exhausted', () => {
    renderWith({ isOnline: false, reconnectAttempt: 5, reconnectExhausted: true, offlineBuffer: [track] });
    expect(screen.getByText(/couldn.t reconnect/i)).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /try now/i });
    fireEvent.click(btn);
    expect(reconnectSocketNow).toHaveBeenCalledTimes(1);
  });
});
