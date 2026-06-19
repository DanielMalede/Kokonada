import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Track {
  id: string;
  title: string;
  artist: string;
  uri: string;
}

interface PlayerState {
  playlist: Track[];
  currentIndex: number;
  isPlaying: boolean;
  trigger: 'emotion' | 'biometric' | 'skip_loop' | null;
}

const initialState: PlayerState = {
  playlist: [],
  currentIndex: 0,
  isPlaying: false,
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
    },
    skipTrack(state) {
      if (state.playlist.length === 0) return;
      state.currentIndex = (state.currentIndex + 1) % state.playlist.length;
    },
    setPlaying(state, action: PayloadAction<boolean>) {
      state.isPlaying = action.payload;
    },
  },
});

export const { setPlaylist, skipTrack, setPlaying } = playerSlice.actions;
export default playerSlice.reducer;
