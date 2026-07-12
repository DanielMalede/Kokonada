import { createStore, type StoreApi } from 'zustand/vanilla';
import type { NowPlaying } from './playbackOrchestrator';

// A tiny observable for the current playback state, so the Now Playing screen can
// subscribe (with useEffect cleanup) instead of the orchestrator holding a single
// component-bound callback. Ephemeral, never persisted.
//
// coverUri is DECOUPLED from the track: title/artist/receipt come from our queue, but the
// album cover is resolved from the LIVE App Remote player state (authoritative for what is
// audible) to a local file — so it is set on its own channel (setCover), never by set().
export interface NowPlayingState extends NowPlaying {
  coverUri: string | null;
  set(state: NowPlaying): void;
  setCover(coverUri: string | null): void;
}

export type NowPlayingStore = StoreApi<NowPlayingState>;

export function createNowPlayingStore(): NowPlayingStore {
  return createStore<NowPlayingState>((set) => ({
    track: null,
    isPlaying: false,
    coverUri: null,
    // Track/playing come from the orchestrator; the cover is intentionally left untouched
    // here so a pause/resume emit can never blank the resolved cover.
    set: (state) => set({ track: state.track, isPlaying: state.isPlaying }),
    setCover: (coverUri) => set({ coverUri }),
  }));
}

// App-level singleton (mirrors warmStore in state/store).
export const nowPlayingStore = createNowPlayingStore();
