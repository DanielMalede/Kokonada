'use strict';

const { normalize }  = require('../services/wearable/adapter');
const User           = require('../models/User');
const MusicProfile   = require('../models/MusicProfile');
const BiometricLog   = require('../models/BiometricLog');
const PlaylistSession = require('../models/PlaylistSession');
const spotify        = require('../services/spotify');
const youtube        = require('../services/youtube');
const { buildEmotionPlaylist, adjustBiometricPlaylist, critiqueTrackVibe } = require('../services/geminiEngine');
const { mixPlaylist, generateFallbackPlaylist, personalizeWhitelist }  = require('../services/playlistMixer');
const { buildMoodParams, resolveMoodKey }      = require('../services/moodDescriptors');
const { resolveMusicProvider } = require('../utils/providerSelect');

// A heart rate must be physiologically plausible before it can drive a playlist.
// The biometric_push content is attacker-controlled and a watch can momentarily
// report 0 (no contact) or a spike — neither should mint a garbage target_bpm.
function isPhysiologicalHR(n) {
  return Number.isFinite(n) && n >= 30 && n <= 220;
}

const debounceMap = new Map();
const HR_DELTA_THRESHOLD = 10;
const DEBOUNCE_MS        = 60_000;
// Watch (5-min cadence) path: each ping is trusted as the new sustained HR.
// A larger 25 bpm gate ensures we only re-adapt on a real activity-state change
// (vs the 10 bpm streaming threshold), so a flat HR never churns Spotify.
const WATCH_HR_DELTA_THRESHOLD = 25;
// Over-fetch discovery candidates so the mixer can filter to the user's taste and
// still fill 50 (15 discovery + library backfill, or all 50 from discovery when
// the library is empty). The mixer trims to the 30% target / fills the rest.
const DISCOVERY_FETCH_LIMIT = 60;
// Anti-repetition: hold every track from the user's last N generations on a cooldown
// so sequential playlists don't overlap. Backed by PlaylistSession (persists across
// restarts/devices), capped so a huge history can't bloat the exclude set.
const COOLDOWN_GENERATIONS = 3;
const COOLDOWN_MAX_IDS = 150;

// Build the recent-track cooldown set from the user's last few generated playlists.
// Best-effort: a DB hiccup must never block a generation, so it degrades to empty.
async function recentTrackCooldown(userId) {
  try {
    const recent = await PlaylistSession.find({ userId })
      .sort({ createdAt: -1 })
      .limit(COOLDOWN_GENERATIONS)
      .select('trackIds')
      .lean();
    const ids = new Set();
    for (const s of recent) {
      for (const id of s.trackIds || []) {
        ids.add(id);
        if (ids.size >= COOLDOWN_MAX_IDS) return ids;
      }
    }
    return ids;
  } catch (e) {
    log(`[cooldown] read failed: ${e.message}`);
    return new Set();
  }
}

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
  // Only reconstruct a Spotify URI for a GENUINELY Spotify track. A familiar/
  // fallback library entry tagged with a different provider (e.g.
  // `youtube_music`) has a YouTube video id — rebuilding `spotify:track:<id>`
  // from it mints a malformed URI that Spotify rejects with a 400 for the whole
  // play request. Untagged tracks (legacy entries, Spotify recommendation
  // objects) are assumed to match the active provider.
  if (!uri && id && provider === 'spotify' && (!t.provider || t.provider === 'spotify')) {
    uri = `spotify:track:${id}`;
  }
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

