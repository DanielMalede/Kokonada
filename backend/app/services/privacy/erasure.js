'use strict';

// The GDPR child-cascade used by DELETE /auth/account. scripts/gdpr-delete.js
// mirrors this collection list with per-collection count reporting — keep the
// two in lockstep. Deletes everything keyed to the user EXCEPT the User doc
// itself — the caller removes that LAST, so a mid-cascade failure leaves a
// retryable account, never an orphaned un-loginable one.

const BiometricLog = require('../../models/BiometricLog');
const VitalSample = require('../../models/VitalSample');
const MedicalProfile = require('../../models/MedicalProfile');
const MorningState = require('../../models/MorningState');
const { RewardEvent } = require('../../models/RewardEvent');
const { PersonalWeights } = require('../../models/PersonalWeights');
const MusicProfile = require('../../models/MusicProfile');
const PlaylistSession = require('../../models/PlaylistSession');
const ServeEvent = require('../../models/ServeEvent');
const Identity = require('../../models/Identity');
const RefreshToken = require('../../models/RefreshToken');
const UnclassifiedTrack = require('../../models/UnclassifiedTrack');
const ConsentRecord = require('../../models/ConsentRecord');
const { purgeUserKeys } = require('../../utils/userRedisPurge');
const { purgeUserJobs } = require('../../queues/userJobPurge');
const { revokeHealthConsentForDeletion } = require('./consent');

// An error's class name, or 'Error': never its message (a driver message can quote values).
const errorType = (e) => (typeof e?.name === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(e.name) ? e.name : 'Error');

// Deliberately NOT erased: AudioFeature (audiofeatures), TrackEmbedding (trackembeddings)
// and TrackCatalog (trackcatalogs) are GLOBAL, cross-user caches keyed only by recordingKey
// (a public-catalog recording's URI/MBID) — no userId, no PII. The personal association
// (which recordings a user has) lives in MusicProfile.library, which IS erased below. Adding
// these caches to a PER-USER cascade would evict every other user's rows and force costly
// re-fetches, so per-user erasure intentionally excludes them. (ADR 0008)
//
// Spotify-ToS containment reconciliation (ADR 0011): the exclusion above is about PRIVACY —
// there is no PII to erase per user. It is NOT a license to retain Spotify Content globally.
// Any spotify:-keyed rows in those caches are eliminated GLOBALLY (across all users) by the
// one-time script backend/scripts/purgeSpotifyCorpus.js — the correct axis for a ToS breach —
// while the (youtube:/mbid:) rows legitimately stay as a shared cache. The corpus write paths
// (catalog/hydration/embedding) now refuse Spotify Content, so no new spotify: rows accrue.
async function eraseUserChildData(userId) {
  // J1 (BE-074): the account's learning jobs waiting in the job queue (`bull:reward-ingest:`) go FIRST,
  // so a waiting job cannot run after the deletes below and write learned preferences back. J2 (T4): so do
  // its state-recompute jobs (`bull:state-vector-recompute:`), which would write its health data again.
  // Best-effort, like the Redis purge at the end: a Redis outage must not block the deletion, so a
  // failure is logged as one fixed line (no id, no message) and the cascade carries on. A job a worker
  // is already running is deleted by the queue once it has run (queues/userJobPurge.js).
  try {
    await purgeUserJobs(userId);
  } catch (err) {
    console.error(`[account-deletion] learning-jobs purge failed (${errorType(err)})`);
  }
  // J2 (BE-087, DT-6 M1′): then the mark, BEFORE any delete. ConsentRecord goes in the same Promise.all as
  // MedicalProfile and the User doc goes last, so without it a step that re-checks consent mid-deletion
  // reads "granted" and keeps what it wrote. A withdrawal row first (consent.revokeHealthConsentForDeletion)
  // makes every check read withdrawn from here on. Best-effort like the purge: one fixed line, no id.
  try {
    await revokeHealthConsentForDeletion(userId);
  } catch (err) {
    console.error(`[account-deletion] consent withdrawal failed (${errorType(err)})`);
  }
  await Promise.all([
    BiometricLog.deleteMany({ userId }),
    // Per-metric physiological samples (W4-004, S5) — special-category, registered in the
    // same task that created the collection.
    VitalSample.deleteMany({ userId }),
    MedicalProfile.deleteMany({ userId }),
    // Nightly consolidated readiness/sleep-debt/cosinor/CUSUM history (W4-012, S5) — registered
    // in the same task that created the collection.
    MorningState.deleteMany({ userId }),
    // Learned context-bucket rewards (W4-011, ADR-0012 Track A, S5) — the user's OWN
    // personalization, registered in the same task that created the collection. Its sibling
    // collection `TrackPosterior` is deliberately NOT here: it is a GLOBAL, CC0-only,
    // userId-less corpus artifact on the same footing as the caches named above.
    RewardEvent.deleteMany({ userId }),
    // The listener's learned scoring overlay (W4-013 B7, S5) — four music-ranking coefficients,
    // registered in the same task that created the collection. Erasing it is also the cleanest
    // possible reset: a missing row IS the cold start, so the account comes back to exactly the
    // global weights a brand-new listener gets.
    PersonalWeights.deleteMany({ userId }),
    MusicProfile.deleteMany({ userId }),
    PlaylistSession.deleteMany({ userId }),
    ServeEvent.deleteMany({ userId }),
    Identity.deleteMany({ userId }),
    RefreshToken.deleteMany({ userId }),
    UnclassifiedTrack.deleteMany({ userId }),
  ]);
  // Art.9 consent history is fully erased with the account (audit H-9, decision 3: no
  // anonymized retention ledger). Its lockstep with userDataExport.js's COLLECTIONS and
  // scripts/gdpr-delete.js is enforced by the shadow.qa4.crypto completeness guard.
  // J2 (P13 decision): LAST, once every other collection is gone, as in scripts/gdpr-delete.js. A deletion
  // that stops part-way then leaves the account with its whole consent history, the withdrawal row above
  // included, so it reads withdrawn; in the same Promise.all, the history could be erased while the
  // health data it covers stayed. Before the Redis purge, so the cascade still reads as one list.
  await ConsentRecord.deleteMany({ userId });
  await purgeUserKeys(userId);
}

module.exports = { eraseUserChildData };
