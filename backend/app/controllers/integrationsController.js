const crypto      = require('crypto');
const { getIo } = require('../sockets');
const { handleBiometricReading } = require('../sockets/biometricHandler');
const spotify     = require('../services/spotify');
const youtube     = require('../services/youtube');
const garmin      = require('../services/wearable/garmin');
const appleHealth = require('../services/wearable/appleHealth');
const suunto      = require('../services/wearable/suunto');
const User        = require('../models/User');
const { buildProfile } = require('../services/musicProfileService');
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

// GET /api/integrations/spotify/token
// Returns a valid (auto-refreshed) decrypted Spotify access token for the Web Playback SDK.
exports.getSpotifyToken = async (req, res, next) => {
  try {
    const accessToken = await spotify.getValidToken(req.user);
    res.json({ access_token: accessToken });
  } catch (err) {
    next(err);
  }
};

// POST /api/integrations/spotify/play
// Body: { uris: string[], deviceId: string }
// Instructs the Spotify player (identified by deviceId) to play the given track URIs.
exports.playSpotifyTracks = async (req, res, next) => {
  try {
    const { uris, deviceId } = req.body;
    if (!Array.isArray(uris) || uris.length === 0) {
      return res.status(400).json({ error: 'uris must be a non-empty array' });
    }
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    const accessToken = await spotify.getValidToken(req.user);
    await spotify.playTracks(accessToken, uris, deviceId);
    res.status(204).end();
  } catch (err) {
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

// ── Garmin (OAuth 1.0a) ───────────────────────────────────────────────────────

// ── Garmin OAuth 1.0a cookie options ─────────────────────────────────────────
// sameSite must be 'lax' (not 'strict') — OAuth redirect flows require the
// browser to send the cookie when Garmin redirects back to our callback URL.
// 'strict' silently drops the cookie on cross-site redirects, breaking the flow.
const GARMIN_COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   10 * 60 * 1000, // 10 minutes — matches Garmin's request token TTL
};

const GARMIN_REQUEST_TTL = 600; // seconds — matches Garmin's request token TTL

// Step 1: Fetch a request token from Garmin, store {token, secret, uid} so the
//         PUBLIC callback can validate token identity AND recover the user.
//         OAuth 1.0a has no `state` param, so the request-token secret cannot go
//         in the URL — it lives in a first-party cookie, mirrored to Redis (when
//         available) keyed by oauth_token as a cookie-drop fallback.
exports.garminConnect = async (req, res, next) => {
  try {
    const { oauthToken, oauthTokenSecret } = await garmin.getRequestToken();

    const payload = JSON.stringify({
      token:  oauthToken,
      secret: oauthTokenSecret,
      uid:    req.user._id.toString(),
    });

    res.cookie('garmin_request', payload, GARMIN_COOKIE_OPTS);

    const redis = getRedis();
    if (redis) {
      try { await redis.set(`garmin:req:${oauthToken}`, payload, 'EX', GARMIN_REQUEST_TTL); } catch { /* best-effort */ }
    }

    res.redirect(garmin.getAuthUrl(oauthToken));
  } catch (err) { next(err); }
};

// Step 2 (PUBLIC — no auth middleware): Garmin redirects here with oauth_token +
//         oauth_verifier. Recover {token, secret, uid} from the cookie (or Redis
//         fallback), validate token identity, exchange for the permanent access
//         token, verify it works, then encrypt and store against the recovered user.
exports.garminCallback = async (req, res) => {
  try {
    const { oauth_token: returnedToken, oauth_verifier } = req.query;

    // Read and immediately clear the request cookie (one-time use)
    const raw = req.cookies.garmin_request;
    res.clearCookie('garmin_request', GARMIN_COOKIE_OPTS);

    let stored = null;
    if (raw) { try { stored = JSON.parse(raw); } catch { stored = null; } }

    // Cookie-drop fallback: recover from Redis by the returned oauth_token
    if (!stored && returnedToken) {
      const redis = getRedis();
      if (redis) {
        try {
          const r = await redis.get(`garmin:req:${returnedToken}`);
          if (r) stored = JSON.parse(r);
        } catch { /* fall through */ }
      }
    }

    if (!stored) return fail(res, 'garmin_expired');

    // Token fixation guard: the returned oauth_token must exactly match Step 1's
    if (!returnedToken || returnedToken !== stored.token) return fail(res, 'garmin_mismatch');
    if (!oauth_verifier) return fail(res, 'garmin_denied');

    // Exchange verifier for permanent access token
    const { accessToken, accessTokenSecret } = await garmin.getAccessToken(
      stored.token,
      stored.secret,
      oauth_verifier
    );

    // Verify the access token actually works before persisting anything
    const { garminUserId } = await garmin.getUserProfile(accessToken, accessTokenSecret);

    const user = await User.findById(stored.uid);
    if (!user || user.deletedAt) return fail(res, 'session');

    // Encrypt both parts of the OAuth 1.0a credential pair (AES-256-GCM)
    user.wearableProvider = 'garmin';
    user.setToken('wearableToken', { accessToken, accessTokenSecret, garminUserId });
    await user.save();

    const redis = getRedis();
    if (redis) { try { await redis.del(`garmin:req:${returnedToken}`); } catch { /* best-effort */ } }

    // Redirect to frontend integrations page so the web app can hydrate state
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
    await req.user.save();
    res.json({ message: 'Garmin disconnected' });
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
    if (typeof heartRate !== 'number' || heartRate < 30 || heartRate > 230) {
      return res.status(400).json({ error: 'heartRate must be a number between 30 and 230' });
    }
    const activity = Number.isInteger(activityType) ? activityType : 0;
    const startTimeLocal = typeof ts === 'string' && ts ? ts : new Date().toISOString();

    // Record liveness for the frontend staleness indicator (fire-and-forget).
    User.updateOne({ _id: user._id }, { $set: { 'watchToken.lastSeenAt': new Date() } })
      .catch((e) => console.error('[watchHrIngest] lastSeenAt update failed:', e.message));

    const io = getIo();
    const room = io?.sockets?.adapter?.rooms?.get(`user:${user._id}`);
    if (!room || room.size === 0) return res.status(409).json({ live: false });

    const socketId = room.values().next().value;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return res.status(409).json({ live: false });

    handleBiometricReading(socket, 'garmin', { heartRate, activityType: activity, startTimeLocal }, { immediate: true });
    return res.status(202).json({ ok: true });
  } catch (err) { next(err); }
};

// GET /api/integrations/status
// Returns the active music and biometric provider for the authenticated user.
exports.getIntegrationsStatus = (req, res) => {
  res.json({
    musicProvider:    req.user.musicProvider    ?? null,
    biometricProvider: req.user.wearableProvider ?? null,
  });
};
