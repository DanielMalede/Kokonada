'use strict';

// The GDPR child-cascade used by DELETE /auth/account. scripts/gdpr-delete.js
// mirrors this collection list with per-collection count reporting — keep the
// two in lockstep. Deletes everything keyed to the user EXCEPT the User doc
// itself — the caller removes that LAST, so a mid-cascade failure leaves a
// retryable account, never an orphaned un-loginable one.

const BiometricLog = require('../../models/BiometricLog');
const MedicalProfile = require('../../models/MedicalProfile');
const MusicProfile = require('../../models/MusicProfile');
const PlaylistSession = require('../../models/PlaylistSession');
const ServeEvent = require('../../models/ServeEvent');
const Identity = require('../../models/Identity');
const RefreshToken = require('../../models/RefreshToken');
const UnclassifiedTrack = require('../../models/UnclassifiedTrack');
const { purgeUserKeys } = require('../../utils/userRedisPurge');

// Deliberately NOT erased: AudioFeature (audiofeatures) and TrackEmbedding
// (trackembeddings) are GLOBAL, cross-user caches keyed only by recordingKey
// (spotify:/youtube: URI of a public-catalog recording) — no userId, no PII. The
// personal association (which recordings a user has) lives in MusicProfile.library,
// which IS erased below. Adding these caches to the cascade would evict every other
// user's rows and force costly re-fetches — it is intentionally excluded. (ADR 0008)
async function eraseUserChildData(userId) {
  await Promise.all([
    BiometricLog.deleteMany({ userId }),
    MedicalProfile.deleteMany({ userId }),
    MusicProfile.deleteMany({ userId }),
    PlaylistSession.deleteMany({ userId }),
    ServeEvent.deleteMany({ userId }),
    Identity.deleteMany({ userId }),
    RefreshToken.deleteMany({ userId }),
    UnclassifiedTrack.deleteMany({ userId }),
  ]);
  await purgeUserKeys(userId);
}

module.exports = { eraseUserChildData };
