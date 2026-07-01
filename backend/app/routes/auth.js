const router = require('express').Router();
const { googleAuth, appleAuth, logout, deleteAccount } = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');
const auth = require('../middleware/auth');

// Mobile-first: clients send their provider token, backend verifies and issues JWT
router.post('/google',   authLimiter, googleAuth);
router.post('/apple',    authLimiter, appleAuth);

// Protected routes
router.post('/logout', auth, logout);
// GDPR hard-delete of the account + all associated data (irreversible)
router.delete('/account', auth, deleteAccount);
router.get('/me', auth, (req, res) => {
  res.json({
    id: req.user._id,
    displayName: req.user.displayName,
    avatarUrl: req.user.avatarUrl,
    email: req.user.email,
    wearableProvider: req.user.wearableProvider,
  });
});

module.exports = router;
