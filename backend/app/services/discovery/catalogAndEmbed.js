// backend/app/services/discovery/catalogAndEmbed.js
'use strict';

// Fan a batch of library tracks into the discovery corpus: upsert the anonymous catalog
// (metadata + genres) and enqueue an embedding-build job. Deps are injected so the unit is
// pure and testable; the real wiring passes trackCatalogRepo.upsertMany + the embed queue.
// The catalog is ALWAYS upserted (genre-union); embedding is enqueued only for keys not
// already in the corpus so a resumable bulk run wastes no Groq spend. A missing/failed
// existence lookup falls back to embedding ALL — re-paying is acceptable, dropping is not.
async function catalogAndEmbed(tracks = [], deps = {}) {
  const valid = (tracks || []).filter(t => t && t.recordingKey);
  if (!valid.length) return { catalogued: 0, enqueued: 0 };

  await deps.upsertCatalog(valid.map(t => ({
    recordingKey: t.recordingKey, canonicalKey: t.canonicalKey ?? null,
    uri: t.uri ?? null, title: t.title ?? null, artist: t.artist ?? null, genres: t.genres ?? [],
  })));

  let existing = new Set();
  if (typeof deps.getExistingEmbeddingKeys === 'function') {
    try { existing = await deps.getExistingEmbeddingKeys(valid.map(t => t.recordingKey)); }
    catch { existing = new Set(); } // lookup failed → embed all (never drop an embed)
  }
  const toEmbed = valid.filter(t => !existing.has(t.recordingKey));

  const genresByKey = {};
  for (const t of toEmbed) if (Array.isArray(t.genres) && t.genres.length) genresByKey[t.recordingKey] = t.genres;
  if (toEmbed.length) await deps.enqueueEmbedding(toEmbed.map(t => t.recordingKey), genresByKey);

  return { catalogued: valid.length, enqueued: toEmbed.length };
}

module.exports = { catalogAndEmbed };
