'use strict';

const { normalize } = require('../services/wearable/adapter');

const debounceMap = new Map();
const HR_DELTA_THRESHOLD = 10;
const DEBOUNCE_MS = 60_000;

function getState(socketId) {
  if (!debounceMap.has(socketId)) {
    debounceMap.set(socketId, {
      stableHR:        null,
      pendingHR:       null,
      latestActivity:  null,
      timer:           null,
      consecutiveSkips: 0,
      lastEmotionTaps: [],
    });
  }
  return debounceMap.get(socketId);
}

function clearTimer(state) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer    = null;
    state.pendingHR = null;
  }
}

function registerBiometricHandler(socket) {
  const socketId = socket.id;

  socket.on('biometric_push', ({ source, raw } = {}) => {
    let normalized;
    try {
      normalized = normalize(source, raw);
    } catch (err) {
      socket.emit('connection_error', { message: err.message });
      return;
    }

    socket.emit('biometric_ack', { normalized });

    const state = getState(socketId);
    state.consecutiveSkips  = 0;
    state.latestActivity    = normalized.activity;

    if (state.stableHR === null) {
      state.stableHR = normalized.heartRate;
      return;
    }

    const delta = Math.abs(normalized.heartRate - state.stableHR);

    if (delta < HR_DELTA_THRESHOLD) {
      if (state.timer) {
        clearTimer(state);
        socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
      }
      state.stableHR = normalized.heartRate;
      return;
    }

    // delta >= threshold
    if (state.timer) return;

    state.pendingHR = normalized.heartRate;
    state.timer = setTimeout(() => {
      const s = debounceMap.get(socketId);
      if (!s) return;
      const currentDelta = Math.abs(s.pendingHR - s.stableHR);
      if (currentDelta >= HR_DELTA_THRESHOLD) {
        s.stableHR = s.pendingHR;
        socket.emit('playlist_recalibration', {
          heartRate:    s.stableHR,
          activity:     s.latestActivity,
          emotionTaps:  s.lastEmotionTaps,
          trigger:      'biometric',
        });
      } else {
        socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
      }
      clearTimer(s);
    }, DEBOUNCE_MS);

    socket.emit('recalibration_pending', { delta, secondsRemaining: Math.round(DEBOUNCE_MS / 1000) });
  });

  socket.on('emotion_update', ({ taps = [] } = {}) => {
    getState(socketId).lastEmotionTaps = taps;
  });

  socket.on('track_skipped', () => {
    const state = getState(socketId);
    state.consecutiveSkips += 1;

    if (state.consecutiveSkips >= 2) {
      clearTimer(state);
      socket.emit('playlist_recalibration', {
        ...(state.stableHR !== null && { heartRate: state.stableHR }),
        ...(state.latestActivity !== null && { activity: state.latestActivity }),
        emotionTaps: state.lastEmotionTaps,
        trigger:     'skip_loop',
      });
      state.consecutiveSkips = 0;
    }
  });

  socket.on('disconnect', () => {
    const state = debounceMap.get(socketId);
    if (state) {
      clearTimer(state);
      debounceMap.delete(socketId);
    }
  });
}

module.exports = { registerBiometricHandler, _debounceMap: debounceMap };
