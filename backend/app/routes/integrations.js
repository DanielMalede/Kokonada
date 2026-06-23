const router = require('express').Router();
const auth = require('../middleware/auth');
const {
  getIntegrationsStatus,
  connectToken,
  spotifyConnect, spotifyCallback, spotifyDisconnect, spotifyStatus,
  getSpotifyToken, playSpotifyTracks,
  youtubeConnect, youtubeCallback, youtubeExchange, youtubeConnectGIS, youtubeDisconnect, youtubeStatus,
  garminConnect, garminCallback, garminDisconnect,
  appleHealthPush,
  suuntoWebhook,
  wearableStatus,
} = require('../controllers/integrationsController');

// Public OAuth callbacks. The browser arrives here from the provider as a
// top-level navigation carrying NO cookie/Bearer/ct, so these MUST sit ABOVE
// router.use(auth) — otherwise auth 401s before the handler runs (the
// "Authentication required" connect bug). Identity is recovered from the signed
// `state` (Spotify/YouTube) or the request cookie + Redis fallback (Garmin).
router.get('/spotify/callback',  spotifyCallback);
router.get('/youtube/callback',  youtubeCallback);
router.post('/youtube/exchange', youtubeExchange);
router.get('/garmin/callback',   garminCallback);

// All remaining integration routes require a logged-in user
router.use(auth);

// Unified integrations status (music + biometric)
router.get('/status', getIntegrationsStatus);

// Mint a single-use connect token for top-level OAuth navigations (audit F1)
router.post('/connect-token', connectToken);

// Spotify (callback registered publicly above)
router.get('/spotify/connect',       spotifyConnect);
router.delete('/spotify/disconnect', spotifyDisconnect);
router.get('/spotify/status',        spotifyStatus);
router.get('/spotify/token',         getSpotifyToken);
router.post('/spotify/play',         playSpotifyTracks);

// YouTube Music (callback registered publicly above)
router.get('/youtube/connect',        youtubeConnect);
router.post('/youtube/connect-gis',   youtubeConnectGIS);
router.delete('/youtube/disconnect',  youtubeDisconnect);
router.get('/youtube/status',         youtubeStatus);

// Garmin (OAuth 1.0a — two-legged flow; callback registered publicly above)
router.get('/garmin/connect',        garminConnect);
router.delete('/garmin/disconnect',  garminDisconnect);

// Apple HealthKit (mobile push — no server-side OAuth needed)
router.post('/apple/push',           appleHealthPush);

// Suunto (webhook — raw body needed for HMAC)
router.post('/suunto/webhook',       suuntoWebhook);

// Unified wearable status
router.get('/wearable/status',       wearableStatus);

module.exports = router;