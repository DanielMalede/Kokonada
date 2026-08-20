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
const { personalizeWhitelist } = require('../services/playlistMixer');
const { buildMoodParams, resolveMoodKey, syntheticBioMoodKey, bandFromHeartRate, BAND_LOWER_CUT } = require('../services/moodDescriptors');
const serveLedger = require('../services/ledger/serveLedger');
const orchestrator = require('../services/generation/orchestrator');
const { buildDeterministicFallback } = require('../services/generation/deterministicFallback');
const { resolveMusicProvider, resolvePlaybackProvider } = require('../utils/providerSelect');
const { captureException } = require('../config/sentry');
const { translateToSpotify } = require('../services/crossPlatform');
const { canonicalKey } = require('../services/identity/trackIdentity');
const { logBiometricAccess } = require('../utils/biometricAudit');
const { createFilterState, filterReading } = require('../agents/runtime/ingestion/anomalyFilter');
const { onlineUpdate: liveStateOnlineUpdate } = require('../agents/runtime/physiology/liveStateAdapter');
const { insertManyAccounted } = require('../services/wearable/insertAccounted');
const featureService = require('../services/features/featureService');
const shadowBufferRepo = require('../repositories/shadowBufferRepo');
const { vectorDiscoveryFetch } = require('../services/discovery/discoveryFetch');
const captionService = require('../services/discovery/captionService');
const { peekBaselines } = require('../services/biosonic/baselines');
// Art.9 consent gate (audit H-9 follow-up) for the live socket biometric_push path.
const { getConsentStatus, HEALTH_CONSENT_PURPOSE } = require('../services/privacy/consent');

// A heart rate must be physiologically plausible before it can drive a playlist.
// The biometric_push content is attacker-controlled and a watch can momentarily
// report 0 (no contact) or a spike — neither should mint a garbage target_bpm.
// ONE definition, shared with ingest (D9): see services/wearable/hrRange.
const { isPhysiologicalHR } = require('../services/wearable/hrRange');

const debounceMap = new Map();
const HR_DELTA_THRESHOLD = 10;
// Sensor noise floor. Consumer optical (PPG) heart rate carries a few bpm of
// error against ECG even at rest, so a band crossing SMALLER than that is not
// evidence of a physiological change — it is the sensor breathing across the cut.
// Used to keep the band-transition trigger (D11) from flapping at 90/120.
const HR_NOISE_FLOOR = 3;
// Band RELEASE margin (W4-D05). The noise floor is sized for SENSOR error; resting heart
// rate additionally varies 5-10 bpm minute to minute from respiratory sinus arrhythmia and
// ordinary autonomic drift, which is real signal at the wrong scale to act on. Reflection #1
// measured the resulting flap at 3-5 bpm amplitude (88<->93, 87<->92, 119<->122), each flip
// re-serving the buffer and changing the listener's music. So leaving a band costs more than
// entering one: 2x the sensor's own error must separate the reading from the cut before we
// abandon the mix. MUST stay > HR_NOISE_FLOOR or the trigger is symmetric again.
const HR_BAND_RELEASE_MARGIN = 6;
// §0.4 S11 escape hatch: set it and the trigger reverts to W4-001's symmetric behaviour with
// no revert and no deploy. Forgiving about its value on purpose — a kill-switch that ignores
// `=1` because it demanded `=true` is a kill-switch that fails when it is finally needed.
const RECAL_HYSTERESIS_FLAG = 'WAVE4_RECAL_STATE_TRIGGER_DISABLED';
const _hysteresisDisabled = () => {
  const v = String(process.env[RECAL_HYSTERESIS_FLAG] ?? '').trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
};
// §0.4 S11 escape hatch for the whole A0 wiring (W4-003): set it and every socket reading
// reverts to the pre-filter, pre-persistence W4-001 behaviour byte-for-byte — the raw
// normalized heart rate drives the debounce/trigger machinery directly (no Hampel/slew/
// Kalman, no live BiometricLog write). Same forgiving parse as RECAL_HYSTERESIS_FLAG: a
// kill-switch that only understands `=true` is a kill-switch that fails at 2am on `=1`.
const ANOMALY_FILTER_FLAG = 'WAVE4_ANOMALY_FILTER_DISABLED';
const _anomalyFilterDisabled = () => {
  const v = String(process.env[ANOMALY_FILTER_FLAG] ?? '').trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
};
// §0.4 S11 escape hatch for the W4-D34 duplicate-serve latch: set it and a recalibration
// serves whatever key it computes, every time, exactly as before the latch existed. Its OWN
// flag on purpose — W4-D35 is the standing complaint that RECAL_HYSTERESIS_FLAG already
// reverts two unrelated behaviours, and a third would make it unusable as a kill-switch:
// disabling the latch to debug a missing serve must not also disable the band hysteresis.
const SERVE_LATCH_FLAG = 'WAVE4_SERVE_LATCH_DISABLED';
const _serveLatchDisabled = () => {
  const v = String(process.env[SERVE_LATCH_FLAG] ?? '').trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0';
};
// D10 (W4-003): the live socket lane finally persists what it sees. Capped at one row per
// minute per socket — a live stream can push every few seconds, and BiometricLog is a
// history/baseline input, not a raw firehose; the batch lane already owns high-density
// backfill. RAW (not filtered) values are stored, matching the batch lane's convention —
// this table is the ground-truth device record, not a derived estimate.
const LIVE_PERSIST_MIN_INTERVAL_MS = 60_000;
const DEBOUNCE_MS        = 60_000;
// Watch (5-min cadence) path: each ping is trusted as the new sustained HR, so it skips
// the debounce entirely. It used to need its own 25 bpm gate to avoid churning Spotify on
// a flat HR; the band trigger (D11) subsumes that — a same-band ping produces the same
// buffer key and is therefore inert by construction, at any delta.
// Over-fetch discovery candidates so the mixer can filter to the user's taste and
// still fill 50 (15 discovery + library backfill, or all 50 from discovery when
// the library is empty). The mixer trims to the 30% target / fills the rest.
const DISCOVERY_FETCH_LIMIT = 60;
// Generation tuning knobs live with their owners: the selection pipeline reads
// SELECTION_POOL_MAX / SCORE_W_* / LEDGER_* env vars.
// Dark-ship gate for Spotify-independent vector discovery. Read at call time so a
// Railway env flip needs no redeploy; OFF (unset/anything-but-'true') keeps the
// existing Spotify-discovery/fallback path byte-for-byte unchanged.
const VECTOR_DISCOVERY = () => process.env.VECTOR_DISCOVERY === 'true';
// Band-aware discovery: compute the biosonic band ONCE and share it with BOTH vector
// discovery (so its candidates survive the pipeline's un-relaxable band) and the selection
// pipeline (identical band, no drift). Read at call time; OFF → today's path exactly.
const DISCOVERY_BAND_AWARE = () => process.env.DISCOVERY_BAND_AWARE === 'true';
// Dark-launch gate for the LLM discovery caption (Step 2). Read at call time so a Railway env
// flip needs no redeploy; OFF (unset/anything-but-'true') skips the caption path entirely —
// no Groq call, generation byte-for-byte unchanged.
const DISCOVERY_CAPTION_LLM = () => process.env.DISCOVERY_CAPTION_LLM === 'true';

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

// A per-track "why this track" mix-receipt derived ENTIRELY from signals already
// computed upstream: the track's familiar/discovery role (isDiscovery, set in
// candidatePool) and the playlist-level trigger + LLM targets (aiResult.params). No new
// scoring, no guessing — honest, already-present data. Shape: { label, detail? }.
function buildReceipt(t, context = {}) {
  const { trigger, params, source, targets } = context || {};
  const label = t?.isDiscovery ? 'New discovery' : 'Familiar favorite';
  const parts = [];
  if (source === 'favorites') {
    // Generic double-failure fallback: an off-vibe top-affinity dump. Be HONEST — never
    // claim a mood/heart match it did not target. (L1)
    parts.push('From your favorites');
  } else {
    if (trigger === 'emotion') parts.push('Matched to your mood');
    else if (trigger) parts.push('Tuned to your heart rate'); // biometric / heart / skip_loop
    const bpm = Math.round(Number(params?.target_bpm));
    if (Number.isFinite(bpm) && bpm > 0) parts.push(`${bpm} BPM`);
  }
  const detail = parts.length ? parts.join(' · ') : undefined;
  const receipt = detail ? { label, detail } : { label };
  // A DISCOVERY track may carry an LLM-written witty caption ("why this discovery"), grounded
  // ONLY in its audio feel + this session's mood, attached upstream by the caption service.
  // Familiar tracks NEVER get one; a blank caption is omitted (the client strips unknowns).
  if (t?.isDiscovery && typeof t.caption === 'string' && t.caption.trim()) {
    receipt.caption = t.caption.trim();
  }
  // W4-006 / S13: the honest "why this mix" line. Already vetted by `explainFor` at the seam —
  // it is only present on the targets when every axis its sentence claims carried real evidence,
  // and it is the state's TONE, never the state's name (HITL H6). ADDITIVE: `label` and `detail`
  // are untouched, so no existing receipt string changes. Withheld on the favorites
  // double-failure path, which deliberately claims nothing about mood or heart rate (L1) and
  // where no state took part in choosing the track.
  if (source !== 'favorites' && typeof targets?.explain === 'string' && targets.explain.trim()) {
    receipt.why = targets.explain.trim();
  }
  return receipt;
}

