import { useEffect, useRef, useState } from 'react';
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

export function useSocket(): {
  connected: boolean;
  skipTrack: () => void;
  emitEmotionUpdate: (taps: EmotionTap[]) => void;
} {
  const dispatch = useDispatch<AppDispatch>();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(BACKEND_URL, { withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err) => console.warn('socket connect_error', err));

    socket.on('biometric_ack', (payload: { normalized: { heartRate: number | null; activity: string | null; lastAck: string | null } }) => {
      dispatch(setBiometricAck(payload.normalized));
    });

    socket.on('recalibration_pending', (payload: { secondsRemaining: number }) => {
      dispatch(setRecalibrationPending({ secondsRemaining: payload.secondsRemaining }));
    });

    socket.on('recalibration_cancelled', () => {
      dispatch(setRecalibrationCancelled());
    });

    socket.on('playlist_recalibration', () => {
      dispatch(setRecalibrating());
    });

    return () => {
      socket.disconnect();
    };
  }, [dispatch]);

  const skipTrack = () => {
    socketRef.current?.emit('track_skipped');
    dispatch(skipTrackAction());
  };

  const emitEmotionUpdate = (taps: EmotionTap[]) => {
    socketRef.current?.emit('emotion_update', { taps });
  };

  return { connected, skipTrack, emitEmotionUpdate };
}
