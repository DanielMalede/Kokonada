'use strict';

/**
 * OS health-store ingest bridge (Apple HealthKit / Google Health Connect).
 *
 * These stores live on the user's phone and cannot be read server-side. A React
 * Native companion app (KokonadaHealth) reads Garmin-synced data locally and pushes
 * batches here; the user's JWT authenticates the push.
 *
 * NOTE (architecture): this is now the primary Garmin-adjacent biometric path — the
 * unofficial garmin-connect credential wrapper was retired after Garmin enforced
 * mandatory MFA, and the official Garmin Health API server-to-server webhook (see
 * garminIngest.js) is still pending Garmin's approval. Once that's approved it
 * becomes the preferred path; this bridge stays as the no-login fallback either way.
 * Persistence is shared via metricStore.persistMetrics.
 */

const { normalizeHealthStoreSamples } = require('./adapter');
const { persistMetrics } = require('./metricStore');
const { GARMIN_SPECIAL_CATEGORY_METRICS } = require('./specialCategoryMetrics');
const {
  HEALTH_CONSENT_PURPOSE,
  garminSpecialCategoryAllowed,
  getGrantedConsentVersion,
} = require('../privacy/consent');

const MAX_BATCH = 2000; // a 6-month backfill is chunked client-side; cap per request

async function ingestBatch(userId, platform, samples) {
  if (Array.isArray(samples) && samples.length > MAX_BATCH) {
    throw Object.assign(new Error(`Batch too large — max ${MAX_BATCH} samples per request`), { statusCode: 400 });
  }

  const metrics = normalizeHealthStoreSamples(platform, samples);

  // Defense-in-depth Art.9 gate (mirrors garminIngest.js). The three Garmin-only special categories
  // are NOT in this lane's HEALTH_METRIC_MAP, so the normalizer above never emits them — this filter
  // is inert today. It is the backstop that keeps the invariant true if that map ever regresses (or a
  // hostile client slips one through a future path): a special category may be persisted ONLY when the
  // user's latest GRANTED consent version is >= GARMIN_CONSENT_MIN_VERSION. Fail-closed on no-grant /
  // withdrawal. (guard test: tests/healthStoreConsentVersionGate.test.js)
  const grantedVersion = await getGrantedConsentVersion(userId, HEALTH_CONSENT_PURPOSE);
  const gated = garminSpecialCategoryAllowed(grantedVersion)
    ? metrics
    : metrics.filter((m) => !GARMIN_SPECIAL_CATEGORY_METRICS.has(m.metric));

  const { inserted, profileMetrics } = await persistMetrics(userId, gated);

  // `accepted` = total recognised (and consent-lawful) samples; `inserted` = new heart-rate rows written.
  return { accepted: gated.length, inserted, profileMetrics };
}

module.exports = { ingestBatch };
