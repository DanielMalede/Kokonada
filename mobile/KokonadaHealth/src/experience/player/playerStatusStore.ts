import { createStore, type StoreApi } from 'zustand/vanilla';
import type { PlayerState } from './spotifyController';

// Observable Spotify connection status. The SpotifyPlayerController already emits
// every transition through its onStateChange dep, but the production `player`
// singleton was constructed WITHOUT that callback — so a connect/disconnect was
// invisible to every screen (QA4 Suspect #4). This tiny warm store is the sink:
// playbackServices wires onStateChange → set(), and the Profile screen subscribes
// to render a live badge. Ephemeral, never persisted.

export interface PlayerStatusState {
  status: PlayerState;
  set(status: PlayerState): void;
}

export type PlayerStatusStore = StoreApi<PlayerStatusState>;

export function createPlayerStatusStore(): PlayerStatusStore {
  return createStore<PlayerStatusState>((set) => ({
    status: 'disconnected',
    set(status: PlayerState) { set({ status }); },
  }));
}

export const playerStatusStore = createPlayerStatusStore();