// Tags Spotify discovery candidates with their artists' genres + ids so the mixer
// can filter them against the user's real taste (genreSet / knownArtistIds).
// /audio-features is dead, but artist genres are still available, so relevance is
// judged on genre overlap + artist novelty. Resolution failures degrade to
// genre-less tracks (the mixer treats them as "looser", not outliers).
async function tagSpotifyDiscovery(accessToken, tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  const idsByTrack = list.map((t) => (t.artists || []).map((a) => a.id).filter(Boolean));
  const allIds = [...new Set(idsByTrack.flat())];

  let genreMap = {};
  if (allIds.length) {
    try { genreMap = await spotify.getArtistsGenres(accessToken, allIds); }
    catch (e) { log(`[generate] artist-genre tagging failed: ${e.message}`); }
  }

  return list.map((t, i) => {
    const artistIds = idsByTrack[i];
    const genres = [...new Set(artistIds.flatMap((id) => genreMap[id] || []))];
    return { ...t, provider: t.provider ?? 'spotify', artistIds, genres };
  });
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
    // Filter to physiological readings BEFORE averaging so a stray 0 (no-contact) or
    // spiked sample can't drag the average to a junk value.
    const hrs = logs.map((l) => l.heartRate).filter(isPhysiologicalHR);
    if (hrs.length > 0) {
      const avg = Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length);
      return { heartRate: avg, activity: logs[0].activity || state.latestActivity || 'unknown', source: 'last_30min' };
    }
  } catch (e) {
    log(`[heart] BiometricLog query failed: ${e.message}`);
  }

  if (isPhysiologicalHR(state.stableHR)) {
    return { heartRate: state.stableHR, activity: state.latestActivity || 'unknown', source: 'current' };
  }
  if (isPhysiologicalHR(clientHeartRate)) {
    return { heartRate: clientHeartRate, activity: state.latestActivity || 'unknown', source: 'client' };
  }

  const profile = await MusicProfile.findOne({ userId });
  if (profile && isPhysiologicalHR(profile.restingHeartRate)) {
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

    // Select the provider with a stored token (token-aware), so generation,
    // GET /integrations/status, and the frontend SDK/playback all agree on one
    // usable provider — no more "musicProvider says spotify but only YouTube is
    // connected" desync that 400s the token + play calls.
    const provider = resolveMusicProvider(user);
    if (!provider) {
      socket.emit('playlist_error', { message: 'No music provider connected', reqId });
      return;
    }

    // Anti-repetition cooldown: exclude tracks from the user's last few playlists so
    // each press feels fresh. Read once and reused by every mixPlaylist call below.
    const cooldownIds = await recentTrackCooldown(userId);

    // Bug 8 — strict branch routing. Route to the mood/emotion pipeline whenever there
    // is ANY emotion intent (mood taps OR a custom text prompt); a custom-text-only
    // request must never fall through to the heart-rate branch and be ignored.
    const useEmotion = trigger === 'emotion'
      && (state.lastEmotionTaps.length > 0 || !!state.lastTextPrompt);
    // The mood the Layer-2 critic and strict personalization key off — null on the
    // heart-rate branch, which keeps its original soft-bias behaviour.
    const moodKey   = useEmotion ? resolveMoodKey(state.lastEmotionTaps) : null;
    // Layer 2 (Groq energy critic) runs only for a real mood and is kill-switchable.
    const runCritic = useEmotion && process.env.VIBE_CRITIC !== 'false';

    let fetchTracks;
    try {
      if (provider === 'spotify') {
        const accessToken = await spotify.getValidToken(user);
        // Layer 1 → personalization → Layer 2. Source candidates from curated vibe
        // playlists (energy/tempo encoded by curation), tag with artist genres, then
        // apply the ABSOLUTE personalization filter (a Rock track from "Beast Mode" is
        // dropped for an Afrobeat listener), then the optional energy critic. Every
        // layer fails open, so the worst case is today's genre-search behaviour.
        fetchTracks = async (params) => {
          const raw     = await spotify.fetchVibeDiscovery(accessToken, params, { limit: DISCOVERY_FETCH_LIMIT });
          const tagged  = await tagSpotifyDiscovery(accessToken, raw);
          const onTaste = personalizeWhitelist(tagged, {
            genreSet:       musicProfile.genreSet,
            knownArtistIds: musicProfile.knownArtistIds,
          });
          if (!runCritic) return onTaste;
          return critiqueTrackVibe({ tracks: onTaste, moodKey, moodKeywords: params.mood_keywords });
        };
      } else {
        const accessToken = await youtube.getValidToken(user);
        fetchTracks = (params) => youtube.searchRecommendations(accessToken, { ...params, limit: DISCOVERY_FETCH_LIMIT });
      }
    } catch (err) {
      socket.emit('playlist_error', { message: `Token refresh failed: ${err.message}`, reqId });
      return;
    }

    log(`[generate] start trigger=${trigger} hr=${state.stableHR} activity=${state.latestActivity} mode=${mode} reqId=${reqId}`);

    // Fresh seed per generation so identical emotion/biometric state yields a
    // DIFFERENT playlist each press — varies the LLM picks and busts the 24h
    // cache key (which is md5(prompt)).
    const seed = `${reqId ?? 'auto'}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    let aiResult;
    try {
      if (useEmotion) {
        aiResult = await buildEmotionPlaylist({
          musicProfile,
          emotionTaps:  state.lastEmotionTaps,
          textPrompt:   state.lastTextPrompt || null,
          fetchTracks,
          seed,
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
          seed,
        });
      }
    } catch (err) {
      // Zero-tolerance fallback: if the LLM is down mid-mood, build a deterministic,
      // strictly on-vibe playlist from the mood descriptors (no AI, library-only so it
      // never depends on a possibly-failing Spotify) rather than dumping off-vibe
      // top-affinity favourites that violate the chosen vibe.
      const moodParams = useEmotion ? buildMoodParams(state.lastEmotionTaps, musicProfile) : null;
      if (moodParams) {
        try {
          const moodPlaylist = await mixPlaylist({
            musicProfile,
            aiParams:             moodParams,
            fetchDiscoveryTracks: () => Promise.resolve([]),
            provider,
            strictPersonalize:    true,
            cooldownIds,
          });
          const moodTracks = toClientTracks(moodPlaylist?.merged, provider);
          if (moodTracks.length > 0) {
            log(`[generate] LLM failed → on-vibe mood fallback tracks=${moodTracks.length} reqId=${reqId}`);
            socket.emit('playlist_ready', {
              trigger,
              mode,
              reqId,
              params:    moodParams,
              tracks:    moodTracks,
              familiar:  moodPlaylist.familiar.length,
              discovery: moodPlaylist.discovery.length,
              fallback:  true,
            });
            return;
          }
        } catch (e2) {
          log(`[generate] mood fallback failed: ${e2.message}`);
        }
      }

      const fallbackTracks = toClientTracks(generateFallbackPlaylist(musicProfile ?? {}, provider), provider);
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
      provider,
      cooldownIds,
      // Personalization is the ABSOLUTE filter on a mood's vibe-sourced pool: discard
      // off-taste candidates rather than backfilling them. Scoped to the Spotify path,
      // which is where Layer-1 sources + genre-tags candidates — YouTube discovery is
      // genre-unknown, so strict discard would wrongly wipe it. HR branch keeps soft-bias.
      strictPersonalize:   useEmotion && provider === 'spotify',
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

    // Session-history honesty: only record the emotion taps / prompt when the emotion
    // pipeline actually drove this generation. A heart/biometric mix must not be
    // labelled with stale mood context it never used.
    PlaylistSession.create({
      userId,
      emotionTaps:       useEmotion && state.lastEmotionTaps.length > 0 ? state.lastEmotionTaps : [{ x: 0, y: 0 }],
      contextPrompt:     useEmotion ? (state.lastTextPrompt || '') : '',
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
  // Exported for unit testing
  toClientTrack,
  toClientTracks,
};
