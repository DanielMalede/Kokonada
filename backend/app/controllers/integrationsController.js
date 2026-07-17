const crypto      = require('crypto');
const { getIo } = require('../sockets');
const { handleBiometricReading } = require('../sockets/biometricHandler');
const spotify     = require('../services/spotify');
const youtube     = require('../services/youtube');
const garmin      = require('../services/wearable/garmin');
const appleHealth = require('../services/wearable/appleHealth');
const healthStore = require('../services/wearable/healthStore');
const garminIngest = require('../services/wearable/garminIngest');
// garminUserId is encrypted (T3.3) — resolve the webhook's plaintext gid via its blind index.
const { resolveGarminUser } = require('../services/wearable/garminUserLookup');
const { persistMetrics } = require('../services/wearable/metricStore');
const suunto      = require('../services/wearable/suunto');
const User        = require('../models/User');
const MusicProfile = require('../models/MusicProfile');
const ServeEvent  = require('../models/ServeEvent');
const { purgeUserKeys } = require('../utils/userRedisPurge');
const { buildProfile } = require('../services/musicProfileService');
const { invalidateUserPools } = require('../services/selection/candidatePool');
const featureService = require('../services/features/featureService');
const { sanitizeSpotifyTrackUris } = require('../utils/spotifyUri');
const { resolveMusicProvider, resolvePlaybackProvider, resolveDataProviders } = require('../utils/providerSelect');
const { signConnectToken, signOauthState, verifyOauthState } = require('../utils/jwt');
const timingSafe = require('../utils/timingSafeEqual');
const { revoke, isRevoked } = require('../utils/tokenDenylist');
const { getRedis } = require('../config/redis');

// All callbacks land the user back in the app. On failure we redirect with a
// machine-readable ?error= code (the frontend toasts it) instead of dumping raw
// JSON on the backend domain. (Provider-redirect UX)
const frontendRedirect = (res, query) =>
  res.redirect(`${process.env.FRONTEND_URL}/integrations?${query}`);
const fail = (res, code) => frontendRedirect(res, `error=${encodeURIComponent(code)}`);

// Mobile clients open the OAuth connect in the SYSTEM browser and can't be returned to via a
// web URL — the grant would strand the user on the website. When the connect carried
// returnTo=app, the signed state remembers it and the callback deep-links back into the native
// app (kokonada://…) so the OS foregrounds it. Web connects are unaffected (default → website).
const APP_SCHEME = () => process.env.APP_DEEPLINK_SCHEME || 'kokonada';
const _returnTarget = (state) => {
  try { return verifyOauthState(state)?.returnTo === 'app' ? 'app' : 'web'; }
  catch { return 'web'; } // unreadable/tampered state → default to the website
};
const oauthRedirect = (res, target, query) =>
  target === 'app'
    ? res.redirect(`${APP_SCHEME()}://integrations?${query}`)
    : frontendRedirect(res, query);
const failTo = (res, target, code) => oauthRedirect(res, target, `error=${encodeURIComponent(code)}`);

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
  // returnTo=app (mobile) is remembered in the signed state so the callback deep-links back
  // into the native app instead of the website. Whitelisted to 'app' — nothing else is honored.
  const extra = req.query?.returnTo === 'app' ? { returnTo: 'app' } : {};
  const state = signOauthState(req.user._id.toString(), 'spotify', extra);
  res.redirect(spotify.getAuthUrl(state));
};

