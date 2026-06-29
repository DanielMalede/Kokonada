'use strict';

// Shared persistence for canonical metric records, used by every wearable source
// (Health Connect bridge, Garmin Health API, …): heartRate → BiometricLog
// (encrypted, deduped time-series), profile scalars → MedicalProfile (median-
// aggregated, encrypted). Keeping this in one place means a new source only needs
// a payload→metric normalizer.

const BiometricLog   = require('../../models/BiometricLog');
const MedicalProfile = require('../../models/MedicalProfile');
const { encrypt }    = require('../../utils/encryption');
const { aggregateProfileMetrics } = require('../medicalProfileService');

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

  // Profile scalars → aggregate (median) → upsert. Encrypt explicitly: encryptedNumber
  // setters do NOT run on findOneAndUpdate($set). (audit F3)
  const profileMetrics = aggregateProfileMetrics(metrics);
  if (Object.keys(profileMetrics).length) {
    const $set = {};
    for (const [field, value] of Object.entries(profileMetrics)) {
      $set[METRIC_FIELD_PATHS[field] || field] = encrypt(String(value));
    }
    await MedicalProfile.findOneAndUpdate({ userId }, { $set }, { upsert: true, new: true });
  }

  return { inserted: hrDocs.length, profileMetrics };
}

module.exports = { persistMetrics };
