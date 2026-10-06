'use strict';

// The gates every server boundary that admits or persists a biometric value asks: the requireConsent
// middleware's 403 reason, the socket forms, and (re-exported) the state-recompute job's fence. H3a's ONE
// definition of "a CURRENT Art.9 grant" lives in consentState.js (J2 round 1, M1) and is used from there.
//
// The consent service is read at CALL time through the module object, never destructured at load:
// several suites jest.mock it with a partial surface (requireConsent.test.js mocks getConsentStatus
// only), and a load-time destructure would freeze whatever that suite's mock happened to export.

const consent = require('./consent');
// H3a's one definition of a current grant, and the verdict mapping, live in consentState.js (J2 round 1, M1);
// the state-recompute job's fence lives in healthWriteFence.js. Both are re-exported below unchanged.
const { isCurrentGrant, verdictOf } = require('./consentState');
const { healthWriteFence } = require('./healthWriteFence');

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

module.exports = {
  isCurrentGrant, denialReason, healthProcessingVerdict, admitHealthProcessing, healthWriteFence,
};