// GET /api/integrations/spotify/callback  (PUBLIC — no auth middleware)
// Spotify redirects the browser here as a top-level navigation with no usable
// credential; the user is recovered from the signed `state`.
exports.spotifyCallback = async (req, res) => {
  const { code, state, error } = req.query;
  // Learn the return target (native app vs website) from the signed state so BOTH success and
  // every failure land back where the user started. Best-effort — falls back to the website.
  const target = _returnTarget(state);
  try {
    if (error) return failTo(res, target, `spotify_${error}`);

    const recovered = await userFromOauthState(state, 'spotify');
    if (!recovered) return failTo(res, target, 'spotify_state');
    const { user, payload } = recovered;

    const tokens = await spotify.exchangeCode(code);
    await spotify.getProfile(tokens.accessToken); // verify token works before persisting

    // Encrypt and persist tokens — never store plain text
    user.musicProvider = 'spotify';
    user.setToken('spotifyToken', tokens);
    // Record the GRANTED scopes so /status can tell the client whether Like/Export
    // will work. Log them so a missing-scope reconnect is diagnosable (audit #5).
    user.spotifyScopes = tokens.scope || '';
    console.info(`[spotify] connected — granted scopes: ${tokens.scope || '(none reported)'}`);
    await user.save();
    await burnState(payload); // single-use

    // Non-blocking: analyze full library and upsert MusicProfile in the background
    setImmediate(async () => {
      const uid = user._id.toString();
      try {
        // Stream build progress to the user's socket room so the dashboard can show a
        // live "Analyzing your library… %" banner (#2). Best-effort — never blocks.
        await buildProfile(uid, user, (pct, label) => {
          getIo()?.to(`user:${uid}`).emit('profile_progress', { pct, label });
        });
      } catch (e) {
        console.error('[musicProfile] Spotify build failed:', e.message);
        getIo()?.to(`user:${uid}`).emit('profile_progress', { pct: 100, label: 'Setup failed', error: true });
      }
    });

    // Land the user back where they started: the native app (mobile) or the website.
    oauthRedirect(res, target, 'music=spotify');
  } catch (err) {
    console.error('[Spotify Callback Catch]', {
      status:  err?.response?.status,
      data:    err?.response?.data,
      message: err?.message,
      stack:   err?.stack,
    });
    return failTo(res, target, 'spotify_failed');
  }
};

// DELETE /api/integrations/spotify/disconnect
exports.spotifyDisconnect = async (req, res, next) => {
  try {
    const userId = req.user._id;
    req.user.musicProvider = null;
    req.user.spotifyToken = null;
    req.user.spotifyScopes = '';
    await req.user.save();
    // Data-handling (Spotify Developer Policy): don't retain Spotify-derived content after
    // the user disconnects. Drop the cached taste profile (rebuilt on reconnect), the
    // personalized serve history (ServeEvent = which Spotify recordings were surfaced to
    // this user, when), and all user-scoped Redis state (candidate pools, serve-ledger
    // windows, encrypted baseline). Global cross-user corpus/embedding/feature caches are
    // eliminated separately by the one-time Spotify purge (scripts/purgeSpotifyCorpus.js),
    // not per-user erasure.
    await Promise.all([
      MusicProfile.deleteOne({ userId }),
      ServeEvent.deleteMany({ userId }),
    ]);
    await purgeUserKeys(userId);
    res.json({ message: 'Spotify disconnected' });
  } catch (err) {
    next(err);
  }
};

// GET /api/integrations/spotify/status
// `connected` = a token exists. `canSave` = the token also carries user-library-modify
// so the client can enable the Like button and prompt a reconnect ONCE up front
// instead of failing on every click (audit #5).
exports.spotifyStatus = (req, res) => {
  const connected = !!req.user.spotifyToken?.blob;
  const scopes    = req.user.spotifyScopes || '';
  const hasLibraryWrite = scopes.includes('user-library-modify');
  res.json({ connected, hasLibraryWrite, canSave: hasLibraryWrite });
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

// Like button (Bug 7). PUT/DELETE/GET /api/integrations/spotify/saved-tracks.
// A 409 { reason: 'reconnect_required' } means the stored token predates the
// user-library-modify scope, so the frontend prompts a Spotify reconnect.
// PUT body: { ids: string[] } — save to Liked Songs.
exports.saveSpotifyTracks = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });
    const user = await loadUserWithTokens(req);
    await spotify.withFreshToken(user, (token) => spotify.saveTracks(token, ids));
    res.status(204).end();
  } catch (err) {
    if (err.code === 'insufficient_scope') return res.status(409).json({ reason: 'reconnect_required', error: err.message });
    next(err);
  }
};

