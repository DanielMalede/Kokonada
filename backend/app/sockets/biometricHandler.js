'use strict';

const { normalize }  = require('../services/wearable/adapter');
const User           = require('../models/User');
const MusicProfile   = require('../models/MusicProfile');
const BiometricLog   = require('../models/BiometricLog');
const PlaylistSession = require('../models/PlaylistSession');
const spotify        = require('../services/spotify');
const youtube        = require('../services/youtube');
const { buildEmotionPlaylist, adjustBiometricPlaylist } = require('../services/geminiEngine');
const { mixPlaylist, generateFallbackPlaylist }  = require('../services/playlistMixer');

const debounceMap = new Map();
const HR_DELTA_THRESHOLD = 10;
const DEBOUNCE_MS        = 60_000;
// Watch (5-min cadence) path: each ping is trusted as the new sustained HR.
// A larger 25 bpm gate ensures we only re-adapt on a real activity-state change
// (vs the 10 bpm streaming threshold), so a flat HR never churns Spotify.
const WATCH_HR_DELTA_THRESHOLD = 25;

// Opt-in boundary tracing for debugging the generation pipeline. Enable with
// DEBUG_PLAYLIST=1 (always on in `development`; silent in test/production).
const DEBUG = process.env.DEBUG_PLAYLIST === '1' || process.env.NODE_ENV === 'development';
function log(...args) { if (DEBUG) console.log(...args); }

// Normalize a track to the frontend contract { id, title, artist, uri } before
// emitting. Library/"familiar" tracks are stored without a uri or title (only
// id/artist/audio-features), and Spotify recommendation objects use name/artists
// rather than title/artist — without this, 70% of every playlist is unplayable
// and the client (which requires a uri) rejects the whole list. For Spotify the
// uri is reconstructed from the track id (`spotify:track:<id>`); anything still
// lacking a uri is dropped as unplayable.
function toClientTrack(t, provider) {
  if (!t) return null;
  const id = t.id ?? null;
  let uri = t.uri ?? null;
  if (!uri && id && provider === 'spotify') uri = `spotify:track:${id}`;
  if (!uri) return null;
  return {
    id,
    uri,
    title:  t.title ?? t.name ?? 'Unknown title',
    artist: t.artist ?? t.artists?.[0]?.name ?? 'Unknown artist',
  };
}
function toClientTracks(list, provider) {
  return (Array.isArray(list) ? list : []).map((t) => toClientTrack(t, provider)).filter(Boolean);
}

function getState(socketId) {
  if (!debounceMap.has(socketId)) {
    debounceMap.set(socketId, {
      stableHR:         null,
      pendingHR:        null,
      latestActivity:   null,
      // Last sustained activity state — drives activity-change-triggered regen
      // (resting→running etc.) independently of the HR delta gate.
      stableActivity:   null,
      pendingActivity:  null,
      timer:            null,
      consecutiveSkips: 0,
      lastEmotionTaps:  [],
      lastTextPrompt:   '',
      // Playback mode ('live'|'export') chosen on the client, echoed back in
      // playlist_ready so the frontend doesn't reset export→live.
      lastMode:         'live',
      // Monotonic request id from the client; echoed so the frontend can drop
      // out-of-order emotion playlists when the user spams Generate.
      lastReqId:        undefined,
      // In-flight guard — collapses overlapping generations on one socket.
      generating:       false,
    });
  }
  return debounceMap.get(socketId);
}

function clearTimer(state) {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer    = null;
    state.pendingHR = null;
    state.pendingActivity = null;
  }
}

const THIRTY_MIN_MS = 30 * 60 * 1000;

// "Listen to your heart": resolve the heart-rate context to drive a playlist,
// preferring richer/more-recent data and degrading gracefully:
//   1. last 30 min of logged readings (Apple Health / Suunto push) — averaged
//   2. current live HR held in socket state (Garmin watch / streaming)
//   3. client-reported current HR (frontend hint)
//   4. resting HR from the health/music profile
// Returns null only when no heart data of any kind is available.
async function resolveHeartContext(socket, state, clientHeartRate) {
  const userId = socket.data.user._id.toString();

  try {
    const since = new Date(Date.now() - THIRTY_MIN_MS);
    // No .lean(): heartRate is encrypted and decrypted via a mongoose getter.
    const logs = await BiometricLog.find({ userId, recordedAt: { $gte: since } })
      .sort({ recordedAt: -1 })
      .limit(500);
    const hrs = logs.map((l) => l.heartRate).filter((n) => Number.isFinite(n));
    if (hrs.length > 0) {
      const avg = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
      return { heartRate: avg, activity: logs[0].activity || state.latestActivity || 'unknown', source: 'last_30min' };
    }
  } catch (e) {
    log(`[heart] BiometricLog query failed: ${e.message}`);
  }

  if (Number.isFinite(state.stableHR)) {
    return { heartRate: state.stableHR, activity: state.latestActivity || 'unknown', source: 'current' };
  }
  if (Number.isFinite(clientHeartRate)) {
    return { heartRate: clientHeartRate, activity: state.latestActivity || 'unknown', source: 'client' };
  }

  const profile = await MusicProfile.findOne({ userId });
  if (profile && Number.isFinite(profile.restingHeartRate)) {
    return { heartRate: profile.restingHeartRate, activity: 'resting', source: 'resting' };
  }
  return null;
}

