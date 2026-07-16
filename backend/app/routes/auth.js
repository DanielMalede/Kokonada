const router = require('express').Router();
const {
  googleAuth, appleAuth, signup, login, refresh, logout, deleteAccount, me,
} = require('../controllers/authController');
// GDPR data export lives in a separate controller (T3.4).
const { exportAccountData } = require('../controllers/gdprExportController');
const { authLimiter } = require('../middleware/rateLimiter');
const auth = require('../middleware/auth');

// Mobile-first: clients send their provider token, backend verifies and issues JWT
router.post('/google',   authLimiter, googleAuth);
router.post('/apple',    authLimiter, appleAuth);

// Email/password flow (Identity collection, argon2id) + refresh-token rotation
router.post('/signup',   authLimiter, signup);
router.post('/login',    authLimiter, login);
router.post('/refresh',  authLimiter, refresh);

// Protected routes
router.post('/logout', auth, logout);
// GDPR hard-delete of the account + all associated data (irreversible)
router.delete('/account', auth, deleteAccount);
// GDPR data export (Art. 15/20): the caller downloads their own data as JSON
router.get('/account/export', auth, exportAccountData);
router.get('/me', auth, me);

module.exports = router;
