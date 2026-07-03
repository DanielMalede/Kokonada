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
const { purgeUserKeys } = require('../../utils/userRedisPurge');

async function eraseUserChildData(userId) {
  await Promise.all([
    BiometricLog.deleteMany({ userId }),
    MedicalProfile.deleteMany({ userId }),
    MusicProfile.deleteMany({ userId }),
    PlaylistSession.deleteMany({ userId }),
    ServeEvent.deleteMany({ userId }),
    Identity.deleteMany({ userId }),
    RefreshToken.deleteMany({ userId }),
  ]);
  await purgeUserKeys(userId);
}

module.exports = { eraseUserChildData };
