'use strict';

const crypto = require('crypto');

// Constant-time string comparison. Both operands are hashed to a fixed-length
// SHA-256 digest first, so a length difference can't leak through (and can't
// throw) crypto.timingSafeEqual's equal-length requirement. Shared by every
// webhook secret check so the constant-time guarantee lives in ONE place.
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { timingSafeEqualStr };
