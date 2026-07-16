'use strict';

const BiometricLog = require('../../models/BiometricLog');
const { getRedis } = require('../../config/redis');
const { encrypt } = require('../../utils/encryption');
const { logBiometricAccess, auditedDecrypt } = require('../../utils/biometricAudit');

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
const CACHE_TTL_S = 6 * 3600;
const MAD_SCALE = 1.4826;
const FALLBACK_MAD = 3;

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

async function computeBaselines(userId) {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000);
  const restingHr = [];
  let lastId = null;
  let decryptedCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = { userId, recordedAt: { $gte: since }, ...(lastId ? { _id: { $gt: lastId } } : {}) };
    // Deliberately NOT .lean(): the encryptedNumber getters must run to decrypt.
    const docs = await BiometricLog.find(query).sort({ _id: 1 }).limit(PAGE_SIZE);
    if (!docs.length) break;

    for (const doc of docs) {
      decryptedCount += 1; // the getter below decrypts special-category data — auditable (ADR-0005)
      if (doc.heartRate == null) continue; // Number(null) === 0 — reject before coercing
      const value = Number(doc.heartRate);
      if (!Number.isFinite(value)) continue;
      const activity = doc.activity ?? 'unknown';
      if (activity === 'resting' || activity === 'unknown') restingHr.push(value);
    }
    lastId = docs[docs.length - 1]._id;
    if (docs.length < PAGE_SIZE) break;
  }

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

async function cacheBaselines(userId, stats) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(_cacheKey(userId), encrypt(JSON.stringify(stats), String(userId)), 'EX', CACHE_TTL_S);
  } catch (e) {
    console.error('[baselines] cache write failed:', e.message);
  }
}

// Request-path read: cached stats or null — NEVER the heavy decrypt compute
// (that stays worker-only). A miss schedules a debounced recompute so the next
// generation has baselines; translate() degrades confidence meanwhile.
async function peekBaselines(userId) {
  const redis = getRedis();
  if (redis) {
    try {
      const blob = await redis.get(_cacheKey(userId));
      if (blob) return auditedDecrypt(String(userId), 'baseline-cache-peek', blob, { parseJson: true });
    } catch { /* corrupt/tampered → treat as miss */ }
  }
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

module.exports = { median, mad, robustZ, computeBaselines, cacheBaselines, getBaselines, peekBaselines };
