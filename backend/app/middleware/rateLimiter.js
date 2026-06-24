const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const WATCH_INGEST_PATH = '/api/integrations/watch/hr';

// True for the high-frequency watch HR ingest endpoint, which has its own
// dedicated limiter and must NOT count against the general /api/ budget.
function isWatchIngest(req) {
  const url = req.originalUrl || '';
  return url.split('?')[0] === WATCH_INGEST_PATH;
}

exports.apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isWatchIngest, // watch streaming is governed by watchLimiter instead
  message: { error: 'Too many requests — please try again later' },
});

// Strict limit on auth endpoints to prevent credential stuffing
exports.authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts — please try again in 15 minutes' },
});

// Watch HR ingest: a low-frequency stream — one ping per ~5 minutes (0.2/min)
// to preserve watch battery. Keyed on a hash of the device token (NOT IP —
// testers share carrier NAT). 5/min is far above the expected rate but still
// caps a looping/misbehaving watch app.
exports.watchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      return crypto.createHash('sha256').update(header.slice(7)).digest('hex');
    }
    return req.ip;
  },
  message: { error: 'Too many heart-rate posts — slow down' },
});

exports._isWatchIngest = isWatchIngest;