// ── Core pipeline ──────────────────────────────────────────────────────────────

async function generateAndEmitPlaylist(socket, trigger, state) {
  // In-flight guard: collapse overlapping generations on one socket (rapid mode
  // toggles, a watch ping landing mid-generation, Listen-Live + Save pressed
  // together) so two pipelines never interleave and emit out-of-order playlists.
  if (state.generating) {
    log(`[generate] skipped — already in-flight trigger=${trigger}`);
    return;
  }
  state.generating = true;

  // Echoed back to the client so it can (a) keep the user's chosen playback mode
  // and (b) drop stale emotion results. Captured up-front so every emit is consistent.
  const mode  = state.lastMode ?? 'live';
  const reqId = state.lastReqId;

  try {
    const userId = socket.data.user._id.toString();

    const user = await User.findById(userId);
    if (!user) {
      socket.emit('playlist_error', { message: 'User not found', reqId });
      return;
    }

    const musicProfile = await MusicProfile.findOne({ userId });
    if (!musicProfile) {
      socket.emit('playlist_error', { message: 'Music profile not built yet — reconnect your music provider', reqId });
      return;
    }

    const hasSpotify = !!user.spotifyToken?.blob;
    const hasYoutube = !!user.youtubeMusicToken?.blob;
    if (!hasSpotify && !hasYoutube) {
      socket.emit('playlist_error', { message: 'No music provider connected', reqId });
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
      socket.emit('playlist_error', { message: `Token refresh failed: ${err.message}`, reqId });
      return;
    }

    log(`[generate] start trigger=${trigger} hr=${state.stableHR} activity=${state.latestActivity} mode=${mode} reqId=${reqId}`);

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
      const fallbackTracks = toClientTracks(generateFallbackPlaylist(musicProfile ?? {}), provider);
      if (fallbackTracks.length > 0) {
        log(`[generate] AI failed → fallback tracks=${fallbackTracks.length} reqId=${reqId}`);
        socket.emit('playlist_ready', {
          trigger,
          mode,
          reqId,
          tracks:    fallbackTracks,
          familiar:  fallbackTracks.length,
          discovery: 0,
          fallback:  true,
        });
      } else {
        socket.emit('playlist_error', { message: err.message, reqId });
      }
      return;
    }

    const cachedDiscovery = aiResult.tracks;
    const playlist = await mixPlaylist({
      musicProfile,
      aiParams:            aiResult.params,
      fetchDiscoveryTracks: () => Promise.resolve(cachedDiscovery),
    });

    // Normalize to the client contract (and reconstruct/validate uris). Guard on
    // the PLAYABLE result: never push an empty/unplayable playlist — it would blank
    // the queue and spin the overlay forever. Surface a recoverable error instead.
    const clientTracks = toClientTracks(playlist?.merged, provider);
    if (clientTracks.length === 0) {
      log(`[generate] no playable tracks → playlist_error trigger=${trigger} reqId=${reqId}`);
      socket.emit('playlist_error', { message: 'Could not build a playlist from the current sources — try again', reqId });
      return;
    }

    socket.emit('playlist_ready', {
      trigger,
      mode,
      reqId,
      params:    aiResult.params,
      tracks:    clientTracks,
      familiar:  playlist.familiar.length,
      discovery: playlist.discovery.length,
    });
    log(`[generate] done trigger=${trigger} tracks=${clientTracks.length} familiar=${playlist.familiar.length} discovery=${playlist.discovery.length} reqId=${reqId}`);

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
  } finally {
    state.generating = false;
  }
}

// ── Shared biometric reading handler ──────────────────────────────────────────
// Called by both the socket `biometric_push` event and server-side pollers
// (e.g. garminPoller). Normalizes the raw reading, updates debounce state,
// and triggers playlist generation when a sustained HR change is detected.

// Reject physiologically impossible / malformed readings before they reach the
// AI engine or state machine. The socket is authenticated, but the *content* of
// biometric_push is fully attacker-controlled (a user can spoof their own client). (audit F14)
function isValidReading(n) {
  if (!n) return false;
  // heartRate is the attacker-controlled physiological value — validate strictly.
  if (typeof n.heartRate !== 'number' || !Number.isFinite(n.heartRate)) return false;
  if (n.heartRate <= 0 || n.heartRate > 300) return false;
  // recordedAt isn't persisted on the socket path, but if present it must be a
  // real Date (rejects `new Date('garbage')` from a bad provider timestamp).
  if (n.recordedAt !== undefined &&
      (!(n.recordedAt instanceof Date) || Number.isNaN(n.recordedAt.getTime()))) {
    return false;
  }
  return true;
}

