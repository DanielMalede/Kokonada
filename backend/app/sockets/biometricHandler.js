'use strict';

const { normalize }  = require('../services/wearable/adapter');
const User           = require('../models/User');
const MusicProfile   = require('../models/MusicProfile');
const BiometricLog   = require('../models/BiometricLog');
const MedicalProfile = require('../models/MedicalProfile');
const PlaylistSession = require('../models/PlaylistSession');
const { computeStateVector } = require('../services/medicalProfileService');
const spotify        = require('../services/spotify');
const youtube        = require('../services/youtube');
const { buildEmotionPlaylist, adjustBiometricPlaylist } = require('../services/geminiEngine');
const { generateFallbackPlaylist, personalizeWhitelist } = require('../services/playlistMixer');
const { buildMoodParams, resolveMoodKey, syntheticBioMoodKey, bandFromHeartRate } = require('../services/moodDescriptors');
const serveLedger = require('../services/ledger/serveLedger');
const orchestrator = require('../services/generation/orchestrator');
const { resolveMusicProvider, resolvePlaybackProvider } = require('../utils/providerSelect');
const { captureException } = require('../config/sentry');
const { translateToSpotify } = require('../services/crossPlatform');
const { canonicalKey } = require('../services/identity/trackIdentity');
const featureService = require('../services/features/featureService');

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
// Generation tuning knobs live with their owners: the selection pipeline reads
// SELECTION_POOL_MAX / SCORE_W_* / LEDGER_* env vars.

// ── Anti-repetition ────────────────────────────────────────────────────────────
// The nine legacy layers (per-mood blacklist, session cooldowns, strict mode,
// sort-axis rotation, ratio inversion, variation seeds) are GONE, and Phase 7
// deleted the legacy mixer entirely. The ServeLedger (24h global / 72h per-mood
// windows + exposure-decay scoring) and the selection pipeline's MMR own variance.

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

