import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState, AppDispatch } from '../index';

interface Track {
  id: string;
  title: string;
  artist: string;
  uri: string;
}

export interface SpotifySDKState {
  deviceId?: string | null;
  isReady?: boolean;
  isPaused?: boolean;
  positionMs?: number;
  durationMs?: number;
  currentTrackUri?: string | null;
}

interface PlayerState {
  playlist: Track[];
  offlineBuffer: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isOnline: boolean;
  trigger: 'emotion' | 'biometric' | 'skip_loop' | null;
  playbackMode: 'live' | 'export' | null;
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
  pendingMode: 'live' | 'export' | null;
  sdkCurrentTrackUri: string | null;
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
      state.offlineBuffer = action.payload.tracks.slice(0, 10);
      state.sdkPositionMs = 0;
    },
    skipTrack(state) {
      const list = state.isOnline ? state.playlist : state.offlineBuffer;
      if (list.length === 0) return;
      state.currentIndex = (state.currentIndex + 1) % list.length;
      state.sdkPositionMs = 0;
    },
    setPendingPlaylist(state, action: PayloadAction<{ tracks: Track[]; mode?: 'live' | 'export' }>) {
      state.pendingPlaylist = action.payload.tracks;
      state.pendingMode = action.payload.mode ?? 'live';
    },
    promotePendingPlaylist(state) {
      if (state.pendingPlaylist.length === 0) return;
      state.playlist = state.pendingPlaylist;
      state.currentIndex = 0;
      state.offlineBuffer = state.pendingPlaylist.slice(0, 10);
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
    },
    setPlaybackMode(state, action: PayloadAction<'live' | 'export' | null>) {
      state.playbackMode = action.payload;
    },
    setSdkState(state, action: PayloadAction<SpotifySDKState>) {
      const { deviceId, isReady, isPaused, positionMs, durationMs, currentTrackUri } = action.payload;
      if (deviceId !== undefined) state.deviceId = deviceId;
      if (isReady !== undefined) state.sdkReady = isReady;
      if (isPaused !== undefined) state.sdkIsPaused = isPaused;
      if (positionMs !== undefined) state.sdkPositionMs = positionMs;
      if (durationMs !== undefined) state.sdkDurationMs = durationMs;
      if (currentTrackUri !== undefined) state.sdkCurrentTrackUri = currentTrackUri;
    },
    setPlaylistError(state) {
      state.lastErrorAt = Date.now();
    },
  },
});

export const {
  setPlaylist, skipTrack, setPlaying, setIsOnline, setPlaybackMode, setSdkState,
  setPendingPlaylist, promotePendingPlaylist, setPlaylistError,
} = playerSlice.actions;

/**
 * Route an incoming playlist. Biometric (watch-HR) playlists defer to the
 * pending queue when a track is actively playing so they never interrupt the
 * current song; everything else replaces playback immediately.
 */
export const receivePlaylist =
  (payload: { tracks: Track[]; trigger: PlayerState['trigger']; mode?: 'live' | 'export' }) =>
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
