import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import NowPlayingPage from '../pages/NowPlayingPage';
import { setTrackSaved, fetchTracksSaved, exportPlaylist } from '@/lib/api';
import playerReducer from '../store/slices/playerSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import emotionReducer from '../store/slices/emotionSlice';
import integrationsReducer from '../store/slices/integrationsSlice';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    setTrackSaved: vi.fn().mockResolvedValue(undefined),
    fetchTracksSaved: vi.fn().mockResolvedValue({}),
    exportPlaylist: vi.fn().mockResolvedValue({ url: 'https://open.spotify.com/playlist/x' }),
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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

const BACKEND = 'http://localhost:5000';
// URIs must be valid 22-char base62 ids or sanitizeTrackUris drops them (export).
const URI_A = 'spotify:track:7ouMYWpwJ422jRcDASZB7P';
const URI_B = 'spotify:track:0VjIjW4GlUZtnsem9w9PA8';
const URI_C = 'spotify:track:11dFghVXANMlKmJXsNCbNl';
const playlist = [
  { id: 'a', title: 'Song A', artist: 'Artist X', uri: URI_A },
  { id: 'b', title: 'Song B', artist: 'Artist Y', uri: URI_B },
  { id: 'c', title: 'Song C', artist: 'Artist Z', uri: URI_C },
];

function renderPage(overrides = {}) {
  const store = configureStore({
    reducer: {
      auth: authReducer, biometrics: biometricsReducer, emotion: emotionReducer,
      player: playerReducer, integrations: integrationsReducer,
    },
    preloadedState: {
      player: {
        playlist, offlineBuffer: [], currentIndex: 1, isPlaying: false, isOnline: true,
        trigger: 'emotion' as const, playbackMode: 'live' as const, sdkReady: true,
        deviceId: 'dev_123', sdkIsPaused: true, sdkPositionMs: 0, sdkDurationMs: 240_000,
        pendingPlaylist: [], sdkCurrentTrackUri: 'spotify:track:b', sdkCurrentTrackImage: null,
        ...overrides,
      },
    } as never,
  });
  return render(
    <Provider store={store}><MemoryRouter><NowPlayingPage /></MemoryRouter></Provider>,
  );
}

describe('NowPlayingPage — Like (Bug 7) + Export (Bug 6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hydrates the heart state for the current track on mount', async () => {
    renderPage();
    await waitFor(() => expect(fetchTracksSaved).toHaveBeenCalledWith(BACKEND, ['b']));
  });

  it('saves the current track to Liked Songs when the heart is clicked', async () => {
    renderPage();
    await waitFor(() => expect(fetchTracksSaved).toHaveBeenCalled());
    fireEvent.click(screen.getByLabelText(/^(like|unlike)$/i));
    expect(setTrackSaved).toHaveBeenCalledWith(BACKEND, 'b', true);
  });

  it('reflects an already-liked track as filled (Unlike)', async () => {
    (fetchTracksSaved as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ b: true });
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('Unlike')).toBeInTheDocument());
  });

  it('exports the whole playlist to Spotify when the Export button is clicked', () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Export to Spotify'));
    expect(exportPlaylist).toHaveBeenCalledWith(
      BACKEND,
      [URI_A, URI_B, URI_C],
      expect.any(String),
    );
  });
});
