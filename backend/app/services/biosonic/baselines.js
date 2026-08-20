'use strict';

const BiometricLog = require('../../models/BiometricLog');
const VitalSample = require('../../models/VitalSample');
const MedicalProfile = require('../../models/MedicalProfile');
const { getRedis } = require('../../config/redis');
const { encrypt } = require('../../utils/encryption');
const { logBiometricAccess, auditedDecrypt } = require('../../utils/biometricAudit');
const { computeBaselineBlob } = require('../../agents/runtime/physiology/baselineEngine');

// Personal biometric baselines: rolling 30-day median/MAD of resting heart rate.
//
// ZERO-KNOWLEDGE BOUNDARY: BiometricLog.heartRate is app-encrypted, so aggregation
// must decrypt — that happens HERE and only here, inside the worker process, on
// paged mongoose documents (getters decrypt transparently). Plaintext samples live
// only in this function's local scope; the returned object carries derived stats
// only, and the Redis cache stores an ENCRYPTED blob bound to the user via AAD.

const PAGE_SIZE = 5000;
const MAX_PAGES = 40;          // hard cap ≈ 200k rows (BiometricLog caps at 100k/user)
const WINDOW_DAYS = 30;
const MIN_SAMPLES = 10;

// ── freshness vs retention (stale-while-revalidate) ─────────────────────────────
//
// These used to be the same number, and that WAS D15's second half: the key simply expired at 6 h,
// so the first generation in every 6-hour window ran with NO personal baseline at all and fell
// back to the population constants — for a heavy user, several unpersonalized generations a day.
//
// Now they are two different ideas. FRESH_TTL_S is how long a blob is considered CURRENT; past it
// we still serve the blob (a 7-hour-old 30-day median is not wrong, it is slightly late) and
// schedule the refresh behind it. CACHE_TTL_S is how long it is worth keeping at all.
const FRESH_TTL_S = 6 * 3600;
const CACHE_TTL_S = 24 * 3600;
const MAD_SCALE = 1.4826;
const FALLBACK_MAD = 3;

// S11 kill-switch: set to restore the pre-W4-004 blob (population HRV constants, MIN_SAMPLES
// cliff, no hourly/cosinor/zones) WITHOUT a revert. The delegation below is a real behaviour
// change for every user with HRV history, so it ships with a way back.
const engineDisabled = () => Boolean(process.env.WAVE4_BASELINE_ENGINE_DISABLED);

const _cacheKey = (userId) => `bio:baseline:${userId}`;

function median(values) {
  if (!values?.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mad(values) {
  const med = median(values);
  if (med == null) return null;
  return median(values.map(v => Math.abs(v - med)));
}

// Robust z-score; a constant series (MAD 0) falls back to a sane spread so the
// score stays finite instead of dividing by zero.
function robustZ(x, med, madValue, fallbackMad = FALLBACK_MAD) {
  // Explicit null checks: Number(null) coerces to 0, which would fabricate a z-score.
  if (x == null || med == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(med))) return null;
  const spread = Number(madValue) > 0 ? Number(madValue) : fallbackMad;
  return (Number(x) - Number(med)) / (MAD_SCALE * spread);
}

// Page a user-scoped, time-windowed collection with the encrypting getters INTACT
// (deliberately not .lean() — the getters are what decrypt). Returns the mapped rows and the
// number of documents whose plaintext was actually touched, for the ADR-0005 audit line.
async function _pageDecrypted(Model, userId, since, map) {
  const rows = [];
  let lastId = null;
  let decryptedCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = { userId, recordedAt: { $gte: since }, ...(lastId ? { _id: { $gt: lastId } } : {}) };
    const docs = await Model.find(query).sort({ _id: 1 }).limit(PAGE_SIZE);
    if (!docs?.length) break;

    for (const doc of docs) {
      decryptedCount += 1;
      const row = map(doc);
      if (row != null) rows.push(row);
    }
    lastId = docs[docs.length - 1]._id;
    if (docs.length < PAGE_SIZE) break;
  }
  return { rows, decryptedCount };
}