function toClientTrack(t, provider, context) {
  if (!t) return null;
  const id = t.id ?? null;
  let uri = t.uri ?? null;
  // Only reconstruct a Spotify URI for a GENUINELY Spotify track, and ONLY from a
  // bare track id. A familiar/fallback library entry tagged with a different
  // provider (e.g. `youtube_music`) has a YouTube video id — rebuilding
  // `spotify:track:<id>` from it mints a malformed URI that Spotify rejects with a
  // 400 for the whole play request. A colon-bearing id is either a recordingKey
  // (`spotify:<trackId>`, what discovery emits) or an already-formed URI — it must
  // NEVER become `spotify:track:spotify:<trackId>`; it drops to null instead.
  // Untagged tracks (legacy entries, Spotify recommendation objects) are assumed
  // to match the active provider.
  if (!uri && id && !String(id).includes(':') && provider === 'spotify' && (!t.provider || t.provider === 'spotify')) {
    uri = `spotify:track:${id}`;
  }
  if (!uri) return null;
  return {
    id,
    uri,
    // Native catalog key (youtube:<id> for a discovery track; null for a familiar entry) so the
    // client can report a playback failure against THIS entry for the discovery self-heal (Phase 2).
    recordingKey: t.recordingKey ?? null,
    title:  t.title ?? t.name ?? 'Unknown title',
    artist: t.artist ?? t.artists?.[0]?.name ?? 'Unknown artist',
    // Wave 2.8 mix-receipt (the "why this track"). The Now Playing COVER is intentionally
    // NOT here — it is resolved on-device from the live App Remote player state (the backend
    // /v1/tracks art path 403s in Dev Mode), decoupled from the queue payload.
    receipt:  buildReceipt(t, context),
  };
}
function toClientTracks(list, provider, context) {
  return (Array.isArray(list) ? list : []).map((t) => toClientTrack(t, provider, context)).filter(Boolean);
}

// Playback is Spotify-only (native App Remote; NO client — web or mobile — has a YouTube player).
// A YouTube-only account (no Spotify token) resolves provider='youtube', so every familiar library
// entry (youtube_music, uri:null) drops in toClientTrack — the Spotify-URI reconstruction is gated
// on provider==='spotify' — and the playlist comes back empty. Retrying can NEVER help, so an empty
// result for such a user must NOT reuse the generic "try again" (nor leak a raw internal error):
// build a distinct NO_PLAYABLE_PROVIDER error + a calm, on-brand, actionable message. A user WITH a
// playback engine (Spotify connected) who hits a genuine no-tracks case keeps the generic message.
const NO_PLAYABLE_PROVIDER_MESSAGE =
  'Connect Spotify to start listening — your YouTube-based taste profile still works, '
  + 'playback just needs a connected Spotify account.';
function emptyPlaylistError(user, reqId, genericMessage) {
  if (!resolvePlaybackProvider(user)) {
    return { reqId, reason: 'NO_PLAYABLE_PROVIDER', message: NO_PLAYABLE_PROVIDER_MESSAGE };
  }
  return { reqId, message: genericMessage };
}

// A corpus discovery candidate is playable on the YouTube path only when it already carries a
// native youtube: URI. The mbid corpus resolves rows to SPOTIFY URIs (or leaves them uri:null)
// — a spotify: URI is truthy and would otherwise slip through toClientTrack and reach a YouTube
// user as an UNPLAYABLE queue entry, while a uri:null (unresolved mbid) row would inflate the
// discovery count before being dropped downstream. Both are excluded here, before telemetry.
function isYoutubePlayable(t) {
  return typeof t?.uri === 'string' && t.uri.startsWith('youtube:');
}

