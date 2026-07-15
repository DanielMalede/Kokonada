// backend/app/services/discovery/corpusIngest.js
'use strict';

const trackCatalogRepo = require('../../repositories/trackCatalogRepo');
const { catalogAndEmbed } = require('./catalogAndEmbed');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');
const vectorIndex = require('../vector/vectorIndex');
const featureService = require('../features/featureService');

// Real-dependency binding of catalogAndEmbed for profile-build / ingest. Best-effort:
// corpus population is an enhancement and must never break profile assembly. enqueue() is a
// graceful no-op without Redis (dev/test); the worker reads recordingKeys + genresByKey.
async function ingestLibrary(libraryTracks = []) {
  try {
    return await catalogAndEmbed(libraryTracks, {
      upsertCatalog: (entries) => trackCatalogRepo.upsertMany(entries),
      enqueueEmbedding: (recordingKeys, genresByKey) => enqueue(QUEUES.EMBEDDING_BUILD, { recordingKeys, genresByKey }),
      // getMany returns a Map of only keys already embedded → skip re-embedding (no wasted Groq).
      getExistingEmbeddingKeys: async (keys) => new Set((await vectorIndex.getMany(keys)).keys()),
    });
  } catch (e) {
    console.warn(`[corpusIngest] skipped: ${e.message}`);
    return { catalogued: 0, enqueued: 0 };
  }
}

// Backfill pairing: the embedding worker HARD-SKIPS keys with no AudioFeature, so the
// standalone backfill must ensure features exist (ReccoBeats/LLM) for misses — enqueueHydration
// self-enqueues embedding once a feature lands. The profile-build path already calls
// enqueueHydration separately (musicProfileService), so it stays on ingestLibrary. Best-effort:
// a hydration failure never breaks the catalog+embed path.
async function backfillLibrary(libraryTracks = []) {
  try { await featureService.enqueueHydration(libraryTracks); }
  catch (e) { console.warn(`[corpusIngest] hydration skipped: ${e.message}`); }
  return ingestLibrary(libraryTracks);
}

// Global-seed variant: entries are ALREADY normalized (canonical MBID recordingKey, source:'global',
// uri:null, no platform id) — so we do NOT run toCatalogEntry (which would strip `source` and re-derive
// a platform recordingKey). Upsert the catalog (source flows via trackCatalogRepo), then enqueue embedding
// only for keys not already embedded. Best-effort: corpus growth is an enhancement, never throws upward.
async function ingestGlobal(entries = []) {
  try {
    const rows = (entries || []).filter(e => e && e.recordingKey);
    if (!rows.length) return { catalogued: 0, enqueued: 0 };
    await trackCatalogRepo.upsertMany(rows);
    let existing = new Set();
    try { existing = new Set((await vectorIndex.getMany(rows.map(e => e.recordingKey))).keys()); }
    catch { existing = new Set(); } // existence lookup failed → embed all (re-paying is fine, dropping is not)
    const toEmbed = rows.filter(e => !existing.has(e.recordingKey));
    const genresByKey = {};
    for (const e of toEmbed) if (Array.isArray(e.genres) && e.genres.length) genresByKey[e.recordingKey] = e.genres;
    if (toEmbed.length) await enqueue(QUEUES.EMBEDDING_BUILD, { recordingKeys: toEmbed.map(e => e.recordingKey), genresByKey });
    return { catalogued: rows.length, enqueued: toEmbed.length };
  } catch (e) {
    console.warn(`[corpusIngest] global skipped: ${e.message}`);
    return { catalogued: 0, enqueued: 0 };
  }
}

module.exports = { ingestLibrary, backfillLibrary, ingestGlobal };
