import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import emotionReducer, { addTap, clearTaps } from '../store/slices/emotionSlice';
import authReducer from '../store/slices/authSlice';
import integrationsReducer from '../store/slices/integrationsSlice';
import playerReducer from '../store/slices/playerSlice';
import AppPage from '../pages/AppPage';

// Mock useSocket to prevent connection issues
vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    emitEmotionUpdate: vi.fn(),
    connected: true,
    skipTrack: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

// Mock child components to simplify testing
vi.mock('../components/ActivityPanel', () => ({
  default: () => <div data-testid="activity-panel">Activity Panel</div>,
}));

vi.mock('../components/ContextPrompt', () => ({
  default: () => <div data-testid="context-prompt">Context Prompt</div>,
}));

vi.mock('../components/EmotionCircle', () => ({
  default: () => <div data-testid="emotion-circle">Emotion Circle</div>,
}));

vi.mock('../components/PlaylistView', () => ({
  default: () => <div data-testid="playlist-view">Playlist View</div>,
}));

describe('NeutralSkip button behavior', () => {
  let store: any;

  beforeEach(() => {
    store = configureStore({
      reducer: {
        emotion: emotionReducer,
        auth: authReducer,
        integrations: integrationsReducer,
        player: playerReducer,
      },
      preloadedState: {
        emotion: { taps: [], textPrompt: '' },
        auth: { user: null, status: 'idle', error: null },
        integrations: { musicProvider: null, biometricProvider: null, status: 'idle' },
        player: {
          playlist: [],
          offlineBuffer: [],
          currentIndex: 0,
          isPlaying: false,
          isOnline: true,
          trigger: null,
          playbackMode: null,
        },
      },
    });
  });

  it('renders the Neutral/Skip button', () => {
    render(
      <Provider store={store}>
        <AppPage />
      </Provider>
    );
    const button = screen.getByRole('button', { name: /Neutral \/ Skip/i });
    expect(button).toBeDefined();
    expect(button).toBeInstanceOf(HTMLButtonElement);
  });

  it('Neutral/Skip button is enabled when less than 3 taps', () => {
    render(
      <Provider store={store}>
        <AppPage />
      </Provider>
    );
    const button = screen.getByRole('button', { name: /Neutral \/ Skip/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('Neutral/Skip button is disabled when 3 taps exist', () => {
    store.dispatch(addTap({ x: 10, y: 20 }));
    store.dispatch(addTap({ x: 30, y: 40 }));
    store.dispatch(addTap({ x: 50, y: 60 }));

    render(
      <Provider store={store}>
        <AppPage />
      </Provider>
    );
    const button = screen.getByRole('button', { name: /Neutral \/ Skip/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('clicking Neutral/Skip button adds a tap at origin (0, 0)', () => {
    const { rerender } = render(
      <Provider store={store}>
        <AppPage />
      </Provider>
    );
    const button = screen.getByRole('button', { name: /Neutral \/ Skip/i });
    fireEvent.click(button);

    const state = store.getState();
    expect(state.emotion.taps).toHaveLength(1);
    expect(state.emotion.taps[0]).toEqual({ x: 0, y: 0 });
  });

  it('allows multiple clicks until 3 taps reached', () => {
    render(
      <Provider store={store}>
        <AppPage />
      </Provider>
    );
    const button = screen.getByRole('button', { name: /Neutral \/ Skip/i });

    fireEvent.click(button);
    expect(store.getState().emotion.taps).toHaveLength(1);
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(store.getState().emotion.taps).toHaveLength(2);
    expect((button as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(button);
    expect(store.getState().emotion.taps).toHaveLength(3);
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('emotionSlice reducer', () => {
  it('addTap adds a tap to the taps array', () => {
    const initial = { taps: [], textPrompt: '' };
    const state = emotionReducer(initial, addTap({ x: 0, y: 0 }));
    expect(state.taps).toHaveLength(1);
    expect(state.taps[0]).toEqual({ x: 0, y: 0 });
  });

  it('addTap stores tap with correct coordinates', () => {
    const initial = { taps: [], textPrompt: '' };
    const state = emotionReducer(initial, addTap({ x: 25, y: 75 }));
    expect(state.taps[0].x).toBe(25);
    expect(state.taps[0].y).toBe(75);
  });

  it('addTap does not exceed 3 taps', () => {
    let state = { taps: [], textPrompt: '' };
    state = emotionReducer(state, addTap({ x: 0, y: 0 }));
    state = emotionReducer(state, addTap({ x: 1, y: 1 }));
    state = emotionReducer(state, addTap({ x: 2, y: 2 }));
    state = emotionReducer(state, addTap({ x: 3, y: 3 }));
    expect(state.taps).toHaveLength(3);
  });

  it('clearTaps removes all taps', () => {
    const initial = { taps: [{ x: 0, y: 0 }, { x: 1, y: 1 }], textPrompt: '' };
    const state = emotionReducer(initial, clearTaps());
    expect(state.taps).toHaveLength(0);
  });
});