// DELETE body: { ids: string[] } — remove from Liked Songs.
exports.removeSpotifyTracks = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });
    const user = await loadUserWithTokens(req);
    await spotify.withFreshToken(user, (token) => spotify.removeSavedTracks(token, ids));
    res.status(204).end();
  } catch (err) {
    if (err.code === 'insufficient_scope') return res.status(409).json({ reason: 'reconnect_required', error: err.message });
    next(err);
  }
};

// GET ?ids=a,b — returns { saved: { id: boolean } } so the UI can show the heart state.
exports.getSpotifyTracksSaved = async (req, res, next) => {
  try {
    const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return res.json({ saved: {} });
    const user = await loadUserWithTokens(req);
    const saved = await spotify.withFreshToken(user, (token) => spotify.areTracksSaved(token, ids));
    res.json({ saved });
  } catch (err) {
    if (err.code === 'insufficient_scope') return res.status(409).json({ reason: 'reconnect_required', error: err.message });
    next(err);
  }
};

// ── YouTube Music ─────────────────────────────────────────────────────────────

// GET /api/integrations/youtube/connect  (auth required)
exports.youtubeConnect = (req, res) => {
  if (!youtube.isConfigured()) {
    console.error('[youtube] connect blocked: set YOUTUBE_REDIRECT_URI and a YOUTUBE_/GOOGLE_ client id+secret');
    // No state exists yet, so read the return target straight off the raw query param.
    return failTo(res, req.query?.returnTo === 'app' ? 'app' : 'web', 'youtube_unconfigured');
  }
  const { codeVerifier, codeChallenge } = youtube.generatePKCE();
  // Store the PKCE verifier inside the signed state so the public callback can
  // retrieve it without any server-side session. The JWT signature prevents tampering.
  // returnTo=app (mobile) rides alongside so the callback deep-links back into the native
  // app instead of the website. Whitelisted to 'app' — nothing else is honored.
  const extra = { cv: codeVerifier };
  if (req.query?.returnTo === 'app') extra.returnTo = 'app';
  const state = signOauthState(req.user._id.toString(), 'youtube', extra);
  res.redirect(youtube.getAuthUrl(state, codeChallenge));
};

