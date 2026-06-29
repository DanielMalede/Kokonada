'use strict';

/**
 * OS health-store ingest bridge (Apple HealthKit / Google Health Connect).
 *
 * These stores live on the user's phone and cannot be read server-side. The
 * React Native companion app reads Garmin-synced data locally and pushes batches
 * here; the user's JWT authenticates the push (no OAuth). Unlike the live HR
 * stream, a batch carries several metric types used to build the medical profile.
 *
 * heartRate samples → BiometricLog (encrypted time-series, one row each).
 * Profile scalars (restingHeartRate, hrv, respirationRate, spO2) → aggregated
 * (median) and upserted onto the user's MedicalProfile.
 */

const BiometricLog   = require('../../models/BiometricLog');
const MedicalProfile = require('../../models/MedicalProfile');
const { encrypt }    = require('../../utils/encryption');
const { normalizeHealthStoreSamples } = require('./adapter');
const { aggregateProfileMetrics }     = require('../medicalProfileService');

const MAX_BATCH = 2000; // a 6-month backfill is chunked client-side; cap per request

// Aggregated metric keys that live on a NESTED MedicalProfile path rather than a
// top-level field. Everything else maps key→field 1:1.
const METRIC_FIELD_PATHS = {
  sleepDeep:  'sleepStages.deep',
  sleepLight: 'sleepStages.light',
  sleepRem:   'sleepStages.rem',
};

async function ingestBatch(userId, platform, samples) {
  if (Array.isArray(samples) && samples.length > MAX_BATCH) {
    throw Object.assign(new Error(`Batch too large — max ${MAX_BATCH} samples per request`), { statusCode: 400 });
  }

  const metrics = normalizeHealthStoreSamples(platform, samples);

  // heartRate → encrypted time-series rows. insertMany runs the schema setters
  // (so heartRate is encrypted at rest); ordered:false continues past duplicates.
  const hrDocs = metrics
    .filter(m => m.metric === 'heartRate')
    .map(m => ({ userId, heartRate: m.value, activity: 'unknown', source: m.source, recordedAt: m.recordedAt }));
  if (hrDocs.length) {
    await BiometricLog.insertMany(hrDocs, { ordered: false });
  }

  // Profile scalars → aggregate → upsert. Encrypt explicitly: encryptedNumber
  // setters do NOT run on findOneAndUpdate($set). (audit F3)
  const profileMetrics = aggregateProfileMetrics(metrics);
  if (Object.keys(profileMetrics).length) {
    const $set = {};
    for (const [field, value] of Object.entries(profileMetrics)) {
      $set[METRIC_FIELD_PATHS[field] || field] = encrypt(String(value));
    }
    await MedicalProfile.findOneAndUpdate({ userId }, { $set }, { upsert: true, new: true });
  }

  return { accepted: metrics.length, heartRateSamples: hrDocs.length, profileMetrics };
}

module.exports = { ingestBatch };
