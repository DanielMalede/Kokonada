import { createStore, type StoreApi } from 'zustand/vanilla';
import type { KokonadaUser } from './auth';
import { authSession } from './session';

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

// C3 (B1 P1 charter §2): the identity of the signed-in account, from the one session record (its uid).
// Null for a v1 pair and with no session. v1 keeps reading getCurrentUserId() until the cutover.
export function getSessionUid(): string | null {
  return authSession.getSessionUid();
}
