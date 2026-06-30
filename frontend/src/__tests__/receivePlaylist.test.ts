import { describe, it, expect, vi } from 'vitest';
import {
  receivePlaylist,
  setPendingPlaylist,
  setPlaylist,
  setPlaybackMode,
  setPlaylistError,
} from '../store/slices/playerSlice';

const track = (id: string) => ({ id, title: `T${id}`, artist: `A${id}`, uri: `spotify:track:${id}` });

function run(payload: Parameters<typeof receivePlaylist>[0], playerState: Record<string, unknown>) {
  const dispatch = vi.fn();
  const getState = () => ({ player: playerState }) as never;
  receivePlaylist(payload)(dispatch, getState);
  return dispatch;
}

describe('receivePlaylist thunk', () => {
  it('queues a biometric playlist as pending, threading its mode, when actively playing', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'biometric', mode: 'live' },
      { playlist: [track('1')], sdkIsPaused: false },
    );
    expect(dispatch).toHaveBeenCalledWith(setPendingPlaylist({ tracks: [track('9')], mode: 'live' }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: setPlaylist.type }));
  });

  it('replaces immediately for a biometric playlist when paused', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'biometric', mode: 'live' },
      { playlist: [track('1')], sdkIsPaused: true },
    );
    expect(dispatch).toHaveBeenCalledWith(setPlaylist({ tracks: [track('9')], trigger: 'biometric' }));
    expect(dispatch).toHaveBeenCalledWith(setPlaybackMode('live'));
  });

  it('replaces immediately for a biometric playlist when nothing is loaded', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'biometric' },
      { playlist: [], sdkIsPaused: false },
    );
    expect(dispatch).toHaveBeenCalledWith(setPlaylist({ tracks: [track('9')], trigger: 'biometric' }));
  });

  it('replaces immediately for an emotion playlist even while actively playing', () => {
    const dispatch = run(
      { tracks: [track('9')], trigger: 'emotion' },
      { playlist: [track('1')], sdkIsPaused: false },
    );
    expect(dispatch).toHaveBeenCalledWith(setPlaylist({ tracks: [track('9')], trigger: 'emotion' }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: setPendingPlaylist.type }));
  });

  it('flags an error and leaves the queue untouched on an empty payload', () => {
    const dispatch = run(
      { tracks: [], trigger: 'emotion' },
      { playlist: [track('1')], sdkIsPaused: false },
    );
    expect(dispatch).toHaveBeenCalledWith(setPlaylistError());
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: setPlaylist.type }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: setPendingPlaylist.type }));
  });
});
