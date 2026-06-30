import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { ReactNode } from 'react';
import { useSocket } from '../hooks/useSocket';
import { store } from '../store';
import { setPlaylist, setIsOnline, setSdkState } from '../store/slices/playerSlice';

// Stub the socket so initSocket doesn't open a real connection.
vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), connected: true }),
  Socket: class {},
}));

const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
const tracks = ['a', 'b', 'c'].map((id) => ({ id, title: id, artist: 'x', uri: `spotify:track:${id}` }));

describe('useSocket.skipTrack — single source of truth for currentIndex (#3/#4)', () => {
  beforeEach(() => {
    store.dispatch(setPlaylist({ tracks, trigger: 'emotion' })); // currentIndex -> 0
  });

  it('does NOT move currentIndex when the SDK is driving (online + ready)', () => {
    store.dispatch(setIsOnline(true));
    store.dispatch(setSdkState({ isReady: true }));
    const { result } = renderHook(() => useSocket(), { wrapper });

    result.current.skipTrack();

    // The SDK (setSdkState) is the only thing allowed to move the index online.
    expect(store.getState().player.currentIndex).toBe(0);
  });

  it('DOES move currentIndex offline (no SDK to report the boundary)', () => {
    store.dispatch(setIsOnline(false));
    store.dispatch(setSdkState({ isReady: false }));
    const { result } = renderHook(() => useSocket(), { wrapper });

    result.current.skipTrack();

    expect(store.getState().player.currentIndex).toBe(1);
  });
});
