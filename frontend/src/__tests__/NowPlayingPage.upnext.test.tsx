import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import NowPlayingPage from '../pages/NowPlayingPage';
import playerReducer from '../store/slices/playerSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import emotionReducer from '../store/slices/emotionSlice';
import integrationsReducer from '../store/slices/integrationsSlice';

vi.mock('../services/spotifyPlayer', () => ({
  spotifyPlayerService: {
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    nextTrack: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({ skipTrack: vi.fn(), emitEmotionUpdate: vi.fn(), connected: true, disconnect: vi.fn() }),
}));

const makePlaylist = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Song ${i}`, artist: `Artist ${i}`, uri: `spotify:track:t${i}`,
  }));

function buildStore(playerOverrides = {}) {
  return configureStore({
    reducer: {
      auth: authReducer,
      biometrics: biometricsReducer,
      emotion: emotionReducer,
      player: playerReducer,
      integrations: integrationsReducer,
    },
    preloadedState: {
      player: {
        playlist: makePlaylist(12),
        offlineBuffer: [],
        currentIndex: 0,
        isPlaying: false,
        isOnline: true,
        trigger: 'emotion' as const,
        playbackMode: 'live' as const,
        sdkReady: true,
        deviceId: 'dev_123',
        sdkIsPaused: true,
        sdkPositionMs: 0,
        sdkDurationMs: 240_000,
        pendingPlaylist: [],
        sdkCurrentTrackUri: 'spotify:track:t0',
        ...playerOverrides,
      },
    } as never,
  });
}

const renderPage = (overrides = {}) =>
  render(
    <Provider store={buildStore(overrides)}>
      <MemoryRouter><NowPlayingPage /></MemoryRouter>
    </Provider>,
  );

describe('NowPlayingPage — Bug 9: full scrollable Up next list', () => {
  it('renders EVERY upcoming track, not just the first 7', () => {
    renderPage();
    // currentIndex 0 → up next is tracks 1..11. The 11th must be reachable.
    expect(screen.getByText('Song 11')).toBeInTheDocument();
    expect(screen.getByText('Song 8')).toBeInTheDocument();
  });

  it('wraps the queue in a scrollable (overflow-y-auto) container', () => {
    const { container } = renderPage();
    expect(container.querySelector('.overflow-y-auto')).toBeTruthy();
  });
});
