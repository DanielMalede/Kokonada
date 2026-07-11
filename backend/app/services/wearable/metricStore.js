'use strict';

// Shared persistence for canonical metric records, used by every wearable source
// (Health Connect bridge, Garmin Health API, …): heartRate → BiometricLog
// (encrypted, deduped time-series), profile scalars → MedicalProfile (median-
// aggregated, encrypted). Keeping this in one place means a new source only needs
// a payload→metric normalizer.

const BiometricLog   = require('../../models/BiometricLog');
const MedicalProfile = require('../../models/MedicalProfile');
const { aggregateProfileMetrics, computeLastNightSleep } = require('../medicalProfileService');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');

// Aggregated metric keys that live on a NESTED MedicalProfile path; others map 1:1.
const METRIC_FIELD_PATHS = {
  sleepDeep:  'sleepStages.deep',
  sleepLight: 'sleepStages.light',
  sleepRem:   'sleepStages.rem',
};

/**
 * @param {string} userId
 * @param {Array<{metric,value,unit,recordedAt,source}>} metrics  canonical records
 * @returns {Promise<{inserted:number, profileMetrics:object}>}
 */
async function persistMetrics(userId, metrics) {
  // heartRate → encrypted time-series rows, idempotent (skip already-stored
  // (source,recordedAt); collapse duplicate timestamps within the batch). App-level
  // dedupe (no DB unique index) so the live watch path is untouched.
  let hrDocs = (metrics || [])
    .filter(m => m.metric === 'heartRate')
    .map(m => ({ userId, heartRate: m.value, activity: 'unknown', source: m.source, recordedAt: m.recordedAt }));

  if (hrDocs.length) {
    const times = hrDocs.map(d => d.recordedAt.getTime());
    const existing = await BiometricLog
      .find({
        userId,
        source: { $in: [...new Set(hrDocs.map(d => d.source))] },
        recordedAt: { $gte: new Date(Math.min(...times)), $lte: new Date(Math.max(...times)) },
      })
      .select('source recordedAt')
      .lean();

    const seen = new Set(existing.map(e => `${e.source}@${new Date(e.recordedAt).getTime()}`));
    hrDocs = hrDocs.filter(d => {
      const key = `${d.source}@${d.recordedAt.getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (hrDocs.length) await BiometricLog.insertMany(hrDocs, { ordered: false });
  }

  // Profile scalars → aggregate (median) → upsert. Pass RAW values: Mongoose 9 DOES run
  // the encryptedNumber setter on findOneAndUpdate($set), so it encrypts once. Pre-encrypting
  // here (the old audit-F3 pattern, correct for Mongoose <9 where update setters didn't run)
  // DOUBLE-encrypted every scalar — the getter then decrypted one layer and Number(ciphertext)
  // was NaN, so Pulse showed "—" for restingHR/sleep despite a successful ingest.
  const profileMetrics = aggregateProfileMetrics(metrics);
  const $set = {};
  for (const [field, value] of Object.entries(profileMetrics)) {
    $set[METRIC_FIELD_PATHS[field] || field] = value;
  }

  // Latest-night sums (the sleep-DEBT input) alongside the median baseline.
  // Night-date guard: a 6-month backfill's "latest" night must never overwrite
  // a fresher night already stored. Guard read is best-effort — an unreadable
  // profile counts as no-existing-night (ingestion never blocks on it).
  const lastNight = computeLastNightSleep(metrics);
  if (lastNight) {
    const nightDate = new Date(lastNight.date);
    let existingDate = null;
    try {
      const existing = await MedicalProfile.findOne({ userId }).select('lastNightSleep.date').lean();
      existingDate = existing?.lastNightSleep?.date ? new Date(existing.lastNightSleep.date) : null;
    } catch { /* treat as no existing night */ }
    if (!existingDate || existingDate <= nightDate) {
      $set['lastNightSleep.deep']  = lastNight.deep;   // raw — the Mongoose 9 setter encrypts once
      $set['lastNightSleep.light'] = lastNight.light;
      $set['lastNightSleep.rem']   = lastNight.rem;
      $set['lastNightSleep.date']  = nightDate;
      $set.sleepUpdatedAt = new Date();
    }
  }

  if (Object.keys($set).length) {
    await MedicalProfile.findOneAndUpdate({ userId }, { $set }, { upsert: true, new: true });
  }

  // New data → recompute baselines + state vector (backfill finally drives state).
  // Debounced: a deterministic jobId + delay coalesces a backfill burst (hundreds
  // of chunked batches) into ONE heavy decrypt run; removeOnComplete frees the id
  // so the next batch can queue again. (shadow-audit flood finding)
  if (hrDocs.length || Object.keys($set).length) {
    try {
      await enqueue(QUEUES.STATE_VECTOR_RECOMPUTE, { userId }, {
        jobId: `state-vector-${userId}`, // BullMQ forbids ':' in custom job ids
        delay: 60_000,
        removeOnComplete: true,
        removeOnFail: true,
      });
    } catch (e) {
      console.error('[metricStore] recompute enqueue failed:', e.message);
    }
  }

  return { inserted: hrDocs.length, profileMetrics };
}

module.exports = { persistMetrics };
