import { configureStore } from '@reduxjs/toolkit';
import emotionReducer from './cold/emotionSlice';
import { ColdPersistence } from './cold/coldPersistence';
import { createWarmStore } from './warm/warmStore';
import type { SecureStore } from '../storage/secureStore';

// Three-lane wiring.
//  COLD (Redux Toolkit): committed intent, persisted.
//  WARM (Zustand): live ephemeral device state, never persisted.
//  HOT (Reanimated SharedValues): gesture/sensor ticks on the UI thread — created
//       inside the wheel component, committed to COLD via laneCommit.

export const store = configureStore({
  reducer: { emotion: emotionReducer },
});
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const warmStore = createWarmStore();

// Call once at bootstrap after the encrypted MMKV SecureStore exists and the user
// is known. Attaches the throttled writer and rehydrates the current user's intent.
export function bootstrapColdPersistence(secure: SecureStore, getUserId: () => string | null): ColdPersistence {
  const persistence = new ColdPersistence({ store, secure, getUserId, throttleMs: 400 });
  persistence.rehydrate();
  persistence.attach();
  return persistence;
}
