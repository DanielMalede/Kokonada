'use strict';

const User = require('../../models/User');
const { blindIndex, blindIndexAll } = require('../../utils/encryption');

// Resolve the User that owns a plaintext Garmin userId (from the webhook payload). garminUserId
// is now AES-GCM encrypted (non-deterministic), so it can NOT be queried directly — we look it up
// via the deterministic keyed blind index (garminUserIdHmac). (T3.3 blocker)
//
//  • Rotation-safe (H2): matches under ANY configured key's index via `$in blindIndexAll`, and
//    re-stamps the current-key index when matched under a rotated key.
//  • Self-healing: a user connected BEFORE the blind index existed has garminUserIdHmac === null.
//    On a miss we scan just those (garmin, null-index) rows, decrypt-match, and backfill the
//    index — a one-shot lazy migration that shrinks to zero. A standalone deploy migration
//    (scripts/backfill-garmin-hmac.js) can front-run this so no webhook ever pays the scan.
async function resolveGarminUser(gid) {
  if (gid == null || String(gid) === '') return null;
  const key = String(gid);

  const indexes = blindIndexAll(key);
  if (indexes.length) {
    const user = await User.findOne({ garminUserIdHmac: { $in: indexes }, deletedAt: null });
    if (user) {
      if (user.garminUserIdHmac !== indexes[0]) { user.syncGarminIndex(); await user.save(); } // rotated-key self-heal
      return user;
    }
  }

  // Fallback: pre-index connections (garminUserIdHmac still null). Bounded to garmin-connected,
  // un-indexed rows; decrypt-match and backfill so the next lookup is an O(1) index hit.
  const candidates = await User.find({ garminUserIdHmac: null, wearableProvider: 'garmin', deletedAt: null });
  for (const user of candidates) {
    if (String(user.garminUserId) === key) { // getter decrypts
      user.syncGarminIndex();
      await user.save();
      return user;
    }
  }
  return null;
}

module.exports = { resolveGarminUser, blindIndex };
