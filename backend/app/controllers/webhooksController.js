'use strict';

const { applyRevenueCatEvent } = require('../services/entitlements/entitlements');
// Shared constant-time compare (digest-based) — one implementation for every
// webhook secret check. (audit T2.1)
const { timingSafeEqualStr } = require('../utils/timingSafeEqual');

// POST /api/webhooks/revenuecat — server-to-server billing events.
// RevenueCat is configured to send `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`.
// Unknown/garbage events are acknowledged with 200 (handled:false) so RevenueCat
// doesn't retry them forever; auth failures are the only hard rejections.
exports.revenueCatWebhook = async (req, res, next) => {
  try {
    const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!secret) {
      return res.status(503).json({ error: 'RevenueCat webhook not configured' });
    }
    const header = req.headers?.authorization || '';
    if (!timingSafeEqualStr(header, `Bearer ${secret}`)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const event = req.body && typeof req.body.event === 'object' ? req.body.event : null;
    const result = await applyRevenueCatEvent(event);
    return res.status(200).json({ handled: !!result.handled });
  } catch (err) { next(err); }
};
