import { createStore, type StoreApi } from 'zustand/vanilla';
import type { KokonadaUser } from './auth';

// The logged-in user identity, held in memory. Login writes it; the auth gate reads
// it to decide tabs-vs-SignIn; ColdPersistence reads its id to namespace persisted
// intent (so user A's taps never rehydrate into user B). Ephemeral — never persisted.

export interface CurrentUserState {
  user: KokonadaUser | null;
  setUser(user: KokonadaUser | null): void;
  clear(): void;
}

export type CurrentUserStore = StoreApi<CurrentUserState>;

export function createCurrentUserStore(): CurrentUserStore {
  return createStore<CurrentUserState>((set) => ({
    user: null,
    setUser(user) { set({ user }); },
    clear() { set({ user: null }); },
  }));
}

export const currentUserStore = createCurrentUserStore();

export function getCurrentUserId(): string | null {
  return currentUserStore.getState().user?.id ?? null;
}
