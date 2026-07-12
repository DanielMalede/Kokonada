// backend/app/services/discovery/corpusIngest.js
'use strict';

const trackCatalogRepo = require('../../repositories/trackCatalogRepo');
const { catalogAndEmbed } = require('./catalogAndEmbed');
const { enqueue } = require('../../queues/queue');
const { QUEUES } = require('../../queues/definitions');

// Real-dependency binding of catalogAndEmbed for profile-build / ingest. Best-effort:
// corpus population is an enhancement and must never break profile assembly. enqueue() is a
// graceful no-op without Redis (dev/test); the worker reads recordingKeys + genresByKey.
async function ingestLibrary(libraryTracks = []) {
  try {
    return await catalogAndEmbed(libraryTracks, {
      upsertCatalog: (entries) => trackCatalogRepo.upsertMany(entries),
      enqueueEmbedding: (recordingKeys, genresByKey) => enqueue(QUEUES.EMBEDDING_BUILD, { recordingKeys, genresByKey }),
    });
  } catch (e) {
    console.warn(`[corpusIngest] skipped: ${e.message}`);
    return { catalogued: 0, enqueued: 0 };
  }
}

module.exports = { ingestLibrary };
