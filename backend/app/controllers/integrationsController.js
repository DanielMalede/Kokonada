const crypto      = require('crypto');
const spotify     = require('../services/spotify');
const youtube     = require('../services/youtube');
const garmin      = require('../services/wearable/garmin');
const appleHealth = require('../services/wearable/appleHealth');
const suunto      = require('../services/wearable/suunto');
const User        = require('../models/User');

// ── Spotify ───────────────────────────────────────────────────────────────────

// GET /api/integrations/spotify/connect
// Generates a state token (CSRF protection), redirects user to Spotify OAuth page.
// Mobile clients open this URL in a WebView / in-app browser.
exports.spotifyConnect = (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');

  // Bind state to user session via a short-lived cookie (cleared after callback)
  res.cookie('spotify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000, // 10 minutes
  });

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
    req.user.setToken('spotifyToken', tokens);
    await req.user.save();

    // Redirect mobile WebView to a deep link so the app can close the browser
    const deepLink = `${process.env.MOBILE_DEEP_LINK || 'kokonada://'}integrations/spotify/success?spotifyId=${profile.spotifyId}`;
    res.redirect(deepLink);
  } catch (err) {
    next(err);
  }
};

// DELETE /api/integrations/spotify/disconnect
exports.spotifyDisconnect = async (req, res, next) => {
  try {
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

// ── YouTube Music ─────────────────────────────────────────────────────────────

exports.youtubeConnect = (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('youtube_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000,
  });
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

    req.user.setToken('youtubeMusicToken', tokens);
    await req.user.save();

    const deepLink = `${process.env.MOBILE_DEEP_LINK || 'kokonada://'}integrations/youtube/success?channelId=${channel.channelId}`;
    res.redirect(deepLink);
  } catch (err) {
    next(err);
  }
};

exports.youtubeDisconnect = async (req, res, next) => {
  try {
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

// Step 1: Get a request token and redirect user to Garmin's consent page
exports.garminConnect = async (req, res, next) => {
  try {
    const { oauthToken, oauthTokenSecret } = await garmin.getRequestToken();

    // Store the request token secret in a short-lived cookie for the callback
    res.cookie('garmin_token_secret', oauthTokenSecret, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000,
    });

    res.redirect(garmin.getAuthUrl(oauthToken));
  } catch (err) { next(err); }
};

// Step 2: Garmin redirects back here with oauth_token + oauth_verifier
exports.garminCallback = async (req, res, next) => {
  try {
    const { oauth_token, oauth_verifier } = req.query;
    const oauthTokenSecret = req.cookies.garmin_token_secret;
    res.clearCookie('garmin_token_secret');

    if (!oauth_token || !oauth_verifier || !oauthTokenSecret) {
      return res.status(400).json({ error: 'Missing Garmin OAuth parameters' });
    }

    const tokens = await garmin.getAccessToken(oauth_token, oauthTokenSecret, oauth_verifier);

    req.user.wearableProvider = 'garmin';
    req.user.setToken('wearableToken', tokens);
    await req.user.save();

    const deepLink = `${process.env.MOBILE_DEEP_LINK || 'kokonada://'}integrations/garmin/success`;
    res.redirect(deepLink);
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