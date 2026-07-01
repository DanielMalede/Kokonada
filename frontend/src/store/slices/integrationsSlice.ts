import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../index';
import { authHeaders } from '@/lib/api';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

/** Watch is considered live if seen within the 5-min ping cadence + 1-min jitter grace. */
export const WATCH_STALE_MS = 6 * 60 * 1000;

interface IntegrationsState {
  musicProvider: 'spotify' | 'youtube' | null;
  biometricProvider: 'garmin' | 'applehealth' | 'health_connect' | null;
  /** Stored Spotify token carries user-library-modify (Like button). false → reconnect once. */
  spotifyCanSave: boolean;
  /** Live background profile-build progress (post-connect library analysis). null when idle. */
  profileProgress: { pct: number; label: string; error?: boolean } | null;
  /** User opted into the wearable-free "mood only" experience. */
  moodOnly: boolean;
  // 'ready'/'error' both mean the post-login status fetch has SETTLED — the routing
  // guards wait for that before deciding, so a refresh never redirects to /integrations
  // off the initial (all-null) state before we know the real connection status.
  status: 'idle' | 'loading' | 'ready' | 'error';
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
  spotifyCanSave: false,
  profileProgress: null,
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
    setBiometricProvider: (state, action: PayloadAction<'garmin' | 'applehealth' | 'health_connect' | null>) => {
      state.biometricProvider = action.payload;
    },
    setSpotifyCanSave: (state, action: PayloadAction<boolean>) => {
      state.spotifyCanSave = action.payload;
    },
    setProfileProgress: (state, action: PayloadAction<{ pct: number; label: string; error?: boolean } | null>) => {
      state.profileProgress = action.payload;
    },
    setMoodOnly: (state, action: PayloadAction<boolean>) => {
      state.moodOnly = action.payload;
    },
    setIntegrationsStatus: (state, action: PayloadAction<'idle' | 'loading' | 'ready' | 'error'>) => {
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
  setMusicProvider, setBiometricProvider, setSpotifyCanSave, setProfileProgress, setMoodOnly, setIntegrationsStatus,
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

/** True once the post-login status fetch has settled (success OR error), so the
 *  routing guards can stop showing the splash and make a redirect decision. */
export const selectIntegrationsSettled = (state: RootState) =>
  state.integrations.status === 'ready' || state.integrations.status === 'error';

/**
 * Fetch the user's integration status once after login and rehydrate the slice.
 * Dispatched from AppBootstrap (router root) so it runs ABOVE the IntegrationsGuard:
 * the guard waits for `status` to settle before deciding whether to redirect to
 * /integrations, which is what stops the false redirect on refresh (the slice's
 * initial state is all-null and would otherwise look "incomplete").
 */
export const hydrateIntegrations = () => async (dispatch: AppDispatch) => {
  dispatch(setIntegrationsStatus('loading'));
  try {
    const res = await fetch(`${BACKEND_URL}/api/integrations/status`, {
      credentials: 'include',
      headers: authHeaders(),
    });
    if (!res.ok) { dispatch(setIntegrationsStatus('error')); return; }
    const data = await res.json();
    dispatch(setMusicProvider(data.musicProvider ?? null));
    dispatch(setBiometricProvider(data.biometricProvider ?? null));
    dispatch(setSpotifyCanSave(Boolean(data.spotifyCanSave)));
    dispatch(setIntegrationsStatus('ready'));
  } catch {
    dispatch(setIntegrationsStatus('error'));
  }
};

export default integrationsSlice.reducer;
