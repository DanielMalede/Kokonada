'use strict';

const AudioFeature = require('../models/AudioFeature');
const { getRedis } = require('../config/redis');

// Cache-aside repository over the permanent AudioFeature store.
// Coherence rules (shadow-audit hardened):
//  - Mongo is the source of truth; Redis is a 7-day hot cache keyed af:{recordingKey}.
//  - 'api' (measured) docs write through to Redis; 'llm' (estimated) docs only
//    INVALIDATE their key, so a racing reader can never pin a guess over a
//    measurement — the next read re-fills from Mongo truth.
//  - An 'llm' upsert can never overwrite an 'api' record (filtered $ne + the
//    unique index turns the race into a swallowed E11000).

const TTL_SECONDS = () => parseInt(process.env.AF_REDIS_TTL_S || String(7 * 24 * 3600), 10);

const _cacheKey = (recordingKey) => `af:${recordingKey}`;

async function getMany(recordingKeys = []) {
  const out = new Map();
  if (!recordingKeys.length) return out;

  const redis = getRedis();
  let misses = recordingKeys;

  if (redis) {
    try {
      const hits = await redis.mget(recordingKeys.map(_cacheKey));
      misses = [];
      recordingKeys.forEach((key, i) => {
        if (hits[i] == null) return misses.push(key);
        try {
          out.set(key, JSON.parse(hits[i]));
        } catch {
          misses.push(key); // corrupt cache entry → treat as a miss, Mongo wins
        }
      });
    } catch (e) {
      console.error('[audioFeatureRepo] redis read failed, degrading to Mongo:', e.message);
      misses = recordingKeys;
    }
  }

  if (misses.length) {
    const rows = await AudioFeature.find({ recordingKey: { $in: misses } }).lean();
    for (const row of rows) {
      out.set(row.recordingKey, row);
      if (redis) {
        // NX: a read-path backfill may race a fresh upsert write — never let the
        // (possibly stale) read overwrite the writer's value.
        redis.set(_cacheKey(row.recordingKey), JSON.stringify(row), 'EX', TTL_SECONDS(), 'NX')
          .catch(() => {}); // cache backfill is best-effort
      }
    }
  }
  return out;
}

async function upsertMany(docs = []) {
  if (!docs.length) return { upserted: 0 };

  const ops = docs.map((doc) => ({
    updateOne: {
      filter: doc.source === 'api'
        ? { recordingKey: doc.recordingKey }
        // Estimates never clobber measurements. If an 'api' doc exists, this
        // filter matches nothing and the upsert insert hits the unique index.
        : { recordingKey: doc.recordingKey, source: { $ne: 'api' } },
      update: { $set: { ...doc, fetchedAt: doc.fetchedAt ?? new Date() } },
      upsert: true,
    },
  }));

  try {
    await AudioFeature.bulkWrite(ops, { ordered: false });
  } catch (e) {
    const writeErrors = e.writeErrors ?? [];
    const onlyDuplicates = e.code === 11000
      || (writeErrors.length > 0 && writeErrors.every(w => (w.code ?? w.err?.code) === 11000));
    if (!onlyDuplicates) throw e;
    // E11000 here means an 'api' record already owns the key — the desired outcome.
  }

  const redis = getRedis();
  if (redis) {
    for (const doc of docs) {
      const op = doc.source === 'api'
        ? redis.set(_cacheKey(doc.recordingKey), JSON.stringify(doc), 'EX', TTL_SECONDS())
        : redis.del(_cacheKey(doc.recordingKey));
      op.catch(() => {});
    }
  }
  return { upserted: docs.length };
}

async function missingKeys(recordingKeys = []) {
  const found = await getMany(recordingKeys);
  return recordingKeys.filter(k => !found.has(k));
}

// Vibe tags from the enrichment worker. Invalidate (not write-through) so a
// racing reader always refills from Mongo truth — same rule as llm upserts.
async function setVibeTags(recordingKey, vibeTags = []) {
  await AudioFeature.updateOne({ recordingKey }, { $set: { vibeTags } });
  const redis = getRedis();
  if (redis) redis.del(_cacheKey(recordingKey)).catch(() => {});
}

// LLM-estimated records that later gained a Spotify id — upgrade candidates
// for the measured API (source 'api' overwrites 'llm', never the reverse).
async function llmUpgradeCandidates(limit = 200) {
  return AudioFeature.find({ source: 'llm', spotifyId: { $ne: null } }).limit(limit).lean();
}

module.exports = { getMany, upsertMany, missingKeys, setVibeTags, llmUpgradeCandidates };
