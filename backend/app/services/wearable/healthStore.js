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

const MAX_BATCH = 2000; // a 6-month backfill is chunked client-side; cap per request

async function ingestBatch(userId, platform, samples) {
  if (Array.isArray(samples) && samples.length > MAX_BATCH) {
    throw Object.assign(new Error(`Batch too large — max ${MAX_BATCH} samples per request`), { statusCode: 400 });
  }

  const metrics = normalizeHealthStoreSamples(platform, samples);
  const { inserted, profileMetrics } = await persistMetrics(userId, metrics);

  // `accepted` = total recognised samples; `inserted` = new heart-rate rows written.
  return { accepted: metrics.length, inserted, profileMetrics };
}

module.exports = { ingestBatch };
