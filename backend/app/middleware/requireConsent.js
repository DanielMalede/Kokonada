'use strict';

// Server-side hard gate for special-category (GDPR Art.9) health/biometric ingestion (audit H-9,
// decision 2: client + server enforcement). Sits AFTER auth (needs req.user) and BEFORE the
// ingest handler, so a request without a current-version consent record can never reach the
// write. Returns machine-readable reasons the client distinguishes:
//   consent_required — no grant on file (first-time prompt)
//   consent_stale    — granted, but at an older consent version (re-prompt for the new terms)

const { getConsentStatus } = require('../services/privacy/consent');
// H3a: the one definition of "current" (and of the two reasons) lives in the gate helper.
const { denialReason } = require('../services/privacy/healthConsentGate');

function requireConsent(purpose) {
  return async (req, res, next) => {
    try {
      const reason = denialReason(await getConsentStatus(req.user._id, purpose));
      if (reason) return res.status(403).json({ error: reason });
      next();
    } catch (err) { next(err); }
  };
}

module.exports = requireConsent;
