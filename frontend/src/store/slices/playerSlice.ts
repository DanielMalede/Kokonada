import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Track {
  id: string;
  title: string;
  artist: string;
  uri: string;
}

interface PlayerState {
  playlist: Track[];
  offlineBuffer: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isOnline: boolean;
  trigger: 'emotion' | 'biometric' | 'skip_loop' | null;
}

const initialState: PlayerState = {
  playlist: [],
  offlineBuffer: [],
  currentIndex: 0,
  isPlaying: false,
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  trigger: null,
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
    },
    skipTrack(state) {
      const list = state.isOnline ? state.playlist : state.offlineBuffer;
      if (list.length === 0) return;
      state.currentIndex = (state.currentIndex + 1) % list.length;
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },
    setIsOnline(state, action: PayloadAction<boolean>) {
      state.isOnline = action.payload;
    },
  },
});

export const { setPlaylist, skipTrack, setPlaying, setIsOnline } = playerSlice.actions;
export default playerSlice.reducer;
