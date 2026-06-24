import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../index';

/** Watch is considered live if seen within the 5-min ping cadence + 1-min jitter grace. */
export const WATCH_STALE_MS = 6 * 60 * 1000;

interface IntegrationsState {
  musicProvider: 'spotify' | 'youtube' | null;
  biometricProvider: 'garmin' | 'applehealth' | null;
  /** User opted into the wearable-free "mood only" experience. */
  moodOnly: boolean;
  status: 'idle' | 'loading' | 'error';
  // Watch HR device token (sideloaded Garmin app). watchToken holds the plaintext
  // ONLY in-memory immediately after generation — the backend never returns it again.
  watchToken: string | null;
  watchConnected: boolean;
  watchLastSeenAt: string | null;
  watchStatus: 'idle' | 'loading' | 'error';
}

const initialState: IntegrationsState = {
  musicProvider: null,
  biometricProvider: null,
  moodOnly: false,
  status: 'idle',
  watchToken: null,
  watchConnected: false,
  watchLastSeenAt: null,
  watchStatus: 'idle',
};

const integrationsSlice = createSlice({
  name: 'integrations',
  initialState,
  reducers: {
    setMusicProvider: (state, action: PayloadAction<'spotify' | 'youtube' | null>) => {
      state.musicProvider = action.payload;
    },
    setBiometricProvider: (state, action: PayloadAction<'garmin' | 'applehealth' | null>) => {
      state.biometricProvider = action.payload;
    },
    setMoodOnly: (state, action: PayloadAction<boolean>) => {
      state.moodOnly = action.payload;
    },
    setIntegrationsStatus: (state, action: PayloadAction<'idle' | 'loading' | 'error'>) => {
      state.status = action.payload;
    },
    setWatchToken: (state, action: PayloadAction<string | null>) => {
      state.watchToken = action.payload;
    },
    setWatchConnection: (state, action: PayloadAction<{ connected: boolean; lastSeenAt: string | null }>) => {
      state.watchConnected = action.payload.connected;
      state.watchLastSeenAt = action.payload.lastSeenAt;
    },
    markWatchSeen: (state) => {
      state.watchConnected = true;
      state.watchLastSeenAt = new Date().toISOString();
    },
    setWatchStatus: (state, action: PayloadAction<'idle' | 'loading' | 'error'>) => {
      state.watchStatus = action.payload;
    },
    clearWatchToken: (state) => {
      state.watchToken = null;
      state.watchConnected = false;
      state.watchLastSeenAt = null;
      state.watchStatus = 'idle';
    },
    clearIntegrations: () => initialState,
  },
});

export const {
  setMusicProvider, setBiometricProvider, setMoodOnly, setIntegrationsStatus,
  setWatchToken, setWatchConnection, markWatchSeen, setWatchStatus, clearWatchToken,
  clearIntegrations,
} = integrationsSlice.actions;

// A music source is always required; a wearable is optional when the user
// chooses the "mood only" path.
export const selectIsIntegrationsComplete = (state: RootState) =>
  state.integrations.musicProvider !== null &&
  (state.integrations.biometricProvider !== null || state.integrations.moodOnly === true);

/** 'connected' if the watch is connected AND seen within WATCH_STALE_MS of `now`. */
export const selectWatchLiveness = (state: RootState, now: number): 'connected' | 'offline' => {
  const { watchConnected, watchLastSeenAt } = state.integrations;
  if (!watchConnected || !watchLastSeenAt) return 'offline';
  return now - Date.parse(watchLastSeenAt) <= WATCH_STALE_MS ? 'connected' : 'offline';
};

export default integrationsSlice.reducer;
