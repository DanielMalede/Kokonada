'use strict';

// Consent API (audit H-9, GDPR Art.9). Authenticated-only — mounted behind the shared auth
// middleware in routes/consent.js. Delegates all state to services/privacy/consent (the single
// source of truth for the append-only ConsentRecord); this layer is just the HTTP contract.

const { recordConsent, withdrawConsent, getConsentStatus } = require('../services/privacy/consent');

// POST /api/consent  — body { purpose, dataCategories }
exports.grantConsent = async (req, res, next) => {
  try {
    const { purpose, dataCategories } = req.body || {};
    if (!purpose) return res.status(400).json({ error: 'purpose is required' });
    await recordConsent(req.user._id, { purpose, dataCategories });
    // Echo the fresh, canonical status so the client confirms the new state in one round trip.
    res.status(201).json(await getConsentStatus(req.user._id, purpose));
  } catch (err) { next(err); }
};

// GET /api/consent/status?purpose=...
exports.getStatus = async (req, res, next) => {
  try {
    const purpose = req.query?.purpose;
    if (!purpose) return res.status(400).json({ error: 'purpose is required' });
    res.json(await getConsentStatus(req.user._id, purpose));
  } catch (err) { next(err); }
};

// POST /api/consent/withdraw  — body { purpose }
// The service also erases the wearable footprint on withdrawal (data-minimization).
exports.withdraw = async (req, res, next) => {
  try {
    const { purpose } = req.body || {};
    if (!purpose) return res.status(400).json({ error: 'purpose is required' });
    await withdrawConsent(req.user._id, purpose);
    res.json(await getConsentStatus(req.user._id, purpose));
  } catch (err) { next(err); }
};
