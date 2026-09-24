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

/** THE definition. Fails closed on anything unshaped (mirrors the mobile healthLane.isCurrentGrant). */
function isCurrentGrant(status) {
  return !!status && status.granted === true && status.staleVersion === false;
}

/** The machine-readable 403 reason for a status that is not current; null when it is. */
function denialReason(status) {
  if (isCurrentGrant(status)) return null;
  return status && status.granted === true ? 'consent_stale' : 'consent_required';
}

/**
 * The socket form: may this user's biometric input be processed right now? Never throws — a
 * missing identity or a consent-store failure answers false (fail closed). The user id is passed to
 * the consent service exactly as received.
 */
async function admitHealthProcessing(userId) {
  if (!userId) return false;
  try {
    return isCurrentGrant(await consent.getConsentStatus(userId, consent.HEALTH_CONSENT_PURPOSE));
  } catch {
    return false;
  }
}

module.exports = { isCurrentGrant, denialReason, admitHealthProcessing };