function handleBiometricReading(socket, source, raw, opts = {}) {
  let normalized;
  try {
    normalized = normalize(source, raw);
  } catch (err) {
    socket.emit('connection_error', { message: err.message });
    return;
  }

  if (!isValidReading(normalized)) {
    socket.emit('connection_error', { message: 'Invalid biometric reading' });
    return;
  }

  socket.emit('biometric_ack', { normalized });

  const state = getState(socket.id);
  state.consecutiveSkips = 0;
  state.latestActivity   = normalized.activity;

  // Immediate (trusted) mode for the 5-minute watch ingest path: no 60s debounce.
  // First reading (no baseline), a change >= 25 bpm, OR a new activity state
  // (resting→running etc.) regenerates synchronously. The activity gate fixes
  // "entering a new activity mode does nothing" when HR hasn't crossed 25 bpm.
  if (opts.immediate) {
    const prev = state.stableHR;
    const activityChanged = state.stableActivity !== null && normalized.activity !== state.stableActivity;
    state.stableHR       = normalized.heartRate;
    state.stableActivity = normalized.activity;
    const hrJumped = prev !== null && Math.abs(normalized.heartRate - prev) >= WATCH_HR_DELTA_THRESHOLD;
    if (prev === null || hrJumped || activityChanged) {
      log(`[handleBiometric] immediate hr=${normalized.heartRate} activity=${normalized.activity} hrJumped=${hrJumped} activityChanged=${activityChanged} → generate`);
      generateAndEmitPlaylist(socket, 'biometric', state);
    }
    return;
  }

  if (state.stableHR === null) {
    state.stableHR       = normalized.heartRate;
    state.stableActivity = normalized.activity;
    return;
  }

  const delta = Math.abs(normalized.heartRate - state.stableHR);
  const activityChanged = normalized.activity !== state.stableActivity;

  // Neither HR nor activity moved meaningfully → settle and cancel any pending
  // recalibration. A new activity state counts as a meaningful change.
  if (delta < HR_DELTA_THRESHOLD && !activityChanged) {
    if (state.timer) {
      clearTimer(state);
      socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
    }
    state.stableHR = normalized.heartRate;
    return;
  }

  if (state.timer) return;

  state.pendingHR       = normalized.heartRate;
  state.pendingActivity = normalized.activity;
  state.timer = setTimeout(() => {
    const s = debounceMap.get(socket.id);
    if (!s) return;
    const currentDelta = Math.abs(s.pendingHR - s.stableHR);
    const stillChanged = currentDelta >= HR_DELTA_THRESHOLD || s.pendingActivity !== s.stableActivity;
    if (stillChanged) {
      s.stableHR       = s.pendingHR;
      s.stableActivity = s.pendingActivity;
      generateAndEmitPlaylist(socket, 'biometric', s);
    } else {
      socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
    }
    clearTimer(s);
  }, DEBOUNCE_MS);

  socket.emit('recalibration_pending', { delta, secondsRemaining: Math.round(DEBOUNCE_MS / 1000) });
}

// ── Socket event registration ──────────────────────────────────────────────────

function registerBiometricHandler(socket) {
  const socketId = socket.id;

  socket.on('biometric_push', ({ source, raw } = {}) => {
    handleBiometricReading(socket, source, raw);
  });

  socket.on('emotion_update', ({ taps = [], textPrompt = '', mode } = {}) => {
    const state = getState(socketId);
    state.lastEmotionTaps = taps;
    state.lastTextPrompt  = textPrompt;
    if (mode) state.lastMode = mode;
    log(`[emotion_update] taps=${taps.length} mode=${state.lastMode}`);
  });

  // Generation trigger for the mood/emotion flow. The client emits emotion_update
  // (to cache taps + mode) immediately followed by request_playlist on the same
  // socket; Socket.IO preserves per-socket order so the cache is set first.
  socket.on('request_playlist', ({ mode, reqId } = {}) => {
    const state = getState(socketId);
    if (mode) state.lastMode = mode;
    if (reqId !== undefined) state.lastReqId = reqId;
    log(`[request_playlist] reqId=${reqId} mode=${state.lastMode}`);
    generateAndEmitPlaylist(socket, 'emotion', state);
  });

  // "Listen to your heart" — an explicit, user-initiated biometric playlist.
  // Uses the 'heart' trigger (not 'biometric') so the client replaces playback
  // immediately rather than queueing it behind the current track.
  socket.on('request_heart_playlist', async ({ mode, reqId, heartRate } = {}) => {
    const state = getState(socketId);
    if (mode) state.lastMode = mode;
    if (reqId !== undefined) state.lastReqId = reqId;

    const ctx = await resolveHeartContext(socket, state, heartRate);
    if (!ctx) {
      socket.emit('playlist_error', { message: 'No heart-rate data yet — connect your watch or wait for a reading', reqId });
      return;
    }
    state.stableHR       = ctx.heartRate;
    state.latestActivity = ctx.activity;
    log(`[heart] generate hr=${ctx.heartRate} activity=${ctx.activity} source=${ctx.source} reqId=${reqId}`);
    generateAndEmitPlaylist(socket, 'heart', state);
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

module.exports = {
  registerBiometricHandler,
  generateAndEmitPlaylist,
  handleBiometricReading,
  _debounceMap: debounceMap,
};
