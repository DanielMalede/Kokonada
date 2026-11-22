'use strict';

/**
 * Garmin Health API ingest (server-to-server).
 *
 * Garmin's cloud pushes/backfills health summaries to our webhook. The webhook
 * receiver groups them by user (via stored garminUserId) and calls this with an
 * array of { type, summary } for ONE user. We flatten every summary to canonical
 * metrics and persist via the shared pipeline (BiometricLog + MedicalProfile).
 *
 * BE-245 (DEC-047, ADR-0018): while the Garmin music fence is closed (garminMusicFence.js, the shipped
 * default), the gates below still run, and then nothing is persisted: Garmin's data may not shape the music
 * until Garmin permits it in writing, and every store persistMetrics writes is read by generation.
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
const { garminMayShapeMusic } = require('./garminMusicFence');
const { readStoredPermissions, permitSummaries } = require('./garminPermissions');

// What the seam returns when the user holds no current Art. 9 grant: nothing was read past the consent
// row, so every count is zero.
const refusal = (code) => ({
  accepted: 0, inserted: 0, rejected: NO_REJECTS, profileMetrics: {}, droppedOutsideRetention: 0, droppedInFuture: 0, refused: code,
});

// What the seam returns while the music fence is closed: the push was admitted by both gates, and its
// `count` metrics were dropped before any store, so nothing was written and nothing was queued.
const fencedDrop = (count) => ({
  accepted: count, inserted: 0, rejected: NO_REJECTS, profileMetrics: {}, droppedOutsideRetention: 0, droppedInFuture: 0,
  refused: null, fenced: true, fencedDropped: count,
});

/**
 * @param {string} userId
 * @param {Array<{type:string, summary:object}>} items
 * @param {{now?: Date}} [options]  the clock the retention window and the future cap are measured against
 * @returns {Promise<{accepted:number, inserted:number, rejected:object, profileMetrics:object, droppedOutsideRetention:number, droppedInFuture:number, droppedNotPermitted?:number, refused:null|'consent_not_current', fenced?:boolean, fencedDropped?:number}>}
 *   `accepted` counts the metrics that cleared the normaliser and the consent gate;
 *   `fenced` is true when the music fence dropped them all before any store, `fencedDropped` how many (BE-245);
 *   `droppedOutsideRetention` counts those of them older than their store keeps, never written;
 *   `droppedInFuture` counts those stamped past `now` + MAX_FUTURE_SKEW_MS, never written;
 *   `droppedNotPermitted` counts the summaries (not metrics) dropped as outside the user's Garmin permissions (BE-219),
 *     on an unfenced return (while fenced, the `[garmin] not permitted` line carries it);
 *   `refused` is null when the push was admitted, else the code it was refused with (every count 0).
 * @throws when the consent read fails: nothing has been written, and the webhook answers 500 so Garmin retries
 */
async function ingestSummaries(userId, items, { now = new Date() } = {}) {
  // The Art. 9 gate, FIRST (BE-205, SEC-273-1). This seam used to trust its caller: only the webhook
  // controller read consent, so any other caller (a job, a script, a new route) would have stored heart
  // rate, HRV and sleep with no record, after a withdrawal or on a stale version. It now decides for
  // itself, from the latest consent row and the one definition of a current grant, before a summary is
  // normalised or a store is touched. A read error is not caught.
  const { status, latest } = await getConsentState(userId, HEALTH_CONSENT_PURPOSE);
  if (!isCurrentGrant(status)) return refusal('consent_not_current');

  // The user's Garmin permissions (BE-219), read by the seam itself from the encrypted token blob, never taken
  // from its caller: a summary type the user did not permit (garminPermissions.SUMMARY_PERMISSION) is dropped
  // before it is normalised, and counted. A user with no stored record (a link from before BE-219) is not
  // narrowed; a record that is not a list permits nothing.
  const { admitted, droppedNotPermitted } = permitSummaries(items, await readStoredPermissions(userId));
  if (droppedNotPermitted > 0) console.info(`[garmin] not permitted summaries=${droppedNotPermitted}`);

  const metrics = [];
  for (const { type, summary } of admitted) {
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

  // The music fence (BE-245, DEC-047). Closed: no BiometricLog, VitalSample or MedicalProfile write and no
  // state-vector recompute queued, so no baseline, state, target or live recalibration can move on Garmin's
  // data. One count-only line (T1): never the user id, never a value.
  if (!garminMayShapeMusic()) {
    console.info(`[garmin] fenced metrics=${gated.length}`);
    return fencedDrop(gated.length);
  }

  // Retention (T2). Garmin hands this lane history: the webhook's backfill reaches back 182 days
  // (garmin.js requestSixMonthBackfill), while BiometricLog and VitalSample keep 90 days by default.
  // The part older than that used to be written, folded into MedicalProfile, and reaped on arrival;
  // the store now drops it before any write and reports how many metrics it dropped.
  // Future cap (BE-206). The webhook lane has no contract in front of it, so a summary stamped past the
  // clock would be written, and a far-future night would hold MedicalProfile.lastNightSleep for good. The
  // store drops those too, with the one allowance the other ingest doors use, and counts them.
  const { inserted, rejected, profileMetrics, droppedOutsideRetention, droppedInFuture } =
    await persistMetrics(userId, gated, { dropOutsideRetention: true, dropInFuture: true, now });
  return { accepted: gated.length, inserted, rejected, profileMetrics, droppedOutsideRetention, droppedInFuture, droppedNotPermitted, refused: null };
}

module.exports = { ingestSummaries, GARMIN_SPECIAL_CATEGORY_METRICS };
