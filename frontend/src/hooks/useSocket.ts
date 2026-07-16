import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';
import type { AppDispatch } from '../store';
import { store } from '../store';
import { getToken, sameOriginAuth } from '@/lib/api';
import { setPlaylist, skipTrack as skipTrackAction, setIsOnline, setReconnectState, receivePlaylist, setPlaylistError } from '../store/slices/playerSlice';
import {
  setBiometricAck,
  setRecalibrationPending,
  setRecalibrationCancelled,
  setRecalibrating,
} from '../store/slices/biometricsSlice';
import { markWatchSeen, setProfileProgress } from '../store/slices/integrationsSlice';

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
let lastBiometricDispatch = 0;
const BIOMETRIC_THROTTLE_MS = 300;
// Monotonic id stamped on each emotion "Generate" request. The backend echoes it
// in playlist_ready so we can drop results from a superseded request (rapid
// re-generate / mode toggling). Biometric playlists carry no reqId and are exempt.
let playlistReqId = 0;
let latestReqId = 0;

function clearRetryTimer() {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleReconnect() {
  if (!socket) return;
  // Automatic-retry budget spent: stop the exponential backoff and flag the UI so it can
  // offer a manual "Try now" instead of silently giving up (previously the app just sat
  // offline forever until a full page reload).
  if (retryCount >= MAX_RETRIES) {
    store.dispatch(setReconnectState({ attempt: retryCount, exhausted: true }));
    return;
  }
  const delay = Math.min(1_000 * Math.pow(2, retryCount), 30_000);
  retryCount += 1;
  store.dispatch(setReconnectState({ attempt: retryCount, exhausted: false }));
  retryTimer = setTimeout(() => {
    if (socket && !socket.connected) socket.connect();
  }, delay);
}

/**
 * Manual reconnect for the offline UI's "Try now" button: resets the backoff budget and
 * forces an immediate connect. Safe to call anytime — no-ops the timer and reconnects the
 * live socket if it exists.
 */
export function reconnectSocketNow() {
  retryCount = 0;
  clearRetryTimer();
  store.dispatch(setReconnectState({ attempt: 0, exhausted: false }));
  if (socket && !socket.connected) socket.connect();
}

function initSocket(dispatch: AppDispatch): Socket {
  if (socket) return socket;

  // B2 same-domain auth prep (T4): once the cookie is first-party (post domain
  // migration), the handshake needs no bearer token at all — the backend already
  // accepts the httpOnly session cookie as a fallback auth path (see
  // backend/app/sockets/index.js). Defaults OFF, preserving today's cross-site
  // bearer-token handshake unchanged.
  const authPayload = sameOriginAuth() ? {} : { token: getToken() };
  socket = io(BACKEND_URL, { withCredentials: true, autoConnect: true, auth: authPayload });

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

  socket.on('biometric_ack', (data: unknown) => {
    const now = Date.now();
    if (now - lastBiometricDispatch >= BIOMETRIC_THROTTLE_MS) {
      lastBiometricDispatch = now;
      // Backend sends { normalized: { heartRate, activity, lastAck } } — unwrap one level.
      const payload = (data as { normalized: never }).normalized ?? data;
      dispatch(setBiometricAck(payload));
      dispatch(markWatchSeen());
    }
  });
  // Background profile-build progress (post-connect library analysis) → live banner.
  socket.on('profile_progress', (data: { pct: number; label: string; error?: boolean }) =>
    dispatch(setProfileProgress(data)));
  socket.on('recalibration_pending', (data: unknown) => dispatch(setRecalibrationPending(data as never)));
  socket.on('recalibration_cancelled', () => dispatch(setRecalibrationCancelled()));
  socket.on('playlist_recalibration', () => dispatch(setRecalibrating()));

  socket.on('playlist_ready', (data: { tracks: Track[]; trigger: 'emotion' | 'biometric' | 'skip_loop' | 'heart'; reqId?: number }) => {
    // Drop stale emotion results — a newer Generate request supersedes this one.
    // Biometric/watch playlists carry no reqId and are never dropped here.
    if (data.trigger === 'emotion' && typeof data.reqId === 'number' && data.reqId < latestReqId) {
      console.warn(`[socket] dropped stale playlist_ready reqId=${data.reqId} < ${latestReqId}`);
      return;
    }
    // Keep only playable tracks (must have a uri). Only error when NONE are usable
    // — don't reject a whole playlist because some entries are malformed.
    const usable = Array.isArray(data.tracks) ? data.tracks.filter((t) => t && t.uri) : [];
    if (usable.length === 0) {
      console.error('[socket] playlist_ready had no usable tracks', data);
      toast.error('Could not build a playlist — please try again.');
      dispatch(setPlaylistError());
      return;
    }
    console.info(`[socket] playlist_ready reqId=${data.reqId} tracks=${usable.length} trigger=${data.trigger}`);
    if (data.trigger === 'biometric') dispatch(markWatchSeen());
    dispatch(receivePlaylist({ tracks: usable, trigger: data.trigger }));
  });

  socket.on('playlist_error', (data: { message?: string; fallbackTracks?: Track[] }) => {
    if (data.fallbackTracks && data.fallbackTracks.length > 0) {
      dispatch(setPlaylist({ tracks: data.fallbackTracks, trigger: 'biometric' }));
      return;
    }
    console.error('[socket] playlist_error:', data.message);
    toast.error(data.message || 'Could not build a playlist — please try again.');
    dispatch(setPlaylistError());
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
    // Single source of truth for currentIndex: when the Spotify SDK is driving
    // playback, it (via setSdkState) snaps currentIndex to the track actually playing.
    // Optimistically bumping the index here as WELL made the two fight during a queue
    // swap → the "jumping between the old and new playlist" bug (#3/#4). Only move the
    // index ourselves offline, where there is no SDK to report the boundary.
    const { isOnline, sdkReady } = store.getState().player;
    if (!(isOnline && sdkReady)) dispatch(skipTrackAction());
  };

  const emitEmotionUpdate = (taps: EmotionTap[], textPrompt?: string, activity?: string | null) => {
    socketRef.current?.emit('emotion_update', { taps, textPrompt, activity });
  };

  // Trigger a playlist generation. Caches the latest taps/prompt, then asks the
  // server to generate — the bug was that the UI only ever emitted emotion_update
  // (which just caches) and never request_playlist, so nothing generated. Socket.IO
  // preserves per-socket order, so the cache lands first.
  const requestPlaylist = (taps: EmotionTap[], textPrompt?: string, activity?: string | null): number => {
    playlistReqId += 1;
    latestReqId = playlistReqId;
    console.info(`[gen] emit reqId=${playlistReqId}`);
    socketRef.current?.emit('emotion_update', { taps, textPrompt, activity });
    socketRef.current?.emit('request_playlist', { reqId: playlistReqId });
    return playlistReqId;
  };

  // "Listen to your heart" — a playlist from the user's heart rate alone (no mood
  // needed). The backend derives HR from the last 30 min of health data, falling
  // back to the current/live HR (passed as a hint), then resting HR.
  const requestHeartPlaylist = (heartRate?: number | null): number => {
    playlistReqId += 1;
    latestReqId = playlistReqId;
    console.info(`[gen] heart emit reqId=${playlistReqId} hr=${heartRate ?? 'n/a'}`);
    socketRef.current?.emit('request_heart_playlist', {
      reqId: playlistReqId,
      heartRate: heartRate ?? undefined,
    });
    return playlistReqId;
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
    requestPlaylist,
    requestHeartPlaylist,
    disconnect,
  };
}
