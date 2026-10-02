'use strict';

// H3a — ONE definition of "a CURRENT Art.9 grant" for every server boundary that admits or persists
// a biometric value: the requireConsent middleware, the inline REST gates (device-token and
// server-to-server routes have no req.user for the middleware) and the socket events. The rule used
// to be copied by hand in five places; the P5 consent-version transition window edits only this.
//
// The consent service is read at CALL time through the module object, never destructured at load:
// several suites jest.mock it with a partial surface (requireConsent.test.js mocks getConsentStatus
// only), and a load-time destructure would freeze whatever that suite's mock happened to export.

const consent = require('./consent');
const User = require('../../models/User');

/** THE definition. Fails closed on anything unshaped (mirrors the mobile healthLane.isCurrentGrant). */
function isCurrentGrant(status) {
  return !!status && status.granted === true && status.staleVersion === false;
}

/** A status the store answered with, as a verdict: the one mapping both socket-side gates share. */
function verdictOf(status) {
  return isCurrentGrant(status)
    ? { admitted: true, reason: null }
    : { admitted: false, reason: 'consent_not_current' };
}

/** The machine-readable 403 reason for a status that is not current; null when it is. */
function denialReason(status) {
  if (isCurrentGrant(status)) return null;
  return status && status.granted === true ? 'consent_stale' : 'consent_required';
}

/**
 * The socket form, with its reason: may this user's biometric input be processed right now, and if
 * not, why? Never throws. `consent_not_current` when the store answered and the grant is not current
 * (withdrawn, never granted, stale, or no identity); `consent_read_error` when the store could not be
 * read — fail closed either way. The error itself is not carried: its message can quote values.
 * The user id is passed to the consent service exactly as received.
 */
async function healthProcessingVerdict(userId) {
  if (!userId) return { admitted: false, reason: 'consent_not_current' };
  let status;
  try {
    status = await consent.getConsentStatus(userId, consent.HEALTH_CONSENT_PURPOSE);
  } catch {
    return { admitted: false, reason: 'consent_read_error' };
  }
  return verdictOf(status);
}

/** The socket form: the verdict's admitted bit. Never throws; fails closed (see above). */
async function admitHealthProcessing(userId) {
  return (await healthProcessingVerdict(userId)).admitted;
}

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
    state = await consent.getConsentState(userId, consent.HEALTH_CONSENT_PURPOSE);
  } catch {
    return refused('consent_read_error');
  }
  const verdict = verdictOf(state?.status);
  if (!verdict.admitted || !state.latest?._id) return refused('consent_not_current');
  return { ...verdict, fence: String(state.latest._id) };
}

module.exports = {
  isCurrentGrant, denialReason, healthProcessingVerdict, admitHealthProcessing, healthWriteFence,
};