// The habitual timezone: the offset the user's own readings carry most often. A single trip
// abroad should not rotate a 30-day hour-of-day table, and an absent offset must NOT become 0 —
// 0 is a real timezone (UTC). No offsets anywhere → null, which is the honest "we fell back to
// server hour" signal rather than a fabricated London.
function _modalTzOffset(...sampleSets) {
  const counts = new Map();
  for (const set of sampleSets) {
    for (const s of set) {
      const tz = s?.tzOffsetMinutes;
      if (tz == null || !Number.isFinite(Number(tz))) continue;
      counts.set(Number(tz), (counts.get(Number(tz)) ?? 0) + 1);
    }
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

// The pre-W4-004 implementation, kept verbatim behind the S11 kill-switch. Its defects are the
// point: every batch row is `activity: 'unknown'` (D2) so workouts and sleep pool into one
// "resting" median, there is no HRV baseline at all (D1), and fewer than MIN_SAMPLES readings
// yield null rather than a shrunk estimate (D15).
async function _computeBaselinesLegacy(userId) {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const { rows: restingHr, decryptedCount } = await _pageDecrypted(BiometricLog, userId, since, (doc) => {
    if (doc.heartRate == null) return null; // Number(null) === 0 — reject before coercing
    const value = Number(doc.heartRate);
    if (!Number.isFinite(value)) return null;
    const activity = doc.activity ?? 'unknown';
    return (activity === 'resting' || activity === 'unknown') ? value : null;
  });

  // ADR-0005 audit trail: record the bulk biometric decryption (userId + purpose + count),
  // never a single reading. Only when data was actually read.
  if (decryptedCount > 0) {
    logBiometricAccess(userId, 'baseline-aggregation', { count: decryptedCount });
  }

  const enough = restingHr.length >= MIN_SAMPLES;
  return {
    rhrMedian: enough ? median(restingHr) : null,
    rhrMAD: enough ? mad(restingHr) : null,
    sampleCount: restingHr.length,
    computedAt: new Date().toISOString(),
  };
}

/**
 * The personal baselines, delegated to the W4-004 baseline engine.
 *
 * The returned object is a STRICT SUPERSET of what this function used to return (§0.2.5): every
 * legacy key keeps its exact meaning, so `translate()` needs no edit whatsoever to stop scoring
 * every user's HRV against the population constant {45, 8}. That is D1's actual fix — it lives
 * here, in what feeds translate, not in translate.
 *
 * ZERO-KNOWLEDGE BOUNDARY, unchanged: plaintext vitals exist only inside this function's scope
 * (worker process), and only derived statistics leave it.
 */
async function computeBaselines(userId) {
  if (engineDisabled()) return _computeBaselinesLegacy(userId);

  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * 24 * 3600 * 1000);

  const hr = await _pageDecrypted(BiometricLog, userId, since, (doc) => {
    if (doc.heartRate == null) return null;
    const value = Number(doc.heartRate);
    if (!Number.isFinite(value)) return null;
    return {
      value,
      // The engine decontaminates by TIME OF DAY and exertion level rather than by this label,
      // which is exactly why D2 stops mattering: 'unknown' no longer has to mean 'resting'.
      activity: doc.activity ?? 'unknown',
      recordedAt: doc.recordedAt,
      tzOffsetMinutes: doc.tzOffsetMinutes ?? null,
    };
  });

  const vitals = await _pageDecrypted(VitalSample, userId, since, (doc) => {
    if (doc.value == null) return null;
    const value = Number(doc.value);
    if (!Number.isFinite(value)) return null;
    return {
      metric: doc.metric,
      value,
      recordedAt: doc.recordedAt,
      tzOffsetMinutes: doc.tzOffsetMinutes ?? null,
    };
  });

  // ONE audit line for the whole bulk decryption (userId + purpose + count), never a reading.
  const decryptedCount = hr.decryptedCount + vitals.decryptedCount;
  if (decryptedCount > 0) {
    logBiometricAccess(userId, 'baseline-aggregation', { count: decryptedCount });
  }

  let profile = null;
  try {
    profile = await MedicalProfile.findOne({ userId }).select('maxHeartRate').lean();
  } catch { /* a missing profile is a cold start, not an error */ }

  const tzOffsetMinutes = _modalTzOffset(hr.rows, vitals.rows);

  const blob = computeBaselineBlob({
    hrSamples: hr.rows,
    vitalSamples: vitals.rows,
    profile: { maxHeartRate: profile?.maxHeartRate ?? null },
    now,
    tzOffsetMinutes: tzOffsetMinutes ?? 0,
  });

  // ── the legacy keys keep their exact MEANING, not just their names (§0.2.5) ──
  //
  // `rhrMedian` has always meant "THIS user's resting heart rate, or null if we do not know it",
  // and `translate()` relies on that precisely: `restingElevation` passes fallback = null, so a
  // null baseline makes the resting-elevation stress term ABSTAIN rather than score the user
  // against a stranger's physiology.
  //
  // That sentence was FALSE when it was written and is true now (W4-D15). `translate`'s numeric
  // guard read `Number.isFinite(Number(x))`, and `Number(null)` is 0 — so a null median did not
  // abstain, it anchored the z-score at a resting pulse of ZERO and reported stress = 1.0 for
  // every calm user this branch produces. The guard is fixed; this comment is now load-bearing
  // rather than aspirational, and `tests/wave4.nullBaseline.test.js` pins it from both ends.
  //
  // The engine, by design, always returns a number — with zero evidence that number is the
  // population prior, correctly tagged `confidence: 0`. Handing that to translate through the
  // legacy key would silently convert "we don't know" into "62 bpm", which is the fabrication the
  // ATTACK-2 shadow test exists to forbid.
  //
  // So: no non-exercise observation of this user AT ALL → the legacy keys stay null. This is NOT
  // the MIN_SAMPLES cliff D15 killed — that cliff discarded 9 perfectly good readings for being
  // fewer than 10. A single resting reading now produces a (heavily shrunk, low-confidence)
  // estimate; only genuinely zero evidence produces null. The superset keys are untouched, so
  // engines that want the prior and its confidence still get both.
  const hasPersonalEvidence = blob.sampleCount > 0;
  // The HRV pair gets the SAME ruling, gated on its OWN evidence (W4-D15(e)). It was passing the
  // engine's population prior through untouched, which is the identical fabrication one metric
  // over — and the two pairs are independent: a user can have months of heart rate and no HRV.
  // Nulling it is numerically free today, because translate carries its own HRV population
  // fallback whose constants equal `POPULATION.hrv` exactly (pinned in wave4.nullBaseline), so the
  // z-score is unchanged; what changes is that the D14 confidence ladder stops counting an unknown
  // person as a known one, and the W4-005 affect engine's HRV axis abstains instead of scoring
  // against a stranger. The superset keys (`coverage.hrvDays`, `coverage.hrvConfidence`, `acute`,
  // `chronic`, `trend`) still carry the prior and its confidence for engines that want both.
  const hasHrvEvidence = (blob.coverage?.hrvDays ?? 0) > 0;

  return {
    ...blob,
    rhrMedian: hasPersonalEvidence ? blob.rhrMedian : null,
    rhrMAD: hasPersonalEvidence ? blob.rhrMAD : null,
    hrvMedian: hasHrvEvidence ? blob.hrvMedian : null,
    hrvMAD: hasHrvEvidence ? blob.hrvMAD : null,
    // Reported so a consumer can tell a genuine UTC user from a server-hour fallback.
    tzOffsetMinutes,
  };
}

/**
 * Write the derived Karvonen zones and the estimated HRmax onto the (until now dormant)
 * MedicalProfile fields, so the stored profile carries the same physiology the engine reasons
 * with.
 *
 * `doc.save()` and NOT `findOneAndUpdate($set)` — deliberately. These are encryptedNumber fields,
 * and update-setter behaviour is the trap that produced the double-encryption incident this repo
 * already paid for once (see metricStore's header). A loaded document + save() runs the setter
 * exactly once, whatever an update pipeline would have done.
 *
 * Best-effort: a profile decoration must never fail a baseline refresh.
 */
async function persistDerivedProfile(userId, blob) {
  try {
    const zones = blob?.zones?.zones;
    if (!Array.isArray(zones)) return false;

    const doc = await MedicalProfile.findOne({ userId });
    if (!doc) return false; // cold start — nothing to decorate yet

    // A number the USER gave us always outranks one we estimated. `maxHeartRateSource` says which
    // this is; a pure default may only fill an empty field, never overwrite a real one.
    const estimated = Number(blob.maxHeartRate);
    const isEstimate = blob.maxHeartRateSource === 'default';
    if (Number.isFinite(estimated) && (!isEstimate || doc.maxHeartRate == null)) {
      doc.maxHeartRate = estimated;
    }

    doc.hrZones = doc.hrZones || {};
    zones.slice(0, 5).forEach((z, i) => {
      doc.hrZones[`zone${i + 1}`] = {
        label: z.label, minBpm: z.minBpm, maxBpm: z.maxBpm, percentOfMax: z.percentOfMax,
      };
    });

    await doc.save();
    return true;
  } catch (e) {
    // Type only: a validation message on these fields would quote the heart rate it rejected.
    console.error(`[baselines] derived-profile write failed: ${e?.name || 'Error'}`);
    return false;
  }
}

async function cacheBaselines(userId, stats) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(_cacheKey(userId), encrypt(JSON.stringify(stats), String(userId)), 'EX', CACHE_TTL_S);
  } catch (e) {
    console.error('[baselines] cache write failed:', e.message);
  }
}

