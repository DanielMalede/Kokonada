'use strict';

// Consent service (audit H-9, GDPR Art.9). The single place the app grants / withdraws / reads
// explicit consent for processing special-category health/biometric data. Writes are append-only
// rows on ConsentRecord — the user's CURRENT state is always the LATEST row (never "any grant").

const ConsentRecord = require('../../models/ConsentRecord');
const User = require('../../models/User');
const { WEARABLE_PROVIDERS, eraseWearableProvider } = require('./wearableErasure');

// CROSS-PACKAGE CONTRACT: the mobile client reads this to decide whether an on-file grant is
// still current (a bump re-prompts before the OS health sheet). Bump this — and update the
// consent copy / dataCategories it stands for — whenever the terms materially change.
const CURRENT_CONSENT_VERSION = 1;

// The one purpose enum value in use today (ConsentRecord.js schema). Exported so every call
// site (routes/integrations.js's requireConsent mounts, watchHrIngest's inline gate, the mobile
// CONSENT_PURPOSE contract) shares ONE literal instead of drifting copies.
const HEALTH_CONSENT_PURPOSE = 'health_biometric_processing';

// Records a granted consent at the current version. `dataCategories` is the special-category
// data the user agreed to; kept as sent so the record reflects exactly what was shown.
//
// `clientVersion` (resilience-audit finding) is the contract version the CLIENT's own consent
// copy/dataCategories were built against — optional for back-compat (an older client that
// doesn't send it is recorded as before), but when present it MUST equal CURRENT_CONSENT_VERSION.
// Without this check, a server-only version bump would let an un-updated app's grant silently
// record as "current" even though the user was shown the OLD terms — the exact gap this closes.
// A mismatch in EITHER direction (client behind OR client ahead, e.g. a server rollback behind a
// newer client) is rejected — never silently trusted — and no row is written.
async function recordConsent(userId, { purpose, dataCategories, appVersion, locale, clientVersion } = {}) {
  if (clientVersion !== undefined && clientVersion !== CURRENT_CONSENT_VERSION) {
    return { ok: false, reason: 'stale_client', currentVersion: CURRENT_CONSENT_VERSION };
  }
  const record = await ConsentRecord.create({
    userId,
    purpose,
    consentVersion: CURRENT_CONSENT_VERSION,
    dataCategories: Array.isArray(dataCategories) ? dataCategories : [],
    status: 'granted',
    grantedAt: new Date(),
    appVersion,
    locale,
  });
  return { ok: true, record };
}

// Records a withdrawal AND erases the wearable footprint. JUDGMENT CALL: a consent "purpose"
// (health_biometric_processing) spans EVERY wearable provider, whereas the reused primitive
// eraseWearableProvider(user, provider) is scoped to ONE provider. Withdrawing the purpose must
// leave no residual special-category data behind — including samples from a previously-connected
// wearable still sitting in BiometricLog — so we erase across ALL providers rather than just the
// currently-active one. Redundant no-op erasures on unconnected providers are acceptable for a
// rare, user-initiated action. We reuse the existing per-provider primitive (no new erasure
// machinery); MedicalProfile drops once the last provider's samples are gone.
async function withdrawConsent(userId, purpose) {
  const record = await ConsentRecord.create({
    userId,
    purpose,
    consentVersion: CURRENT_CONSENT_VERSION,
    status: 'withdrawn',
    withdrawnAt: new Date(),
  });

  // The withdrawal row is written FIRST and stands regardless of what follows — consent is
  // revoked (the server gate re-checks the record, not erasure completeness) even if an
  // erasure attempt below fails. Each provider is isolated so a mid-loop throw (e.g. a
  // transient Mongo timeout) does not abort erasure of the REMAINING providers (resilience-
  // audit finding: a bare sequential loop would silently leave residual data on providers
  // after the one that threw). Failures are collected, not swallowed, so an operator can see
  // an incomplete erasure and retry — they do not fail withdrawConsent itself.
  const erasureFailures = [];
  const user = await User.findById(userId);
  if (user) {
    for (const provider of WEARABLE_PROVIDERS) {
      try {
        await eraseWearableProvider(user, provider);
      } catch {
        erasureFailures.push(provider);
      }
    }
  }

  // Explicit shape (not a spread of the Mongoose document — `create()` returns a real Document
  // whose getters/virtuals don't survive `{...record}`; no current caller reads the return
  // value beyond `record`/`erasureFailures`, but keep the contract unambiguous for the next one).
  return { record, erasureFailures };
}

// The read the server gate and the client both consume. staleVersion means the user IS granted
// but at an older contract version — the client should re-prompt, and the server treats it as
// not-current (distinct from a first-time "no record" case).
async function getConsentStatus(userId, purpose) {
  const latest = await ConsentRecord.latestFor(userId, purpose);
  const granted = !!latest && latest.status === 'granted';
  return {
    granted,
    currentVersion: CURRENT_CONSENT_VERSION,
    staleVersion: granted && latest.consentVersion < CURRENT_CONSENT_VERSION,
  };
}

module.exports = { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE, recordConsent, withdrawConsent, getConsentStatus };
