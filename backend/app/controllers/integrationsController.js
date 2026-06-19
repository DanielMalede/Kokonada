const crypto = require('crypto');
const spotify = require('../services/spotify');

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