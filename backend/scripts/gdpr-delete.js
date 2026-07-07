'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const fs   = require('fs');
const path = require('path');

// The app connects with MONGO_URI; accept the legacy MONGODB_URI as a fallback so
// a stale env name can never silently point erasure at the wrong/empty DB. (audit F11)
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

// Collection list MUST stay in lockstep with services/privacy/erasure.js (the
// controller cascade) — this script only adds dry-run/count reporting on top.
const BiometricLog    = require('../app/models/BiometricLog');
const MedicalProfile  = require('../app/models/MedicalProfile');
const MusicProfile    = require('../app/models/MusicProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent      = require('../app/models/ServeEvent');
const Identity        = require('../app/models/Identity');
const RefreshToken    = require('../app/models/RefreshToken');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const User            = require('../app/models/User');
const { connectRedis } = require('../app/config/redis');
const { purgeUserKeys } = require('../app/utils/userRedisPurge');

function parseArgs() {
  const args = process.argv.slice(2);
  let userId  = null;
  let dryRun  = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--userId' && args[i + 1]) {
      userId = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }
  return { userId, dryRun };
}

function isValidObjectId(id) {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

// Append-only erasure audit trail: who erased which user, when, and what counts.
// Records the *fact* of erasure (Art. 30 accountability) without storing any of
// the erased personal data itself. (audit F11)
function appendAudit(record) {
  const logPath = path.join(__dirname, '..', 'gdpr-erasure-audit.log');
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    operator: process.env.GDPR_OPERATOR || process.env.USER || process.env.USERNAME || 'unknown',
    ...record,
  }) + '\n';
  try {
    fs.appendFileSync(logPath, line, { flag: 'a' });
  } catch (e) {
    console.error(`WARNING: failed to write erasure audit log: ${e.message}`);
  }
}

async function main() {
  const { userId, dryRun } = parseArgs();

  if (!userId) {
    console.error('Error: --userId is required');
    process.exit(1);
  }

  if (!isValidObjectId(userId)) {
    console.error('Error: --userId must be a valid 24-character MongoDB ObjectId');
    process.exit(1);
  }

  if (!MONGO_URI) {
    console.error('Error: MONGO_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);

  try {
    if (dryRun) {
      console.log(`[DRY RUN] GDPR deletion for userId: ${userId}`);

      const biometricCount    = await BiometricLog.countDocuments({ userId });
      const medicalExists     = await MedicalProfile.findOne({ userId }).lean();
      const musicExists       = await MusicProfile.findOne({ userId }).lean();
      const playlistCount     = await PlaylistSession.countDocuments({ userId });
      const serveCount        = await ServeEvent.countDocuments({ userId });
      const identityCount     = await Identity.countDocuments({ userId });
      const refreshCount      = await RefreshToken.countDocuments({ userId });
      const unclassifiedCount = await UnclassifiedTrack.countDocuments({ userId });
      const userExists        = await User.findById(userId).lean();

      console.log(`  BiometricLog: ${biometricCount} document(s) would be deleted`);
      console.log(`  MedicalProfile: ${medicalExists ? '1 document would be deleted' : 'not found (nothing to delete)'}`);
      console.log(`  MusicProfile: ${musicExists ? '1 document would be deleted' : 'not found (nothing to delete)'}`);
      console.log(`  PlaylistSession: ${playlistCount} document(s) would be deleted`);
      console.log(`  ServeEvent: ${serveCount} document(s) would be deleted`);
      console.log(`  Identity: ${identityCount} document(s) would be deleted`);
      console.log(`  RefreshToken: ${refreshCount} document(s) would be deleted`);
      console.log(`  UnclassifiedTrack: ${unclassifiedCount} document(s) would be deleted`);
      console.log(`  User: ${userExists ? '1 document would be deleted' : 'not found (nothing to delete)'}`);
      console.log('  Redis: user-scoped ledger/pool/baseline keys would be purged');
      console.log('[DRY RUN] No changes made.');
    } else {
      console.log(`GDPR deletion for userId: ${userId}`);

      const biometricResult = await BiometricLog.deleteMany({ userId });
      console.log(`  BiometricLog: deleted ${biometricResult.deletedCount} document(s)`);

      const medicalResult = await MedicalProfile.deleteOne({ userId });
      if (medicalResult.deletedCount === 0) {
        console.log('  MedicalProfile: not found (nothing to delete)');
      } else {
        console.log('  MedicalProfile: deleted 1 document');
      }

      const musicResult = await MusicProfile.deleteOne({ userId });
      if (musicResult.deletedCount === 0) {
        console.log('  MusicProfile: not found (nothing to delete)');
      } else {
        console.log('  MusicProfile: deleted 1 document');
      }

      const playlistResult = await PlaylistSession.deleteMany({ userId });
      console.log(`  PlaylistSession: deleted ${playlistResult.deletedCount} document(s)`);

      const serveResult = await ServeEvent.deleteMany({ userId });
      console.log(`  ServeEvent: deleted ${serveResult.deletedCount} document(s)`);

      const identityResult = await Identity.deleteMany({ userId });
      console.log(`  Identity: deleted ${identityResult.deletedCount} document(s)`);

      const refreshResult = await RefreshToken.deleteMany({ userId });
      console.log(`  RefreshToken: deleted ${refreshResult.deletedCount} document(s)`);

      const unclassifiedResult = await UnclassifiedTrack.deleteMany({ userId });
      console.log(`  UnclassifiedTrack: deleted ${unclassifiedResult.deletedCount} document(s)`);

      await connectRedis();
      const redisKeys = await purgeUserKeys(userId);
      console.log(`  Redis: purged ${redisKeys} user-scoped key(s)`);

      const user = await User.findByIdAndDelete(userId);
      if (!user) {
        console.log('  User: not found (nothing to delete)');
      } else {
        console.log('  User: deleted');
      }

      appendAudit({
        userId,
        deleted: {
          biometricLogs:    biometricResult.deletedCount,
          medicalProfile:   medicalResult.deletedCount,
          musicProfile:     musicResult.deletedCount,
          playlistSessions: playlistResult.deletedCount,
          serveEvents:      serveResult.deletedCount,
          identities:       identityResult.deletedCount,
          refreshTokens:    refreshResult.deletedCount,
          unclassifiedTracks: unclassifiedResult.deletedCount,
          redisKeys,
          user:             user ? 1 : 0,
        },
      });

      console.log('GDPR deletion complete.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
