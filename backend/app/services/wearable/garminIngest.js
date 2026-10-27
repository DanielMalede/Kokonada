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
const { NO_REJECTS } = require('./insertAccounted');
const { GARMIN_SPECIAL_CATEGORY_METRICS } = require('./specialCategoryMetrics');
const {
  HEALTH_CONSENT_PURPOSE,
  garminSpecialCategoryAllowed,
  getConsentState,
} = require('../privacy/consent');
const { isCurrentGrant } = require('../privacy/consentState');

// What the seam returns when the user holds no current Art. 9 grant: nothing was read past the consent
// row, so every count is zero.
const refusal = (code) => ({
  accepted: 0, inserted: 0, rejected: NO_REJECTS, profileMetrics: {}, droppedOutsideRetention: 0, refused: code,
});

/**
 * @param {string} userId
 * @param {Array<{type:string, summary:object}>} items
 * @returns {Promise<{accepted:number, inserted:number, rejected:object, profileMetrics:object, droppedOutsideRetention:number, refused:null|'consent_not_current'}>}
 *   `accepted` counts the metrics that cleared the normaliser and the consent gate;
 *   `droppedOutsideRetention` counts those of them older than their store keeps, never written;
 *   `refused` is null when the push was admitted, else the code it was refused with (every count 0).
 * @throws when the consent read fails: nothing has been written, and the webhook answers 500 so Garmin retries
 */
async function ingestSummaries(userId, items) {
  // The Art. 9 gate, FIRST (BE-205, SEC-273-1). This seam used to trust its caller: only the webhook
  // controller read consent, so any other caller (the personal lane's pull job) would have stored heart
  // rate, HRV and sleep with no record, after a withdrawal or on a stale version. It now decides for
  // itself, from the latest consent row and the one definition of a current grant, before a summary is
  // normalised or a store is touched. A read error is not caught.
  const { status, latest } = await getConsentState(userId, HEALTH_CONSENT_PURPOSE);
  if (!isCurrentGrant(status)) return refusal('consent_not_current');

  const metrics = [];
  for (const { type, summary } of items || []) {
    for (const m of normalizeGarminSummaries(type, summary)) metrics.push(m);
  }

  // ENFORCED consent-version gate (audit H-9 follow-up, replaces a prose "MUST bump" comment).
  // The three Garmin-only special categories may be persisted ONLY when the user's latest GRANTED
  // consent version is >= GARMIN_CONSENT_MIN_VERSION. Inert while the lane is dormant (everyone is
  // at v1 < min), so they are dropped here; when the lane goes live and CURRENT_CONSENT_VERSION is
  // bumped to the min, only re-consented users clear the gate. The HC-lane metrics are unaffected.
  // The version is read off the same row the grant was decided from, so the two cannot disagree.
  const gated = garminSpecialCategoryAllowed(latest.consentVersion)
    ? metrics
    : metrics.filter((m) => !GARMIN_SPECIAL_CATEGORY_METRICS.has(m.metric));

  // Retention (T2). Garmin hands this lane history: the webhook's backfill reaches back 182 days
  // (garmin.js requestSixMonthBackfill) and the personal lane's first pull covers the whole window,
  // while BiometricLog and VitalSample keep 90 days by default. The part older than that used to be
  // written, folded into MedicalProfile, and reaped on arrival; the store now drops it before any
  // write and reports how many metrics it dropped.
  const { inserted, rejected, profileMetrics, droppedOutsideRetention } =
    await persistMetrics(userId, gated, { dropOutsideRetention: true });
  return { accepted: gated.length, inserted, rejected, profileMetrics, droppedOutsideRetention, refused: null };
}

module.exports = { ingestSummaries, GARMIN_SPECIAL_CATEGORY_METRICS };
