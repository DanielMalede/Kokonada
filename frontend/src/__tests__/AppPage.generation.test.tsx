import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import AppPage from '../pages/AppPage';
import playerReducer, { setPlaylist } from '../store/slices/playerSlice';
import emotionReducer, { setActivity } from '../store/slices/emotionSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import integrationsReducer from '../store/slices/integrationsSlice';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await (orig() as Promise<object>)),
  useNavigate: () => navigateMock,
}));

const requestPlaylist = vi.fn(() => 1);
const requestHeartPlaylist = vi.fn(() => 1);
vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({ requestPlaylist, requestHeartPlaylist }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: { error: (...a: unknown[]) => toastError(...a), success: (...a: unknown[]) => toastSuccess(...a) },
}));

vi.mock('@/lib/history', () => ({ saveSession: vi.fn(), makeSessionId: () => 's1' }));

function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      emotion: emotionReducer,
      player: playerReducer,
      biometrics: biometricsReducer,
      integrations: integrationsReducer,
    },
  });
}

const track = (id: string) => ({ id, title: `T${id}`, artist: 'A', uri: `spotify:track:${id}` });

describe('AppPage — generation feedback (no silent failure)', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('still navigates to the player when the playlist arrives after the old 9s timeout', () => {
    const store = makeStore();
    render(<Provider store={store}><MemoryRouter><AppPage /></MemoryRouter></Provider>);

    fireEvent.click(screen.getByRole('button', { name: /listen to your heart/i }));
    expect(requestHeartPlaylist).toHaveBeenCalled();

    // Backend takes ~12s (Groq + critic + discovery) — past the OLD 9s overlay timeout.
    act(() => { vi.advanceTimersByTime(12_000); });
    act(() => { store.dispatch(setPlaylist({ tracks: [track('a'), track('b')], trigger: 'heart' })); });

    // The late result must NOT be silently dropped — the user is taken to the player.
    expect(navigateMock).toHaveBeenCalledWith('/now-playing');
  });

  it('shows a toast (never silent) when generation truly times out', () => {
    const store = makeStore();
    render(<Provider store={store}><MemoryRouter><AppPage /></MemoryRouter></Provider>);

    fireEvent.click(screen.getByRole('button', { name: /listen to your heart/i }));
    // Nothing ever arrives — advance past the safety timeout.
    act(() => { vi.advanceTimersByTime(26_000); });

    expect(toastError).toHaveBeenCalled();
  });

  it('enables Generate with only an activity selected (no mood) and sends its label', () => {
    const store = makeStore();
    act(() => { store.dispatch(setActivity('running')); });
    render(<Provider store={store}><MemoryRouter><AppPage /></MemoryRouter></Provider>);

    const btn = screen.getByRole('button', { name: /generate playlist/i });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    // No mood tap, empty context, activity sent as its natural-language label.
    expect(requestPlaylist).toHaveBeenCalledWith([], '', 'Running');
  });
});
