import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import LivePlayer from '../components/LivePlayer';
import playerReducer from '../store/slices/playerSlice';
import authReducer from '../store/slices/authSlice';
import biometricsReducer from '../store/slices/biometricsSlice';
import emotionReducer from '../store/slices/emotionSlice';
import integrationsReducer from '../store/slices/integrationsSlice';

// Mock spotifyPlayerService
vi.mock('../services/spotifyPlayer', () => ({
  spotifyPlayerService: {
    pause:     vi.fn().mockResolvedValue(undefined),
    resume:    vi.fn().mockResolvedValue(undefined),
    nextTrack: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock useSocket
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
        sdkPositionMs: 0,
        sdkDurationMs: 210000,
        ...playerOverrides,
      },
    } as never,
  });
}

describe('LivePlayer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders track title and artist', () => {
    render(<Provider store={buildStore()}><LivePlayer /></Provider>);
    expect(screen.getByText('Song A')).toBeInTheDocument();
    expect(screen.getByText('Artist X')).toBeInTheDocument();
  });

  it('shows play button when SDK is paused', () => {
    render(<Provider store={buildStore({ sdkIsPaused: true })}><LivePlayer /></Provider>);
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument();
  });

  it('shows pause button when SDK is playing', () => {
    render(<Provider store={buildStore({ sdkIsPaused: false })}><LivePlayer /></Provider>);
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  it('calls spotifyPlayerService.resume() on play click', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    render(<Provider store={buildStore({ sdkIsPaused: true })}><LivePlayer /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /play/i }));
    expect(spotifyPlayerService.resume).toHaveBeenCalledOnce();
  });

  it('calls spotifyPlayerService.pause() on pause click', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    render(<Provider store={buildStore({ sdkIsPaused: false })}><LivePlayer /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /pause/i }));
    expect(spotifyPlayerService.pause).toHaveBeenCalledOnce();
  });

  it('calls spotifyPlayerService.nextTrack() on skip click', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    render(<Provider store={buildStore()}><LivePlayer /></Provider>);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(spotifyPlayerService.nextTrack).toHaveBeenCalledOnce();
  });

  it('skip button is disabled when on last track', () => {
    render(
      <Provider store={buildStore({ currentIndex: 1 })}><LivePlayer /></Provider>
    );
    expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled();
  });

  it('renders progress bar width from SDK position', () => {
    // 50% through a 200s track
    const store = buildStore({ sdkPositionMs: 100000, sdkDurationMs: 200000 });
    const { container } = render(<Provider store={store}><LivePlayer /></Provider>);
    const bar = container.querySelector('.bg-\\[\\#e9c46a\\]') as HTMLElement;
    expect(bar.style.width).toBe('50%');
  });

  it('returns null when playbackMode is not live', () => {
    const { container } = render(
      <Provider store={buildStore({ playbackMode: null })}><LivePlayer /></Provider>
    );
    expect(container.firstChild).toBeNull();
  });
});
