const router = require('express').Router();
const { revenueCatWebhook } = require('../controllers/webhooksController');

// Server-to-server webhooks (no user session; each endpoint authenticates itself)
router.post('/revenuecat', revenueCatWebhook);

module.exports = router;
