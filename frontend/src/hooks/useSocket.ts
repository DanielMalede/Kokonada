import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { io, Socket } from 'socket.io-client';
import type { AppDispatch } from '../store';
import { setPlaylist, skipTrack as skipTrackAction, setIsOnline } from '../store/slices/playerSlice';
import {
  setBiometricAck,
  setRecalibrationPending,
  setRecalibrationCancelled,
  setRecalibrating,
} from '../store/slices/biometricsSlice';

interface Track { id: string; title: string; artist: string; uri: string; }

export interface EmotionTap {
  x: number;
  y: number;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';
const MAX_RETRIES = 5;

let socket: Socket | null = null;
let retryCount = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleReconnect() {
  if (!socket || retryCount >= MAX_RETRIES) return;
  const delay = Math.min(1_000 * Math.pow(2, retryCount), 30_000);
  retryCount += 1;
  retryTimer = setTimeout(() => {
    if (socket && !socket.connected) socket.connect();
  }, delay);
}

function initSocket(dispatch: AppDispatch): Socket {
  if (socket) return socket;

  socket = io(BACKEND_URL, { withCredentials: true, autoConnect: true });

  socket.on('connect', () => {
    retryCount = 0;
    clearRetryTimer();
    dispatch(setIsOnline(true));
  });

  socket.on('disconnect', () => {
    dispatch(setIsOnline(false));
    scheduleReconnect();
  });

  socket.on('connect_error', () => {
    scheduleReconnect();
  });

  socket.on('biometric_ack', (data: unknown) => dispatch(setBiometricAck(data as never)));
  socket.on('recalibration_pending', (data: unknown) => dispatch(setRecalibrationPending(data as never)));
  socket.on('recalibration_cancelled', () => dispatch(setRecalibrationCancelled()));
  socket.on('playlist_recalibration', () => dispatch(setRecalibrating()));

  socket.on('playlist_ready', (data: { tracks: Track[]; trigger: 'emotion' | 'biometric' | 'skip_loop' }) => {
    dispatch(setPlaylist({ tracks: data.tracks, trigger: data.trigger }));
  });

  socket.on('playlist_error', (data: { message: string; fallbackTracks?: Track[] }) => {
    if (data.fallbackTracks && data.fallbackTracks.length > 0) {
      dispatch(setPlaylist({ tracks: data.fallbackTracks, trigger: 'biometric' }));
    }
  });

  return socket;
}

export function useSocket() {
  const dispatch = useDispatch<AppDispatch>();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    socketRef.current = initSocket(dispatch);

    const handleOnline = () => {
      dispatch(setIsOnline(true));
      if (socket && !socket.connected) {
        retryCount = 0;
        socket.connect();
      }
    };
    const handleOffline = () => {
      dispatch(setIsOnline(false));
      scheduleReconnect();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [dispatch]);

  const skipTrack = () => {
    socketRef.current?.emit('track_skipped');
    dispatch(skipTrackAction());
  };

  const emitEmotionUpdate = (taps: EmotionTap[], textPrompt?: string) => {
    socketRef.current?.emit('emotion_update', { taps, textPrompt });
  };

  const disconnect = () => {
    clearRetryTimer();
    socket?.disconnect();
    socket = null;
  };

  return {
    connected: socket?.connected ?? false,
    skipTrack,
    emitEmotionUpdate,
    disconnect,
  };
}
