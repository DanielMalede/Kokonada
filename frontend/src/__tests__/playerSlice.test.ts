import { describe, it, expect } from 'vitest';
import playerReducer, { setSdkState } from '../store/slices/playerSlice';

describe('playerSlice — SDK state', () => {
  const base = {
    playlist: [], offlineBuffer: [], currentIndex: 0,
    isPlaying: false, isOnline: true, trigger: null, playbackMode: null,
    sdkReady: false, deviceId: null,
    sdkIsPaused: true, sdkPositionMs: 0, sdkDurationMs: 0,
  };

  it('setSdkState updates SDK fields', () => {
    const next = playerReducer(base as never, setSdkState({
      deviceId: 'dev_abc',
      isReady: true,
      isPaused: false,
      positionMs: 5000,
      durationMs: 210000,
    }));
    expect(next.deviceId).toBe('dev_abc');
    expect(next.sdkReady).toBe(true);
    expect(next.sdkIsPaused).toBe(false);
    expect(next.sdkPositionMs).toBe(5000);
    expect(next.sdkDurationMs).toBe(210000);
  });

  it('setSdkState partial update preserves other fields', () => {
    const state = { ...base, sdkPositionMs: 3000, sdkDurationMs: 180000 };
    const next = playerReducer(state as never, setSdkState({ positionMs: 4000 }));
    expect(next.sdkPositionMs).toBe(4000);
    expect(next.sdkDurationMs).toBe(180000); // unchanged
  });

  // ── Bug 3: the SDK's reported track is the single source of truth for index ──

  const withPlaylist = {
    ...base,
    playlist: [
      { id: 'a', title: 'A', artist: 'X', uri: 'spotify:track:a' },
      { id: 'b', title: 'B', artist: 'Y', uri: 'spotify:track:b' },
      { id: 'c', title: 'C', artist: 'Z', uri: 'spotify:track:c' },
    ],
    currentIndex: 0,
  };

  it('syncs currentIndex to the track the SDK reports it is actually playing', () => {
    const next = playerReducer(withPlaylist as never, setSdkState({ currentTrackUri: 'spotify:track:c' }));
    expect(next.currentIndex).toBe(2);
    expect(next.sdkCurrentTrackUri).toBe('spotify:track:c');
  });

  it('leaves currentIndex untouched when the reported uri is not in the playlist', () => {
    const state = { ...withPlaylist, currentIndex: 1 };
    const next = playerReducer(state as never, setSdkState({ currentTrackUri: 'spotify:track:zzz' }));
    expect(next.currentIndex).toBe(1);
  });

  it('leaves currentIndex untouched when the SDK reports no track (null)', () => {
    const state = { ...withPlaylist, currentIndex: 2 };
    const next = playerReducer(state as never, setSdkState({ currentTrackUri: null }));
    expect(next.currentIndex).toBe(2);
  });

  it('stores the album art url (Bug 4)', () => {
    const next = playerReducer(base as never, setSdkState({ currentTrackImage: 'https://img/cover.jpg' }));
    expect(next.sdkCurrentTrackImage).toBe('https://img/cover.jpg');
  });
});
