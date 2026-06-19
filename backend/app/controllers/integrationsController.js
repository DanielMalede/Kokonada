const crypto  = require('crypto');
const spotify  = require('../services/spotify');
const youtube  = require('../services/youtube');

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