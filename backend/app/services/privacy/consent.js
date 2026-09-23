'use strict';

// Consent service (audit H-9, GDPR Art.9). The single place the app grants / withdraws / reads
// explicit consent for processing special-category health/biometric data. Writes are append-only
// rows on ConsentRecord — the user's CURRENT state is always the LATEST row (never "any grant").

const ConsentRecord = require('../../models/ConsentRecord');
const User = require('../../models/User');
const { WEARABLE_PROVIDERS, eraseWearableProvider } = require('./wearableErasure');
const { purgeLearnedPersonalization } = require('./learningErasure');

// CROSS-PACKAGE CONTRACT: the mobile client reads this to decide whether an on-file grant is
// still current (a bump re-prompts before the OS health sheet). Bump this — and update the
// consent copy / dataCategories it stands for — whenever the terms materially change.
const CURRENT_CONSENT_VERSION = 1;

// ENFORCED go-live gate for the Garmin server-to-server lane's special-category (GDPR Art.9)
// types — spo2 / respiratory_rate / body_battery (mobile consentApi.ts GARMIN_ONLY_DATA_CATEGORIES).
// Health Connect on this client does NOT read them, so today they are DISCLOSED but the lane that
// would actually process them is DORMANT. This constant is the consent version at which processing
// those three becomes lawful; garminIngest.js DROPS them until the user's granted version reaches
// it (guard test: tests/garminConsentVersionGate.test.js). It sits ABOVE CURRENT_CONSENT_VERSION
// on purpose: flipping the lane live means bumping CURRENT_CONSENT_VERSION (and the mobile
// CONSENT_SCREEN_VERSION in lockstep) to this value, which forces existing v1 grantors to
// re-consent before any of the three is ever persisted. The tripwire test fails if the two drift
// into alignment without a conscious bump.
const GARMIN_CONSENT_MIN_VERSION = 2;

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
//
// It ALSO erases the learned personalization (BE-015 / ADR-0015) — see the block below.
async function withdrawConsent(userId, purpose) {
  // Read the grant state BEFORE the withdrawal row is written. ORDER IS LOAD-BEARING: after the
  // create() below, `latestFor` IS the withdrawal we just wrote, so this would read 'withdrawn'
  // every time and the learning purge would never run for anyone. The integration test's main
  // assertion fails outright if this read is moved down.
  const priorConsent = await ConsentRecord.latestFor(userId, purpose);
  const hadGrantOnFile = priorConsent?.status === 'granted';

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
  // GUARDED. This lookup was the one unguarded await in the erasure block, and it failed in the
  // UNSAFE direction: the per-provider loop below is carefully isolated, but a transient Mongo
  // error here (a replica-set step-down, a redeploy mid-request) rejected withdrawConsent AFTER
  // the withdrawal row was committed and BEFORE the learning purge — so consent was revoked, the
  // learned personalization survived, and the Art.5(2) accountability line never emitted, leaving
  // no record anywhere that the promised erasure had not happened. The comment above says the
  // withdrawal row "stands regardless of what follows"; that was true of the row and false of the
  // erasure. Now the purge and the log still run, and the operator sees WHICH step failed.
  let user = null;
  try {
    user = await User.findById(userId);
  } catch {
    erasureFailures.push('user-lookup');
  }
  if (user) {
    for (const provider of WEARABLE_PROVIDERS) {
      try {
        await eraseWearableProvider(user, provider);
      } catch {
        erasureFailures.push(provider);
      }
    }
  }

  // Everything collected so far is a PROVIDER failure; captured before the learning block so the
  // two are never conflated in the count below.
  const providerErasureFailures = erasureFailures.length;

  // The learned personalization (BE-015 / ADR-0015). OUTSIDE the provider loop, deliberately:
  // `RewardEvent` / `PersonalWeights` are addressed by the USER alone — there is no provider in a
  // taste profile — so running this per-provider would repeat a whole-user delete four times. It
  // also runs whether or not a User doc was found: these rows are keyed by userId and need no
  // credential to erase. Its own try/catch, contributing a DISTINCT 'learning' entry rather than
  // a provider name, so an operator reading `erasureFailures` sees WHICH promise went unkept —
  // a learning failure misfiled as a provider failure would send them to retry the wrong thing.
  //
  // GUARDED on an actual grant. POST /api/consent/withdraw is directly callable by any
  // authenticated client and the UI only HIDES the button, so a mood-only listener who never
  // granted health consent can reach this path. For them the erasure was never promised and the
  // data was never covered by the consent being withdrawn — destroying their taste model would
  // be over-erasure of exactly the kind wearableErasure.js's exclusion rationale argues against.
  let learning = 'skipped';
  let learningPurged = { rewardEvents: 0, personalWeights: 0 };
  if (hadGrantOnFile) {
    try {
      learningPurged = await purgeLearnedPersonalization(userId);
      learning = 'purged';
    } catch {
      learning = 'failed';
      erasureFailures.push('learning');
    }
  }

  // GDPR Art.5(2) accountability: the controller must be able to DEMONSTRATE the erasure ran.
  // consentController.withdraw discards this function's return value, so without this line the
  // `erasureFailures` list an operator is meant to act on reaches nobody, and there is no record
  // anywhere that the promised erasure happened. ONE line, COUNTS ONLY — never a value, never a
  // bucket coordinate (ADR-0005: biometrics are never logged), on the same footing as
  // utils/biometricAudit's values-free access record.
  console.info(
    `[consent-withdrawal] user=${userId} purpose=${purpose} `
    + `providerErasureFailures=${providerErasureFailures} learning=${learning} `
    + `rewardEvents=${learningPurged.rewardEvents} personalWeights=${learningPurged.personalWeights}`,
  );

  // Explicit shape (not a spread of the Mongoose document — `create()` returns a real Document
  // whose getters/virtuals don't survive `{...record}`; no current caller reads the return
  // value beyond `record`/`erasureFailures`, but keep the contract unambiguous for the next one).
  return { record, erasureFailures };
}

// TRUE once the user has re-consented at (or above) the version where the Garmin lane's
// special-category processing is lawful. A pure predicate on a version number; a non-number
// (undefined / null / "no grant" sentinel) reads below the min → fails closed.
function garminSpecialCategoryAllowed(consentVersion) {
  return Number(consentVersion) >= GARMIN_CONSENT_MIN_VERSION;
}

// The version stamped on the user's CURRENT (latest) consent row IFF it is a grant, else 0.
// Distinct from getConsentStatus (which returns booleans) because the Garmin lane's version gate
// needs the raw number to compare against GARMIN_CONSENT_MIN_VERSION. A withdrawn/absent latest
// yields 0 — below any real version — so the gate fails closed.
async function getGrantedConsentVersion(userId, purpose) {
  const latest = await ConsentRecord.latestFor(userId, purpose);
  return latest && latest.status === 'granted' ? latest.consentVersion : 0;
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

module.exports = {
  CURRENT_CONSENT_VERSION,
  GARMIN_CONSENT_MIN_VERSION,
  HEALTH_CONSENT_PURPOSE,
  recordConsent,
  withdrawConsent,
  getConsentStatus,
  garminSpecialCategoryAllowed,
  getGrantedConsentVersion,
};
