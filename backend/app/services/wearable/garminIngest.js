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

  const { inserted, profileMetrics } = await persistMetrics(userId, metrics);
  return { accepted: metrics.length, inserted, profileMetrics };
}

module.exports = { ingestSummaries };
