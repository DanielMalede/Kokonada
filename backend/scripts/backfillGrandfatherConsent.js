'use strict';

// backfillGrandfatherConsent.js — ONE-TIME, human-gated backfill (audit H-9, decision 4). Writes a
// single GRANTED ConsentRecord (purpose: health_biometric_processing) at CURRENT_CONSENT_VERSION,
// dated today, for a user who already consented to health processing via the OS/OAuth grants BEFORE
// the server-side Art.9 consent gate shipped — so the new gate does not lock out their existing,
// already-consented usage.
//
// SAFETY: this WRITES (there is no dry-run), but it is IDEMPOTENT — re-running never double-writes
// (it skips a user who already has a granted row at this version). It is NOT wired to any automation
// and MUST be run by a human. Target the one existing prod user by --userId; if exactly one user has
// health data on file it can be auto-resolved, otherwise --userId is required.
//
// Usage:
//   node scripts/backfillGrandfatherConsent.js --userId <ObjectId>
//   node scripts/backfillGrandfatherConsent.js            # auto-resolve the sole health-data user

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');

// The app connects with MONGO_URI; accept the legacy MONGODB_URI as a fallback (matches gdpr-delete.js).
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

const ConsentRecord = require('../app/models/ConsentRecord');
const MedicalProfile = require('../app/models/MedicalProfile');
const BiometricLog = require('../app/models/BiometricLog');
const { recordConsent, CURRENT_CONSENT_VERSION } = require('../app/services/privacy/consent');

const PURPOSE = 'health_biometric_processing';

function isValidObjectId(id) {
  return /^[0-9a-fA-F]{24}$/.test(String(id));
}

// Idempotency guard: does this user already have a GRANTED row at this version? (Re-running the
// backfill must never create a second grant.)
async function hasGrantAtVersion(userId, version = CURRENT_CONSENT_VERSION) {
  const existing = await ConsentRecord
    .findOne({ userId, purpose: PURPOSE, consentVersion: version, status: 'granted' })
    .lean();
  return !!existing;
}

// Backfill exactly one user, idempotently. Returns a result describing whether a row was written.
async function backfillOne(userId) {
  if (await hasGrantAtVersion(userId)) {
    return { userId: String(userId), written: false, reason: 'already-granted' };
  }
  await recordConsent(userId, { purpose: PURPOSE });
  return { userId: String(userId), written: true };
}

// Resolve the target user: an explicit id wins; otherwise fall back to the SOLE owner of health
// data (MedicalProfile or BiometricLog). Returns null when it is ambiguous (0 or >1) — the caller
// must then supply --userId.
async function resolveTargetUserId(explicitUserId) {
  if (explicitUserId) return explicitUserId;
  const med = (await MedicalProfile.distinct('userId')) || [];
  const bio = (await BiometricLog.distinct('userId')) || [];
  const owners = new Set([...med, ...bio].map(String));
  return owners.size === 1 ? [...owners][0] : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let userId = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--userId' && args[i + 1]) userId = args[++i];
  }
  return { userId };
}

async function main() {
  const { userId } = parseArgs();

  if (userId && !isValidObjectId(userId)) {
    console.error('Error: --userId must be a valid 24-character MongoDB ObjectId');
    process.exit(1);
  }
  if (!MONGO_URI) {
    console.error('Error: MONGO_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  try {
    const target = await resolveTargetUserId(userId);
    if (!target) {
      console.error('Error: could not resolve a single health-data user — pass --userId <ObjectId>');
      process.exit(1);
    }

    const result = await backfillOne(target);
    if (result.written) {
      console.log(`Backfilled granted consent (${PURPOSE} v${CURRENT_CONSENT_VERSION}) for user ${result.userId}`);
    } else {
      console.log(`No change — user ${result.userId} already has a granted consent at v${CURRENT_CONSENT_VERSION}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err.message);
    mongoose.disconnect().finally(() => process.exit(1));
  });
}

module.exports = { hasGrantAtVersion, backfillOne, resolveTargetUserId, PURPOSE };
