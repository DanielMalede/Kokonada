'use strict';

const { normalize }  = require('../services/wearable/adapter');
const User           = require('../models/User');
const MusicProfile   = require('../models/MusicProfile');
const PlaylistSession = require('../models/PlaylistSession');
const spotify        = require('../services/spotify');
const youtube        = require('../services/youtube');
const { buildEmotionPlaylist, adjustBiometricPlaylist } = require('../services/geminiEngine');
const { mixPlaylist }  = require('../services/playlistMixer');

const debounceMap = new Map();
const HR_DELTA_THRESHOLD = 10;
const DEBOUNCE_MS        = 60_000;

function getState(socketId) {
  if (!debounceMap.has(socketId)) {
    debounceMap.set(socketId, {
      stableHR:         null,
      pendingHR:        null,
      latestActivity:   null,
      timer:            null,
      consecutiveSkips: 0,
      lastEmotionTaps:  [],
      lastTextPrompt:   '',
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

// ── Core pipeline ──────────────────────────────────────────────────────────────

async function generateAndEmitPlaylist(socket, trigger, state) {
  const userId = socket.data.user._id.toString();

  // Re-fetch user WITH tokens (socket middleware strips them for auth checks)
  const user = await User.findById(userId);
  if (!user) {
    socket.emit('playlist_error', { message: 'User not found' });
    return;
  }

  // Load music profile (built after OAuth)
  const musicProfile = await MusicProfile.findOne({ userId });
  if (!musicProfile) {
    socket.emit('playlist_error', { message: 'Music profile not built yet — reconnect your music provider' });
    return;
  }

  // Determine provider: Spotify preferred, YouTube fallback
  const hasSpotify = !!user.spotifyToken?.blob;
  const hasYoutube = !!user.youtubeMusicToken?.blob;
  if (!hasSpotify && !hasYoutube) {
    socket.emit('playlist_error', { message: 'No music provider connected' });
    return;
  }

  let fetchTracks;
  let provider;
  try {
    if (hasSpotify) {
      const accessToken = await spotify.getValidToken(user);
      fetchTracks = (params) => spotify.getRecommendations(accessToken, params);
      provider = 'spotify';
    } else {
      const accessToken = await youtube.getValidToken(user);
      fetchTracks = (params) => youtube.searchRecommendations(accessToken, params);
      provider = 'youtube';
    }
  } catch (err) {
    socket.emit('playlist_error', { message: `Token refresh failed: ${err.message}` });
    return;
  }

  let aiResult;
  try {
    if (trigger === 'emotion' && state.lastEmotionTaps.length > 0) {
      aiResult = await buildEmotionPlaylist({
        musicProfile,
        emotionTaps:  state.lastEmotionTaps,
        textPrompt:   state.lastTextPrompt || null,
        fetchTracks,
      });
    } else {
      aiResult = await adjustBiometricPlaylist({
        musicProfile,
        biometric: {
          heartRate:  state.stableHR,
          activity:   state.latestActivity,
          restingHR:  musicProfile.restingHeartRate,
        },
        fetchTracks,
      });
    }
  } catch (err) {
    // AI failure — emit error with library fallback so music doesn't stop
    const fallbackTracks = (musicProfile.library || [])
      .filter(t => t.tempo != null)
      .sort((a, b) => Math.abs(a.tempo - (state.stableHR || 120)) - Math.abs(b.tempo - (state.stableHR || 120)))
      .slice(0, 10);

    socket.emit('playlist_error', {
      message:        err.message,
      fallbackTracks,
    });
    return;
  }

  // 70/30 mix — reuse already-fetched discovery tracks, no double API call
  const cachedDiscovery = aiResult.tracks;
  const playlist = await mixPlaylist({
    musicProfile,
    aiParams:            aiResult.params,
    fetchDiscoveryTracks: () => Promise.resolve(cachedDiscovery),
  });

  socket.emit('playlist_ready', {
    trigger,
    params:    aiResult.params,
    tracks:    playlist.merged,
    familiar:  playlist.familiar.length,
    discovery: playlist.discovery.length,
  });

  // Persist session (non-blocking — don't await)
  PlaylistSession.create({
    userId,
    emotionTaps:       state.lastEmotionTaps.length > 0 ? state.lastEmotionTaps : [{ x: 0, y: 0 }],
    contextPrompt:     state.lastTextPrompt || '',
    biometricSnapshot: { heartRate: state.stableHR, activity: state.latestActivity },
    targetBpm:         aiResult.params.target_bpm,
    targetGenres:      aiResult.params.seed_genres || [],
    targetValence:     aiResult.params.target_valence,
    targetEnergy:      aiResult.params.target_energy,
    musicProvider:     provider,
    trackIds:          playlist.merged.map(t => t.id).filter(Boolean),
  }).catch(e => console.error('[PlaylistSession] save failed:', e.message));
}

// ── Socket event registration ──────────────────────────────────────────────────

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
    state.consecutiveSkips = 0;
    state.latestActivity   = normalized.activity;

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
        generateAndEmitPlaylist(socket, 'biometric', s);
      } else {
        socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
      }
      clearTimer(s);
    }, DEBOUNCE_MS);

    socket.emit('recalibration_pending', { delta, secondsRemaining: Math.round(DEBOUNCE_MS / 1000) });
  });

  socket.on('emotion_update', ({ taps = [], textPrompt = '' } = {}) => {
    const state = getState(socketId);
    state.lastEmotionTaps = taps;
    state.lastTextPrompt  = textPrompt;
  });

  socket.on('request_playlist', () => {
    generateAndEmitPlaylist(socket, 'emotion', getState(socketId));
  });

  socket.on('track_skipped', () => {
    const state = getState(socketId);
    state.consecutiveSkips += 1;

    if (state.consecutiveSkips >= 2) {
      clearTimer(state);
      generateAndEmitPlaylist(socket, 'skip_loop', state);
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

module.exports = { registerBiometricHandler, generateAndEmitPlaylist, _debounceMap: debounceMap };
