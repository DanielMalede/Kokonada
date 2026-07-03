import { createStore, type StoreApi } from 'zustand/vanilla';
import type { NowPlaying } from './playbackOrchestrator';

// A tiny observable for the current playback state, so the Now Playing screen can
// subscribe (with useEffect cleanup) instead of the orchestrator holding a single
// component-bound callback. Ephemeral, never persisted.
export interface NowPlayingState extends NowPlaying {
  set(state: NowPlaying): void;
}

export type NowPlayingStore = StoreApi<NowPlayingState>;

export function createNowPlayingStore(): NowPlayingStore {
  return createStore<NowPlayingState>((set) => ({
    track: null,
    isPlaying: false,
    set: (state) => set({ track: state.track, isPlaying: state.isPlaying }),
  }));
}

// App-level singleton (mirrors warmStore in state/store).
export const nowPlayingStore = createNowPlayingStore();
