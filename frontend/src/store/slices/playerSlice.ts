import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

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
  // current track ends, then usePendingPromotion promotes them.
  pendingPlaylist: Track[];
  sdkCurrentTrackUri: string | null;
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
  sdkCurrentTrackUri: null,
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
    setPendingPlaylist(state, action: PayloadAction<Track[]>) {
      state.pendingPlaylist = action.payload;
    },
    promotePendingPlaylist(state) {
      if (state.pendingPlaylist.length === 0) return;
      state.playlist = state.pendingPlaylist;
      state.currentIndex = 0;
      state.offlineBuffer = state.pendingPlaylist.slice(0, 10);
      state.sdkPositionMs = 0;
      state.pendingPlaylist = [];
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
  },
});

export const {
  setPlaylist, skipTrack, setPlaying, setIsOnline, setPlaybackMode, setSdkState,
  setPendingPlaylist, promotePendingPlaylist,
} = playerSlice.actions;
export default playerSlice.reducer;
