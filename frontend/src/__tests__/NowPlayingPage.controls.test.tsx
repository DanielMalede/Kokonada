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
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    nextTrack: vi.fn().mockResolvedValue(undefined),
    previousTrack: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../hooks/useSocket', () => ({
  useSocket: () => ({ skipTrack: vi.fn(), emitEmotionUpdate: vi.fn(), connected: true, disconnect: vi.fn() }),
}));

const playlist = [
  { id: 'a', title: 'Song A', artist: 'Artist X', uri: 'spotify:track:a' },
  { id: 'b', title: 'Song B', artist: 'Artist Y', uri: 'spotify:track:b' },
  { id: 'c', title: 'Song C', artist: 'Artist Z', uri: 'spotify:track:c' },
];

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
        playlist,
        offlineBuffer: [],
        currentIndex: 1,
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
        sdkCurrentTrackUri: 'spotify:track:b',
        sdkCurrentTrackImage: 'https://img/cover-b.jpg',
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

describe('NowPlayingPage — Agent 2 controls', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a Previous button wired to the SDK previousTrack() (Bug 2/5)', () => {
    renderPage();
    const prev = screen.getByLabelText('Previous');
    fireEvent.click(prev);
    expect(spotifyPlayerService.previousTrack).toHaveBeenCalledOnce();
  });

  it('Next is still wired to the SDK nextTrack()', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Skip'));
    expect(spotifyPlayerService.nextTrack).toHaveBeenCalledOnce();
  });

  it('disables Previous on the first track', () => {
    renderPage({ currentIndex: 0, sdkCurrentTrackUri: 'spotify:track:a' });
    expect(screen.getByLabelText('Previous')).toBeDisabled();
  });

  it('renders the album art when the SDK reports cover art (Bug 4)', () => {
    renderPage();
    const img = screen.getByAltText(/album art/i) as HTMLImageElement;
    expect(img.src).toContain('cover-b.jpg');
  });

  it('falls back to the aura (no img) when there is no album art', () => {
    renderPage({ sdkCurrentTrackImage: null });
    expect(screen.queryByAltText(/album art/i)).toBeNull();
  });
});
