import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from '@reduxjs/toolkit';

export interface EmotionTap {
  x: number;
  y: number;
}

interface EmotionState {
  taps: EmotionTap[];
  textPrompt: string;
  // Selected activity preset key (from lib/activities.ts), or null. Distinct from
  // biometrics.activity, which is the watch-detected motion state (walking/running).
  activity: string | null;
}

const initialState: EmotionState = {
  taps: [],
  textPrompt: '',
  activity: null,
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
    setActivity(state, action: PayloadAction<string | null>) {
      state.activity = action.payload;
    },
  },
});

export const { addTap, removeTap, clearTaps, setTextPrompt, setActivity } = emotionSlice.actions;
export default emotionSlice.reducer;
