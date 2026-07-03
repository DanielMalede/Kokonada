import { createStore, type StoreApi } from 'zustand/vanilla';

// Surfaces the latest generation failure (playlist_error) to the UI. Ephemeral.
export interface PlaybackErrorState {
  message: string | null;
  set(message: string | null): void;
  clear(): void;
}

export type PlaybackErrorStore = StoreApi<PlaybackErrorState>;

export const playbackErrorStore: PlaybackErrorStore = createStore<PlaybackErrorState>((set) => ({
  message: null,
  set: (message) => set({ message }),
  clear: () => set({ message: null }),
}));
