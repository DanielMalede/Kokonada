const router = require('express').Router();
const { listSessions } = require('../controllers/sessionsController');
const auth = require('../middleware/auth');

// GET /api/sessions — the caller's persistent playlist-generation history (A11).
// Auth required; every row is scoped to req.user in the controller.
router.get('/', auth, listSessions);

module.exports = router;
