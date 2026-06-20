import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from '@reduxjs/toolkit';

interface User {
  id: string;
  displayName: string;
  avatarUrl: string;
  email: string;
  wearableProvider: string | null;
}

interface AuthState {
  user: User | null;
  status: 'idle' | 'loading' | 'authenticated' | 'error';
}

const initialState: AuthState = {
  user: null,
  status: 'idle',
};

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setUser(state, action: PayloadAction<User>) {
      state.user = action.payload;
    },
    clearUser(state) {
      state.user = null;
    },
    setAuthStatus(state, action: PayloadAction<AuthState['status']>) {
      state.status = action.payload;
    },
  },
});

export const { setUser, clearUser, setAuthStatus } = authSlice.actions;
export default authSlice.reducer;
