// backend/app/services/discovery/catalogAndEmbed.js
'use strict';

// Fan a batch of library tracks into the discovery corpus: upsert the anonymous catalog
// (metadata + genres) and enqueue an embedding-build job. Deps are injected so the unit is
// pure and testable; the real wiring passes trackCatalogRepo.upsertMany + the embed queue.
async function catalogAndEmbed(tracks = [], deps = {}) {
  const valid = (tracks || []).filter(t => t && t.recordingKey);
  if (!valid.length) return { catalogued: 0, enqueued: 0 };

  await deps.upsertCatalog(valid.map(t => ({
    recordingKey: t.recordingKey, canonicalKey: t.canonicalKey ?? null,
    uri: t.uri ?? null, title: t.title ?? null, artist: t.artist ?? null, genres: t.genres ?? [],
  })));

  const genresByKey = {};
  for (const t of valid) if (Array.isArray(t.genres) && t.genres.length) genresByKey[t.recordingKey] = t.genres;
  await deps.enqueueEmbedding(valid.map(t => t.recordingKey), genresByKey);

  return { catalogued: valid.length, enqueued: valid.length };
}

module.exports = { catalogAndEmbed };
