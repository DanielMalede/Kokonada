import { configureStore } from '@reduxjs/toolkit';
import authReducer from './slices/authSlice';
import biometricsReducer from './slices/biometricsSlice';
import emotionReducer from './slices/emotionSlice';
import playerReducer from './slices/playerSlice';
import integrationsReducer from './slices/integrationsSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    biometrics: biometricsReducer,
    emotion: emotionReducer,
    player: playerReducer,
    integrations: integrationsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