// Debounced background refresh. The deterministic jobId is load-bearing: a burst of generations
// for one user coalesces into ONE heavy decrypt run rather than N.
function _scheduleRefresh(userId) {
  try {
    const { enqueue } = require('../../queues/queue');
    const { QUEUES } = require('../../queues/definitions');
    enqueue(QUEUES.STATE_VECTOR_RECOMPUTE, { userId }, {
      jobId: `state-vector-${userId}`, // BullMQ forbids ':' in custom job ids
      delay: 5000,
      removeOnComplete: true,
      removeOnFail: true,
    }).catch(() => {});
  } catch { /* queue seam unavailable — fine */ }
}

// A blob is FRESH for FRESH_TTL_S after the moment it was computed. An unparseable or absent
// `computedAt` counts as stale, which is the safe direction: it costs one background job and
// never serves an unbounded-age blob as current.
function _isFresh(stats, nowMs) {
  const at = Date.parse(stats?.computedAt);
  if (!Number.isFinite(at)) return false;
  return (nowMs - at) < FRESH_TTL_S * 1000;
}

// Request-path read: cached stats or null — NEVER the heavy decrypt compute (that stays
// worker-only).
//
// STALE-WHILE-REVALIDATE (D15's second half). Previously the cache key simply expired at 6 h, so
// the first generation in every 6-hour window had NO baselines at all and translate() ran on
// population constants. A 30-day median does not become wrong at 6 h and one second — so a stale
// blob is now SERVED and refreshed behind the request. Only a genuinely empty cache degrades.
async function peekBaselines(userId) {
  const redis = getRedis();
  if (redis) {
    try {
      const blob = await redis.get(_cacheKey(userId));
      if (blob) {
        const stats = auditedDecrypt(String(userId), 'baseline-cache-peek', blob, { parseJson: true });
        if (stats && !_isFresh(stats, Date.now())) _scheduleRefresh(userId);
        return stats;
      }
    } catch { /* corrupt/tampered → treat as miss */ }
  }
  _scheduleRefresh(userId);
  return null;
}

async function getBaselines(userId) {
  const redis = getRedis();
  if (redis) {
    try {
      const blob = await redis.get(_cacheKey(userId));
      if (blob) return auditedDecrypt(String(userId), 'baseline-cache-read', blob, { parseJson: true });
    } catch {
      // corrupt/tampered/rotated-key cache entry → recompute from truth
    }
  }
  const stats = await computeBaselines(userId);
  await cacheBaselines(userId, stats);
  return stats;
}

module.exports = {
  median, mad, robustZ,
  computeBaselines, cacheBaselines, getBaselines, peekBaselines, persistDerivedProfile,
  // exported so tests pin the SWR relationship itself, not a copy of the numbers
  FRESH_TTL_S, CACHE_TTL_S,
};
