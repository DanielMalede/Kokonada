'use strict';

// Consent API (audit H-9, GDPR Art.9). Authenticated-only — mounted behind the shared auth
// middleware in routes/consent.js. Delegates all state to services/privacy/consent (the single
// source of truth for the append-only ConsentRecord); this layer is just the HTTP contract.

const {
  recordConsent, withdrawConsent, getConsentStatus, HEALTH_CONSENT_PURPOSE,
} = require('../services/privacy/consent');

// H3b (DT-S6 W-A) — a withdrawal must also reach the user's OPEN sockets. Each one holds the last
// heart rate, the play window's samples and the baseline blob in memory, and without this they were
// written into the next generation's PlaylistSession and fed to the rewards after the user withdrew.
// The sockets stay connected (a server-initiated disconnect is never retried by the client); only
// their held Art.9 state is withheld. Lazy requires, like authController: the socket module drags
// the whole handler chain in. Per process only — a second instance would need a shared adapter
// (ARCH-004). Best-effort: the withdrawal row already stands, and every later biometric the socket
// receives is refused by the gate anyway, so a failed purge is logged, never a failed response.
async function withholdLiveSockets(userId) {
  try {
    const io = require('../sockets/index').getIo();
    if (!io) return;
    const { withholdSocketBiometrics } = require('../sockets/biometricHandler');
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) withholdSocketBiometrics(s.id);
  } catch (err) {
    console.warn(`[consent-withdrawal] live-socket purge failed user=${userId}: ${err?.message ?? err}`);
  }
}

// POST /api/consent  — body { purpose, dataCategories, clientVersion, appVersion, locale }
// clientVersion (resilience-audit finding) is the contract version the CALLER's consent copy/
// categories were built against; optional for back-compat, but a mismatch is rejected (409)
// before anything is recorded — see services/privacy/consent.recordConsent.
// appVersion and locale (MB-062, REG-034): the build the grant was given in, which names the rendered
// consent screen, and the device's language setting (not the screen's language: the
// consent text has no translation yet). Optional for back-compat.
exports.grantConsent = async (req, res, next) => {
  try {
    const { purpose, dataCategories, clientVersion, appVersion, locale } = req.body || {};
    if (!purpose) return res.status(400).json({ error: 'purpose is required' });
    const result = await recordConsent(req.user._id, { purpose, dataCategories, clientVersion, appVersion, locale });
    if (!result.ok) return res.status(409).json({ error: result.reason, currentVersion: result.currentVersion });
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
    if (purpose === HEALTH_CONSENT_PURPOSE) await withholdLiveSockets(req.user._id);
    res.json(await getConsentStatus(req.user._id, purpose));
  } catch (err) { next(err); }
};
