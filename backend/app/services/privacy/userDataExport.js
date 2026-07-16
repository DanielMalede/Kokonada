'use strict';

// GDPR data export (Art. 15 access / Art. 20 portability) — T3.4. Serializes the subject's OWN
// records to JSON, DECRYPTED where they are the subject (health data), reusing the SAME
// user-owned collection list as account erasure (services/privacy/erasure.js). Credential
// secrets are redacted — a portability export must never hand back a password hash, a
// refresh-token hash, or an OAuth blob.
//
// NOTE: erasure.js (Wave 1's file) declares the same list inline; consolidating both onto this
// single registry is deferred to the post-Wave-1 rebase — until then keep them in lockstep.

const BiometricLog      = require('../../models/BiometricLog');
const MedicalProfile    = require('../../models/MedicalProfile');
const MusicProfile      = require('../../models/MusicProfile');
const PlaylistSession   = require('../../models/PlaylistSession');
const ServeEvent        = require('../../models/ServeEvent');
const Identity          = require('../../models/Identity');
const RefreshToken      = require('../../models/RefreshToken');
const UnclassifiedTrack = require('../../models/UnclassifiedTrack');
const User              = require('../../models/User');

// Same collections erasure cascades over. `redact` strips credential secrets from the export
// (the row is still represented — only the secret field is removed).
const COLLECTIONS = [
  { model: BiometricLog },
  { model: MedicalProfile },
  { model: MusicProfile },
  { model: PlaylistSession },
  { model: ServeEvent },
  { model: Identity,     redact: ['passwordHash'] },   // argon2id hash — never exported
  { model: RefreshToken, redact: ['tokenHash'] },      // session secret — never exported
  { model: UnclassifiedTrack },
];

// Curated, non-secret slice of the User doc. Deliberately excludes OAuth token blobs
// (spotifyToken/youtubeMusicToken/wearableToken), device push-token secrets, the watchToken
// hash and garminUserIdHmac (an internal blind index) — credentials, not portable data.
function _publicProfile(u) {
  return {
    email:            u.email,
    displayName:      u.displayName,
    avatarUrl:        u.avatarUrl,
    ssoProvider:      u.ssoProvider,
    musicProvider:    u.musicProvider,
    wearableProvider: u.wearableProvider,
    garminUserId:     u.garminUserId, // subject's own Garmin account id (decrypted)
    entitlements:     u.entitlements,
    createdAt:        u.createdAt,
  };
}

async function exportUserData(userId) {
  const collections = {};
  for (const { model, redact } of COLLECTIONS) {
    // NOT .lean(): the encrypted getters must run so the subject's own health data decrypts.
    const docs = await model.find({ userId });
    collections[model.collection.name] = docs.map((d) => {
      const obj = d.toObject({ getters: true });
      if (redact) for (const key of redact) delete obj[key];
      return obj;
    });
  }

  const user = await User.findById(userId);
  return {
    exportedAt: new Date().toISOString(),
    subjectId:  String(userId),
    user:       user ? _publicProfile(user) : null,
    collections,
  };
}

module.exports = { exportUserData };
