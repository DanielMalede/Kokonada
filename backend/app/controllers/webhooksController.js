'use strict';

const crypto = require('crypto');
const { applyRevenueCatEvent } = require('../services/entitlements/entitlements');

// Compare via digests so length differences can't leak through timingSafeEqual's
// equal-length requirement.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

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
