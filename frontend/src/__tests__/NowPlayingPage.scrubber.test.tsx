import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import NowPlayingPage from '../pages/NowPlayingPage';
import { spotifyPlayerService } from '../services/spotifyPlayer';
import playerReducer from '../store/slices/playerSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import emotionReducer from '../store/slices/emotionSlice';
import integrationsReducer from '../store/slices/integrationsSlice';

vi.mock('../services/spotifyPlayer', () => ({
  spotifyPlayerService: {
    pause:     vi.fn().mockResolvedValue(undefined),
    resume:    vi.fn().mockResolvedValue(undefined),
    nextTrack: vi.fn().mockResolvedValue(undefined),
    seek:      vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({ skipTrack: vi.fn(), emitEmotionUpdate: vi.fn(), connected: true, disconnect: vi.fn() }),
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
        playlist: [
          { id: 'aaa', title: 'Song A', artist: 'Artist X', uri: 'spotify:track:aaa' },
          { id: 'bbb', title: 'Song B', artist: 'Artist Y', uri: 'spotify:track:bbb' },
        ],
        offlineBuffer: [],
        currentIndex: 0,
        isPlaying: false,
        isOnline: true,
        trigger: 'emotion' as const,
        playbackMode: 'live' as const,
        sdkReady: true,
        deviceId: 'dev_123',
        sdkIsPaused: true,
        sdkPositionMs: 100_000, // 1:40
        sdkDurationMs: 240_000, // 4:00
        pendingPlaylist: [],
        sdkCurrentTrackUri: 'spotify:track:aaa',
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

describe('NowPlayingPage scrubber', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an enabled seek slider with current position and duration', () => {
    renderPage();
    expect(screen.getByText('1:40')).toBeInTheDocument(); // position
    expect(screen.getByText('4:00')).toBeInTheDocument(); // duration
    expect(document.querySelector('[role="slider"]')).toBeTruthy();
  });

  it('disables the scrubber and shows --:-- when no track duration is known', () => {
    const { container } = renderPage({ sdkDurationMs: 0, sdkPositionMs: 0 });
    expect(screen.getByText('--:--')).toBeInTheDocument();
    expect(container.querySelector('.pointer-events-none')).toBeTruthy();
  });

  it('commits a seek to the SDK when the user moves the slider to the end', () => {
    renderPage();
    const thumb = document.querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(thumb, { key: 'End' });
    expect(spotifyPlayerService.seek).toHaveBeenCalledWith(240_000); // jump to track end
  });

  it('shows the empty state when nothing is playing', () => {
    renderPage({ playlist: [], offlineBuffer: [] });
    expect(screen.getByText(/Nothing playing yet/i)).toBeInTheDocument();
  });
});
