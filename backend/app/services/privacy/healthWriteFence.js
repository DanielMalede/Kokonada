'use strict';

// J2 (BE-087; round 1, M1): the state-recompute job's gate, in a module of its own. It requires only the
// import-light consent read (consentState.js) and the User model, so the job no longer loads the consent
// service and, through its withdrawal erasure, ServeEvent (the isolation pin, P15 in
// tests/shadow.fullSystem.test.js). healthConsentGate.js re-exports it.

const User = require('../../models/User');
const { getConsentState, verdictOf, HEALTH_CONSENT_PURPOSE } = require('./consentState');

const refused = (reason) => ({ admitted: false, reason, fence: null });

/**
 * J2 (BE-087; DT-4 A1, DT-5 W-c) — the state-recompute job's gate. The job asks it before it reads any
 * health data, and again once it has written: does the account still exist, and does it hold a CURRENT
 * health-data grant? Returns `{ admitted, reason, fence }`. Never throws.
 *
 *   admitted — the account exists, carries no `deletedAt`, and its latest consent row is a current grant
 *              (the same rule as healthProcessingVerdict: `verdictOf`, `isCurrentGrant`).
 *   reason   — null when admitted, otherwise one closed token:
 *     user_missing        no User doc carries the id. Definitive: both deletion doors remove the User doc
 *                         LAST (authController.deleteAccount, scripts/gdpr-delete.js), so its absence means
 *                         the account is gone, and only its absence: a read that FAILS is never this;
 *     user_flagged        the User doc carries `deletedAt`;
 *     consent_not_current the store answered and the grant is not current (or no id was given);
 *     consent_read_error  either read failed, the account's or the consent's, so nothing about the
 *                         account can be said. An id that cannot name an account (not an ObjectId) fails
 *                         the read too. No error text is carried: a driver message can quote values.
 *   fence    — when admitted, the latest consent row's _id as a string; null otherwise. Every new row
 *              changes it, so a second ask that returns another fence saw the consent change in between,
 *              even a withdraw-then-re-grant that reads granted again.
 *
 * Both reads go to the PRIMARY. The second ask follows the job's own write and must see a deletion or a
 * withdrawal written before it (HX-1); ConsentRecord.latestFor pins the consent read, this the account read.
 */
async function healthWriteFence(userId) {
  if (!userId) return refused('consent_not_current');
  let account;
  try {
    account = await User.findById(userId).select('deletedAt').read('primary').lean();
  } catch {
    return refused('consent_read_error');
  }
  if (!account) return refused('user_missing');
  if (account.deletedAt != null) return refused('user_flagged');
  let state;
  try {
    state = await getConsentState(userId, HEALTH_CONSENT_PURPOSE);
  } catch {
    return refused('consent_read_error');
  }
  const verdict = verdictOf(state?.status);
  if (!verdict.admitted || !state.latest?._id) return refused('consent_not_current');
  return { ...verdict, fence: String(state.latest._id) };
}

module.exports = { healthWriteFence };
