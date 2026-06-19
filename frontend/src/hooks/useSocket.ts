import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../store';
import {
  setBiometricAck,
  setRecalibrationPending,
  setRecalibrationCancelled,
  setRecalibrating,
} from '../store/slices/biometricsSlice';
import { skipTrack as skipTrackAction } from '../store/slices/playerSlice';
import type { EmotionTap } from '../store/slices/emotionSlice';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

// Module-level singleton — io() is called exactly once for the entire app session.
let _socket: ReturnType<typeof io> | null = null;

export function useSocket(): {
  connected: boolean;
  skipTrack: () => void;
  emitEmotionUpdate: (taps: EmotionTap[], textPrompt?: string) => void;
  disconnect: () => void;
} {
  const dispatch = useDispatch<AppDispatch>();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Only create the socket once; subsequent hook calls reuse the singleton.
    if (_socket === null) {
      _socket = io(BACKEND_URL, { withCredentials: true });

      _socket.on('connect', () => setConnected(true));
      _socket.on('disconnect', () => setConnected(false));
      _socket.on('connect_error', (err: Error) => console.warn('socket connect_error', err));

      _socket.on('biometric_ack', (payload: { normalized: { heartRate: number | null; activity: string | null; lastAck: string | null } }) => {
        dispatch(setBiometricAck(payload.normalized));
      });

      _socket.on('recalibration_pending', (payload: { secondsRemaining: number }) => {
        dispatch(setRecalibrationPending({ secondsRemaining: payload.secondsRemaining }));
      });

      _socket.on('recalibration_cancelled', () => {
        dispatch(setRecalibrationCancelled());
      });

      _socket.on('playlist_recalibration', () => {
        dispatch(setRecalibrating());
      });
    } else {
      // Socket already exists — sync the connected state for this component instance.
      setConnected(_socket.connected);
    }

    // Do NOT disconnect on unmount — other components share the singleton.
    // Disconnection is handled explicitly via the exposed disconnect() function.
  }, [dispatch]);

  const skipTrack = () => {
    _socket?.emit('track_skipped');
    dispatch(skipTrackAction());
  };

  const emitEmotionUpdate = (taps: EmotionTap[], textPrompt?: string) => {
    _socket?.emit('emotion_update', { taps, textPrompt: textPrompt ?? '' });
  };

  const disconnect = () => {
    if (_socket !== null) {
      _socket.disconnect();
      _socket = null;
    }
  };

  return { connected, skipTrack, emitEmotionUpdate, disconnect };
}
