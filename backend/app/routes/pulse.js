const router = require('express').Router();
const { getPulseState } = require('../controllers/pulseController');
const auth = require('../middleware/auth');

// GET /api/pulse/state — the caller's own physiological snapshot for the Pulse
// screen (A11). Auth required; the controller scopes strictly to req.user.
router.get('/state', auth, getPulseState);

module.exports = router;