// Deliver a playlist result to the USER, not a single socket. Generation can be triggered
// on one socket (a biometric push from the watch's socket, or a socket that later churned)
// while the app is listening on ANOTHER of the same user's sockets — a plain socket.emit
// would strand the reply. Emitting to the per-user room (joined on connect in sockets/index)
// reaches every one of that user's live sockets (app + watch). Falls back to socket.emit when
// the namespace isn't available (unit tests). Always-on log so delivery is visible in prod.
function emitToUser(socket, event, payload) {
  const uid = String(socket?.data?.user?._id ?? '');
  if (event === 'playlist_ready') {
    console.warn(`[gen] emit playlist_ready reqId=${payload?.reqId} tracks=${payload?.tracks?.length ?? 0} user=${uid}`);
  } else if (event === 'playlist_error') {
    console.warn(`[gen] emit playlist_error reqId=${payload?.reqId} msg="${payload?.message ?? ''}" user=${uid}`);
  }
  if (uid && socket.nsp && typeof socket.nsp.to === 'function') {
    socket.nsp.to(`user:${uid}`).emit(event, payload);
  } else {
    socket.emit(event, payload);
  }
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
      // User-selected activity preset key (lib/activities.ts), e.g. 'running'.
      // Distinct from latestActivity (watch-detected motion). Drives the emotion
      // pipeline + is woven into the LLM prompt alongside taps/text/biometrics.
      lastActivity:     null,
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

// Feature flag — keep the 24h biometric injection togglable while Garmin Health
// API approval is pending and many users' MedicalProfiles are still sparse.
const BIO_CONTEXT_ENABLED = process.env.BIO_CONTEXT_PROMPT !== 'false';

// Build a compact, anonymised snapshot of the user's recent health baselines
// (sleep stages, HRV, body battery, readiness, resting HR — all decrypted via the
// MedicalProfile getters) plus the current HR, so the emotion LLM can weigh the
// user's physical state against their chosen mood/activity. Returns null (no block)
// when disabled, when there's no profile, or when nothing meaningful is present.
// Best-effort: any DB/decrypt failure degrades to null and never blocks generation.
async function resolveBiometricContext(userId, currentHR) {
  if (!BIO_CONTEXT_ENABLED) return null;

  let profile;
  try {
    profile = await MedicalProfile.findOne({ userId });
  } catch (e) {
    log(`[bio-context] MedicalProfile query failed: ${e.message}`);
    return null;
  }
  if (!profile) return null;

  const num = (v) => (Number.isFinite(v) ? v : null);
  const restingHeartRate = num(profile.restingHeartRate);
  const hrv              = num(profile.hrv);
  const respirationRate  = num(profile.respirationRate);
  const spO2             = num(profile.spO2);
  const bodyBattery      = num(profile.bodyBattery);
  const dailyReadiness   = num(profile.dailyReadiness);
  const sleepDeep        = num(profile.sleepStages?.deep);
  const sleepLight       = num(profile.sleepStages?.light);
  const sleepRem         = num(profile.sleepStages?.rem);
  const sleep = (sleepDeep != null || sleepLight != null || sleepRem != null)
    ? { deep: sleepDeep, light: sleepLight, rem: sleepRem }
    : null;
  const heartRate = isPhysiologicalHR(currentHR) ? currentHR : null;

  // Deterministic, human-readable physiological state label — a hint for the LLM.
  const { status: stateLabel } = computeStateVector({
    heartRate, restingHeartRate, hrv, respirationRate, spO2, bodyBattery, dailyReadiness,
  });

  const ctx = {
    stateLabel,
    heartRate,
    restingHeartRate,
    hrRatio: heartRate && restingHeartRate
      ? Math.round((heartRate / restingHeartRate) * 100) / 100
      : null,
    hrv,
    bodyBattery,
    dailyReadiness,
    spO2,
    sleep,
  };

  // No scalar signal at all → skip the block (a bare "state=Neutral" adds noise).
  const hasSignal = [restingHeartRate, hrv, bodyBattery, dailyReadiness, spO2, sleep]
    .some((v) => v != null);
  return hasSignal ? ctx : null;
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
  // Generation epoch: every generation claims a monotonically-increasing token. A run that
  // is superseded (it timed out, or a newer generation started) no longer "owns" the socket,
  // so its late emits and its lock-release become no-ops — this stops a stale playlist from
  // reaching the client and stops an abandoned run from clobbering a newer generation's lock.
  const myGen = (state.genSeq = (state.genSeq || 0) + 1);

  // Echoed back to the client so it can (a) keep the user's chosen playback mode
  // and (b) drop stale emotion results. Captured up-front so every emit is consistent.
  const mode  = state.lastMode ?? 'live';
  const reqId = state.lastReqId;

  // Epoch-guarded emit: only the generation that still owns the socket may reach the client.
  const emit = (event, payload) => {
    if (state.genSeq === myGen) emitToUser(socket, event, payload);
  };

  // HARD wall-clock bound on the WHOLE generation. Any external stall — an LLM outage, or a
  // Spotify 429 Retry-After storm across dozens of discovery/translation searches (withRetry
  // waits out each Retry-After) — could otherwise hold state.generating for MINUTES, wedging
  // the socket so every later request_playlist hits the in-flight guard and the user never
  // gets a reply. On expiry we free the lock and, for a user-initiated request, surface a
  // recoverable error; the abandoned pipeline settles harmlessly (the epoch guard voids it).
  const GENERATION_TIMEOUT_MS = Number(process.env.GENERATION_TIMEOUT_MS) || 30_000;
  const userInitiated = trigger === 'emotion' || trigger === 'heart';
  const timer = setTimeout(() => {
    if (state.genSeq !== myGen) return;   // already settled — nothing to abandon
    state.genSeq += 1;                     // supersede: void the in-flight run's emits + its release
    state.generating = false;              // free the lock now so the next request can generate
    console.warn(`[generate] TIMEOUT after ${GENERATION_TIMEOUT_MS}ms trigger=${trigger} reqId=${reqId} — released lock`);
    if (userInitiated) emitToUser(socket, 'playlist_error', { message: 'Generation timed out — please try again', reqId });
  }, GENERATION_TIMEOUT_MS);
  timer.unref?.();

  try {
    const userId = socket.data.user._id.toString();

    const user = await User.findById(userId);
    if (!user) {
      emit('playlist_error', { message: 'User not found', reqId });
      return;
    }

    // .lean(): generation only READS the profile (library/genreSet/topGenres/baselines).
    // Hydrated Mongoose subdocuments here get JSON.stringify'd in candidatePool with
    // their parent proxies → 442MB heap OOM on a large library. Plain objects are safe
    // and faster; candidatePool also hardens against non-lean callers as defense in depth.
    const musicProfile = await MusicProfile.findOne({ userId }).lean();
    if (!musicProfile) {
      // Always-on diagnostic (prod's log() is gated): the profile row is missing —
      // the background build hasn't run/finished, or it saved nothing.
      console.warn(`[generate] no MusicProfile for user — build not finished yet? trigger=${trigger}`);
      emit('playlist_error', { message: 'Still setting up your library — try again in a few seconds.', reqId });
      return;
    }
    // Always-on diagnostic: surface the library size so an empty/thin profile (the
    // common cause of an empty playlist) is visible in prod logs.
    console.warn(`[generate] profile loaded trigger=${trigger} library=${musicProfile.library?.length ?? 0} topGenres=${(musicProfile.topGenres || []).length} genreSet=${(musicProfile.genreSet || []).length}`);

    // PLAYBACK-first sourcing (YouTube-as-data / Spotify-as-playback architecture):
    // when Spotify is connected it is the playback engine, so we SOURCE from Spotify
    // regardless of which provider built the taste profile — the (now YouTube-weighted)
    // profile's genres/artists still steer that Spotify discovery, and every track is
    // natively playable on the Web Playback SDK. A YouTube-only user (no Spotify) falls
    // back to YouTube sourcing. This supersedes the old resolveMusicProvider desync.
    const provider = resolvePlaybackProvider(user) || resolveMusicProvider(user);
    if (!provider) {
      emit('playlist_error', { message: 'No music provider connected', reqId });
      return;
    }

    // Bug 8 — strict branch routing. Route to the mood/emotion pipeline whenever there
    // is ANY emotion intent (mood taps OR a custom text prompt); a custom-text-only
    // request must never fall through to the heart-rate branch and be ignored.
    const useEmotion = trigger === 'emotion'
      && (state.lastEmotionTaps.length > 0 || !!state.lastTextPrompt || !!state.lastActivity);
    // The mood the critic, strict personalization and the serve ledger key off.
    // The heart-rate branch now gets a SYNTHETIC, deterministic bio:* moodKey
    // (bio:<band>:<activity>) — closing the old moodKey=null blacklist bypass.
    // Null only when no usable HR exists (degrades to legacy global cooldown).
    const moodKey   = useEmotion
      ? resolveMoodKey(state.lastEmotionTaps)
      : syntheticBioMoodKey(state.stableHR, state.latestActivity);
    let fetchTracks;
    let spotifyToken = null; // hoisted so the post-mix Spotify translation step can reuse it
    try {
      if (provider === 'spotify') {
        spotifyToken = await spotify.getValidToken(user);
        const accessToken = spotifyToken;
        // Layer 1 → personalization. Source candidates from curated vibe playlists
        // (energy/tempo encoded by curation), tag with artist genres, then apply the
        // ABSOLUTE personalization filter (a Rock track from "Beast Mode" is dropped
        // for an Afrobeat listener). The LLM critic left the hot path in Phase 7 —
        // vibe enrichment happens asynchronously in the embedding worker.
        fetchTracks = async (params) => {
          // Latency cut: when Spotify won't serve artist genres (/artists 403), discovery
          // candidates can't be tagged → personalization discards them anyway → the whole
          // discovery sourcing + tagging + critic is pure wasted time (and burns the
          // Dev-Mode rate budget, slowing everything to a client timeout). Skip it and let
          // the genre-backfilled familiar library fill the playlist (~20s → ~5s).
          if (!spotify.artistGenresAvailable()) return [];
          const raw     = await spotify.fetchVibeDiscovery(accessToken, params, { limit: DISCOVERY_FETCH_LIMIT });
          const tagged  = await tagSpotifyDiscovery(accessToken, raw);
          const onTaste = personalizeWhitelist(tagged, {
            genreSet:       musicProfile.genreSet,
            knownArtistIds: musicProfile.knownArtistIds,
          });
          return onTaste;
        };
      } else {
        const accessToken = await youtube.getValidToken(user);
        fetchTracks = (params) => youtube.searchRecommendations(accessToken, { ...params, limit: DISCOVERY_FETCH_LIMIT });
      }
    } catch (err) {
      emit('playlist_error', { message: `Token refresh failed: ${err.message}`, reqId });
      return;
    }

    log(`[generate] start trigger=${trigger} hr=${state.stableHR} activity=${state.latestActivity} mode=${mode} reqId=${reqId}`);

    // (Variation seeds + sort-axis rotation are gone: the LLM prompt cache is now
    // deterministic per context, and variance comes from the ledger + MMR.)

    let aiResult;
    try {
      if (useEmotion) {
        // 24h health snapshot (sleep/HRV/body battery/readiness + current HR) so the
        // LLM weighs physical state against the chosen mood + activity. Best-effort.
        const biometricContext = await resolveBiometricContext(userId, state.stableHR);
        aiResult = await buildEmotionPlaylist({
          musicProfile,
          emotionTaps:  state.lastEmotionTaps,
          textPrompt:   state.lastTextPrompt || null,
          activity:     state.lastActivity || null,
          biometricContext,
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
      // The generation pipeline threw (LLM/Spotify/mixer). We recover below, but this
      // path was previously only console-logged — report it so a systemic failure that
      // silently degrades every user to the fallback playlist is visible in Sentry.
      captureException(err, { scope: 'generate', trigger, reqId, provider });
      // Zero-tolerance fallback: if the LLM is down mid-mood, build a deterministic,
      // strictly on-vibe playlist from the mood descriptors (no AI, library-only so it
      // never depends on a possibly-failing Spotify) rather than dumping off-vibe
      // top-affinity favourites that violate the chosen vibe.
      const moodParams = useEmotion ? buildMoodParams(state.lastEmotionTaps, musicProfile) : null;
      if (moodParams) {
        try {
          const moodPlaylist = await orchestrator.generateV2({
            userId, musicProfile, moodKey, provider,
            aiParams: moodParams,
            discoveryTracks: [],
            live: { heartRate: state.stableHR, activity: state.latestActivity },
            crossPlatform: provider === 'spotify' && !!spotifyToken,
          });
          const moodTracks = toClientTracks(moodPlaylist?.merged, provider);
          if (moodTracks.length > 0) {
            log(`[generate] LLM failed → on-vibe mood fallback tracks=${moodTracks.length} reqId=${reqId}`);
            emit('playlist_ready', {
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
        emit('playlist_ready', {
          trigger,
          mode,
          reqId,
          tracks:    fallbackTracks,
          familiar:  fallbackTracks.length,
          discovery: 0,
          fallback:  true,
        });
      } else {
        emit('playlist_error', { message: err.message, reqId });
      }
      return;
    }

    const cachedDiscovery = aiResult.tracks;
    // The v2 engine is the ONLY serving path (Phase 7 sealed the flip): full
    // biosonic targets + ledger windows + scoring + MMR.
    const playlist = await orchestrator.generateV2({
      userId, musicProfile, moodKey, provider,
      aiParams: aiResult.params,
      discoveryTracks: cachedDiscovery,
      live: { heartRate: state.stableHR, activity: state.latestActivity },
      // Spotify sink + a live token ⇒ the post-mix translation step runs, so familiar
      // cross-provider (YouTube) tracks must survive selection to be resolved to Spotify.
      crossPlatform: provider === 'spotify' && !!spotifyToken,
    });
    if (playlist.telemetry) {
      log(`[selection.v2] pool=${playlist.telemetry.poolSize} filtered=${playlist.telemetry.afterFilters} relax=${playlist.telemetry.relaxLevel} ms=${playlist.telemetry.stageMs?.total} reqId=${reqId}`);
    }

    // Cross-platform translation: playback happens on Spotify's SDK, so every track must
    // carry a spotify: URI. This is a cheap O(n) passthrough for native Spotify tracks (no
    // network) and resolves any YouTube-sourced track to a playable Spotify URI via search.
    // Guarded to the Spotify playback path; a dropped (unmatched) track never blocks the rest.
    if (provider === 'spotify' && spotifyToken && playlist?.merged?.length) {
      try {
        const { tracks: playable } = await translateToSpotify(playlist.merged, spotifyToken);
        if (playable.length) playlist.merged = playable;
      } catch (e) {
        log(`[generate] cross-platform translation skipped: ${e.message}`);
      }
    }

    // Normalize to the client contract (and reconstruct/validate uris). Guard on
    // the PLAYABLE result: never push an empty/unplayable playlist — it would blank
    // the queue and spin the overlay forever. Surface a recoverable error instead.
    const clientTracks = toClientTracks(playlist?.merged, provider);
    if (clientTracks.length === 0) {
      // Always-on diagnostic: show WHY the playlist is empty (library size, discovery
      // candidates, post-mix bucket sizes, and the mood filters) so prod logs pinpoint
      // the cause without DEBUG_PLAYLIST.
      console.warn(`[generate] EMPTY playlist trigger=${trigger} provider=${provider} useEmotion=${useEmotion} `
        + `library=${musicProfile.library?.length ?? 0} discoveryCandidates=${cachedDiscovery?.length ?? 0} `
        + `mixedFamiliar=${playlist?.familiar?.length ?? 0} mixedDiscovery=${playlist?.discovery?.length ?? 0} `
        + `seed_genres=${JSON.stringify(aiResult.params?.seed_genres)} exclude_genres=${JSON.stringify(aiResult.params?.exclude_genres)}`);
      emit('playlist_error', { message: 'Could not build a playlist from the current sources — try again', reqId });
      return;
    }

    emit('playlist_ready', {
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
      // Persist the resolved mood so a repeat can be detected + its tracks blacklisted.
      moodKey,
      biometricSnapshot: { heartRate: state.stableHR, activity: state.latestActivity },
      targetBpm:         aiResult.params.target_bpm,
      targetGenres:      aiResult.params.seed_genres || [],
      targetValence:     aiResult.params.target_valence,
      targetEnergy:      aiResult.params.target_energy,
      musicProvider:     provider,
      trackIds:          playlist.merged.map(t => t.id).filter(Boolean),
      // Canonical keys (isrc:… / at:artist|title) mirroring trackIds — the cross-provider
      // identity the serve ledger dedupes on. Library tracks carry one; discovery gets it here.
      trackKeys:         playlist.merged.map(t => t.canonicalKey ?? canonicalKey(t)).filter(Boolean),
      // Denormalized display summary for the history feed (A11). clientTracks already
      // resolved title/artist + a playable URI; cap at 50 (a playlist is always 50).
      trackSummary:      clientTracks.slice(0, 50).map(t => ({ id: t.id, title: t.title, artist: t.artist })),
    }).catch(e => {
      console.error('[PlaylistSession] save failed:', e.message);
      // A dropped session write silently breaks anti-repetition (the next generation
      // won't know these tracks were just served) — report it rather than swallow.
      captureException(e, { scope: 'playlistSession.save', userId: String(userId) });
    });

    // Dark launch: queue audio-feature hydration for anything just served that the
    // store hasn't seen. Nothing reads AudioFeature until the Phase-5 scorer.
    featureService.enqueueHydration(playlist.merged).catch(() => {});

    // Serve ledger (write path — reads land with the Phase-5 selector): record every
    // served track under this generation's mood context. Coarse bands only, no vitals.
    serveLedger.recordServes({
      userId,
      sessionId: String(reqId ?? ''),
      entries: playlist.merged.map(t => ({
        canonicalKey: t.canonicalKey ?? canonicalKey(t),
        moodKey,
        bioState: { tempoBand: bandFromHeartRate(state.stableHR), activity: state.latestActivity ?? null },
      })),
    }).catch(e => console.error('[serveLedger] record failed:', e.message));
  } finally {
    clearTimeout(timer);
    // Release only if we still own the lock: a timed-out run (epoch bumped) must not clear a
    // newer generation's in-flight flag when its abandoned body finally settles.
    if (state.genSeq === myGen) state.generating = false;
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
    // A wearable adapter throwing means malformed/unsupported device data reached us —
    // worth seeing (a provider changed its payload shape) beyond the client-facing error.
    captureException(err, { scope: 'biometric.normalize', source });
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

  socket.on('emotion_update', ({ taps = [], textPrompt = '', activity = null, mode } = {}) => {
    const state = getState(socketId);
    state.lastEmotionTaps = taps;
    state.lastTextPrompt  = textPrompt;
    state.lastActivity    = activity || null;
    if (mode) state.lastMode = mode;
    log(`[emotion_update] taps=${taps.length} activity=${state.lastActivity ?? 'none'} mode=${state.lastMode}`);
  });

  // Generation trigger for the mood/emotion flow. The client emits emotion_update
  // (to cache taps + mode) immediately followed by request_playlist on the same
  // socket; Socket.IO preserves per-socket order so the cache is set first.
  socket.on('request_playlist', ({ mode, reqId } = {}) => {
    const state = getState(socketId);
    if (mode) state.lastMode = mode;
    if (reqId !== undefined) state.lastReqId = reqId;
    // Always-on: confirms the app's Generate request actually reached the server (vs an
    // automatic biometric trigger) so request delivery is visible in prod.
    console.warn(`[gen] recv request_playlist reqId=${reqId} sid=${socketId} user=${socket?.data?.user?._id ?? ''}`);
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
      emitToUser(socket, 'playlist_error', { message: 'No heart-rate data yet — connect your watch or wait for a reading', reqId });
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
  resolveBiometricContext,
};
