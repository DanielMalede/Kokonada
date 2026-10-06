'use strict';

// The consent READ, and H3a's ONE definition of "a CURRENT Art.9 grant", in a module that requires nothing but
// the ConsentRecord model (J2 round 1, M1). The consent service (consent.js) also erases on a withdrawal, so it
// loads the wearable, learning and session-health erasures, and with them ServeEvent; a caller that only needs
// to know whether consent stands (the state-recompute job's fence, healthWriteFence.js) reads it here, without
// that weight. consent.js and healthConsentGate.js re-export these as the same objects: one definition each
// (pinned in tests/consentState.identity.test.js).

const ConsentRecord = require('../../models/ConsentRecord');

// CROSS-PACKAGE CONTRACT: the mobile client reads this to decide whether an on-file grant is
// still current (a bump re-prompts before the OS health sheet). Bump this — and update the
// consent copy / dataCategories it stands for — whenever the terms materially change.
const CURRENT_CONSENT_VERSION = 1;

// The one purpose enum value in use today (ConsentRecord.js schema). Exported so every call
// site (routes/integrations.js's requireConsent mounts, watchHrIngest's inline gate, the mobile
// CONSENT_PURPOSE contract) shares ONE literal instead of drifting copies.
const HEALTH_CONSENT_PURPOSE = 'health_biometric_processing';

// The status a latest row stands for. staleVersion means the user IS granted but at an older
// contract version — the client should re-prompt, and the server treats it as not-current
// (distinct from a first-time "no record" case).
function statusOf(latest) {
  const granted = !!latest && latest.status === 'granted';
  return {
    granted,
    currentVersion: CURRENT_CONSENT_VERSION,
    staleVersion: granted && latest.consentVersion < CURRENT_CONSENT_VERSION,
  };
}

// J2 (BE-087): the same read and the same rule as getConsentStatus, together with the latest row the
// status was decided from. A caller that asks twice around a write (healthWriteFence.js) compares the
// rows' _ids: every new row changes it — a withdrawal, a re-grant — even when the status reads the same
// again.
async function getConsentState(userId, purpose) {
  const latest = await ConsentRecord.latestFor(userId, purpose);
  return { status: statusOf(latest), latest };
}

// The read the server gate and the client both consume.
async function getConsentStatus(userId, purpose) {
  return (await getConsentState(userId, purpose)).status;
}

// H3a — ONE definition of "a CURRENT Art.9 grant" for every server boundary that admits or persists
// a biometric value: the requireConsent middleware, the inline REST gates (device-token and
// server-to-server routes have no req.user for the middleware), the socket events and the state-recompute
// job. The rule used to be copied by hand in five places; the P5 consent-version transition window edits
// only this.

/** THE definition. Fails closed on anything unshaped (mirrors the mobile healthLane.isCurrentGrant). */
function isCurrentGrant(status) {
  return !!status && status.granted === true && status.staleVersion === false;
}

/** A status the store answered with, as a verdict: the one mapping every socket-side gate shares. */
function verdictOf(status) {
  return isCurrentGrant(status)
    ? { admitted: true, reason: null }
    : { admitted: false, reason: 'consent_not_current' };
}

module.exports = {
  CURRENT_CONSENT_VERSION,
  HEALTH_CONSENT_PURPOSE,
  statusOf,
  getConsentState,
  getConsentStatus,
  isCurrentGrant,
  verdictOf,
};
