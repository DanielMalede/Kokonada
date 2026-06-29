const crypto      = require('crypto');
const { getIo } = require('../sockets');
const { handleBiometricReading } = require('../sockets/biometricHandler');
const spotify     = require('../services/spotify');
const youtube     = require('../services/youtube');
const garmin      = require('../services/wearable/garmin');
const appleHealth = require('../services/wearable/appleHealth');
const healthStore = require('../services/wearable/healthStore');
const garminIngest = require('../services/wearable/garminIngest');
const suunto      = require('../services/wearable/suunto');
const User        = require('../models/User');
const { buildProfile } = require('../services/musicProfileService');
const { sanitizeSpotifyTrackUris } = require('../utils/spotifyUri');
const { resolveMusicProvider } = require('../utils/providerSelect');
const { signConnectToken, signOauthState, verifyOauthState } = require('../utils/jwt');
const { revoke, isRevoked } = require('../utils/tokenDenylist');
const { getRedis } = require('../config/redis');

// All callbacks land the user back in the app. On failure we redirect with a
// machine-readable ?error= code (the frontend toasts it) instead of dumping raw
// JSON on the backend domain. (Provider-redirect UX)
const frontendRedirect = (res, query) =>
  res.redirect(`${process.env.FRONTEND_URL}/integrations?${query}`);
const fail = (res, code) => frontendRedirect(res, `error=${encodeURIComponent(code)}`);

// Recover the authenticated user that a public OAuth callback belongs to, from
// the signed `state` minted at connect. Verifies signature, purpose, provider,
// and single-use (jti) status, then loads the live user. Returns null on any
// failure so the caller can redirect gracefully.
async function userFromOauthState(state, provider) {
  let payload;
  try { payload = verifyOauthState(state); } catch { return null; }
  if (payload.purpose !== 'oauth-state' || payload.provider !== provider) return null;
  if (payload.jti && (await isRevoked(payload.jti))) return null; // replay guard
  const user = await User.findById(payload.uid);
  if (!user || user.deletedAt) return null;
  return { user, payload };
}

// Burn the state's jti so a captured callback URL can't be replayed. (audit F1)
async function burnState(payload) {
  if (payload?.jti) {
    const ttl = payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 600;
    await revoke(payload.jti, Math.max(ttl, 1));
  }
}

// POST /api/integrations/connect-token
// Mints a short-lived single-use token the web client appends as ?ct= to the
// top-level OAuth connect navigation (which cannot send an auth header). Replaces
// putting the long-lived session JWT in the URL. (audit F1)
exports.connectToken = (req, res) => {
  res.json({ connectToken: signConnectToken(req.user._id.toString()) });
};

// ── Spotify ───────────────────────────────────────────────────────────────────

// GET /api/integrations/spotify/connect  (auth required — req.user is set)
// Mints a signed `state` carrying the userId, then redirects to Spotify's OAuth
// page. No state cookie: identity round-trips through the provider in the signed
// state, so the public callback needs no cookie. Mobile clients open this in a
// WebView / in-app browser.
exports.spotifyConnect = (req, res) => {
  const state = signOauthState(req.user._id.toString(), 'spotify');
  res.redirect(spotify.getAuthUrl(state));
};

// GET /api/integrations/spotify/callback  (PUBLIC — no auth middleware)
// Spotify redirects the browser here as a top-level navigation with no usable
// credential; the user is recovered from the signed `state`.
exports.spotifyCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) return fail(res, `spotify_${error}`);

    const recovered = await userFromOauthState(state, 'spotify');
    if (!recovered) return fail(res, 'spotify_state');
    const { user, payload } = recovered;

    const tokens = await spotify.exchangeCode(code);
    await spotify.getProfile(tokens.accessToken); // verify token works before persisting

    // Encrypt and persist tokens — never store plain text
    user.musicProvider = 'spotify';
    user.setToken('spotifyToken', tokens);
    await user.save();
    await burnState(payload); // single-use

    // Non-blocking: analyze full library and upsert MusicProfile in the background
    setImmediate(async () => {
      try {
        await buildProfile(user._id.toString(), user);
      } catch (e) {
        console.error('[musicProfile] Spotify build failed:', e.message);
      }
    });

    // Redirect to frontend integrations page so the web app can hydrate state
    frontendRedirect(res, 'music=spotify');
  } catch (err) {
    console.error('[Spotify Callback Catch]', {
      status:  err?.response?.status,
      data:    err?.response?.data,
      message: err?.message,
      stack:   err?.stack,
    });
    return fail(res, 'spotify_failed');
  }
};

