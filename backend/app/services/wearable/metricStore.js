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
const { stateVectorJobOptions } = require('../../queues/stateVectorJob');

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
      // RMSSD and SDNN are different statistics, so a normaliser that knows which one its device
      // reports says so (Garmin: RMSSD), and the label rides on HRV rows only. The model refuses it
      // on any other metric, and a stray label must not cost a resting-HR row its write.
      ...(m.metric === 'hrv' && m.hrvMethod != null ? { hrvMethod: m.hrvMethod } : {}),
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
    // A driver/validation message can echo the offending VALUE ("340 is above maximum"), and these
    // rows ARE the vitals. So the error TYPE and a count, never the message. (§0.2.2)
    console.error(`[metricStore] vital persist failed for ${docs.length} row(s): ${e?.name || 'Error'}`);
    return { inserted: 0, rejected: NO_REJECTS };
  }
}

// ── Retention (T2) ──────────────────────────────────────────────────────────────
//
// BiometricLog and VitalSample expire rows on `recordedAt` through a TTL index, so a row already
// older than its window is deleted on the TTL monitor's next pass. Writing one only churns the
// collection, queues a recompute over data about to vanish, and folds the reading into the TTL-less
// MedicalProfile, where it outlives the raw data it came from. A caller that receives history asks
// persistMetrics to drop those metrics before any write (the Garmin lane: a 182-day backfill, and the
// personal lane's first pull).
//
// The windows are read off the models' own TTL indexes, so BIOMETRIC_RETENTION_DAYS and
// VITAL_SAMPLE_RETENTION_DAYS stay defined in one place each and this filter cannot drift from the
// reaper. A metric with no TTL'd store of its own (sleep stages land only on MedicalProfile) takes
// the shortest window: no derivative outlives its raw data.
function ttlMsOf(Model) {
  const ttl = Model.schema.indexes().find(([fields, options]) => Object.keys(fields).length === 1
    && fields.recordedAt === 1 && Number.isFinite(options?.expireAfterSeconds));
  return ttl ? ttl[1].expireAfterSeconds * 1000 : null;
}

function withinRetention(metrics, now = Date.now()) {
  const heartRateMs = ttlMsOf(BiometricLog);
  const vitalMs = ttlMsOf(VitalSample);
  const known = [heartRateMs, vitalMs].filter((ms) => ms !== null);
  const shortestMs = known.length ? Math.min(...known) : null;
  const windowOf = (metric) => {
    if (metric === 'heartRate') return heartRateMs;
    return VitalSample.VITAL_METRICS.includes(metric) ? vitalMs : shortestMs;
  };

  const kept = [];
  let dropped = 0;
  for (const m of metrics) {
    const windowMs = windowOf(m?.metric);
    const at = m?.recordedAt instanceof Date ? m.recordedAt.getTime() : NaN;
    if (windowMs !== null && at < now - windowMs) { dropped += 1; continue; }
    kept.push(m);
  }
  return { kept, dropped };
}

/**
 * @param {string} userId
 * @param {Array<{metric,value,unit,recordedAt,source}>} metrics  canonical records
 * @param {{dropOutsideRetention?: boolean}} [options]  drop, before any write, every metric older
 *   than its store keeps (withinRetention above). Off by default; only the Garmin lane opts in.
 * @returns {Promise<{inserted:number, rejected:{count:number,reasons:Array}, vitals:object, profileMetrics:object, droppedOutsideRetention:number}>}
 *   `inserted` is what Mongo actually took — NOT the attempted count (W4-D08).
 */
async function persistMetrics(userId, metrics, { dropOutsideRetention = false } = {}) {
  let inserted = 0;
  let rejected = NO_REJECTS;

  let batch = metrics || [];
  let droppedOutsideRetention = 0;
  if (dropOutsideRetention) ({ kept: batch, dropped: droppedOutsideRetention } = withinRetention(batch));

  // heartRate → encrypted time-series rows, idempotent (skip already-stored
  // (source,recordedAt); collapse duplicate timestamps within the batch). App-level
  // dedupe (no DB unique index) so the live watch path is untouched.
  let hrDocs = batch
    .filter(m => m.metric === 'heartRate')
    .map(m => ({
      userId, heartRate: m.value, activity: 'unknown', source: m.source, recordedAt: m.recordedAt,
      tzOffsetMinutes: sanitizeTzOffset(m.tzOffsetMinutes),
    }));

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
  const vitals = await persistVitalSamples(userId, batch);

  // Profile scalars → aggregate (median) → upsert. Pass RAW values: Mongoose 9 DOES run
  // the encryptedNumber setter on findOneAndUpdate($set), so it encrypts once. Pre-encrypting
  // here (the old audit-F3 pattern, correct for Mongoose <9 where update setters didn't run)
  // DOUBLE-encrypted every scalar — the getter then decrypted one layer and Number(ciphertext)
  // was NaN, so Pulse showed "—" for restingHR/sleep despite a successful ingest.
  const profileMetrics = aggregateProfileMetrics(batch);
  const $set = {};
  for (const [field, value] of Object.entries(profileMetrics)) {
    $set[METRIC_FIELD_PATHS[field] || field] = value;
  }

  // Latest-night sums (the sleep-DEBT input) alongside the median baseline.
  // Night-date guard: a 6-month backfill's "latest" night must never overwrite
  // a fresher night already stored. Guard read is best-effort — an unreadable
  // profile counts as no-existing-night (ingestion never blocks on it).
  const lastNight = computeLastNightSleep(batch);
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
      // J2 (BE-084): the job id is a keyed pseudonym of the user id, never the id itself (queues/stateVectorJob.js).
      await enqueue(QUEUES.STATE_VECTOR_RECOMPUTE, { userId }, stateVectorJobOptions(userId, 60_000));
    } catch (e) {
      console.error('[metricStore] recompute enqueue failed:', e.message);
    }
  }

  return { inserted, rejected, vitals, profileMetrics, droppedOutsideRetention };
}

module.exports = { persistMetrics, persistVitalSamples, VITAL_METRICS_PERSISTED };
