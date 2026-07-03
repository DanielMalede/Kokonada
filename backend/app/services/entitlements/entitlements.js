'use strict';

// Entitlements scaffold. The tier lives denormalized on the User doc and is
// written ONLY by billing events (RevenueCat webhook) or manual grants; reads
// always go through resolveEntitlements so an expired period demotes to free
// immediately without waiting for the EXPIRATION webhook to arrive.

const User = require('../../models/User');

const FREE = { tier: 'free', premium: false, expiresAt: null };

function resolveEntitlements(user, now = new Date()) {
  const e = user && user.entitlements;
  if (!e || e.tier !== 'premium') return { ...FREE };
  if (e.currentPeriodEnd && new Date(e.currentPeriodEnd).getTime() <= now.getTime()) {
    return { tier: 'free', premium: false, expiresAt: e.currentPeriodEnd };
  }
  return { tier: 'premium', premium: true, expiresAt: e.currentPeriodEnd || null };
}

// RevenueCat app_user_id is set to our userId by the mobile client (Purchases.logIn).
const PREMIUM_EVENTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE']);
const REVOKE_EVENTS  = new Set(['EXPIRATION']);

async function applyRevenueCatEvent(event) {
  const userId = event && event.app_user_id;
  const type = event && event.type;
  if (!userId || typeof type !== 'string') return { handled: false };

  if (PREMIUM_EVENTS.has(type)) {
    const ms = Number(event.expiration_at_ms);
    await User.findByIdAndUpdate(userId, {
      $set: {
        entitlements: {
          tier: 'premium',
          source: 'revenuecat',
          currentPeriodEnd: Number.isFinite(ms) && ms > 0 ? new Date(ms) : null,
          updatedAt: new Date(),
        },
      },
    });
    return { handled: true, tier: 'premium' };
  }

  if (REVOKE_EVENTS.has(type)) {
    await User.findByIdAndUpdate(userId, {
      $set: {
        entitlements: { tier: 'free', source: 'revenuecat', currentPeriodEnd: null, updatedAt: new Date() },
      },
    });
    return { handled: true, tier: 'free' };
  }

  return { handled: false };
}

module.exports = { resolveEntitlements, applyRevenueCatEvent };
