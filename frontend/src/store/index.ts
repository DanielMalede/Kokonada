import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import biometricsReducer from './slices/biometricsSlice';
import emotionReducer from './slices/emotionSlice';
import playerReducer, { restorePlayer } from './slices/playerSlice';
import integrationsReducer from './slices/integrationsSlice';
import { loadPersistedPlayer, savePlayerState, throttle } from './persist';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    biometrics: biometricsReducer,
    emotion: emotionReducer,
    player: playerReducer,
    integrations: integrationsReducer,
  },
});

// Rehydrate the durable playlist/queue from localStorage on boot (Bug B: refresh
// must restore the exact song + queue). This runs at module load — before React
// renders — so the queue is present on the first render and AppShell can mark it as
// "already handled" (no auto-restart). Live SDK/network state stays at its defaults.
const persisted = loadPersistedPlayer();
if (persisted) store.dispatch(restorePlayer(persisted));

// Persist the durable player fields on change, throttled so we don't hit localStorage
// on every 1s SDK position tick.
store.subscribe(throttle(() => savePlayerState(store.getState().player), 500));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
