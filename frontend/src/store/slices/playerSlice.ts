import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../index';

interface Track {
  id: string;
  title: string;
  artist: string;
  uri: string;
}

// How many leading tracks are mirrored into the offline buffer — the queue the user
// can still see/navigate when the realtime link drops. Kept generous so a disconnect
// mid-session leaves plenty of runway before a reconnect is required.
export const OFFLINE_BUFFER_SIZE = 20;

export interface SpotifySDKState {
  deviceId?: string | null;
  isReady?: boolean;
  isPaused?: boolean;
  positionMs?: number;
  durationMs?: number;
  currentTrackUri?: string | null;
  currentTrackImage?: string | null;
}

interface PlayerState {
  playlist: Track[];
  offlineBuffer: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isOnline: boolean;
  // Live reconnect telemetry surfaced from the socket layer so the UI can show real
  // status ("Reconnecting… 2/5") and, once retries are exhausted, offer a manual retry
  // instead of stranding the user offline until a full page reload.
  reconnectAttempt: number;
  reconnectExhausted: boolean;
  trigger: 'emotion' | 'biometric' | 'skip_loop' | 'heart' | null;
  playbackMode: 'live' | null;
  // Spotify Web Playback SDK state
  sdkReady: boolean;
  deviceId: string | null;
  sdkIsPaused: boolean;
  sdkPositionMs: number;
  sdkDurationMs: number;
  // "Adjust upcoming queue only" — HR-driven playlists wait here until the
  // current track ends, then usePendingPromotion promotes them. pendingMode
  // carries the incoming playlist's playbackMode so promotion applies the
  // queued playlist's mode rather than silently inheriting the current one.
  pendingPlaylist: Track[];
  pendingMode: 'live' | null;
  sdkCurrentTrackUri: string | null;
  sdkCurrentTrackImage: string | null;
  // Bumped to Date.now() whenever generation fails or returns an empty/malformed
  // payload, so views can clear a "generating…" overlay and toast the error
  // instead of spinning until a timeout.
  lastErrorAt: number | null;
}

const initialState: PlayerState = {
  playlist: [],
  offlineBuffer: [],
  currentIndex: 0,
  isPlaying: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  reconnectAttempt: 0,
  reconnectExhausted: false,
  trigger: null,
  playbackMode: null,
  sdkReady: false,
  deviceId: null,
  sdkIsPaused: true,
  sdkPositionMs: 0,
  sdkDurationMs: 0,
  pendingPlaylist: [],
  pendingMode: null,
  sdkCurrentTrackUri: null,
  sdkCurrentTrackImage: null,
  lastErrorAt: null,
};

