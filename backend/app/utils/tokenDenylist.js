'use strict';

// Redis-backed JWT revocation list. A revoked token's jti is stored with a TTL
// equal to its remaining lifetime, so entries self-expire and the set stays small.
//
// Redis is optional in this app (the cache degrades gracefully). When it is
// unavailable, revocation cannot be enforced — we fail OPEN (treat tokens as not
// revoked) to preserve availability, matching the pre-existing "no revocation"
// behavior rather than locking everyone out. Document this in the threat model. (audit F7)
const { getRedis } = require('../config/redis');

const PREFIX = 'revoked:jti:';

async function revoke(jti, ttlSeconds) {
  const redis = getRedis();
  if (!redis || !jti) return false;
  try {
    await redis.set(`${PREFIX}${jti}`, '1', 'EX', Math.max(1, Math.floor(ttlSeconds)));
    return true;
  } catch {
    return false; // best-effort
  }
}

async function isRevoked(jti) {
  const redis = getRedis();
  if (!redis || !jti) return false;
  try {
    return (await redis.get(`${PREFIX}${jti}`)) !== null;
  } catch {
    return false; // fail-open on cache error
  }
}

module.exports = { revoke, isRevoked };
