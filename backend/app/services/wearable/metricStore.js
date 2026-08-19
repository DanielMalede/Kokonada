'use strict';

// Shared persistence for canonical metric records, used by every wearable source
// (Health Connect bridge, Garmin Health API, …): heartRate → BiometricLog
// (encrypted, deduped time-series), profile scalars → MedicalProfile (median-
// aggregated, encrypted). Keeping this in one place means a new source only needs
// a payload→metric normalizer.

const BiometricLog   = require('../../models/BiometricLog');
const VitalSample    = require('../../models/VitalSample');
const MedicalProfile = require('../../models/MedicalProfile');
const { aggregateProfileMetrics, computeLastNightSleep } = require('../medicalProfileService');
const { enqueue } = require('../../queues/queue');
const { insertManyAccounted, NO_REJECTS } = require('./insertAccounted');
const { consentV2Enabled, sanitizeTzOffset } = require('./adapter');
const { QUEUES } = require('../../queues/definitions');

// ── VitalSample writers (W4-004) ────────────────────────────────────────────────
//
// Until this existed, every non-heartRate metric was MEDIAN-AGGREGATED into a single scalar on
// MedicalProfile and the individual readings were thrown away. That is why D1 was possible at all:
// `translate()` wants an HRV median AND a spread, and a lone scalar can only give the first, so
// every user in production was z-scored against the population constant {45, 8}.
//
// §0.2.3 — COLLECTION IS NOT WIDENED HERE. `VitalSample.VITAL_METRICS` is a consent-v2-ready
// superset of six metrics; exactly two of them have a writer, and they are the two already
// collected under consent v1 and already declared to the stores. The other four are reachable
// only through `consentV2Enabled`, which is empty by default. The retention-doc guard
// (tests/wave4.retentionDocs.test.js) fails the build if that stops being true while the
// "SpO₂ and respiratory rate are NOT collected" declaration stands.
const VITAL_METRICS_PERSISTED = Object.freeze(['hrv', 'restingHeartRate']);

const isVitalMetricWritable = (metric) =>
  VITAL_METRICS_PERSISTED.includes(metric) || consentV2Enabled(metric);

// Aggregated metric keys that live on a NESTED MedicalProfile path; others map 1:1.
const METRIC_FIELD_PATHS = {
  sleepDeep:  'sleepStages.deep',
  sleepLight: 'sleepStages.light',
  sleepRem:   'sleepStages.rem',
};

/**
 * Per-metric physiological rows → VitalSample. Same idempotence contract as the heartRate path:
 * `metric@source@recordedAt` is the identity of a reading, so a replayed backfill chunk or a
 * reconnect writes nothing twice (S6). Keyed PER METRIC — an HRV reading and a resting-HR reading
 * from the same summary share a timestamp and are two different facts.
 *
 * Best-effort by design: vitals feed baselines, and a baseline is a nicety compared to losing the
 * heart-rate ingest. A failure here is logged (count only, never a value) and swallowed.
 */
async function persistVitalSamples(userId, metrics) {
  let docs = (metrics || [])
    .filter((m) => m && isVitalMetricWritable(m.metric))
    .filter((m) => Number.isFinite(Number(m.value)) && m.recordedAt instanceof Date
      && Number.isFinite(m.recordedAt.getTime()))
    .map((m) => ({
      userId,
      metric: m.metric,
      value: Number(m.value),
      source: m.source,
      recordedAt: m.recordedAt,
      tzOffsetMinutes: sanitizeTzOffset(m.tzOffsetMinutes),
    }));

  if (!docs.length) return { inserted: 0, rejected: NO_REJECTS };

  const key = (d) => `${d.metric}@${d.source}@${new Date(d.recordedAt).getTime()}`;

  try {
    const times = docs.map((d) => d.recordedAt.getTime());
    const existing = await VitalSample
      .find({
        userId,
        metric: { $in: [...new Set(docs.map((d) => d.metric))] },
        recordedAt: { $gte: new Date(Math.min(...times)), $lte: new Date(Math.max(...times)) },
      })
      .select('metric source recordedAt')
      .lean();

    const seen = new Set((existing || []).map(key));
    docs = docs.filter((d) => {
      const k = key(d);
      if (seen.has(k)) return false;
      seen.add(k); // also collapses duplicates WITHIN this batch
      return true;
    });

    if (!docs.length) return { inserted: 0, rejected: NO_REJECTS };
    return await insertManyAccounted(VitalSample, docs);
  } catch (e) {
    // Count only — a message could carry a value on some driver errors.
    console.error(`[metricStore] vital persist failed for ${docs.length} row(s):`, e.message);
    return { inserted: 0, rejected: NO_REJECTS };
  }
}

/**
 * @param {string} userId
 * @param {Array<{metric,value,unit,recordedAt,source}>} metrics  canonical records
 * @returns {Promise<{inserted:number, rejected:{count:number,reasons:Array}, vitals:object, profileMetrics:object}>}
 *   `inserted` is what Mongo actually took — NOT the attempted count (W4-D08).
 */
async function persistMetrics(userId, metrics) {
  let inserted = 0;
  let rejected = NO_REJECTS;

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

    // W4-D08: `insertMany({ ordered: false })` drops schema-rejected rows without rejecting, so the
    // count has to come from the driver, not from `hrDocs.length`.
    if (hrDocs.length) ({ inserted, rejected } = await insertManyAccounted(BiometricLog, hrDocs));
  }

  // Per-metric physiological rows — the fuel for the personal HRV/RHR baselines (D1).
  const vitals = await persistVitalSamples(userId, metrics);

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
  // NOTE (W4-D08): still the ATTEMPTED count on purpose — the debounced recompute is an
  // "new data arrived" signal, and re-gating it on `inserted` would be an unrelated change.
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

  return { inserted, rejected, vitals, profileMetrics };
}

module.exports = { persistMetrics, persistVitalSamples, VITAL_METRICS_PERSISTED };
