// backend/app/services/discovery/globalSeeds.js
'use strict';

const IngestCursor = require('../../models/IngestCursor');

// The seed set for the global ingestion pipeline. Each scheduled run takes the NEXT slice (rotating
// cursor) so we spread provider fetches across many runs instead of hammering the API. Two seed kinds:
//   - 'genre'    → fed to spotify.searchTracksByGenres (catalog tracks by genre/mood)
//   - 'playlist' → fed to spotify.getVibePlaylistTracks (tracks of a curated PUBLIC playlist)
// Genre/mood seeds are static (broad coverage of the catalog); playlist IDs are supplied via env so
// we never hardcode editorial IDs that Spotify may rotate.
const CURSOR_NAME = 'global-seed';

const GENRE_SEEDS = [
  { kind: 'genre', query: 'lo-fi beats',        genres: ['lo-fi'] },
  { kind: 'genre', query: 'deep focus',         genres: ['ambient'] },
  { kind: 'genre', query: 'indie chill',        genres: ['indie'] },
  { kind: 'genre', query: 'classic soul',       genres: ['soul'] },
  { kind: 'genre', query: 'jazz essentials',    genres: ['jazz'] },
  { kind: 'genre', query: 'acoustic covers',    genres: ['acoustic'] },
  { kind: 'genre', query: 'hip hop classics',   genres: ['hip-hop'] },
  { kind: 'genre', query: 'r&b slow jams',      genres: ['r-n-b'] },
  { kind: 'genre', query: 'house grooves',      genres: ['house'] },
  { kind: 'genre', query: 'techno drive',       genres: ['techno'] },
  { kind: 'genre', query: 'rock anthems',       genres: ['rock'] },
  { kind: 'genre', query: 'afrobeats heat',     genres: ['afrobeat'] },
  { kind: 'genre', query: 'latin pop',          genres: ['latin'] },
  { kind: 'genre', query: 'reggae vibes',       genres: ['reggae'] },
  { kind: 'genre', query: 'folk storytellers',  genres: ['folk'] },
  { kind: 'genre', query: 'electronic pop',     genres: ['electropop'] },
  { kind: 'genre', query: 'metal energy',       genres: ['metal'] },
  { kind: 'genre', query: 'country roads',      genres: ['country'] },
  { kind: 'genre', query: 'blues roots',        genres: ['blues'] },
  { kind: 'genre', query: 'classical calm',     genres: ['classical'] },
  { kind: 'genre', query: 'funk & disco',       genres: ['funk'] },
  { kind: 'genre', query: 'ambient sleep',      genres: ['ambient'] },
];

// Playlist seeds from env (comma-separated public playlist IDs) — optional, trimmed, blanks dropped.
function playlistSeeds() {
  return String(process.env.GLOBAL_SEED_PLAYLIST_IDS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(playlistId => ({ kind: 'playlist', playlistId }));
}

function allSeeds() {
  return [...GENRE_SEEDS, ...playlistSeeds()];
}

// Pure rotation: return up to n seeds starting at `offset` (wrapping), capped at the list length so
// one batch never repeats a seed, and the advanced offset for the next run. Offset is normalized
// (mod length, negatives folded) so a stale/oversized stored cursor is always safe.
function nextBatch(offset = 0, n = 1, list = allSeeds()) {
  const len = Array.isArray(list) ? list.length : 0;
  if (!len || n <= 0) return { batch: [], nextOffset: 0 };
  const take = Math.min(n, len);
  const start = ((Number(offset) % len) + len) % len;
  const batch = [];
  for (let i = 0; i < take; i++) batch.push(list[(start + i) % len]);
  return { batch, nextOffset: (start + take) % len };
}

// Durable variant: read the persisted cursor, return the next batch, and advance the stored offset.
// Best-effort on the cursor I/O — a read/write failure degrades to offset 0 rather than throwing into
// the ingestion run (which is an enhancement and must never break).
async function takeNextBatch(n, list = allSeeds()) {
  let offset = 0;
  try {
    const cur = await IngestCursor.findOneAndUpdate(
      { name: CURSOR_NAME }, {}, { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    offset = cur?.offset ?? 0;
  } catch { offset = 0; }
  const { batch, nextOffset } = nextBatch(offset, n, list);
  try {
    await IngestCursor.updateOne({ name: CURSOR_NAME }, { $set: { offset: nextOffset } }, { upsert: true });
  } catch { /* best-effort cursor advance — never break the run */ }
  return batch;
}

module.exports = { CURSOR_NAME, GENRE_SEEDS, playlistSeeds, allSeeds, nextBatch, takeNextBatch };