const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    setPlaylist(state, action: PayloadAction<{ tracks: Track[]; trigger: PlayerState['trigger'] }>) {
      state.playlist = action.payload.tracks;
      state.trigger = action.payload.trigger;
      state.currentIndex = 0;
      state.offlineBuffer = action.payload.tracks.slice(0, OFFLINE_BUFFER_SIZE);
      state.sdkPositionMs = 0;
    },
    skipTrack(state) {
      const list = state.isOnline ? state.playlist : state.offlineBuffer;
      if (list.length === 0) return;
      state.currentIndex = (state.currentIndex + 1) % list.length;
      state.sdkPositionMs = 0;
    },
    // Jump to a specific track (play-from-queue). Online, the SDK's reported track
    // remains the source of truth and re-snaps currentIndex on the next state tick;
    // this gives immediate feedback and drives the offline (non-SDK) buffer path.
    setCurrentIndex(state, action: PayloadAction<number>) {
      const list = state.isOnline ? state.playlist : state.offlineBuffer;
      const i = action.payload;
      if (i < 0 || i >= list.length) return;
      state.currentIndex = i;
      state.sdkPositionMs = 0;
    },
    setPendingPlaylist(state, action: PayloadAction<{ tracks: Track[]; mode?: 'live' }>) {
      state.pendingPlaylist = action.payload.tracks;
      state.pendingMode = action.payload.mode ?? 'live';
    },
    promotePendingPlaylist(state) {
      if (state.pendingPlaylist.length === 0) return;
      state.playlist = state.pendingPlaylist;
      state.currentIndex = 0;
      state.offlineBuffer = state.pendingPlaylist.slice(0, OFFLINE_BUFFER_SIZE);
      state.sdkPositionMs = 0;
      state.playbackMode = state.pendingMode ?? 'live';
      state.pendingPlaylist = [];
      state.pendingMode = null;
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },
    setIsOnline(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
      // Coming back online clears any stale reconnect telemetry.
      if (action.payload) {
        state.reconnectAttempt = 0;
        state.reconnectExhausted = false;
      }
    },
    // Pushed by the socket layer as it backs off: `attempt` is the current retry number
    // (1-based), `exhausted` true once the automatic-retry budget is spent.
    setReconnectState(state, action: PayloadAction<{ attempt: number; exhausted: boolean }>) {
      state.reconnectAttempt = action.payload.attempt;
      state.reconnectExhausted = action.payload.exhausted;
    },
    setPlaybackMode(state, action: PayloadAction<'live' | null>) {
      state.playbackMode = action.payload;
    },
    setSdkState(state, action: PayloadAction<SpotifySDKState>) {
      const { deviceId, isReady, isPaused, positionMs, durationMs, currentTrackUri, currentTrackImage } = action.payload;
      if (deviceId !== undefined) state.deviceId = deviceId;
      if (isReady !== undefined) state.sdkReady = isReady;
      if (isPaused !== undefined) state.sdkIsPaused = isPaused;
      if (positionMs !== undefined) state.sdkPositionMs = positionMs;
      if (durationMs !== undefined) state.sdkDurationMs = durationMs;
      if (currentTrackImage !== undefined) state.sdkCurrentTrackImage = currentTrackImage;
      if (currentTrackUri !== undefined) {
        state.sdkCurrentTrackUri = currentTrackUri;
        // Bug 3: the SDK's reported track is the single source of truth. Snap
        // currentIndex to whatever Spotify is actually playing (button press OR
        // auto-advance) so the displayed track + queue never drift. A uri that
        // isn't in the active list (null, or playback of something external)
        // leaves the index where it was.
        if (currentTrackUri) {
          const list = state.isOnline ? state.playlist : state.offlineBuffer;
          const idx = list.findIndex((t) => t.uri === currentTrackUri);
          if (idx >= 0) state.currentIndex = idx;
        }
      }
    },
    setPlaylistError(state) {
      state.lastErrorAt = Date.now();
    },
    // Rehydrate the durable queue from localStorage on app boot (see store/persist).
    // Only the playback-restoring fields are restored; live SDK/network state keeps
    // its initial defaults and reconnects fresh.
    restorePlayer(state, action: PayloadAction<{
      playlist: Track[];
      offlineBuffer: Track[];
      currentIndex: number;
      playbackMode: 'live' | null;
      trigger: PlayerState['trigger'];
    }>) {
      state.playlist = action.payload.playlist;
      state.offlineBuffer = action.payload.offlineBuffer;
      state.currentIndex = action.payload.currentIndex;
      state.playbackMode = action.payload.playbackMode;
      state.trigger = action.payload.trigger;
    },
  },
});

export const {
  setPlaylist, skipTrack, setCurrentIndex, setPlaying, setIsOnline, setReconnectState,
  setPlaybackMode, setSdkState, setPendingPlaylist, promotePendingPlaylist, setPlaylistError,
  restorePlayer,
} = playerSlice.actions;

/**
 * Route an incoming playlist. Biometric (watch-HR) playlists defer to the
 * pending queue when a track is actively playing so they never interrupt the
 * current song; everything else replaces playback immediately.
 */
export const receivePlaylist =
  (payload: { tracks: Track[]; trigger: PlayerState['trigger']; mode?: 'live' }) =>
  (dispatch: AppDispatch, getState: () => RootState) => {
    // Defense-in-depth empty-payload guard: never blank the active queue on a
    // malformed/empty playlist. Flag the error instead so the UI can recover.
    if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) {
      dispatch(setPlaylistError());
      return;
    }
    const { player } = getState();
    const activelyPlaying = player.playlist.length > 0 && player.sdkIsPaused === false;
    if (payload.trigger === 'biometric' && activelyPlaying) {
      dispatch(setPendingPlaylist({ tracks: payload.tracks, mode: payload.mode }));
    } else {
      dispatch(setPlaylist({ tracks: payload.tracks, trigger: payload.trigger }));
      dispatch(setPlaybackMode(payload.mode ?? 'live'));
    }
  };

export default playerSlice.reducer;
