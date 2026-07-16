'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

// One-shot deploy migration (T3.3): backfill garminUserIdHmac for users connected BEFORE the
// blind index existed. garminUserId is now encrypted, so the Garmin webhook resolves users via
// the deterministic blind index — a user whose index is still null would be orphaned until their
// next save. This computes the index from the (decrypted) garminUserId and persists it.
//
// The webhook also self-heals lazily (services/wearable/garminUserLookup.js), but running this
// front-loads the work so no inbound webhook ever pays an O(N) decrypt-scan. Idempotent —
// re-running only touches rows still missing an index. Supports --dry-run.
//
//   node scripts/backfill-garmin-hmac.js [--dry-run]

const mongoose = require('mongoose');
const User = require('../app/models/User');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const dryRun = process.argv.slice(2).includes('--dry-run');

async function main() {
  if (!MONGO_URI) throw new Error('MONGO_URI not set');
  await mongoose.connect(MONGO_URI);

  // Rows with a Garmin id but no blind index yet.
  const cursor = User.find({
    garminUserId: { $ne: null },
    $or: [{ garminUserIdHmac: null }, { garminUserIdHmac: { $exists: false } }],
  }).cursor();

  let scanned = 0, backfilled = 0, skipped = 0;
  for (let user = await cursor.next(); user != null; user = await cursor.next()) {
    scanned += 1;
    if (!user.garminUserId) { skipped += 1; continue; } // decrypt failed / empty
    user.syncGarminIndex();
    if (!dryRun) await user.save();
    backfilled += 1;
  }

  console.log(`[backfill-garmin-hmac] scanned=${scanned} backfilled=${backfilled} skipped=${skipped}${dryRun ? ' (dry-run)' : ''}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[backfill-garmin-hmac] failed:', err.message);
  process.exitCode = 1;
});
