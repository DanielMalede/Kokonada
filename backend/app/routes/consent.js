const router = require('express').Router();
const auth = require('../middleware/auth');
const { consentLimiter } = require('../middleware/rateLimiter');
const { grantConsent, getStatus, withdraw } = require('../controllers/consentController');

// GDPR Art.9 consent (audit H-9). Every route requires a logged-in user.
router.use(auth);

// Grant / withdraw are writes → rate-limited (consentLimiter). Status is a cheap read governed
// by the global apiLimiter.
router.post('/',         consentLimiter, grantConsent);
router.get('/status',    getStatus);
router.post('/withdraw', consentLimiter, withdraw);

module.exports = router;