// DELETE /api/integrations/spotify/disconnect
exports.spotifyDisconnect = async (req, res, next) => {
  try {
    req.user.musicProvider = null;
    req.user.spotifyToken = null;
    await req.user.save();
    res.json({ message: 'Spotify disconnected' });
  } catch (err) {
    next(err);
  }
};

// GET /api/integrations/spotify/status
exports.spotifyStatus = (req, res) => {
  const connected = !!req.user.spotifyToken?.blob;
  res.json({ connected });
};

// The auth middleware loads req.user with the encrypted token blobs stripped
// (`.select('-spotifyToken -youtubeMusicToken -wearableToken')`) so they never
// ride along on the request object. Any handler that must READ or REFRESH a
// provider token — or report which provider is actually connected — has to
// re-load the full document, or getToken()/resolveMusicProvider see no token and
// wrongly report "not connected" (the silent token + playback 400 bug).
function loadUserWithTokens(req) {
  return User.findById(req.user._id);
}

// GET /api/integrations/spotify/token
// Returns a valid (auto-refreshed) decrypted Spotify access token for the Web Playback SDK.
exports.getSpotifyToken = async (req, res, next) => {
  try {
    const user = await loadUserWithTokens(req);
    const accessToken = await spotify.getValidToken(user);
    res.json({ access_token: accessToken });
  } catch (err) {
    // Differentiate so the frontend can act: a revoked/expired refresh token
    // (reconnect_required) prompts a Spotify reconnect; a never-connected user
    // (spotify_not_connected) is a benign state the SDK init should ignore.
    if (err.code === 'reconnect_required') {
      return res.status(401).json({ error: err.message, code: 'reconnect_required' });
    }
    if (err.code === 'spotify_not_connected') {
      return res.status(400).json({ error: err.message, code: 'spotify_not_connected' });
    }
    next(err);
  }
};

