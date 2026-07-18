'use strict';

/**
 * Garmin Health API ingest (server-to-server).
 *
 * Garmin's cloud pushes/backfills health summaries to our webhook. The webhook
 * receiver groups them by user (via stored garminUserId) and calls this with an
 * array of { type, summary } for ONE user. We flatten every summary to canonical
 * metrics and persist via the shared pipeline (BiometricLog + MedicalProfile).
 */

const { normalizeGarminSummaries } = require('./adapter');
const { persistMetrics } = require('./metricStore');
const {
  HEALTH_CONSENT_PURPOSE,
  garminSpecialCategoryAllowed,
  getGrantedConsentVersion,
} = require('../privacy/consent');

// The Garmin-only special-category (GDPR Art.9) canonical metrics — spo2 / respiratory_rate /
// body_battery in adapter.js's normalizer. These are DISCLOSED to the user but only lawful to
// process once they re-consent at GARMIN_CONSENT_MIN_VERSION; below that they are dropped at
// ingest. The HC-lane metrics (heartRate / restingHeartRate / hrv / sleep*, lawful at v1) are
// NOT in this set and always pass through. (guard test: tests/garminConsentVersionGate.test.js)
const GARMIN_SPECIAL_CATEGORY_METRICS = new Set(['spO2', 'respirationRate', 'bodyBattery']);

/**
 * @param {string} userId
 * @param {Array<{type:string, summary:object}>} items
 * @returns {Promise<{accepted:number, inserted:number, profileMetrics:object}>}
 */
async function ingestSummaries(userId, items) {
  const metrics = [];
  for (const { type, summary } of items || []) {
    for (const m of normalizeGarminSummaries(type, summary)) metrics.push(m);
  }

  // ENFORCED consent-version gate (audit H-9 follow-up, replaces a prose "MUST bump" comment).
  // The three Garmin-only special categories may be persisted ONLY when the user's latest GRANTED
  // consent version is >= GARMIN_CONSENT_MIN_VERSION. Inert while the lane is dormant (everyone is
  // at v1 < min), so they are dropped here; when the lane goes live and CURRENT_CONSENT_VERSION is
  // bumped to the min, only re-consented users clear the gate. The HC-lane metrics are unaffected.
  const grantedVersion = await getGrantedConsentVersion(userId, HEALTH_CONSENT_PURPOSE);
  const gated = garminSpecialCategoryAllowed(grantedVersion)
    ? metrics
    : metrics.filter((m) => !GARMIN_SPECIAL_CATEGORY_METRICS.has(m.metric));

  const { inserted, profileMetrics } = await persistMetrics(userId, gated);
  return { accepted: gated.length, inserted, profileMetrics };
}

module.exports = { ingestSummaries, GARMIN_SPECIAL_CATEGORY_METRICS };
