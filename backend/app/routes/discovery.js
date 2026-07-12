const router = require('express').Router();
const auth = require('../middleware/auth');
const { playbackFailedLimiter } = require('../middleware/rateLimiter');
const { reportPlaybackFailure } = require('../controllers/discoveryController');

// POST /api/discovery/playback-failed — see controller. Auth + per-user rate-limit.
router.post('/playback-failed', auth, playbackFailedLimiter, reportPlaybackFailure);

module.exports = router;