// POST /api/integrations/spotify/play
// Body: { uris: string[], deviceId?: string }
// Plays the given URIs. deviceId is the desktop Web Playback SDK device when
// present; on mobile (no SDK device) it is omitted and we transfer playback to
// the user's active Spotify device. 409 { reason: 'no_active_device' } tells the
// frontend to prompt the user to open Spotify.
exports.playSpotifyTracks = async (req, res, next) => {
  try {
    const { uris, deviceId } = req.body;
    if (!Array.isArray(uris) || uris.length === 0) {
      return res.status(400).json({ error: 'uris must be a non-empty array' });
    }

    // Defense in depth: never forward malformed/cross-provider URIs to Spotify.
    // A single bad URI makes Spotify 400 the whole batch, so we drop them here
    // and only fail when nothing playable remains.
    const playable = sanitizeSpotifyTrackUris(uris);
    if (playable.length === 0) {
      return res.status(422).json({ error: 'No playable Spotify track URIs', code: 'no_playable_tracks' });
    }

    const user = await loadUserWithTokens(req);
    await spotify.withFreshToken(user, async (token) => {
      let target = deviceId;
      if (!target) {
        target = await spotify.getActiveDevice(token);
        if (!target) {
          res.status(409).json({ reason: 'no_active_device' });
          return;
        }
      }
      await spotify.playTracks(token, playable, target);
      res.status(204).end();
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/integrations/spotify/export
// Body: { uris: string[], name?: string, description?: string }
// "Save to library" — creates a new private playlist in the user's Spotify
// account and adds the tracks. Returns { playlistId, url }. A 409
// { reason: 'reconnect_required' } means the stored token predates the
// playlist-modify scopes, so the frontend prompts a Spotify reconnect.
exports.exportSpotifyPlaylist = async (req, res, next) => {
  try {
    const { uris, name, description } = req.body;
    if (!Array.isArray(uris) || uris.length === 0) {
      return res.status(400).json({ error: 'uris must be a non-empty array' });
    }

    // Same guard as playback: a malformed URI fails the whole add-tracks call.
    const playable = sanitizeSpotifyTrackUris(uris);
    if (playable.length === 0) {
      return res.status(422).json({ error: 'No playable Spotify track URIs', code: 'no_playable_tracks' });
    }
    const playlistName = (typeof name === 'string' && name.trim()) || 'Kokonada session';

    const user = await loadUserWithTokens(req);
    const result = await spotify.withFreshToken(user, async (token) => {
      const { spotifyId } = await spotify.getProfile(token);
      const playlist = await spotify.createPlaylist(
        token, spotifyId, playlistName,
        typeof description === 'string' ? description : 'Generated by Kokonada',
      );
      await spotify.addTracksToPlaylist(token, playlist.id, playable);
      return { playlistId: playlist.id, url: playlist.url };
    });

    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'insufficient_scope') {
      return res.status(409).json({ reason: 'reconnect_required', error: err.message });
    }
    next(err);
  }
};

// ── YouTube Music ─────────────────────────────────────────────────────────────

// GET /api/integrations/youtube/connect  (auth required)
exports.youtubeConnect = (req, res) => {
  if (!youtube.isConfigured()) {
    console.error('[youtube] connect blocked: set YOUTUBE_REDIRECT_URI and a YOUTUBE_/GOOGLE_ client id+secret');
    return fail(res, 'youtube_unconfigured');
  }
  const { codeVerifier, codeChallenge } = youtube.generatePKCE();
  // Store the PKCE verifier inside the signed state so the public callback can
  // retrieve it without any server-side session. The JWT signature prevents tampering.
  const state = signOauthState(req.user._id.toString(), 'youtube', { cv: codeVerifier });
  res.redirect(youtube.getAuthUrl(state, codeChallenge));
};

// GET /api/integrations/youtube/callback  (PUBLIC — no auth middleware)
exports.youtubeCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) return fail(res, `youtube_${error}`);

    const recovered = await userFromOauthState(state, 'youtube');
    if (!recovered) return fail(res, 'youtube_state');
    const { user, payload } = recovered;

    const tokens  = await youtube.exchangeCode(code, payload.cv);
    await youtube.getChannel(tokens.accessToken); // verify token works before persisting

    user.musicProvider = 'youtube';
    user.setToken('youtubeMusicToken', tokens);
    await user.save();
    await burnState(payload); // single-use

    // Non-blocking: analyze full library and upsert MusicProfile in the background
    setImmediate(async () => {
      try {
        await buildProfile(user._id.toString(), user);
      } catch (e) {
        console.error('[musicProfile] YouTube build failed:', e.message);
      }
    });

    // Redirect to frontend integrations page so the web app can hydrate state
    frontendRedirect(res, 'music=youtube');
  } catch (err) {
    console.error('[YouTube Callback Catch]', {
      status:  err?.response?.status,
      data:    err?.response?.data,
      message: err?.message,
      stack:   err?.stack,
    });
    return fail(res, 'youtube_failed');
  }
};

