const router = require('express').Router();
const auth = require('../middleware/auth');
const {
  getIntegrationsStatus,
  connectToken,
  spotifyConnect, spotifyCallback, spotifyDisconnect, spotifyStatus,
  getSpotifyToken, playSpotifyTracks,
  youtubeConnect, youtubeCallback, youtubeDisconnect, youtubeStatus,
  garminConnect, garminCallback, garminDisconnect,
  appleHealthPush,
  suuntoWebhook,
  wearableStatus,
} = require('../controllers/integrationsController');

// All integration routes require a logged-in user
router.use(auth);

// Unified integrations status (music + biometric)
router.get('/status', getIntegrationsStatus);

// Mint a single-use connect token for top-level OAuth navigations (audit F1)
router.post('/connect-token', connectToken);

// Spotify
router.get('/spotify/connect',       spotifyConnect);
router.get('/spotify/callback',      spotifyCallback);
router.delete('/spotify/disconnect', spotifyDisconnect);
router.get('/spotify/status',        spotifyStatus);
router.get('/spotify/token',         getSpotifyToken);
router.post('/spotify/play',         playSpotifyTracks);

// YouTube Music
router.get('/youtube/connect',       youtubeConnect);
router.get('/youtube/callback',      youtubeCallback);
router.delete('/youtube/disconnect', youtubeDisconnect);
router.get('/youtube/status',        youtubeStatus);

// Garmin (OAuth 1.0a — two-legged flow)
router.get('/garmin/connect',        garminConnect);
router.get('/garmin/callback',       garminCallback);
router.delete('/garmin/disconnect',  garminDisconnect);

// Apple HealthKit (mobile push — no server-side OAuth needed)
router.post('/apple/push',           appleHealthPush);

// Suunto (webhook — raw body needed for HMAC)
router.post('/suunto/webhook',       suuntoWebhook);

// Unified wearable status
router.get('/wearable/status',       wearableStatus);

module.exports = router;