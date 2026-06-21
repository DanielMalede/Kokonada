import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import playerReducer from '../store/slices/playerSlice';
import LivePlayer from '../components/LivePlayer/LivePlayer';

// Mock useSocket so it doesn't try to open a real WebSocket
vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({
    skipTrack: vi.fn(),
    emitEmotionUpdate: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  }),
}));

// Mock audioPlayer to avoid Web Audio API in test environment
vi.mock('../services/audioPlayer', () => ({
  audioPlayer: {
    play: vi.fn(),
    stop: vi.fn(),
    crossfadeTo: vi.fn(),
  },
}));

const makeStore = (playbackMode: 'live' | 'export' | null, playlist: { id: string; title: string; artist: string; uri: string }[]) =>
  configureStore({
    reducer: { player: playerReducer },
    preloadedState: {
      player: {
        playbackMode,
        playlist,
        currentIndex: 0,
        isPlaying: false,
        isOnline: true,
        offlineBuffer: [],
        trigger: null,
      },
    },
  });

describe('LivePlayer', () => {
  it('renders current track when playbackMode is live', () => {
    const store = makeStore('live', [{ id: '1', uri: 'x', title: 'Track A', artist: 'Artist B' }]);
    const { getByText } = render(
      <Provider store={store}>
        <LivePlayer />
      </Provider>
    );
    expect(getByText('Track A')).toBeTruthy();
    expect(getByText('Artist B')).toBeTruthy();
  });

  it('renders nothing when playbackMode is null', () => {
    const store = makeStore(null, [{ id: '1', uri: 'x', title: 'Track A', artist: 'Artist B' }]);
    const { container } = render(
      <Provider store={store}>
        <LivePlayer />
      </Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when playlist is empty', () => {
    const store = makeStore('live', []);
    const { container } = render(
      <Provider store={store}>
        <LivePlayer />
      </Provider>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when playbackMode is export', () => {
    const store = makeStore('export', [{ id: '1', uri: 'x', title: 'Track A', artist: 'Artist B' }]);
    const { container } = render(
      <Provider store={store}>
        <LivePlayer />
      </Provider>
    );
    expect(container.firstChild).toBeNull();
  });
});