// POST /api/integrations/youtube/connect-gis  (auth required)
// Receives the authorization code from the GIS popup flow (client-side initCodeClient).
// Identity comes from the auth middleware (Bearer token), not from a state JWT.
exports.youtubeConnectGIS = async (req, res, next) => {
  try {
    const { code } = req.body ?? {};
    if (!code) return res.status(400).json({ error: 'youtube_missing_code' });

    const tokens = await youtube.exchangeCodeFromGIS(code);
    await youtube.getChannel(tokens.accessToken);

    req.user.musicProvider = 'youtube';
    req.user.setToken('youtubeMusicToken', tokens);
    await req.user.save();

    setImmediate(async () => {
      try { await buildProfile(req.user._id.toString(), req.user); }
      catch (e) { console.error('[musicProfile] YouTube build failed:', e.message); }
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

// POST /api/integrations/youtube/exchange  (PUBLIC — called by the Vercel frontend callback page)
// The frontend receives the OAuth code from Google and posts it here for server-side exchange.
// Identity is recovered from the signed state (same as the GET callback).
exports.youtubeExchange = async (req, res) => {
  try {
    const { code, state } = req.body ?? {};
    if (!code || !state) return res.status(400).json({ error: 'youtube_missing_params' });

    const recovered = await userFromOauthState(state, 'youtube');
    if (!recovered) return res.status(400).json({ error: 'youtube_state' });
    const { user, payload } = recovered;

    const tokens = await youtube.exchangeCode(code, payload.cv);
    await youtube.getChannel(tokens.accessToken);

    user.musicProvider = 'youtube';
    user.setToken('youtubeMusicToken', tokens);
    await user.save();
    await burnState(payload);

    setImmediate(async () => {
      try { await buildProfile(user._id.toString(), user); }
      catch (e) { console.error('[musicProfile] YouTube build failed:', e.message); }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[YouTube Exchange Catch]', {
      status:  err?.response?.status,
      data:    err?.response?.data,
      message: err?.message,
      stack:   err?.stack,
    });
    res.status(500).json({ error: 'youtube_failed' });
  }
};

exports.youtubeDisconnect = async (req, res, next) => {
  try {
    req.user.musicProvider = null;
    req.user.youtubeMusicToken = null;
    await req.user.save();
    res.json({ message: 'YouTube Music disconnected' });
  } catch (err) {
    next(err);
  }
};

exports.youtubeStatus = (req, res) => {
  const connected = !!req.user.youtubeMusicToken?.blob;
  res.json({ connected });
};

// ── Garmin (OAuth 2.0 + PKCE) ─────────────────────────────────────────────────

// GET /api/integrations/garmin/connect  (auth required)
// PKCE: generate verifier+challenge, carry the verifier inside the signed `state`
// so the PUBLIC callback recovers it with no server-side session (same pattern as
// YouTube). OAuth 1.0a (request-token cookie/Redis dance) was retired by Garmin.
exports.garminConnect = (req, res) => {
  if (!garmin.isConfigured()) {
    console.error('[garmin] connect blocked: set GARMIN_CONSUMER_KEY/SECRET and GARMIN_REDIRECT_URI');
    return fail(res, 'garmin_unconfigured');
  }
  const { codeVerifier, codeChallenge } = garmin.generatePKCE();
  const state = signOauthState(req.user._id.toString(), 'garmin', { cv: codeVerifier });
  res.redirect(garmin.getAuthUrl(state, codeChallenge));
};

// GET /api/integrations/garmin/callback  (PUBLIC — no auth middleware)
// Garmin redirects here with ?code&state. Recover the user + PKCE verifier from the
// signed state, exchange the code for tokens, verify, store, then kick off backfill.
exports.garminCallback = async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return fail(res, `garmin_${error}`);

    const recovered = await userFromOauthState(state, 'garmin');
    if (!recovered) return fail(res, 'garmin_state');
    const { user, payload } = recovered;

    const tokens = await garmin.exchangeCode(code, payload.cv);
    const { garminUserId } = await garmin.getUserId(tokens.accessToken); // verify token works

    // Store the OAuth2 token set (access + refresh + expiry). garminUserId is also
    // kept in plaintext so the server-to-server webhook can route pushes.
    user.wearableProvider = 'garmin';
    user.garminUserId = garminUserId;
    user.setToken('wearableToken', { ...tokens, garminUserId });
    await user.save();
    await burnState(payload); // single-use

    // Kick off the ~6-month historical backfill (async, best-effort) — Garmin then
    // pushes the historical summaries to our webhook. (garmin.requestSixMonthBackfill)
    setImmediate(async () => {
      try { await garmin.requestSixMonthBackfill(tokens.accessToken); }
      catch (e) { console.error('[garmin] backfill kickoff failed:', e.message); }
    });

    frontendRedirect(res, 'biometric=garmin');
  } catch (err) {
    console.error('[Garmin Callback Catch]', {
      status:  err?.response?.status,
      data:    err?.response?.data,
      message: err?.message,
      stack:   err?.stack,
    });
    return fail(res, 'garmin_failed');
  }
};

exports.garminDisconnect = async (req, res, next) => {
  try {
    req.user.wearableProvider = null;
    req.user.wearableToken    = null;
    req.user.garminUserId     = null;
    await req.user.save();
    res.json({ message: 'Garmin disconnected' });
  } catch (err) { next(err); }
};

// POST /api/integrations/garmin/webhook  (PUBLIC — Garmin Health API server-to-server push)
// Garmin posts { <summaryType>: [ { userId, ...summary }, ... ], ... }. There is no
// per-request auth header from Garmin, so the route is guarded by an unguessable
// secret (GARMIN_WEBHOOK_SECRET) and we only ingest summaries whose Garmin userId
// maps to a known user. Summaries are grouped per user, then handed to garminIngest.
exports.garminWebhook = async (req, res, next) => {
  try {
    if (process.env.GARMIN_WEBHOOK_SECRET && req.query.secret !== process.env.GARMIN_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const byGarminUser = new Map(); // garminUserId -> [{ type, summary }]
    for (const [type, list] of Object.entries(req.body || {})) {
      if (!Array.isArray(list)) continue;
      for (const summary of list) {
        const gid = summary?.userId;
        if (!gid) continue;
        if (!byGarminUser.has(gid)) byGarminUser.set(gid, []);
        byGarminUser.get(gid).push({ type, summary });
      }
    }

    let users = 0;
    for (const [gid, items] of byGarminUser) {
      const user = await User.findOne({ garminUserId: gid, deletedAt: null }).select('_id');
      if (!user) continue;
      await garminIngest.ingestSummaries(user._id, items);
      users += 1;
    }

    res.status(200).json({ received: true, users });
  } catch (err) { next(err); }
};

// ── Apple HealthKit (mobile push bridge) ─────────────────────────────────────

// Mobile app pushes HealthKit samples here after reading them locally
exports.appleHealthPush = async (req, res, next) => {
  try {
    const { samples } = req.body;
    const result = await appleHealth.ingestBatch(req.user._id, samples);

    // Mark as connected on first successful push
    if (req.user.wearableProvider !== 'apple_health') {
      await User.findByIdAndUpdate(req.user._id, { wearableProvider: 'apple_health' });
    }

    res.json(result);
  } catch (err) { next(err); }
};

// ── Health store batch (HealthKit / Health Connect medical-profile backfill) ─────

// POST /api/integrations/health/batch  (auth required — JWT)
// The React Native companion app reads Garmin-synced data from the on-device OS
// health store and pushes batches of multi-metric samples here for the medical
// profile. heartRate lands in BiometricLog; resting HR / HRV / respiration / SpO2
// are aggregated onto the user's MedicalProfile. Used for both the initial
// backfill and the ongoing background delta sync.
exports.healthBatchIngest = async (req, res, next) => {
  try {
    const { platform, samples } = req.body || {};
    if (platform !== 'healthkit' && platform !== 'health_connect') {
      return res.status(400).json({ error: 'platform must be "healthkit" or "health_connect"' });
    }

    const result = await healthStore.ingestBatch(req.user._id, platform, samples);

    // Mark the wearable provider on first push so the web UI reflects the connection.
    const provider = platform === 'healthkit' ? 'apple_health' : 'health_connect';
    if (req.user.wearableProvider !== provider) {
      await User.findByIdAndUpdate(req.user._id, { wearableProvider: provider });
    }

    res.json(result);
  } catch (err) { next(err); }
};

// ── Suunto (webhooks) ─────────────────────────────────────────────────────────

// Suunto pushes workout data here; body must be raw Buffer for HMAC verification
exports.suuntoWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-suunto-signature'];
    const result = await suunto.handleWebhook(req.user._id, req.rawBody, signature);
    res.json(result);
  } catch (err) { next(err); }
};

exports.wearableStatus = (req, res) => {
  res.json({
    provider:  req.user.wearableProvider || null,
    connected: !!req.user.wearableToken?.blob || req.user.wearableProvider === 'apple_health',
  });
};

// ── Garmin watch (sideloaded app — opaque device-token HR streaming) ─────────

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// POST /api/integrations/watch/token  (auth required)
// Mints a long-lived opaque device token for the watch app. Stores only the
// hash; returns the plaintext once. Re-issuing overwrites the hash, which
// instantly revokes any previously issued token.
exports.issueWatchToken = async (req, res, next) => {
  try {
    const token = `whr_${crypto.randomBytes(32).toString('base64url')}`;
    req.user.watchToken = { hash: sha256Hex(token), createdAt: new Date(), lastSeenAt: null };
    req.user.wearableProvider = 'garmin';
    await req.user.save();
    res.status(201).json({ token });
  } catch (err) { next(err); }
};

// DELETE /api/integrations/watch/token  (auth required)
exports.revokeWatchToken = async (req, res, next) => {
  try {
    req.user.watchToken = null;
    req.user.wearableProvider = null;
    await req.user.save();
    res.json({ message: 'Watch disconnected' });
  } catch (err) { next(err); }
};

// GET /api/integrations/watch/status  (auth required)
// Powers the frontend connection badge. lastSeenAt is updated on each successful
// HR ingest (see watchHrIngest); it is null until the first ping.
exports.watchStatus = (req, res) => {
  res.json({
    connected:  !!req.user.watchToken?.hash,
    lastSeenAt: req.user.watchToken?.lastSeenAt ?? null,
  });
};

// POST /api/integrations/watch/hr  (PUBLIC — device-token auth, not session)
// The sideloaded watch app POSTs live HR here ~every 5 minutes. We authenticate
// by hashing the Bearer token, look up the user's live browser socket, and feed
// the reading into the biometric pipeline in immediate mode (each ping trusted
// as the new sustained HR; see WATCH_HR_DELTA_THRESHOLD in biometricHandler).
exports.watchHrIngest = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing watch token' });
    }
    const hash = sha256Hex(header.slice(7));
    const user = await User.findOne({ 'watchToken.hash': hash, deletedAt: null }).select('_id');
    if (!user) return res.status(401).json({ error: 'Invalid watch token' });

    const { heartRate, activityType, ts } = req.body || {};
    if (!Number.isFinite(heartRate) || heartRate < 30 || heartRate > 230) {
      return res.status(400).json({ error: 'heartRate must be a finite number between 30 and 230' });
    }
    const activity = Number.isInteger(activityType) ? activityType : 0;
    const startTimeLocal =
      typeof ts === 'string' && ts && !Number.isNaN(new Date(ts).getTime())
        ? ts
        : new Date().toISOString();

    // Record liveness for the frontend staleness indicator (fire-and-forget).
    User.updateOne({ _id: user._id }, { $set: { 'watchToken.lastSeenAt': new Date() } })
      .catch((e) => console.error('[watchHrIngest] lastSeenAt update failed:', e.message));

    const io = getIo();
    const room = io?.sockets?.adapter?.rooms?.get(`user:${user._id}`);
    if (!room || room.size === 0) return res.status(409).json({ live: false });

    // DELIBERATE LIMITATION: delivers to only the first socket in the room.
    // Multi-tab delivery is intentionally deferred — issuing the same Spotify
    // play command to every tab's independent Web Playback SDK device would
    // cause duplicate playback. See final-hardening-workorder.md §Limitation 3.
    const socketId = room.values().next().value;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return res.status(409).json({ live: false });

    handleBiometricReading(socket, 'garmin', { heartRate, activityType: activity, startTimeLocal }, { immediate: true });
    return res.status(202).json({ ok: true });
  } catch (err) { next(err); }
};

// GET /api/integrations/status
// Returns the active music and biometric provider for the authenticated user.
exports.getIntegrationsStatus = async (req, res, next) => {
  try {
    // Re-load with the token blobs so resolveMusicProvider can actually see them
    // (req.user has them stripped). Report the EFFECTIVE provider — the one with
    // a stored token — not a stale `musicProvider` string, so the frontend drives
    // the SDK/playback for a provider that really has a usable token.
    const user = await loadUserWithTokens(req);
    res.json({
      musicProvider:     resolveMusicProvider(user),
      biometricProvider: user.wearableProvider ?? null,
    });
  } catch (err) {
    next(err);
  }
};
