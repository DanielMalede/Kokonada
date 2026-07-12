// backend/app/services/discovery/toCatalogEntry.js
'use strict';

const { recordingKeyOf } = require('../features/featureProvider');
const trackIdentity = require('../identity/trackIdentity');

// Normalize a raw library track (shape { id, provider, name, uri, canonicalKey, genres, artist })
// into a discovery-catalog entry. Pure, no I/O. Returns a catalog-shaped object or null so callers
// can .filter(Boolean).
//
// recordingKey MUST come from the shared recordingKeyOf helper: it keys youtube_music tracks as
// `youtube:<id>`, matching how the existing trackembeddings are keyed. Hand-rolling `${provider}:${id}`
// would key them `youtube_music:<id>` and silently miss on catalog hydration. A track with no derivable
// recordingKey has no playable identity and is skipped (null), never throws. canonicalKey is derived
// from the same tested identity helper when absent so every entry carries a real cross-provider key.
function toCatalogEntry(track) {
  if (!track || typeof track !== 'object') return null;

  const recordingKey = recordingKeyOf(track); // honors a pre-set recordingKey, else derives (youtube_music → youtube:<id>)
  if (!recordingKey) return null;

  return {
    recordingKey,
    canonicalKey: track.canonicalKey ?? trackIdentity.canonicalKey(track),
    uri: track.uri ?? null,
    title: track.title ?? track.name ?? null,
    artist: track.artist ?? null,
    genres: Array.isArray(track.genres) ? track.genres : [],
  };
}

module.exports = { toCatalogEntry };