// GET /api/integrations/youtube/callback  (PUBLIC — no auth middleware)
exports.youtubeCallback = async (req, res) => {
  const { code, state, error } = req.query;
  // Learn the return target (native app vs website) from the signed state so BOTH success and
  // every failure land back where the user started. Best-effort — falls back to the website.
  const target = _returnTarget(state);
  try {
    if (error) return failTo(res, target, `youtube_${error}`);

    const recovered = await userFromOauthState(state, 'youtube');
    if (!recovered) return failTo(res, target, 'youtube_state');
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

    // Land the user back where they started: the native app (mobile) or the website.
    oauthRedirect(res, target, 'music=youtube');
  } catch (err) {
    console.error('[YouTube Callback Catch]', {
      status:  err?.response?.status,
      data:    err?.response?.data,
      message: err?.message,
      stack:   err?.stack,
    });
    return failTo(res, target, 'youtube_failed');
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

// DELETE /api/integrations/youtube/disconnect
// Cleanly removes YouTube as a data source and leaves the user with a provider-consistent
// profile: (1) clear the YT token, (2) purge the YouTube-tainted candidate-pool cache,
// (3) deterministically rebuild the profile from the REMAINING source. Because the YT
// token is gone, buildProfile now yields a Spotify-only, natively-playable library — no
// more YouTube tracks dropped by the Spotify provider filter (the empty-playlist bug).
exports.youtubeDisconnect = async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    // auth() strips token blobs from req.user — re-load the FULL doc so getToken() can
    // see the Spotify token the rebuild needs (otherwise it builds an empty profile).
    const user = await loadUserWithTokens(req);

    // 1. Clear the YouTube link. Fall back the effective provider to Spotify if it is
    //    still connected, else null.
    user.youtubeMusicToken = null;
    const hasSpotify = !!user.getToken?.('spotifyToken')?.accessToken;
    user.musicProvider = hasSpotify ? 'spotify' : null;
    await user.save();

    // 2. Purge every cached candidate pool for this user so generation can't serve
    //    stale YouTube tracks before the rebuild's lastAnalyzed stamp invalidates them.
    await invalidateUserPools(userId);

    // 3. Deterministic rebuild from the remaining source. With no source left, wipe the
    //    library so stale YouTube tracks don't linger in the profile.
    let library = 0;
    if (hasSpotify) {
      const profile = await buildProfile(userId, user);
      library = profile?.library?.length ?? 0;
    } else {
      await MusicProfile.findOneAndUpdate(
        { userId },
        { $set: { library: [], topGenres: [], topArtists: [], genreSet: [], knownArtistIds: [], lastAnalyzed: new Date() } },
        { upsert: true },
      );
    }

    res.json({ message: 'YouTube Music disconnected', rebuilt: hasSpotify, provider: user.musicProvider, library });
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
//
// Auth is FAIL-CLOSED and UNCONDITIONAL: an unset secret always rejects (503),
// never gated on NODE_ENV (Railway may not set it, and a fail-open there would be
// catastrophic — local dev MUST set GARMIN_WEBHOOK_SECRET). Garmin cannot attach
// custom headers to its push POSTs, so the ?secret= query param is the PERMANENT
// live transport; the x-garmin-webhook-secret header is optional hardening for a
// trusted reverse proxy, and an absent OR empty header falls through to the query
// so a stray proxy header can't block real Garmin traffic. Comparison is constant
// time (timingSafeEqualStr — SHA-256 digest + timingSafeEqual) and summary.userId
// is validated as a string before any DB lookup so a NoSQL operator ({"$gt":""})
// can't poison another user's biometrics. (audit T2.1 / F1 / F2 / F3 / compliance C1)
exports.garminWebhook = async (req, res, next) => {
  try {
    const configured = process.env.GARMIN_WEBHOOK_SECRET;
    if (!configured) {
      return res.status(503).json({ error: 'garmin webhook not configured' });
    }
    const headerSecret = req.headers?.['x-garmin-webhook-secret'];
    const provided = (headerSecret == null || headerSecret === '')
      ? req.query?.secret
      : headerSecret;
    if (!timingSafe.timingSafeEqualStr(typeof provided === 'string' ? provided : '', configured)) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const byGarminUser = new Map(); // garminUserId -> [{ type, summary }]
    for (const [type, list] of Object.entries(req.body || {})) {
      if (!Array.isArray(list)) continue;
      for (const summary of list) {
        const gid = summary?.userId;
        // Only a plain string is a valid Garmin userId — reject objects/operators
        // ({"$gt":""}) before they can reach User.findOne. (audit T2.1d)
        if (typeof gid !== 'string' || !gid) continue;
        if (!byGarminUser.has(gid)) byGarminUser.set(gid, []);
        byGarminUser.get(gid).push({ type, summary });
      }
    }

    let users = 0;
    for (const [gid, items] of byGarminUser) {
      const user = await resolveGarminUser(gid); // garminUserId is encrypted → resolve via blind index (T3.3)
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
  // Always-on receipt log (#90): pairs with the mobile [koko] healthSync logs so ONE Sync
  // shows the full path — did the batch reach the server, and did it persist? The device
  // reads the data fine; the gap was an invisible upload boundary.
  const n = Array.isArray(req.body?.samples) ? req.body.samples.length : 'none';
  console.warn(`[healthBatch] recv platform=${req.body?.platform} samples=${n} user=${req.user?._id}`);
  try {
    const { platform, samples } = req.body || {};
    if (platform !== 'healthkit' && platform !== 'health_connect') {
      return res.status(400).json({ error: 'platform must be "healthkit" or "health_connect"' });
    }

    const result = await healthStore.ingestBatch(req.user._id, platform, samples);
    console.warn(`[healthBatch] ok accepted=${result.accepted} inserted=${result.inserted} profileMetrics=${JSON.stringify(result.profileMetrics || {})}`);

    // Mark the wearable provider on first push so the web UI reflects the connection.
    const provider = platform === 'healthkit' ? 'apple_health' : 'health_connect';
    if (req.user.wearableProvider !== provider) {
      await User.findByIdAndUpdate(req.user._id, { wearableProvider: provider });
    }

    res.json(result);
  } catch (err) {
    console.warn(`[healthBatch] FAILED user=${req.user?._id}: ${err.message}`);
    next(err);
  }
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

// Shared by issueWatchToken and the pairing exchange below (audit L-15: only the
// UI-EXPOSURE mechanism changes — the actual mint logic is unchanged). Mutates
// `user` in place; caller is responsible for `await user.save()`.
function mintWatchToken(user) {
  const token = `whr_${crypto.randomBytes(32).toString('base64url')}`;
  user.watchToken = { hash: sha256Hex(token), createdAt: new Date(), lastSeenAt: null };
  user.wearableProvider = 'garmin';
  return token;
}

// POST /api/integrations/watch/token  (auth required)
// Mints a long-lived opaque device token for the watch app. Stores only the
// hash; returns the plaintext once. Re-issuing overwrites the hash, which
// instantly revokes any previously issued token. Retained for non-browser/API
// callers; the web UI itself now uses the pairing-code flow below (audit L-15)
// so the long-lived token is never rendered in the browser DOM or clipboard.
exports.issueWatchToken = async (req, res, next) => {
  try {
    const token = mintWatchToken(req.user);
    await req.user.save();
    res.status(201).json({ token });
  } catch (err) { next(err); }
};

// DELETE /api/integrations/watch/token  (auth required)
exports.revokeWatchToken = async (req, res, next) => {
  try {
    req.user.watchToken = null;
    req.user.watchPairing = null; // a stale in-flight pairing must not outlive a disconnect
    req.user.wearableProvider = null;
    await req.user.save();
    res.json({ message: 'Watch disconnected' });
  } catch (err) { next(err); }
};

const WATCH_PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes — short-lived, single-use
const WATCH_PAIRING_CODE_LEN = 6; // digits — fast to key in on a watch bezel/buttons
const WATCH_PAIRING_MAX_ATTEMPTS = 5; // collision-avoidance retries at mint time

function randomPairingCode() {
  return crypto.randomInt(0, 10 ** WATCH_PAIRING_CODE_LEN).toString().padStart(WATCH_PAIRING_CODE_LEN, '0');
}

// POST /api/integrations/watch/pair  (auth required)
// Mints a short-lived, single-use pairing code shown in the browser INSTEAD of
// the long-lived device token (audit L-15). The watch exchanges this code,
// server-side, for its own whr_ token via exchangeWatchPairing below.
exports.createWatchPairing = async (req, res, next) => {
  try {
    let code = null;
    let hash = null;
    for (let attempt = 0; attempt < WATCH_PAIRING_MAX_ATTEMPTS && !code; attempt += 1) {
      const candidate = randomPairingCode();
      const candidateHash = sha256Hex(candidate);
      // eslint-disable-next-line no-await-in-loop -- bounded (<=5), correctness over throughput
      const collision = await User.exists({
        'watchPairing.hash': candidateHash,
        'watchPairing.expiresAt': { $gt: new Date() },
      });
      if (!collision) { code = candidate; hash = candidateHash; }
    }
    if (!code) return res.status(503).json({ error: 'Could not allocate a pairing code — try again' });

    const expiresAt = new Date(Date.now() + WATCH_PAIRING_TTL_MS);
    req.user.watchPairing = { hash, expiresAt };
    await req.user.save();
    res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
  } catch (err) { next(err); }
};

// POST /api/integrations/watch/pair/exchange  (PUBLIC — the watch has no session;
// it authenticates with the freshly-typed one-time code instead)
// Single-use: the atomic findOneAndUpdate both matches AND clears watchPairing in
// one round-trip (`{ new: true }` returns the POST-update doc), so two concurrent
// exchange attempts for the same code can't both succeed.
exports.exchangeWatchPairing = async (req, res, next) => {
  try {
    const { code } = req.body || {};
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'code must be a 6-digit string' });
    }
    const hash = sha256Hex(code);
    const user = await User.findOneAndUpdate(
      { 'watchPairing.hash': hash, 'watchPairing.expiresAt': { $gt: new Date() }, deletedAt: null },
      { $set: { watchPairing: null } },
      { new: true },
    );
    if (!user) return res.status(401).json({ error: 'Invalid or expired pairing code' });

    const token = mintWatchToken(user);
    await user.save();
    res.status(201).json({ token });
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

    // Deliver to EVERY live socket in the user's room (defect C — Live-mode intermittency).
    // liveMode is per-socket state, set on whichever socket the app toggled Live on. The old
    // "first socket only" (connection order) meant that after an app reconnect the reading
    // could land on a stale/Manual socket whose recalibrateForBand early-returns, so the
    // band-serve silently never fired — intermittently, depending on socket order. Each
    // socket's own liveMode gate still decides whether it serves, so a Manual/idle socket
    // just updates its HR and no-ops — no duplicate playback (the old web-multi-tab concern
    // is moot for the single App-Remote mobile client).
    let delivered = 0;
    for (const socketId of room) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket) continue;
      handleBiometricReading(socket, 'garmin', { heartRate, activityType: activity, startTimeLocal }, { immediate: true });
      delivered += 1;
    }
    if (delivered === 0) return res.status(409).json({ live: false });
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
    // Whether the stored Spotify token carries user-library-modify, so the client
    // can enable the Like button (and prompt a single reconnect when missing)
    // instead of discovering it via a 409 on every click (audit #5).
    const scopes = user.spotifyScopes || '';
    const dataProviders = resolveDataProviders(user);
    res.json({
      // Back-compat: the single "effective" provider (Spotify preferred).
      musicProvider:     resolveMusicProvider(user),
      // New role model — Spotify is the PLAYBACK engine, both can be DATA engines
      // simultaneously. The UI shows both as connected and labels their roles.
      playbackProvider:  resolvePlaybackProvider(user),   // 'spotify' | null
      dataProviders,                                       // ['spotify','youtube'] (either/both)
      spotifyConnected:  dataProviders.includes('spotify'),
      youtubeConnected:  dataProviders.includes('youtube'),
      biometricProvider: user.wearableProvider ?? null,
      spotifyCanSave:    scopes.includes('user-library-modify'),
    });
  } catch (err) {
    next(err);
  }
};

// Force-hydrate the caller's library synchronously (bypasses the async feature-hydration
// queue) and return the provider breakdown — a diagnose-and-fix for an empty AudioFeature
// store (the "same playlist" root cause: no features → the scorer can't differentiate
// mood/HR). ReccoBeats measures spotify:<id>; both spotify: and youtube_music: are dropped
// before persistence (third-party-ToS containment, featureService.js) — only mbid: (CC0)
// features land in AudioFeature, so a connected user's own youtube: tracks stay featureless.
exports.hydrateLibrary = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const profile = await MusicProfile.findOne({ userId }).lean();
    const library = profile?.library ?? [];
    if (!library.length) return res.status(200).json({ summary: { requested: 0 }, note: 'empty library' });
    const summary = await featureService.hydrate(library);
    console.warn(`[hydrateLibrary] user=${userId} ${JSON.stringify(summary)}`);
    return res.status(200).json({ summary });
  } catch (err) {
    next(err);
  }
};
