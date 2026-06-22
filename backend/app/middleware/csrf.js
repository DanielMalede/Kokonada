'use strict';

// Origin-based CSRF defense for state-changing requests (audit F6).
//
// Why this works for Kokonada specifically: the frontend (Vercel / localhost:5173)
// and backend (Railway / localhost:5000) are always a different origin, so every
// legitimate browser request carries an `Origin` header equal to FRONTEND_URL. A
// forged cross-site request from attacker.example would carry that site's Origin
// and is rejected. Requests with NO Origin (native mobile using a Bearer token,
// or the server-to-server Suunto webhook using HMAC) are allowed through — those
// transports are not CSRF-able because the attacker cannot forge the Bearer/HMAC.
//
// This complements the SameSite=None auth cookie (which alone is CSRF-fragile) and
// the CORS allowlist, without requiring a stateful CSRF-token round-trip.

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const stripTrailingSlash = (u) => (u || '').replace(/\/+$/, '');

module.exports = function csrfOriginGuard(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next(); // non-browser client (mobile Bearer / webhook HMAC)

  const allowed = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (stripTrailingSlash(origin) === stripTrailingSlash(allowed)) return next();

  return res.status(403).json({ error: 'Cross-site request blocked' });
};
