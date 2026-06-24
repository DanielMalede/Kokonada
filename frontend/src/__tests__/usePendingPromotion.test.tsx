import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import playerReducer, { setSdkState, setPendingPlaylist } from '../store/slices/playerSlice';
import { shouldPromote, usePendingPromotion } from '../hooks/usePendingPromotion';

const track = (id: string) => ({ id, title: `T${id}`, artist: `A${id}`, uri: `spotify:track:${id}` });

describe('shouldPromote', () => {
  it('true when the track uri changes and pending exists', () => {
    expect(shouldPromote('spotify:track:1', 'spotify:track:2', 1)).toBe(true);
  });
  it('false when pending is empty', () => {
    expect(shouldPromote('spotify:track:1', 'spotify:track:2', 0)).toBe(false);
  });
  it('false when the uri is unchanged', () => {
    expect(shouldPromote('spotify:track:1', 'spotify:track:1', 1)).toBe(false);
  });
  it('false on the first uri (prev is null) so initial play never promotes', () => {
    expect(shouldPromote(null, 'spotify:track:1', 1)).toBe(false);
  });
});

describe('usePendingPromotion', () => {
  it('promotes the pending playlist when the track changes', () => {
    const store = configureStore({ reducer: { player: playerReducer } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    renderHook(() => usePendingPromotion(), { wrapper });

    // Establish the current track, then queue a pending playlist.
    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:1' })); });
    act(() => { store.dispatch(setPendingPlaylist([track('9'), track('8')])); });

    // Current track ends → SDK reports the next uri.
    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:2' })); });

    expect(store.getState().player.playlist).toEqual([track('9'), track('8')]);
    expect(store.getState().player.pendingPlaylist).toEqual([]);
  });

  it('does not promote when there is no pending playlist', () => {
    const store = configureStore({ reducer: { player: playerReducer } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <Provider store={store}>{children}</Provider>;
    renderHook(() => usePendingPromotion(), { wrapper });

    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:1' })); });
    act(() => { store.dispatch(setSdkState({ currentTrackUri: 'spotify:track:2' })); });

    expect(store.getState().player.playlist).toEqual([]); // initial empty, untouched
  });
});
