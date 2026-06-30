import { describe, it, expect } from 'vitest';
import playerReducer, {
  setPendingPlaylist,
  promotePendingPlaylist,
  setSdkState,
} from '../store/slices/playerSlice';

const track = (id: string) => ({ id, title: `T${id}`, artist: `A${id}`, uri: `spotify:track:${id}` });

const base = {
  playlist: [track('1')], offlineBuffer: [track('1')], currentIndex: 0,
  isPlaying: true, isOnline: true, trigger: 'emotion' as const, playbackMode: 'live' as const,
  sdkReady: true, deviceId: 'dev', sdkIsPaused: false, sdkPositionMs: 1000, sdkDurationMs: 200000,
  pendingPlaylist: [], pendingMode: null, sdkCurrentTrackUri: 'spotify:track:1',
};

describe('playerSlice — pending playlist', () => {
  it('setPendingPlaylist stores tracks without touching the active playlist', () => {
    const next = playerReducer(base as never, setPendingPlaylist({ tracks: [track('9'), track('8')] }));
    expect(next.pendingPlaylist).toHaveLength(2);
    expect(next.playlist).toEqual([track('1')]); // unchanged
  });

  it('setPendingPlaylist replaces any existing pending (newest wins)', () => {
    const withPending = { ...base, pendingPlaylist: [track('5')] };
    const next = playerReducer(withPending as never, setPendingPlaylist({ tracks: [track('9')] }));
    expect(next.pendingPlaylist).toEqual([track('9')]);
  });

  it('setPendingPlaylist defaults the pending mode to live', () => {
    const def = playerReducer(base as never, setPendingPlaylist({ tracks: [track('9')] }));
    expect(def.pendingMode).toBe('live');
  });

  it('promotePendingPlaylist moves pending to active, resets index, clears pending', () => {
    const withPending = { ...base, currentIndex: 3, pendingPlaylist: [track('9'), track('8')] };
    const next = playerReducer(withPending as never, promotePendingPlaylist());
    expect(next.playlist).toEqual([track('9'), track('8')]);
    expect(next.currentIndex).toBe(0);
    expect(next.offlineBuffer).toEqual([track('9'), track('8')]);
    expect(next.pendingPlaylist).toEqual([]);
  });

  it('promotePendingPlaylist applies the pending mode to playbackMode and clears it', () => {
    const withPending = { ...base, playbackMode: null, pendingPlaylist: [track('9')], pendingMode: 'live' as const };
    const next = playerReducer(withPending as never, promotePendingPlaylist());
    expect(next.playbackMode).toBe('live');
    expect(next.pendingMode).toBeNull();
  });

  it('promotePendingPlaylist is a no-op when pending is empty', () => {
    const next = playerReducer(base as never, promotePendingPlaylist());
    expect(next.playlist).toEqual([track('1')]);
    expect(next.pendingPlaylist).toEqual([]);
  });

  it('setSdkState applies currentTrackUri', () => {
    const next = playerReducer(base as never, setSdkState({ currentTrackUri: 'spotify:track:2' }));
    expect(next.sdkCurrentTrackUri).toBe('spotify:track:2');
  });
});
