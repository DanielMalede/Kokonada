import { describe, it, expect } from 'vitest';
import type { RootState } from '../store';
import integrationsReducer, {
  setMusicProvider,
  setConnections,
  clearIntegrations,
  selectIsIntegrationsComplete,
  selectPlaybackProvider,
} from '../store/slices/integrationsSlice';

const initial = { musicProvider: null, biometricProvider: null, status: 'idle' as const };

describe('integrationsSlice', () => {
  it('sets music provider', () => {
    const state = integrationsReducer(initial, setMusicProvider('spotify'));
    expect(state.musicProvider).toBe('spotify');
  });

  it('clears integrations', () => {
    const populated = { musicProvider: 'spotify' as const, biometricProvider: 'garmin' as const, status: 'idle' as const };
    const state = integrationsReducer(populated, clearIntegrations());
    expect(state.musicProvider).toBeNull();
    expect(state.biometricProvider).toBeNull();
  });

  it('selectIsIntegrationsComplete returns false when either is null', () => {
    const rootState = { integrations: { musicProvider: 'spotify', biometricProvider: null, status: 'idle' } } as unknown as RootState;
    expect(selectIsIntegrationsComplete(rootState)).toBe(false);
  });

  it('selectIsIntegrationsComplete returns true when both set', () => {
    const rootState = { integrations: { musicProvider: 'spotify', biometricProvider: 'garmin', status: 'idle' } } as unknown as RootState;
    expect(selectIsIntegrationsComplete(rootState)).toBe(true);
  });

  it('tracks Spotify + YouTube as connected simultaneously with distinct roles', () => {
    const state = integrationsReducer(
      initial,
      setConnections({ spotifyConnected: true, youtubeConnected: true, playbackProvider: 'spotify' }),
    );
    expect(state.spotifyConnected).toBe(true);
    expect(state.youtubeConnected).toBe(true);
    expect(state.playbackProvider).toBe('spotify'); // Spotify is the playback engine
  });

  it('selectPlaybackProvider is null for a YouTube-only user (no in-app playback)', () => {
    const state = integrationsReducer(
      initial,
      setConnections({ spotifyConnected: false, youtubeConnected: true, playbackProvider: null }),
    );
    expect(selectPlaybackProvider({ integrations: state } as unknown as RootState)).toBeNull();
  });

  it('treats a YouTube-only connection (no musicProvider yet) as a complete music source', () => {
    const state = integrationsReducer(
      { ...initial, biometricProvider: 'garmin' as const },
      setConnections({ spotifyConnected: false, youtubeConnected: true, playbackProvider: null }),
    );
    expect(selectIsIntegrationsComplete({ integrations: state } as unknown as RootState)).toBe(true);
  });
});
