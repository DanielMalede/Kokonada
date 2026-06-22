const crypto      = require('crypto');
const spotify     = require('../services/spotify');
const youtube     = require('../services/youtube');
const garmin      = require('../services/wearable/garmin');
const appleHealth = require('../services/wearable/appleHealth');
const suunto      = require('../services/wearable/suunto');
const User        = require('../models/User');
const { buildProfile } = require('../services/musicProfileService');
const { signConnectToken } = require('../utils/jwt');

// POST /api/integrations/connect-token
// Mints a short-lived single-use token the web client appends as ?ct= to the
// top-level OAuth connect navigation (which cannot send an auth header). Replaces
// putting the long-lived session JWT in the URL. (audit F1)
exports.connectToken = (req, res) => {
  res.json({ connectToken: signConnectToken(req.user._id.toString()) });
};

// Shared options for short-lived OAuth state/CSRF cookies (Spotify, YouTube).
// httpOnly + Secure(prod) + sameSite:'lax' (survives provider redirect, withheld
// from cross-site sub-requests), 10-min TTL matching the OAuth flow window. (audit F10)
const OAUTH_STATE_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 10 * 60 * 1000, // 10 minutes
};

// ── Spotify ───────────────────────────────────────────────────────────────────

// GET /api/integrations/spotify/connect
// Generates a state token (CSRF protection), redirects user to Spotify OAuth page.
// Mobile clients open this URL in a WebView / in-app browser.
exports.spotifyConnect = (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');

  // Bind state to user session via a short-lived cookie (cleared after callback).
  // sameSite:'lax' so the cookie survives the provider's top-level GET redirect
  // back to our callback, while still being withheld from cross-site sub-requests. (audit F10)
  res.cookie('spotify_oauth_state', state, OAUTH_STATE_COOKIE_OPTS);

  res.redirect(spotify.getAuthUrl(state));
};

// GET /api/integrations/spotify/callback
// Spotify redirects here after user grants permission.
exports.spotifyCallback = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({ error: `Spotify denied access: ${error}` });
    }

    // CSRF check
    const savedState = req.cookies.spotify_oauth_state;
    res.clearCookie('spotify_oauth_state');
    if (!state || state !== savedState) {
      return res.status(403).json({ error: 'OAuth state mismatch — possible CSRF attack' });
    }

    const tokens = await spotify.exchangeCode(code);
    const profile = await spotify.getProfile(tokens.accessToken);

    // Encrypt and persist tokens — never store plain text
    req.user.musicProvider = 'spotify';
    req.user.setToken('spotifyToken', tokens);
    await req.user.save();

    // Non-blocking: analyze full library and upsert MusicProfile in the background
    setImmediate(async () => {
      try {
        await buildProfile(req.user._id.toString(), req.user);
      } catch (e) {
        console.error('[musicProfile] Spotify build failed:', e.message);
      }
    });

    // Redirect to frontend integrations page so the web app can hydrate state
    res.redirect(`${process.env.FRONTEND_URL}/integrations?music=spotify`);
  } catch (err) {
    next(err);
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

exports.youtubeConnect = (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('youtube_oauth_state', state, OAUTH_STATE_COOKIE_OPTS);
  res.redirect(youtube.getAuthUrl(state));
};

exports.youtubeCallback = async (req, res, next) => {
  try {
    const { code, state, error } = req.query;

    if (error) return res.status(400).json({ error: `YouTube denied access: ${error}` });

    const savedState = req.cookies.youtube_oauth_state;
    res.clearCookie('youtube_oauth_state');
    if (!state || state !== savedState) {
      return res.status(403).json({ error: 'OAuth state mismatch — possible CSRF attack' });
    }

    const tokens  = await youtube.exchangeCode(code);
    const channel = await youtube.getChannel(tokens.accessToken);

    req.user.musicProvider = 'youtube';
    req.user.setToken('youtubeMusicToken', tokens);
    await req.user.save();

    // Non-blocking: analyze full library and upsert MusicProfile in the background
    setImmediate(async () => {
      try {
        await buildProfile(req.user._id.toString(), req.user);
      } catch (e) {
        console.error('[musicProfile] YouTube build failed:', e.message);
      }
    });

    // Redirect to frontend integrations page so the web app can hydrate state
    res.redirect(`${process.env.FRONTEND_URL}/integrations?music=youtube`);
  } catch (err) {
    next(err);
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

// Step 1: Fetch a request token from Garmin, store token + secret together,
//         then redirect the user to Garmin's consent page.
exports.garminConnect = async (req, res, next) => {
  try {
    const { oauthToken, oauthTokenSecret } = await garmin.getRequestToken();

    // Store BOTH token and secret so the callback can validate token identity
    // (prevents token fixation: attacker swapping their token into our session)
    res.cookie(
      'garmin_request',
      JSON.stringify({ token: oauthToken, secret: oauthTokenSecret }),
      GARMIN_COOKIE_OPTS
    );

    res.redirect(garmin.getAuthUrl(oauthToken));
  } catch (err) { next(err); }
};

// Step 2: Garmin redirects here with oauth_token + oauth_verifier.
//         Validate token identity, exchange for permanent access token,
//         verify it works, then encrypt and store.
exports.garminCallback = async (req, res, next) => {
  try {
    const { oauth_token: returnedToken, oauth_verifier } = req.query;

    // Read and immediately clear the request cookie (one-time use)
    const raw = req.cookies.garmin_request;
    res.clearCookie('garmin_request', GARMIN_COOKIE_OPTS);

    if (!raw) {
      return res.status(403).json({ error: 'OAuth session expired or cookie missing — please reconnect' });
    }

    let stored;
    try {
      stored = JSON.parse(raw);
    } catch {
      return res.status(403).json({ error: 'Malformed OAuth session — please reconnect' });
    }

    // Token fixation guard: the returned oauth_token must exactly match
    // the one we originally received from Garmin in Step 1
    if (!returnedToken || returnedToken !== stored.token) {
      return res.status(403).json({ error: 'OAuth token mismatch — possible token fixation attack' });
    }

    if (!oauth_verifier) {
      return res.status(400).json({ error: 'Missing oauth_verifier — user may have denied access' });
    }

    // Exchange verifier for permanent access token
    const { accessToken, accessTokenSecret } = await garmin.getAccessToken(
      stored.token,
      stored.secret,
      oauth_verifier
    );

    // Verify the access token actually works before persisting anything
    const { garminUserId } = await garmin.getUserProfile(accessToken, accessTokenSecret);

    // Encrypt both parts of the OAuth 1.0a credential pair (AES-256-GCM)
    req.user.wearableProvider = 'garmin';
    req.user.setToken('wearableToken', { accessToken, accessTokenSecret, garminUserId });
    await req.user.save();

    // Redirect to frontend integrations page so the web app can hydrate state
    res.redirect(`${process.env.FRONTEND_URL}/integrations?biometric=garmin`);
  } catch (err) { next(err); }
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

// GET /api/integrations/status
// Returns the active music and biometric provider for the authenticated user.
exports.getIntegrationsStatus = (req, res) => {
  res.json({
    musicProvider:    req.user.musicProvider    ?? null,
    biometricProvider: req.user.wearableProvider ?? null,
  });
};