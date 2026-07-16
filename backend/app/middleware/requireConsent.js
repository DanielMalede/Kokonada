'use strict';

// Server-side hard gate for special-category (GDPR Art.9) health/biometric ingestion (audit H-9,
// decision 2: client + server enforcement). Sits AFTER auth (needs req.user) and BEFORE the
// ingest handler, so a request without a current-version consent record can never reach the
// write. Returns machine-readable reasons the client distinguishes:
//   consent_required — no grant on file (first-time prompt)
//   consent_stale    — granted, but at an older consent version (re-prompt for the new terms)

const { getConsentStatus } = require('../services/privacy/consent');

function requireConsent(purpose) {
  return async (req, res, next) => {
    try {
      const status = await getConsentStatus(req.user._id, purpose);
      if (!status.granted)     return res.status(403).json({ error: 'consent_required' });
      if (status.staleVersion) return res.status(403).json({ error: 'consent_stale' });
      next();
    } catch (err) { next(err); }
  };
}

module.exports = requireConsent;
