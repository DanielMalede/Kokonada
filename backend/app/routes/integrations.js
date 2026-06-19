const router = require('express').Router();
const auth = require('../middleware/auth');
const {
  spotifyConnect, spotifyCallback, spotifyDisconnect, spotifyStatus,
  youtubeConnect, youtubeCallback, youtubeDisconnect, youtubeStatus,
} = require('../controllers/integrationsController');

// All integration routes require a logged-in user
router.use(auth);

// Spotify
router.get('/spotify/connect',       spotifyConnect);
router.get('/spotify/callback',      spotifyCallback);
router.delete('/spotify/disconnect', spotifyDisconnect);
router.get('/spotify/status',        spotifyStatus);

// YouTube Music
router.get('/youtube/connect',       youtubeConnect);
router.get('/youtube/callback',      youtubeCallback);
router.delete('/youtube/disconnect', youtubeDisconnect);
router.get('/youtube/status',        youtubeStatus);

module.exports = router;