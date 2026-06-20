import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from '@reduxjs/toolkit';

interface BiometricsState {
  heartRate: number | null;
  activity: string | null;
  calibrationState: 'stable' | 'pending' | 'recalibrating';
  secondsUntilRecalibration: number | null;
  lastAck: string | null;
}

interface NormalizedBiometric {
  heartRate: number | null;
  activity: string | null;
  lastAck: string | null;
}

const initialState: BiometricsState = {
  heartRate: null,
  activity: null,
  calibrationState: 'stable',
  secondsUntilRecalibration: null,
  lastAck: null,
};

const biometricsSlice = createSlice({
  name: 'biometrics',
  initialState,
  reducers: {
    setBiometricAck(state, action: PayloadAction<NormalizedBiometric>) {
      state.heartRate = action.payload.heartRate;
      state.activity = action.payload.activity;
      state.lastAck = action.payload.lastAck;
      state.calibrationState = 'stable';
    },
    setRecalibrationPending(state, action: PayloadAction<{ secondsRemaining: number }>) {
      state.calibrationState = 'pending';
      state.secondsUntilRecalibration = action.payload.secondsRemaining;
    },
    setRecalibrationCancelled(state) {
      state.calibrationState = 'stable';
      state.secondsUntilRecalibration = null;
    },
    setRecalibrating(state) {
      state.calibrationState = 'recalibrating';
      state.secondsUntilRecalibration = null;
    },
  },
});

export const {
  setBiometricAck,
  setRecalibrationPending,
  setRecalibrationCancelled,
  setRecalibrating,
} = biometricsSlice.actions;
export default biometricsSlice.reducer;
