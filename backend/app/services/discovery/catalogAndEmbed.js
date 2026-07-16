// backend/app/services/discovery/catalogAndEmbed.js
'use strict';

const { toCatalogEntry } = require('./toCatalogEntry');
const { isSpotifyContent } = require('../../utils/spotifyContent');
const { isYoutubeContent } = require('../../utils/youtubeContent');

// Fan a batch of library tracks into the discovery corpus: upsert the anonymous catalog
// (metadata + genres) and enqueue an embedding-build job. Deps are injected so the unit is
// pure and testable; the real wiring passes trackCatalogRepo.upsertMany + the embed queue.
// Raw library tracks carry no recordingKey — toCatalogEntry derives it (via the shared
// recordingKeyOf, so youtube_music → youtube:<id> aligns with existing embeddings) and maps
// name→title before anything is catalogued; entries that can't yield a key are dropped.
// The catalog is ALWAYS upserted (genre-union); embedding is enqueued only for keys not
// already in the corpus so a resumable bulk run wastes no Groq spend. A missing/failed
// existence lookup falls back to embedding ALL — re-paying is acceptable, dropping is not.
async function catalogAndEmbed(tracks = [], deps = {}) {
  // toCatalogEntry already drops Spotify AND YouTube Content; this is the belt-and-suspenders
  // gate at the write choke — nothing spotify: or youtube: reaches upsertCatalog/enqueueEmbedding
  // even if a caller injects a pre-built entry that bypassed normalization (third-party-ToS
  // containment; the cross-user corpus stays CC0 mbid:-only).
  const entries = (tracks || [])
    .map(toCatalogEntry)
    .filter(Boolean)
    .filter(e => !isSpotifyContent(e) && !isYoutubeContent(e));
  if (!entries.length) return { catalogued: 0, enqueued: 0 };

  await deps.upsertCatalog(entries);

  let existing = new Set();
  if (typeof deps.getExistingEmbeddingKeys === 'function') {
    try { existing = await deps.getExistingEmbeddingKeys(entries.map(e => e.recordingKey)); }
    catch { existing = new Set(); } // lookup failed → embed all (never drop an embed)
  }
  const toEmbed = entries.filter(e => !existing.has(e.recordingKey));

  const genresByKey = {};
  for (const e of toEmbed) if (Array.isArray(e.genres) && e.genres.length) genresByKey[e.recordingKey] = e.genres;
  if (toEmbed.length) await deps.enqueueEmbedding(toEmbed.map(e => e.recordingKey), genresByKey);

  return { catalogued: entries.length, enqueued: toEmbed.length };
}

module.exports = { catalogAndEmbed };
