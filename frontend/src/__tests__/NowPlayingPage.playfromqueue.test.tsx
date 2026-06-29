import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import NowPlayingPage from '../pages/NowPlayingPage';
import playerReducer from '../store/slices/playerSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import emotionReducer from '../store/slices/emotionSlice';
import integrationsReducer from '../store/slices/integrationsSlice';
import { playTracks, fetchTracksSaved } from '@/lib/api';

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

vi.mock('@/lib/api', () => ({
  authHeaders: () => ({}),
  setTrackSaved: vi.fn().mockResolvedValue(undefined),
  fetchTracksSaved: vi.fn().mockResolvedValue({}),
  exportPlaylist: vi.fn().mockResolvedValue({ url: 'https://open.spotify.com/playlist/x' }),
  playTracks: vi.fn().mockResolvedValue(undefined),
}));

// sanitizeTrackUris drops anything that isn't a valid 22-char base62 Spotify id,
// so the fixture URIs must be real-shaped ids (e.g. "track3" padded to 22 chars).
const id22 = (i: number) => `track${i}`.padEnd(22, '0');
const makePlaylist = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, title: `Song ${i}`, artist: `Artist ${i}`, uri: `spotify:track:${id22(i)}`,
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

describe('NowPlayingPage — play from queue (clickable rows)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mounts and hydrates the like state', () => {
    renderPage();
    expect(fetchTracksSaved).toHaveBeenCalled();
  });

  it('clicking an Up-next row plays from that track onward on the SDK device', () => {
    renderPage();
    // currentIndex 0 → Up next is t1..t11. Click "Song 3" (absolute index 3).
    fireEvent.click(screen.getByText('Song 3').closest('button')!);
    expect(playTracks).toHaveBeenCalledTimes(1);
    const [, uris, deviceId] = (playTracks as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    // Plays the rest of the queue starting at the clicked track so the queue continues.
    expect(uris[0]).toBe(`spotify:track:${id22(3)}`);
    expect(uris).toHaveLength(9); // t3..t11
    expect(deviceId).toBe('dev_123');
  });
});
