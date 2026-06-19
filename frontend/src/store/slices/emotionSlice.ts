import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface EmotionTap {
  x: number;
  y: number;
}

interface EmotionState {
  taps: EmotionTap[];
  textPrompt: string;
}

const initialState: EmotionState = {
  taps: [],
  textPrompt: '',
};

const emotionSlice = createSlice({
  name: 'emotion',
  initialState,
  reducers: {
    addTap(state, action: PayloadAction<EmotionTap>) {
      if (state.taps.length >= 3) return;
      state.taps.push(action.payload);
    },
    removeTap(state, action: PayloadAction<number>) {
      state.taps.splice(action.payload, 1);
    },
    clearTaps(state) {
      state.taps = [];
    },
    setTextPrompt(state, action: PayloadAction<string>) {
      state.textPrompt = action.payload;
    },
  },
});

export const { addTap, removeTap, clearTaps, setTextPrompt } = emotionSlice.actions;
export default emotionSlice.reducer;