// Bound an external generation step (LLM + Spotify discovery) with a soft budget WELL under
// the 30s wall-clock. A hung call — a Spotify 429 Retry-After storm across discovery searches,
// or a stalled LLM — would otherwise block to the wall-clock, which VOIDS the whole run into a
// hard "Generation timed out" error (the catch/fallback never runs, because a hang is not a
// throw). On budget-exceed we reject with a typed error so the existing fallback builds a real
// library playlist instead. Promise.race doesn't cancel the loser; it settles harmlessly.
function withTimeout(promise, ms, label) {
  let t;
  const budget = new Promise((_, reject) => {
    t = setTimeout(() => reject(Object.assign(new Error(`${label} exceeded ${ms}ms budget`), { code: 'gen_budget' })), ms);
    t.unref?.();
  });
  return Promise.race([promise, budget]).finally(() => clearTimeout(t));
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
    console.warn(`[gen] emit playlist_error reqId=${payload?.reqId} reason=${payload?.reason ?? ''} msg="${payload?.message ?? ''}" user=${uid}`);
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
      // A0 signal-integrity state (W4-003): Hampel -> slew -> Kalman, owned by the caller
      // (§0.4 S9) and JSON-round-trippable. Lazily created on the first usable reading.
      // This IS the D7 observation trace now — a rejected/sub-threshold reading updates
      // the Kalman estimate without ever confirming stableHR, which is what used to let
      // 9 bpm steps walk 60 -> 150 silently.
      filterState:      null,
      // D10 throttle: last wall-clock time (Date.now(), not the reading's own recordedAt)
      // this socket wrote a BiometricLog row. null = never written yet.
      lastPersistedAtMs: null,
      // The heart rate the last recalibration was TRIGGERED at — the latched output of the
      // Schmitt trigger (W4-D05), i.e. the band this socket is being served. Distinct from
      // stableHR, which on the watch lane tracks every 5-minute ping: comparing a crossing
      // against the previous READING makes an oscillation look like a fresh crossing every
      // time, so the release margin alone would not have bounded it. Latched on the trigger
      // decision, not on the serve — the Manual-mode gate lives inside recalibrateForBand,
      // and a latch that only warmed in Live mode would flap on the first switch into it.
      servedHR:         null,
      // The bio moodKey (`bio:<band>:<activity>`) whose buffer this socket is currently being
      // served (W4-D34). `servedHR` latches the HR-band TRIGGER; this latches the SERVE, and the
      // two are not the same question now that W4-009 fires recalibration on taxonomy-state
      // transitions: 20 of the 34 states share `band: resting`, so most confirmed transitions
      // leave the key — and therefore the buffer, which §0.2.6 freezes at this coarse shape —
      // completely unchanged. null = nothing served under a keyed buffer yet (also the value
      // after an UNKEYED legacy serve, which is deliberately never latched).
      servedBioMoodKey: null,
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
      // Dual-path mode (Part 2b): false = Manual (user presses Generate), true = Live
      // Biometric (HR band shifts auto-recalibrate from the precompiled buffer). Default
      // Manual so a client that never opts in is NEVER auto-driven (§3, mode-gate). Set
      // by the `live_mode` event; also gates the watch HR-ingest, which drives this same
      // socket (integrationsController.watchHrIngest → handleBiometricReading).
      liveMode:         false,
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

/**
 * Drop ALL socket debounce state — releasing every armed timer first (W4-D06).
 *
 * `debounceMap` is module-global and a debounce timer runs for a full minute, so dropping entries
 * with `debounceMap.delete()`/`.clear()` does NOT stop the timers: it only makes the armed
 * callbacks unreachable while they keep the event loop alive and then fire against whatever state
 * exists a minute later. In production `registerBiometricHandler`'s disconnect handler gets the
 * order right (`clearTimer` THEN `delete`); a caller reaching for the map directly cannot, which is
 * how 60 s timers leaked across a whole wave and fired inside later suites of the same in-band run.
 *
 * Release and clear are therefore ONE operation, not a sequence a caller has to remember — the
 * lesson of W4-D02: a rule nobody can fail loudly is not a control. Built on the same `clearTimer`
 * the disconnect path uses, so there is a single definition of "let go of an armed timer".
 */
function _resetDebounceState() {
  for (const state of debounceMap.values()) clearTimer(state);
  debounceMap.clear();
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

  // Resting-HR fallback: the baseline lives on the ENCRYPTED MedicalProfile (T3.3), not on
  // MusicProfile (which no longer stores plaintext vitals). The getter decrypts on access.
  const profile = await MedicalProfile.findOne({ userId });
  if (profile && isPhysiologicalHR(profile.restingHeartRate)) {
    logBiometricAccess(userId, 'live-heart-context'); // ADR-0005: reading the encrypted resting-HR baseline
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

// ── D-1: session-playlist context attach ──────────────────────────────────────
// Rewrite the user's hidden "Kokonada Session" playlist with this playlist's Spotify
// URIs and attach its contextUri, so the client plays a CONTEXT (absolute queue parity
// on App Remote) instead of loose track URIs. Strictly fail-open: any failure — missing
// scope (pre-reconnect token), API error, no playable URIs — returns the payload
// unchanged and the client falls back to track playback.
async function attachSessionContext(socket, payload) {
  try {
    const uris = (payload?.tracks ?? [])
      .map((t) => t?.uri)
      .filter((u) => typeof u === 'string' && u.startsWith('spotify:track:'));
    if (uris.length < 2) return payload; // a context buys nothing for 0-1 tracks
    const user = await User.findById(socket.data.user._id.toString());
    if (!user || !user.spotifyToken) return payload;
    const sessionPlaylist = require('../services/spotifySessionPlaylist');
    const hasScope = (user.spotifyScopes || '').includes('playlist-modify-private');
    console.warn(`[sessionPlaylist] attaching tracks=${uris.length} playlist-modify-private=${hasScope} existingId=${user.spotifySessionPlaylistId ?? '(none)'}`);
    const { contextUri } = await sessionPlaylist.writeSessionPlaylist(user, uris);
    console.warn(`[sessionPlaylist] context attached ${contextUri} tracks=${uris.length}`);
    return { ...payload, contextUri };
  } catch (e) {
    // Fail-open — playback continues with loose track URIs. Log EVERYTHING needed to
    // root-cause a real Spotify 403: which call (op), the HTTP status, and Spotify's own
    // error body (the generic message alone was undiagnosable on-device).
    const detail = e?.spotifyError ? ` spotify=${JSON.stringify(e.spotifyError)}` : '';
    console.warn(`[sessionPlaylist] attach failed op=${e?.op ?? '?'} status=${e?.statusCode ?? ''} — falling back to track playback: ${e?.message ?? e}${detail}`);
    return payload;
  }
}

// W4-D41: release a serve claim that was never earned. `recalibrateForBand` claims the key
// BEFORE the serve (both its callers are fire-and-forget, so two regime changes in one tick would
// otherwise both read the pre-serve latch and both serve), which means every path that ends
// without delivering music owes the claim back. `bioServeKey` cannot witness that: it is resolved
// deep inside the generation, after four exits that precede it, so a claim released only when a
// bio key exists strands the key for the life of the socket. The claim object IS the witness —
// it knows what it claimed, what was there before, and whether the run ever served.
// Idempotent by design: several exits can race (a wall-clock abort and the abandoned body's own
// `finally`), and only the first release may act.
function _releaseServeClaim(state, claim) {
  if (!claim || claim.served || claim.released) return;
  claim.released = true;
  // Only if the claim is still the standing one: a newer generation that legitimately latched
  // its own key must not be cleared by an older run settling late.
  if (state.servedBioMoodKey === claim.key) state.servedBioMoodKey = claim.previousKey;
}

// ── Core pipeline ──────────────────────────────────────────────────────────────

// `opts.serveClaim` (W4-D41) — set only when this generation is the cold-key fallback of a
// recalibration, i.e. when it runs to discharge a claim someone else already made.
async function generateAndEmitPlaylist(socket, trigger, state, opts = {}) {
  const serveClaim = opts.serveClaim ?? null;
  // In-flight guard: collapse overlapping generations on one socket (rapid mode
  // toggles, a watch ping landing mid-generation, Listen-Live + Save pressed
  // together) so two pipelines never interleave and emit out-of-order playlists.
  if (state.generating) {
    // W4-D41: the earliest exit of all — before the epoch, the emit wrapper or the timer exist.
    // The run this collapses into is generating under whatever key IT resolved, so the claim made
    // for this one was not earned by anybody.
    _releaseServeClaim(state, serveClaim);
    log(`[generate] skipped — already in-flight trigger=${trigger}`);
    // D-6 heartbeat: the caller already adopted the newest reqId into state.lastReqId, and
    // the running generation replies to it (see the emit wrapper). Answer the retry with a
    // building signal so the client's loader stays alive — never a silent drop.
    if (trigger === 'emotion' || trigger === 'heart') {
      emitToUser(socket, 'playlist_building', {
        message: 'Still working on your playlist…',
        reqId: state.lastReqId,
      });
    }
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
  // D-6 reqId adoption: a retry that lands mid-run updates state.lastReqId; the reply must
  // carry the NEWEST reqId or the client's gate drops its own answer as stale.
  // D-1: a playlist_ready first gets the session-playlist contextUri attached (absolute
  // queue parity on App Remote); the attach is fail-open — no context, same payload.
  let readyEmitSettled = Promise.resolve(); // awaited in finally so the deferred ready lands before the lock frees
  // Set once the mood is resolved (see below); non-null only for the heart-rate branch's
  // synthetic `bio:<band>:<activity>` key. Declared out here because `emit` is, and a run that
  // dies before resolving a mood must latch nothing.
  let bioServeKey = null;
  const emit = (event, payload) => {
    if (state.genSeq !== myGen) return;
    if (payload && 'reqId' in payload) payload = { ...payload, reqId: state.lastReqId ?? payload.reqId };
    if (event === 'playlist_ready') {
      // W4-D34: the latch answers "is this key's buffer what is playing", so a playlist that is
      // NOT a bio serve (the emotion branch, bioServeKey null) clears it rather than leaving a
      // stale claim behind — otherwise a mood request would strand the socket, every later
      // resting-band transition reading as a duplicate of music that stopped playing.
      state.servedBioMoodKey = bioServeKey;
      // W4-D41: the claim is earned when the playlist LANDS, not when it is queued — this emit is
      // deferred behind the context attach, and a run superseded during that await (a wall-clock
      // abort mid-Spotify-stall) drops it at the epoch guard below. Marking it here instead would
      // let the abort's release read `served` and no-op, stranding the key on music nobody heard.
      // Safe against the `finally`, which awaits `readyEmitSettled` before releasing anything.
      // Marked on ANY ready: if the key moved mid-run, the assignment above already latched what
      // is actually playing, and releasing would clobber it.
      readyEmitSettled = attachSessionContext(socket, payload)
        .then((p) => {
          if (state.genSeq !== myGen) return;
          emitToUser(socket, event, p);
          if (serveClaim) serveClaim.served = true;
        })
        .catch(() => {});
      return;
    }
    // W4-D34: a bio generation that ERRORS does not throw — it emits this and returns — so the
    // claim `recalibrateForBand` made on its behalf has to be released here or a cold key whose
    // one generation failed would stay claimed forever, and the next transition back to it would
    // be suppressed as a duplicate of a playlist the listener never received. Scoped to runs that
    // resolved a bio key: an emotion request failing says nothing about the bio buffer.
    if (event === 'playlist_error' && bioServeKey) state.servedBioMoodKey = null;
    emitToUser(socket, event, payload);
  };

  // HARD wall-clock bound on the WHOLE generation. Any external stall — an LLM outage, or a
  // Spotify 429 Retry-After storm across dozens of discovery/translation searches (withRetry
  // waits out each Retry-After) — could otherwise hold state.generating for MINUTES, wedging
  // the socket so every later request_playlist hits the in-flight guard and the user never
  // gets a reply. On expiry we free the lock and, for a user-initiated request, surface a
  // recoverable error; the abandoned pipeline settles harmlessly (the epoch guard voids it).
  const GENERATION_TIMEOUT_MS = Number(process.env.GENERATION_TIMEOUT_MS) || 30_000;
  // D-6: a FRESH library (first minutes after signup/connect) generates slowly but
  // healthily — cold pool, first hydration, 429 waits. Voiding the run at 30s discarded
  // real work and looped the user into timeout→retry→timeout forever. During warmup the
  // wall-clock becomes a HEARTBEAT (loader stays alive, run keeps working); the hard
  // abort only fires at the ceiling — the true-wedge case the #63 guard exists for.
  const WARMUP_CEILING_MS = Number(process.env.GENERATION_WARMUP_CEILING_MS) || 180_000;
  const WARMUP_WINDOW_MS  = Number(process.env.GENERATION_WARMUP_WINDOW_MS) || 30 * 60_000;
  const userInitiated = trigger === 'emotion' || trigger === 'heart';
  const startedAt = Date.now();
  let profileWarmingUp = false; // set once the profile row is loaded below
  let timer;
  const onWallClock = () => {
    if (state.genSeq !== myGen) return;   // already settled — nothing to abandon
    if (profileWarmingUp && Date.now() - startedAt < WARMUP_CEILING_MS) {
      console.warn(`[generate] warmup heartbeat at ${Date.now() - startedAt}ms trigger=${trigger} — run continues`);
      if (userInitiated) {
        emitToUser(socket, 'playlist_building', {
          message: 'Warming up your library — your first playlist is on its way…',
          reqId: state.lastReqId ?? reqId,
        });
      }
      timer = setTimeout(onWallClock, GENERATION_TIMEOUT_MS);
      timer.unref?.();
      return;
    }
    // W4-D41: release here, not in the abandoned body's `finally` — that runs whenever the stall
    // finally settles (an LLM outage: minutes), and this exit bypasses the emit wrapper entirely,
    // so nothing downstream could ever hand the claim back.
    _releaseServeClaim(state, serveClaim);
    state.genSeq += 1;                     // supersede: void the in-flight run's emits + its release
    state.generating = false;              // free the lock now so the next request can generate
    console.warn(`[generate] TIMEOUT after ${Date.now() - startedAt}ms trigger=${trigger} reqId=${reqId} — released lock`);
    if (userInitiated) emitToUser(socket, 'playlist_error', { message: 'Generation timed out — please try again', reqId: state.lastReqId ?? reqId });
  };
  timer = setTimeout(onWallClock, GENERATION_TIMEOUT_MS);
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
      // Onboarding (D-6): a brand-new account's profile build takes >10s, so this is an
      // EXPECTED transient state, not a failure. Emit a distinct building signal — the
      // client keeps its loader alive and auto-retries — never a hard playlist_error.
      emit('playlist_building', { message: 'Setting up your library — your first playlist is moments away…', reqId });
      return;
    }
    // D-6: a just-built profile marks this generation as warmup — the wall-clock above
    // heartbeats instead of aborting. Missing createdAt (old rows) → NOT warmup.
    profileWarmingUp = !!musicProfile.createdAt
      && (Date.now() - new Date(musicProfile.createdAt).getTime()) < WARMUP_WINDOW_MS;
    // Always-on diagnostic: surface the library size so an empty/thin profile (the
    // common cause of an empty playlist) is visible in prod logs.
    console.warn(`[generate] profile loaded trigger=${trigger} library=${musicProfile.library?.length ?? 0} topGenres=${(musicProfile.topGenres || []).length} genreSet=${(musicProfile.genreSet || []).length}`);

    // PLAYBACK-first sourcing (YouTube-as-data / Spotify-as-playback architecture):
    // when Spotify is connected it is the playback engine, so we SOURCE from Spotify
    // regardless of which provider built the taste profile — the (now YouTube-weighted)
    // profile's genres/artists still steer that Spotify discovery, and every track is
    // natively playable on the Web Playback SDK. A YouTube-only user (no Spotify) falls
    // back to YouTube sourcing. This supersedes the old resolveMusicProvider desync.
    const playbackProvider = resolvePlaybackProvider(user);
    const provider = playbackProvider || resolveMusicProvider(user);
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
    // W4-D34: the other half of the duplicate-serve latch. A generation that actually delivers
    // a playlist under a synthetic bio key IS that key's buffer starting to play (it warms the
    // buffer on the way out), so a policy-only taxonomy transition arriving straight afterwards
    // would re-serve music the listener already has. Read by `emit` below on every
    // playlist_ready this generation emits — main path, deterministic fallback, no-sink
    // familiar path alike. Null on the emotion branch: that key is not a bio buffer.
    bioServeKey = (typeof moodKey === 'string' && moodKey.startsWith('bio:')) ? moodKey : null;
    // The activity CHIP the user tapped is in lastActivity; latestActivity is watch-detected
    // motion. On the emotion path the chosen chip MUST drive translate()'s biosonic target
    // (running→162bpm cadence, workout→high energy) — otherwise a Run/Workout stays calm.
    const effectiveActivity = useEmotion
      ? (state.lastActivity || state.latestActivity)
      : state.latestActivity;
    // Band-aware discovery: compute the biosonic band ONCE, up front, so vector discovery and
    // the pipeline key off the SAME object (no double translate). OFF → stays null and every
    // downstream call behaves exactly as today (generateV2's default targets is null → recompute).
    const bandTargets = DISCOVERY_BAND_AWARE()
      ? await orchestrator.buildTargets({ userId, live: { heartRate: state.stableHR, activity: effectiveActivity }, moodKey, taps: state.lastEmotionTaps })
      : null;
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
          if (VECTOR_DISCOVERY()) {
            // Spotify-independent discovery over our own corpus (dead /v1/recommendations
            // replacement). Never throws; yields [] on any failure so the fallback ladder
            // still fills the playlist.
            return vectorDiscoveryFetch({ musicProfile, aiParams: params, blacklistCanonicalKeys: [], targets: bandTargets });
          }
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
        // YouTube-as-data, no Spotify playback: keep the OAuth token warm for first-party taste
        // import, but discovery no longer burns a per-generation search.list (100 quota units).
        // Candidates come from the SAME provider-agnostic mbid vector corpus the Spotify path uses.
        //
        // INTERIM (no YouTube serve-time resolver, by design): that corpus resolves mbid rows to
        // SPOTIFY URIs only, so for a YouTube-only user we keep ONLY candidates already playable on
        // YouTube (a youtube: URI) — filtered HERE so uri:null and spotify: rows never inflate the
        // discovery count nor reach the client as an unplayable entry. Today that is typically 0 →
        // the familiar ladder fills the playlist (never an error). A YouTube serve-time resolver is
        // a deliberate FUTURE product decision (it would re-introduce the search.list quota burn +
        // the substitute-service ToS exposure this wave removes).
        await youtube.getValidToken(user);
        fetchTracks = async (params) => {
          const raw = await vectorDiscoveryFetch({ musicProfile, aiParams: params, blacklistCanonicalKeys: [], targets: bandTargets });
          const list = Array.isArray(raw) ? raw : [];
          const playable = list.filter(isYoutubePlayable);
          console.warn(`[discovery] youtubePlayable=${playable.length}/${list.length} reqId=${reqId}`);
          return playable;
        };
      }
    } catch (err) {
      emit('playlist_error', { message: `Token refresh failed: ${err.message}`, reqId });
      return;
    }

    log(`[generate] start trigger=${trigger} hr=${state.stableHR} activity=${state.latestActivity} mode=${mode} reqId=${reqId}`);

    // Serve-time side effects, recorded by EVERY playlist_ready (the normal LLM/discovery path AND
    // the no-playback familiar-only short-circuit): warm the live-biometric buffer, persist the
    // session (History + anti-repetition), queue feature hydration, and record serves in the
    // exposure ledger. One definition so the two ready-paths can NEVER diverge on side effects — a
    // divergence that would silently drop anti-repetition/history for a served no-playback playlist.
    // All fire-and-forget: a failed side effect is reported but never fails generation.
    const recordServeSideEffects = (builtPlaylist, clientTracks, params) => {
      // Warm the live-biometric buffer (Part 3): an HR-driven generation is cached under its bio-mood
      // key so a Live-mode toggle plays instantly. Storing records NO serves (§3.5). Emotion → skip.
      if (!useEmotion && isPhysiologicalHR(state.stableHR)) {
        shadowBufferRepo.setBuffer(userId, moodKey, {
          tracks:    clientTracks,
          familiar:  builtPlaylist.familiar.length,
          discovery: builtPlaylist.discovery.length,
          targets:   builtPlaylist.targets,
          builtAt:   Date.now(),
        }).catch(() => {});
      }
      // Session-history honesty: only record the emotion taps / prompt when the emotion pipeline
      // actually drove this generation. A heart/biometric mix must not be labelled with stale mood.
      PlaylistSession.create({
        userId,
        emotionTaps:       useEmotion && state.lastEmotionTaps.length > 0 ? state.lastEmotionTaps : [{ x: 0, y: 0 }],
        contextPrompt:     useEmotion ? (state.lastTextPrompt || '') : '',
        moodKey,
        biometricSnapshot: { heartRate: state.stableHR, activity: effectiveActivity },
        targetBpm:         params.target_bpm,
        targetGenres:      params.seed_genres || [],
        targetValence:     params.target_valence,
        targetEnergy:      params.target_energy,
        musicProvider:     provider,
        trackIds:          builtPlaylist.merged.map(t => t.id).filter(Boolean),
        // Canonical keys mirroring trackIds — the cross-provider identity the serve ledger dedupes on.
        trackKeys:         builtPlaylist.merged.map(t => t.canonicalKey ?? canonicalKey(t)).filter(Boolean),
        // Denormalized display summary for the History feed (A11); cap at 50.
        trackSummary:      clientTracks.slice(0, 50).map(t => ({ id: t.id, title: t.title, artist: t.artist })),
      }).catch(e => {
        console.error('[PlaylistSession] save failed:', e.message);
        // A dropped session write silently breaks anti-repetition — report it rather than swallow.
        captureException(e, { scope: 'playlistSession.save', userId: String(userId) });
      });
      // Dark launch: queue audio-feature hydration for anything just served the store hasn't seen.
      featureService.enqueueHydration(builtPlaylist.merged).catch(() => {});
      // Serve ledger (write path): record every served track under this generation's mood context.
      serveLedger.recordServes({
        userId,
        sessionId: String(reqId ?? ''),
        entries: builtPlaylist.merged.map(t => ({
          canonicalKey: t.canonicalKey ?? canonicalKey(t),
          moodKey,
          bioState: { tempoBand: bandFromHeartRate(state.stableHR), activity: state.latestActivity ?? null },
        })),
      }).catch(e => console.error('[serveLedger] record failed:', e.message));
    };

    // ── Deterministic emotion-fallback (§5 Fork 4B) ───────────────────────────────
    // The fallback module's playability PORT: keep ALL provider/token I/O here — translate onto
    // the Spotify sink (if any) then normalize to the client contract. featured=0 (no AudioFeature
    // coverage) ⇒ an honest "From your favorites" receipt (Fork 2: never overclaim a precise
    // emotion match when the tracks carry no features); featured>0 ⇒ the trigger-tuned receipt.
    const resolveFallbackPlayable = async (rawTracks, { featured = 0 } = {}) => {
      let merged = Array.isArray(rawTracks) ? rawTracks : [];
      if (provider === 'spotify' && spotifyToken && merged.length) {
        try {
          const { tracks } = await translateToSpotify(merged, spotifyToken);
          if (tracks.length) merged = tracks;
        } catch { /* keep raw; native-Spotify entries still resolve at toClientTracks */ }
      }
      const context = featured > 0
        ? { trigger, params: useEmotion ? buildMoodParams(state.lastEmotionTaps, musicProfile) : {} }
        : { source: 'favorites' };
      // Carry the SERVED (post-translate) canonical identity onto each surviving client track so the
      // fallback's serve ledger records EXACTLY what was served (LOW-1) — not a raw candidate dropped
      // at translation/client-contract — keyed by the SAME identity the normal path records.
      return merged
        .map((t) => {
          const ct = toClientTrack(t, provider, context);
          if (ct) ct.canonicalKey = t.canonicalKey ?? canonicalKey(t);
          return ct;
        })
        .filter(Boolean);
    };

    // The never-empty, emotion-honoring, library-only guarantee. Reached when normal generation
    // THROWS (G-1/G-4) or delivers an EMPTY PLAYABLE set (G-2). The bounded 3-tier ladder re-runs
    // selection and checks the CLIENT-PLAYABLE count each tier (the downstream loop generateV2's L4
    // can't see). A delivered fallback records the SAME serve side-effects as the normal path — or
    // anti-repetition + history silently break for served fallbacks. Empty history → soft error.
    const emitDeterministicFallback = async (emptyMessage) => {
      const fb = await buildDeterministicFallback({
        userId, musicProfile,
        taps:    state.lastEmotionTaps,
        moodKey, provider,
        targets: bandTargets,
        crossPlatform: provider === 'spotify' && !!spotifyToken,
        live:    { heartRate: state.stableHR, activity: effectiveActivity },
        now:     Date.now(),
        resolveToPlayable: resolveFallbackPlayable,
      });
      console.warn(`[selection.v2] fallback fallbackTier=${fb.fallbackTier} featured=${fb.featured} tracks=${fb.tracks.length} reason=${fb.reason ?? ''} reqId=${reqId}`);
      if (fb.tracks.length > 0) {
        emit('playlist_ready', {
          trigger, mode, reqId,
          params:       fb.params,
          tracks:       fb.tracks,
          familiar:     fb.tracks.length,
          discovery:    0,
          fallback:     true,
          fallbackTier: fb.fallbackTier,
        });
        recordServeSideEffects(fb.built, fb.tracks, fb.params);
        return;
      }
      emit('playlist_error', emptyPlaylistError(user, reqId, emptyMessage));
    };

    // ── Structural dead-end short-circuit: no playback sink ⇒ skip the LLM + vector ──
    // A user with NO playback provider (resolvePlaybackProvider falsy — a YouTube-only
    // account, since Spotify is the only playback engine) can NEVER receive a playable
    // DISCOVERY track: the shared corpus has NO youtube: rows (removed for ToS containment,
    // #151), and serve-time Spotify resolution is ephemeral/per-user and is never written
    // back onto the anonymous cross-user catalog (#155) — so a corpus row can never carry a
    // youtube: URI, and the isYoutubePlayable gate (#143/#150) filters discovery to EMPTY by
    // construction. Even an unfiltered candidate would be dropped at toClientTracks (no Spotify sink).
    // Running the Groq LLM generation + the vector-index query first is therefore pure
    // wasted spend on a request that is 100% guaranteed to reach NO_PLAYABLE_PROVIDER.
    // Skip BOTH and build familiar-only — the SAME selection pipeline (generateV2) with
    // ZERO discovery input, which invokes neither the LLM nor vectorDiscoveryFetch; if
    // nothing is playable there either, emit the exact NO_PLAYABLE_PROVIDER result #150
    // already built (unchanged in content/reason/reqId). This is ORTHOGONAL to a Spotify
    // user whose discovery pool is empty for an unrelated reason: playbackProvider is
    // truthy for them, so they keep the full LLM/vector path + generic empty handling below.
    if (!playbackProvider) {
      let familiarPlaylist = null;
      let familiarTracks = [];
      try {
        familiarPlaylist = await orchestrator.generateV2({
          userId, musicProfile, moodKey, provider,
          aiParams: {},
          discoveryTracks: [],
          live: { heartRate: state.stableHR, activity: effectiveActivity },
          targets: bandTargets,
          crossPlatform: false, // no Spotify sink to translate onto
        });
        familiarTracks = toClientTracks(familiarPlaylist?.merged, provider, { trigger, params: {} });
      } catch (e) {
        // Observability parity with the LLM path (this file's standard): a systemic generateV2
        // failure for no-playback users must NOT masquerade as a plain empty playlist. Always-on
        // warn + Sentry capture so it's visible in prod; the user still gets the honest
        // NO_PLAYABLE_PROVIDER below (familiarTracks stays []).
        console.warn(`[generate] no-playback familiar-only build failed reqId=${reqId}: ${e.message}`);
        captureException(e, { scope: 'generate.noPlayback', reqId, provider });
      }
      if (familiarTracks.length > 0) {
        log(`[generate] no playback provider → familiar-only tracks=${familiarTracks.length} reqId=${reqId}`);
        emit('playlist_ready', {
          trigger, mode, reqId,
          tracks:    familiarTracks,
          familiar:  familiarTracks.length,
          discovery: 0,
          fallback:  true,
        });
        // Side-effect parity: a delivered playlist_ready records the SAME session/ledger/hydration/
        // buffer side effects as the normal path (a legacy Spotify library row can survive here).
        recordServeSideEffects(familiarPlaylist, familiarTracks, {});
      } else {
        console.warn(`[generate] no playback provider + no playable familiar → NO_PLAYABLE_PROVIDER (skipped LLM+vector) reqId=${reqId}`);
        emit('playlist_error', emptyPlaylistError(user, reqId, 'Could not build a playlist from the current sources — try again'));
      }
      return;
    }

    // (Variation seeds + sort-axis rotation are gone: the LLM prompt cache is now
    // deterministic per context, and variance comes from the ledger + MMR.)

    // Soft budget for the whole AI/discovery step. Comfortably under GENERATION_TIMEOUT_MS
    // (30s) so a stall falls through to the fast library fallback with time to spare, instead
    // of hitting the wall-clock and hard-erroring. A warmup profile keeps the fuller budget.
    const AI_BUDGET_MS = Number(process.env.GENERATION_AI_BUDGET_MS)
      || (profileWarmingUp ? 60_000 : 18_000);
    let aiResult;
    try {
      if (useEmotion) {
        // 24h health snapshot (sleep/HRV/body battery/readiness + current HR) so the
        // LLM weighs physical state against the chosen mood + activity. Best-effort.
        const biometricContext = await resolveBiometricContext(userId, state.stableHR);
        aiResult = await withTimeout(buildEmotionPlaylist({
          musicProfile,
          emotionTaps:  state.lastEmotionTaps,
          textPrompt:   state.lastTextPrompt || null,
          activity:     state.lastActivity || null,
          biometricContext,
          fetchTracks,
        }), AI_BUDGET_MS, 'buildEmotionPlaylist');
      } else {
        // Wave-0 HR branch maps the CURRENT heart rate to a coarse band server-side
        // (adjustBiometricPlaylist → applyBiometricBands). W4-016: that band now routes
        // through biometricBand's real preference chain — stateLabel (the taxonomy state this
        // wave maintains, from bandTargets.stateId when band-aware discovery has resolved a
        // confident one) then hrRatio (this user's HR relative to THEIR OWN resting baseline,
        // W4-004's peekBaselines) then raw HR — instead of the fixed population ladder that
        // scored an athlete and a sedentary user identically at the same raw HR. Both reads
        // are best-effort and gated by the same kill switch geminiEngine.js honours, so a
        // cold-start user (no baseline, no resolved state) or a disabled flag degrades this
        // object to exactly {heartRate, activity} — today's behaviour byte-for-byte.
        let stateLabel = null;
        let hrRatio = null;
        if (process.env.WAVE4_LLM_BAND_FROM_STATE_DISABLED !== 'true') {
          stateLabel = bandTargets?.stateId || null;
          try {
            const personalBaselines = await peekBaselines(userId);
            const rhr = Number(personalBaselines?.rhrMedian);
            if (Number.isFinite(rhr) && rhr > 0 && isPhysiologicalHR(state.stableHR)) {
              hrRatio = Math.round((state.stableHR / rhr) * 100) / 100;
            }
          } catch { /* degrade to raw-HR band */ }
        }
        aiResult = await withTimeout(adjustBiometricPlaylist({
          musicProfile,
          biometric: {
            heartRate:  state.stableHR,
            activity:   state.latestActivity,
            stateLabel,
            hrRatio,
          },
          fetchTracks,
        }), AI_BUDGET_MS, 'adjustBiometricPlaylist');
      }
    } catch (err) {
      // A discovery/LLM stall (budget exceeded) → trip the discovery-skip gate so the NEXT
      // generation bypasses the stalled Spotify discovery layer and is fast, and log it plainly.
      if (err.code === 'gen_budget') {
        spotify.markDiscoveryUnavailable();
        console.warn(`[generate] ${err.message} — discovery skipped going forward; serving library fallback reqId=${reqId}`);
      } else {
        // The generation pipeline threw (LLM/Spotify/mixer). We recover below, but this
        // path was previously only console-logged — report it so a systemic failure that
        // silently degrades every user to the fallback playlist is visible in Sentry. A
        // budget timeout is an expected, handled condition (logged above) — not an exception.
        captureException(err, { scope: 'generate', trigger, reqId, provider });
      }
      // Deterministic personal fallback (G-1/G-4): emotion-honoring, library-only, never random.
      // The bounded ladder subsumes the old on-vibe mood attempt AND the emotion-blind top-affinity
      // terminal — and, critically, records serve side-effects so anti-repetition/history hold for a
      // served fallback (the old terminal silently dropped them). The heart path is honored via the
      // synthetic bio:* moodKey targets (no more moodKey=null → emotion-blind dump).
      await emitDeterministicFallback(err.message);
      return;
    }

    const cachedDiscovery = aiResult.tracks;
    // The v2 engine is the ONLY serving path (Phase 7 sealed the flip): full
    // biosonic targets + ledger windows + scoring + MMR.
    const playlist = await orchestrator.generateV2({
      userId, musicProfile, moodKey, provider,
      aiParams: aiResult.params,
      discoveryTracks: cachedDiscovery,
      live: { heartRate: state.stableHR, activity: effectiveActivity },
      // The SAME band discovery filtered against (band-aware ON), so the pipeline enforces an
      // identical window — no second translate, no drift. Null when OFF ⇒ generateV2 recomputes.
      targets: bandTargets,
      // Spotify sink + a live token ⇒ the post-mix translation step runs, so familiar
      // cross-provider (YouTube) tracks must survive selection to be resolved to Spotify.
      crossPlatform: provider === 'spotify' && !!spotifyToken,
    });
    if (playlist.telemetry) {
      // Always-on: pool/featured/filtered/relax pinpoint an empty or thin playlist in prod
      // without DEBUG_PLAYLIST. featured=0 (with pool>0) means AudioFeature is unpopulated →
      // the scorer can't differentiate mood/HR (the "same playlist" symptom). relax=4 means the
      // last-resort level fired (whole pool was inside the serve window); pool=0 means the
      // library partition itself came back empty.
      console.warn(`[selection.v2] pool=${playlist.telemetry.poolSize} featured=${playlist.telemetry.featured} banded=${playlist.telemetry.banded} filtered=${playlist.telemetry.afterFilters} relax=${playlist.telemetry.relaxLevel} widened=${playlist.telemetry.bandWidened} ms=${playlist.telemetry.stageMs?.total} reqId=${reqId}`);
    }
    // Diagnostic (always-on): the parsed biosonic target vector + the moodKey + the last tap
    // it derived from. A CONSTANT band across different mood requests ⇒ a constant moodKey ⇒
    // the tap intent isn't varying upstream — this line pinpoints exactly where mood is lost.
    const _lastTap = state.lastEmotionTaps?.[state.lastEmotionTaps.length - 1] ?? null;
    console.warn(`[gen.targets] reqId=${reqId} taps=${state.lastEmotionTaps?.length ?? 0} last=${JSON.stringify(_lastTap)} activity=${effectiveActivity} moodKey=${moodKey} bpmCenter=${playlist.targets?.bpmCenter} bpmWidth=${playlist.targets?.bpmWidth} energy=[${playlist.targets?.energyFloor}..${playlist.targets?.energyCeiling}] valence=${playlist.targets?.valenceTarget} conf=${playlist.targets?.confidence} tempoBand=${playlist.targets?.tempoBand}`);

    // Cross-platform translation: playback happens on Spotify's SDK, so every track must
    // carry a spotify: URI. This is a cheap O(n) passthrough for native Spotify tracks (no
    // network) and resolves any YouTube-sourced track to a playable Spotify URI via search.
    // Guarded to the Spotify playback path; a dropped (unmatched) track never blocks the rest.
    if (provider === 'spotify' && spotifyToken && playlist?.merged?.length) {
      try {
        const { tracks: playable } = await translateToSpotify(playlist.merged, spotifyToken);
        if (playable.length) playlist.merged = playable;
        // Serve-time Spotify resolution is EPHEMERAL and per-user: the resolved spotify: URI is used
        // for THIS playback only and is NEVER written back onto the anonymous cross-user discovery
        // catalog. Caching it there would re-introduce Spotify Content into the shared corpus
        // (ADR-0011 containment) and breach ADR-0010's Discovery ⊥ Runtime-Resolver boundary — and,
        // being market-specific, would serve one user's region to another. youtube: discovery tracks
        // therefore re-resolve on every serve, exactly like mbid: discovery tracks already do.
      } catch (e) {
        log(`[generate] cross-platform translation skipped: ${e.message}`);
      }
    }

    // Discovery captions (Step 2, dark-launched behind DISCOVERY_CAPTION_LLM): ONE batched Groq
    // call writes a short witty "why this discovery" line per discovery track from its audio
    // FEATURES + this session's mood/activity/HR context ONLY — never a title/artist/genre (§II).
    // Hard-budgeted inside the service and fail-open here: a timeout/error yields no captions and
    // NEVER blocks or fails generation. Attached before toClientTracks so buildReceipt emits them.
    if (DISCOVERY_CAPTION_LLM() && Array.isArray(playlist?.merged)) {
      const allDiscovery = playlist.merged.filter((t) => t?.isDiscovery);
      // A track can only be captioned once selection ATTACHED its features (pipeline.js:95);
      // a featureless catalog entry (no AudioFeature doc) is skipped, not sent to the model.
      const captionable = allDiscovery.filter((t) => t.recordingKey && t.features);
      let captioned = 0;
      if (captionable.length) {
        try {
          // L2 (ACCEPTED, audit): with the flag ON this awaits up to DISCOVERY_CAPTION_BUDGET_MS
          // of serial latency BEFORE playlist_ready. Dark-launch-acceptable; revisit for rollout
          // (this could move off the critical path — emit first, patch captions after).
          const captions = await captionService.captionDiscovery(captionable, {
            moodKey,
            emotionTaps: state.lastEmotionTaps,
            activity:    effectiveActivity,
            hrBand:      bandFromHeartRate(state.stableHR),
            targets:     playlist.targets,
          });
          for (const t of captionable) {
            const cap = captions?.get?.(t.recordingKey);
            if (typeof cap === 'string' && cap) { t.caption = cap; captioned += 1; }
          }
        } catch (e) {
          log(`[generate] discovery captions skipped: ${e.message}`);
        }
      }
      // Always-on: how many discovery tracks actually got an LLM caption out of the total, so a
      // live no-op (0/N — a featureless catalog, or a budget/parse miss) is observable in prod
      // without DEBUG. NO track data — §II keeps titles/artists/genres out of logs, not just the model.
      console.warn(`[discovery.caption] captionedDiscovery=${captioned}/${allDiscovery.length} reqId=${reqId}`);
    }

    // Normalize to the client contract (and reconstruct/validate uris). Guard on
    // the PLAYABLE result: never push an empty/unplayable playlist — it would blank
    // the queue and spin the overlay forever. Surface a recoverable error instead.
    const clientTracks = toClientTracks(playlist?.merged, provider, { trigger, params: aiResult.params, targets: playlist?.targets });
    if (clientTracks.length === 0) {
      // Always-on diagnostic: show WHY the playlist is empty (library size, discovery
      // candidates, post-mix bucket sizes, and the mood filters) so prod logs pinpoint
      // the cause without DEBUG_PLAYLIST.
      console.warn(`[generate] EMPTY playlist trigger=${trigger} provider=${provider} useEmotion=${useEmotion} `
        + `library=${musicProfile.library?.length ?? 0} discoveryCandidates=${cachedDiscovery?.length ?? 0} `
        + `mixedFamiliar=${playlist?.familiar?.length ?? 0} mixedDiscovery=${playlist?.discovery?.length ?? 0} `
        + `seed_genres=${JSON.stringify(aiResult.params?.seed_genres)} exclude_genres=${JSON.stringify(aiResult.params?.exclude_genres)}`);
      // G-2: the main path succeeded but resolved to an EMPTY PLAYABLE set (every track dropped at
      // translation/provider — the downstream loop generateV2's L4 can't see). Try the deterministic
      // personal fallback (never random, library-only) BEFORE erroring; a user with ANY history is
      // never left empty. Zero history → the fallback returns empty and this emits the soft error.
      await emitDeterministicFallback('Could not build a playlist from the current sources — try again');
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

    // Serve-time side effects (buffer warm + session + feature hydration + serve ledger) — the SAME
    // set the no-playback short-circuit records, via one shared helper so the two ready-paths cannot
    // diverge. Fire-and-forget inside the helper; never blocks or fails generation.
    recordServeSideEffects(playlist, clientTracks, aiResult.params);
  } finally {
    await readyEmitSettled; // the context-attach ready emit must land before the lock frees
    clearTimeout(timer);
    // Release only if we still own the lock: a timed-out run (epoch bumped) must not clear a
    // newer generation's in-flight flag when its abandoned body finally settles.
    if (state.genSeq === myGen) {
      state.generating = false;
      // W4-D41: the catch-all for every exit that returned without a playlist — `!user`,
      // `!provider`, `!musicProfile` (a `playlist_building`, not even an error, so no release
      // path could have fired), and any throw on the way out. A no-op once the run has served.
      _releaseServeClaim(state, serveClaim);
    }
  }
}

// ── Live-mode band recalibration (Part 2b / Part 3, §3.4) ─────────────────────
// On a CONFIRMED heart-rate band transition, a Live-mode socket SERVES the precompiled
// buffer for the new band instantly instead of generating fresh. Reuses the Part-3
// shadow buffer (warmed inline by prior HR generations at zero extra Groq cost).
//   • Mode-gate (§3): Manual sockets are NEVER auto-driven — they return immediately.
//   • Warm buffer   → emit it as a `biometric` playlist and record serves ON THE PLAY
//                     (§3.5) — the precompile store recorded none; this is the sole point
//                     the buffer's tracks enter the exposure ledger.
//   • Cold band     → never a silent wait: emit `live_assembling` (the neural loader's
//                     "assembling your live biometric soundscape") then run ONE live
//                     generation, which emits the playlist, records its own serves, and
//                     warms THIS band's buffer for the next visit.
async function recalibrateForBand(socket, state) {
  if (!state.liveMode) return; // mode-gate: Manual users are never auto-driven

  const userId     = socket.data.user._id.toString();
  const bioMoodKey = syntheticBioMoodKey(state.stableHR, state.latestActivity);

  // W4-D34 duplicate-serve latch. A recalibration is now triggered by two independent things:
  // an HR-band/activity crossing (which always moves this key) and a CONFIRMED taxonomy-state
  // transition (W4-009, which usually does not — 20 of the 34 states are `band: resting`, so
  // the common transition changes only the state's musicPolicy). The buffer is keyed
  // `bio:<band>:<activity>` and §0.2.6 freezes that shape, so on a policy-only transition
  // there is literally nothing different to serve: re-emitting is the same playlist pushed at
  // the listener again, and — worse — a second `recordServes` batch through an append-only
  // ledger, inflating exposure for exactly the tracks that fit this user best (`score`
  // subtracts `w_exp * exposure`). So a key already being served is a no-op.
  //
  // A NULL key is never latched: it means "no usable HR", which degrades to the legacy
  // unkeyed generation rather than to a buffer. Treating `null === null` as "already serving
  // it" would silence that path for the rest of the socket's life. Assigning it here instead
  // CLEARS the latch, which is correct — what is playing is no longer any key's buffer.
  const duplicateServe = bioMoodKey !== null && state.servedBioMoodKey === bioMoodKey;
  if (duplicateServe && !_serveLatchDisabled()) return;
  // Claimed BEFORE the first await: both callers are fire-and-forget, so two regime changes
  // arriving in the same tick would otherwise both read the pre-serve latch and both serve.
  const previousServedKey = state.servedBioMoodKey;
  state.servedBioMoodKey  = bioMoodKey;
  // W4-D41: the claim travels WITH the serve. A thrown serve is one of six ways to end without
  // delivering music, and it was one of only two that released — the other four live inside the
  // generation, before it resolves any bio key, so they need a witness that predates it.
  const claim = { key: bioMoodKey, previousKey: previousServedKey, served: false, released: false };

  try {
    await _serveForBand(socket, state, userId, bioMoodKey, claim);
  } catch (err) {
    // Nothing reached the listener, so the claim was not earned — release it, or a later
    // legitimate transition back to this key would be swallowed by a serve that never was.
    // (Guarded by `served`: a throw AFTER the playlist landed — a failing side effect on the way
    // out — must not un-latch music the listener is already hearing.)
    _releaseServeClaim(state, claim);
    throw err;
  }
}

// The serve itself, split out of `recalibrateForBand` only so the latch above reads as one
// decision rather than a flag threaded through the body. Unchanged behaviour: warm → play the
// buffer + record the serves; cold → loader + exactly one live generation.
async function _serveForBand(socket, state, userId, bioMoodKey, claim = null) {
  let buffer = null;
  if (bioMoodKey) {
    try { buffer = await shadowBufferRepo.getBuffer(userId, bioMoodKey); }
    catch { buffer = null; } // a down/erroring buffer store degrades to a cold miss → live gen
  }

  const tracks = Array.isArray(buffer?.tracks) ? buffer.tracks : [];
  if (tracks.length === 0) {
    // COLD: no buffer for this band yet. Show the loader, then fall back to one live gen.
    emitToUser(socket, 'live_assembling', { message: 'assembling your live biometric soundscape' });
    // W4-D41: hand the claim down. This generation is the only thing that can earn it, and it is
    // also where every unreleased exit lives.
    await generateAndEmitPlaylist(socket, 'biometric', state, { serveClaim: claim });
    return;
  }

  // WARM: play the precompiled buffer instantly — no generation, no Groq spend. The
  // `biometric` trigger marks it as an auto-drive the client accepts without a reqId.
  const mode  = state.lastMode ?? 'live';
  const reqId = state.lastReqId;
  // D-1: buffered serves get the session-playlist context too (fail-open) so Live-mode
  // playback also runs with absolute queue parity, not loose track URIs.
  const readyPayload = await attachSessionContext(socket, {
    trigger:   'biometric',
    mode,
    reqId,
    tracks,
    familiar:  buffer.familiar ?? 0,
    discovery: buffer.discovery ?? 0,
    buffered:  true,
  });
  emitToUser(socket, 'playlist_ready', readyPayload);
  if (claim) claim.served = true; // W4-D41: the buffer is playing — the claim is earned.

  // Serve-on-play (§3.5): the buffer is now PLAYED, so its tracks enter the ledger here —
  // and ONLY here. A store/precompile never records serves (that would pollute the
  // exposure ledger with never-heard tracks and re-trigger the saturation Part 1 fixed).
  serveLedger.recordServes({
    userId,
    sessionId: String(reqId ?? ''),
    entries: tracks.map((t) => ({
      canonicalKey: t.canonicalKey ?? canonicalKey(t),
      moodKey: bioMoodKey,
      bioState: { tempoBand: bandFromHeartRate(state.stableHR), activity: state.latestActivity ?? null },
    })),
  }).catch((e) => console.error('[serveLedger] buffer-serve record failed:', e.message));
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
  // heartRate is the attacker-controlled physiological value — validate strictly,
  // against the SAME range every consumer requires (D9). Accepting 0–300 here while
  // consumption demanded 30–220 meant an out-of-range reading was acked and then
  // silently dropped downstream, which reads to the user as "the app stopped reacting".
  if (!isPhysiologicalHR(n.heartRate)) return false;
  // recordedAt isn't persisted on the socket path, but if present it must be a
  // real Date (rejects `new Date('garbage')` from a bad provider timestamp).
  if (n.recordedAt !== undefined &&
      (!(n.recordedAt instanceof Date) || Number.isNaN(n.recordedAt.getTime()))) {
    return false;
  }
  return true;
}

// ── A0 signal integrity (W4-003) ────────────────────────────────────────────────
//
// Run one reading through the shared Hampel -> slew -> Kalman filter and return the
// FILTERED estimate the debounce/trigger machinery is entitled to trust — the raw value
// never drives a decision directly again (D6). PURE apart from the env-flag read; the
// caller owns `state.filterState` (S9: `now` is a required, explicit parameter here too).
//
// PASS-THROUGH is deliberate, not a shortcut: a reading with no USABLE device timestamp
// (a source predating this contract, or a synthetic caller that never set recordedAt) has
// no `dt` for the model to reason about, so a `now`-derived one would corrupt the slew/
// Kalman gates with an arrival-time artifact instead of a sampling-time one. Falling back
// to the raw value — exactly today's behaviour — is honester than inventing a timestamp.
// Every REAL adapter (garmin/apple_health/suunto — see wearable/adapter.js) always sets
// recordedAt, so this path is inert in production; it exists for forward/backward
// compatibility with a caller that predates the anomaly filter (the telemetry DTO's own
// stated policy — see _shared/dto/telemetry.js).
function _filterHeartRate(state, normalized, now) {
  const passthrough = () => ({
    level: normalized.heartRate, trend: 0, confidence: 1, accepted: true, degraded: null,
    reason: null, passthrough: true,
  });

  if (_anomalyFilterDisabled()) return passthrough();
  const recordedAt = normalized.recordedAt;
  if (!(recordedAt instanceof Date) || Number.isNaN(recordedAt.getTime())) return passthrough();

  const prior = state.filterState ?? createFilterState('heartRate');
  const { state: nextFilterState, result } = filterReading(
    prior, { value: normalized.heartRate, atMs: recordedAt.getTime() }, { now },
  );
  state.filterState = nextFilterState;
  return { ...result, passthrough: false };
}

// D10: persist an ACCEPTED, genuinely-timestamped live reading to BiometricLog — the raw
// device value, not the filtered estimate (this table is the ground-truth record; baseline
// engines are the ones entitled to smooth it). Throttled to LIVE_PERSIST_MIN_INTERVAL_MS
// per socket and deduped on the batch lane's own `source@recordedAt` convention so a
// reconnect replaying the same reading cannot double-write. Fire-and-forget: a persistence
// failure must never block the trigger/generation pipeline it is downstream of.
async function _maybePersistLiveReading(userId, normalized, filtered, state, nowMs) {
  if (filtered.passthrough || !filtered.accepted) return;
  if (state.lastPersistedAtMs !== null && nowMs - state.lastPersistedAtMs < LIVE_PERSIST_MIN_INTERVAL_MS) return;
  state.lastPersistedAtMs = nowMs;

  try {
    const recordedAt = normalized.recordedAt;
    const exists = await BiometricLog.exists({ userId, source: normalized.source, recordedAt });
    if (exists) return;
    await insertManyAccounted(BiometricLog, [{
      userId,
      heartRate:  normalized.heartRate,
      activity:   normalized.activity ?? 'unknown',
      source:     normalized.source,
      recordedAt,
      // W4-004: the wearer's own offset when the client sends one; null (server-hour fallback)
      // for every client shipped today. Mobile emission is an on-device checklist item.
      tzOffsetMinutes: normalized.tzOffsetMinutes ?? null,
    }], { label: 'BiometricLog.live' });
  } catch (e) {
    console.error('[biometricHandler] live persistence failed:', e.message);
  }
}

// The CONFIRMED-transition trigger (D11). Recalibration serves a shadow buffer keyed
// `bio:<band>:<activity>` (syntheticBioMoodKey), so the only changes that can produce a
// DIFFERENT serve are a band crossing or an activity change. The old ±10/±25 bpm gates
// were keyed on nothing the buffer knows about, and that cost both ways: 60→85 bpm burned
// a recalibration on an identical key, while 115→125 crossed the 120 cut on the watch lane
// and was ignored because it moved less than 25 bpm.
//
// The delta guard survives as a NOISE FLOOR: a crossing smaller than the sensor's own
// error is the PPG breathing across the cut, not a state change, and must not flap the band.
//
// W4-D05 made the crossing ASYMMETRIC. W4-001's version fired on any crossing in either
// direction, which is a symmetric comparator sitting on a noisy signal — the textbook way to
// build an oscillator. The costs are not symmetric either: entering a higher band late means
// the music ignores a real activation (the exact D11 complaint), while leaving one early
// abandons a mix the body has not actually left. So: fast attack, slow release.
//
// PURE — exported for unit testing. W4-009 landed the taxonomy-state-transition trigger
// (`liveStateOnlineUpdate`, above the immediate/debounce branch below) as an ADDITIONAL signal
// rather than a replacement of this function: this HR-band gate stays the fast, Redis-free
// fallback — degrading to it is exactly what a disabled affect layer or a down Redis client
// falls back to (fail-soft, §0.4 S11).
function _shouldRecalibrate({ prevHR, nextHR, activityChanged = false }) {
  if (activityChanged) return true;
  const nextBand = bandFromHeartRate(nextHR);
  if (nextBand === null) return false;            // an unusable reading is never a trigger
  const prevBand = bandFromHeartRate(prevHR);
  if (prevBand === null) return true;             // no confirmed serve state yet
  if (prevBand === nextBand) return false;
  const prev = Number(prevHR);
  const next = Number(nextHR);
  // ATTACK — into a higher band: unchanged from W4-001, the noise floor is the only gate.
  if (next > prev) return next - prev >= HR_NOISE_FLOOR;
  // RELEASE — back down: the reading must clear the band's own cut by the margin. Measured
  // from the cut rather than from prevHR so the threshold is a property of the BAND, which
  // is what the buffer is keyed by; a delta from the last reading is what flapped.
  if (_hysteresisDisabled()) return prev - next >= HR_NOISE_FLOOR;
  const cut = BAND_LOWER_CUT[prevBand];
  if (cut === null || cut === undefined) return true;  // nothing below resting to defend
  return next < cut - HR_BAND_RELEASE_MARGIN;
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
  const now   = Number.isFinite(opts.now) ? opts.now : Date.now();
  // A0 (W4-003): every downstream decision — trigger, debounce, persistence — is driven by
  // the FILTERED estimate, never the raw value (D6). `filtered.level === null` means this
  // is the FIRST-EVER reading on this socket and it failed a hard gate (S6: future/stale) —
  // there is nothing to seed a confirmed HR from, so the payload is acked (it was well-
  // formed) and otherwise ignored rather than fabricating a baseline from bad data.
  const filtered = _filterHeartRate(state, normalized, now);
  _maybePersistLiveReading(
    socket.data.user._id.toString(), normalized, filtered, state, now,
  ).catch(() => {}); // logged inside; never blocks the trigger pipeline
  if (filtered.level === null) return;
  const effectiveHR = filtered.level;

  state.consecutiveSkips = 0;
  state.latestActivity   = normalized.activity;

  // W4-009 (D11's full fix): advance the shared taxonomy-state posterior for EVERY filtered
  // reading, live or manual — recalibrateForBand's own liveMode gate decides whether a regime
  // change is ever SERVED, the posterior itself stays current for the next serving-path read
  // either way (the servedHR-latch precedent above: warm the state, gate the serve). Fire-and-
  // forget, like every other live-lane side effect (_maybePersistLiveReading): the socket owes
  // an ack, not a Redis round trip. Disabled together with the interim W4-D05 hysteresis fix
  // under the SAME S11-reserved flag (it was reserved for exactly this task), restoring the
  // pure HR-band trigger byte-for-byte — the Redis-down fail-soft this degrades to either way,
  // since `liveStateAdapter` itself refuses to run without a live Redis client.
  if (!_hysteresisDisabled()) {
    const uid = socket.data.user._id.toString();
    liveStateOnlineUpdate(
      uid,
      { level: effectiveHR, confidence: filtered.confidence, degraded: filtered.degraded },
      { activity: normalized.activity, now },
    ).then((result) => {
      if (result.regimeChanged) recalibrateForBand(socket, state);
    }).catch(() => {});
  }

  // Immediate (trusted) mode for the 5-minute watch ingest path: no 60s debounce.
  // First reading (no baseline), a change >= 25 bpm, OR a new activity state
  // (resting→running etc.) regenerates synchronously. The activity gate fixes
  // "entering a new activity mode does nothing" when HR hasn't crossed 25 bpm.
  if (opts.immediate) {
    const prev = state.stableHR;
    const activityChanged = state.stableActivity !== null && normalized.activity !== state.stableActivity;
    state.stableHR       = effectiveHR;
    state.stableActivity = normalized.activity;
    // D11: the trigger is the BAND — what the buffer is actually keyed by — not a bare
    // ±25 bpm delta, which fired on same-band jumps and missed real band crossings.
    // W4-D05: compared against the band being SERVED, not the previous ping. This lane has no
    // debounce at all, so the latch is the only thing standing between a resting oscillation
    // across a cut and a re-serve every five minutes.
    const latchHR = _hysteresisDisabled() ? prev : (state.servedHR ?? prev);
    const bandChanged = prev !== null &&
      _shouldRecalibrate({ prevHR: latchHR, nextHR: effectiveHR, activityChanged: false });
    if (prev === null || bandChanged || activityChanged) {
      log(`[handleBiometric] immediate hr=${effectiveHR} activity=${normalized.activity} bandChanged=${bandChanged} activityChanged=${activityChanged} → recalibrate`);
      state.servedHR = effectiveHR;
      recalibrateForBand(socket, state); // Live-mode: serve the buffer; Manual: no-op (mode-gate)
    }
    return;
  }

  if (state.stableHR === null) {
    state.stableHR       = effectiveHR;
    state.stableActivity = normalized.activity;
    return;
  }

  const delta = Math.abs(effectiveHR - state.stableHR);
  const activityChanged = normalized.activity !== state.stableActivity;
  // A band crossing is a candidate even below the 10 bpm gate (D11): the buffer is keyed by
  // band, so 115→121 changes the serve while the old gate saw "only 6 bpm" and ignored it.
  // The noise floor inside _shouldRecalibrate keeps jitter at the 90/120 cuts from arming.
  const bandCrossed = _shouldRecalibrate({
    prevHR: state.stableHR, nextHR: effectiveHR, activityChanged: false,
  });
  const meaningful = delta >= HR_DELTA_THRESHOLD || activityChanged || bandCrossed;

  // Nothing moved meaningfully → settle and cancel any pending recalibration.
  if (!meaningful) {
    if (state.timer) {
      clearTimer(state);
      socket.emit('recalibration_cancelled', { reason: 'change_reverted' });
    }
    return; // D7: stableHR is deliberately NOT overwritten here — that was the silent drift.
  }

  // D8: a reading arriving INSIDE the window refreshes the pending snapshot instead of being
  // discarded, so the timer confirms where the body actually ended up. The old code captured
  // pendingHR once and threw away every larger change that followed within the same minute.
  if (state.timer) {
    state.pendingHR       = effectiveHR;
    state.pendingActivity = normalized.activity;
    return;
  }

  state.pendingHR       = effectiveHR;
  state.pendingActivity = normalized.activity;
  state.timer = setTimeout(() => {
    const s = debounceMap.get(socket.id);
    if (!s) return;
    const currentDelta = Math.abs(s.pendingHR - s.stableHR);
    const pendingActivityChanged = s.pendingActivity !== s.stableActivity;
    const serveChanged = _shouldRecalibrate({
      prevHR: s.stableHR, nextHR: s.pendingHR, activityChanged: pendingActivityChanged,
    });
    const stillChanged = currentDelta >= HR_DELTA_THRESHOLD || pendingActivityChanged || serveChanged;
    if (stillChanged) {
      // The change is CONFIRMED, so it becomes the sustained heart rate either way — but it
      // only earns a recalibration when it actually changes the served band/activity (D11);
      // otherwise the buffer key is identical and the work would be wasted.
      s.stableHR       = s.pendingHR;
      s.stableActivity = s.pendingActivity;
      if (serveChanged) {
        recalibrateForBand(socket, s); // Live-mode: serve the buffer; Manual: no-op (mode-gate)
      } else {
        socket.emit('recalibration_cancelled', { reason: 'band_unchanged' });
      }
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

  // biometric_push is live special-category (Art.9) processing. Even though the socket is
  // authenticated, a reading must not be processed without a CURRENT consent grant on the socket's
  // user — the SAME gate the ingest routes enforce (getConsentStatus). A missing/stale grant, or a
  // consent-store error, DROPS the reading (fail closed) without ever crashing the socket.
  socket.on('biometric_push', async ({ source, raw } = {}) => {
    const uid = socket?.data?.user?._id;
    if (!uid) return;
    let status;
    try { status = await getConsentStatus(uid, HEALTH_CONSENT_PURPOSE); }
    catch { return; } // fail closed: never process special-category data on a consent-store error
    if (!status.granted || status.staleVersion) return;
    handleBiometricReading(socket, source, raw);
  });

  // Dual-path mode toggle (Part 2b). The client echoes its persisted Live/Manual choice
  // here on connect + on every toggle. Live mode is the ONLY state in which a band
  // transition auto-recalibrates (serves the buffer); Manual users are never auto-driven.
  socket.on('live_mode', ({ enabled } = {}) => {
    const state = getState(socketId);
    state.liveMode = !!enabled;
    log(`[live_mode] enabled=${state.liveMode}`);
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
  recalibrateForBand,
  handleBiometricReading,
  _debounceMap: debounceMap,
  // Exported for unit testing
  _resetDebounceState,
  _shouldRecalibrate,
  HR_NOISE_FLOOR,
  HR_BAND_RELEASE_MARGIN,
  RECAL_HYSTERESIS_FLAG,
  ANOMALY_FILTER_FLAG,
  LIVE_PERSIST_MIN_INTERVAL_MS,
  toClientTrack,
  toClientTracks,
  resolveBiometricContext,
};
