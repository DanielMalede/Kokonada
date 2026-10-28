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
const {
  consentV2Enabled, sanitizeTzOffset, TZ_MIN_MINUTES, TZ_MAX_MINUTES, MAX_FUTURE_SKEW_MS,
} = require('./adapter');
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

// A Garmin HRV is one value a night, stamped where its window ends (adapter.js). Garmin can revise a
// window's length on a later sync or pull, which moves that end, so for this one series the time is not
// the reading's identity: the night is (BE-191, RA-3), filed under the LOCAL date of its end, and the first
// write of a night wins. Under the UTC date, two different nights that end on one UTC date shared a key and
// the second was never written: a wearer at UTC+8 who wakes at 08:10 and then at 07:50 the next morning ends
// them at 00:10Z and 23:50Z (RA-1 of #275). The local date is the UTC date of recordedAt + tzOffsetMinutes.
// The Garmin normaliser takes that offset from startTimeOffsetInSeconds, which is local minus UTC, so it is
// east-positive (UTC+8 is +480) and is ADDED, as the baseline engine's localDayIndex adds it. A row with no
// offset is filed under its UTC date.
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const isGarminNightlyHrv = (d) => d.metric === 'hrv' && d.source === 'garmin';
const localDateOf = (d) => {
  const offsetMs = (sanitizeTzOffset(d.tzOffsetMinutes) ?? 0) * MINUTE_MS;
  return new Date(new Date(d.recordedAt).getTime() + offsetMs).toISOString().slice(0, 10);
};
const vitalIdentity = (d) => (isGarminNightlyHrv(d)
  ? `${d.metric}@${d.source}@${localDateOf(d)}`
  : `${d.metric}@${d.source}@${new Date(d.recordedAt).getTime()}`);
// Two rows of one local date are less than a day apart in local time, and their offsets differ by at most the
// width of the offset band, so in UTC they are less than a day plus that width apart.
const NIGHT_REACH_MS = DAY_MS + (TZ_MAX_MINUTES - TZ_MIN_MINUTES) * MINUTE_MS;

/**
 * Per-metric physiological rows → VitalSample. Same idempotence contract as the heartRate path:
 * `metric@source@recordedAt` is the identity of a reading, so a replayed backfill chunk or a
 * reconnect writes nothing twice (S6). Keyed PER METRIC — an HRV reading and a resting-HR reading
 * from the same summary share a timestamp and are two different facts. A Garmin HRV is keyed by its
 * night instead (vitalIdentity above).
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

  try {
    // A night's row can sit anywhere on the local date of the night's end, under any offset, so a Garmin
    // HRV widens the read on each side by NIGHT_REACH_MS, and the read takes each row's offset with it.
    const reach = (d) => (isGarminNightlyHrv(d) ? NIGHT_REACH_MS : 0);
    const from = docs.map((d) => d.recordedAt.getTime() - reach(d));
    const to = docs.map((d) => d.recordedAt.getTime() + reach(d));
    const existing = await VitalSample
      .find({
        userId,
        metric: { $in: [...new Set(docs.map((d) => d.metric))] },
        recordedAt: { $gte: new Date(Math.min(...from)), $lte: new Date(Math.max(...to)) },
      })
      .select('metric source recordedAt tzOffsetMinutes')
      .lean();

    const seen = new Set((existing || []).map(vitalIdentity));
    docs = docs.filter((d) => {
      const k = vitalIdentity(d);
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

// ── Future cap (BE-206) ─────────────────────────────────────────────────────────────────────────────
//
// A reading stamped past the clock is not a reading yet. Written, a far-future night wins
// MedicalProfile.lastNightSleep for good (the night-date guard below keeps the LATEST night) and its rows
// outlive their TTL, which counts from recordedAt. The Health Connect contract and the personal-lane
// envelope refuse such stamps at their door; the Garmin webhook lane has no door of its own, so the
// Garmin seam asks the store to drop them, with the same allowance (adapter.js MAX_FUTURE_SKEW_MS).
//
// A metric is kept only when its time is provably at or before that moment. A time a Date cannot hold is NaN,
// and NaN fails every comparison, so `at > latestMs` used to keep it: the heart-rate read then cast it and
// threw, and the webhook answered 500 for the whole push (RA-2 of #275). It is dropped, and counted in
// droppedInFuture with the future-stamped: the cap is the one filter that admits no time it cannot place.
function notInFuture(metrics, now) {
  const latestMs = now + MAX_FUTURE_SKEW_MS;
  const kept = [];
  let dropped = 0;
  for (const m of metrics) {
    const at = m?.recordedAt instanceof Date ? m.recordedAt.getTime() : NaN;
    if (!(at <= latestMs)) { dropped += 1; continue; }
    kept.push(m);
  }
  return { kept, dropped };
}

/**
 * @param {string} userId
 * @param {Array<{metric,value,unit,recordedAt,source}>} metrics  canonical records
 * @param {{dropOutsideRetention?: boolean, dropInFuture?: boolean, now?: Date}} [options]
 *   `dropOutsideRetention` drops, before any write, every metric older than its store keeps
 *   (withinRetention above); `dropInFuture` drops every metric stamped past `now` + MAX_FUTURE_SKEW_MS, or
 *   at a time a Date cannot hold (notInFuture above). Both are off by default; only the Garmin seam opts
 *   in. `now` is the clock both measure against, injectable so a test can stand on a boundary.
 * @returns {Promise<{inserted:number, rejected:{count:number,reasons:Array}, vitals:object, profileMetrics:object, droppedOutsideRetention:number, droppedInFuture:number}>}
 *   `inserted` is what Mongo actually took — NOT the attempted count (W4-D08).
 */
async function persistMetrics(userId, metrics, { dropOutsideRetention = false, dropInFuture = false, now = new Date() } = {}) {
  let inserted = 0;
  let rejected = NO_REJECTS;

  let batch = metrics || [];
  let droppedOutsideRetention = 0;
  let droppedInFuture = 0;
  if (dropOutsideRetention) ({ kept: batch, dropped: droppedOutsideRetention } = withinRetention(batch, now.getTime()));
  if (dropInFuture) ({ kept: batch, dropped: droppedInFuture } = notInFuture(batch, now.getTime()));

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

  return { inserted, rejected, vitals, profileMetrics, droppedOutsideRetention, droppedInFuture };
}

module.exports = { persistMetrics, persistVitalSamples, VITAL_METRICS_PERSISTED };
