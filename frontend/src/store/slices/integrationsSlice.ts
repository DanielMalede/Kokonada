import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../index';

interface IntegrationsState {
  musicProvider: 'spotify' | 'youtube' | null;
  biometricProvider: 'garmin' | 'applehealth' | null;
  /** User opted into the wearable-free "mood only" experience. */
  moodOnly: boolean;
  status: 'idle' | 'loading' | 'error';
}

const initialState: IntegrationsState = {
  musicProvider: null,
  biometricProvider: null,
  moodOnly: false,
  status: 'idle',
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
    clearIntegrations: () => initialState,
  },
});

export const { setMusicProvider, setBiometricProvider, setMoodOnly, setIntegrationsStatus, clearIntegrations } =
  integrationsSlice.actions;

// A music source is always required; a wearable is optional when the user
// chooses the "mood only" path.
export const selectIsIntegrationsComplete = (state: RootState) =>
  state.integrations.musicProvider !== null &&
  (state.integrations.biometricProvider !== null || state.integrations.moodOnly === true);

export default integrationsSlice.reducer;
