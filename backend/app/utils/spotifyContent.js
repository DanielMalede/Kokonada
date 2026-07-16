'use strict';

// Single source of truth for the Spotify-ToS containment predicate. Spotify's
// Developer Terms forbid storing Spotify Content in our corpus / feature store /
// embedding index and forbid feeding it to third-party ML. Every write path
// (catalog, feature hydration, embedding build, purge script, leak monitor)
// gates on THIS helper so the rule is defined once and can never drift between
// call sites.
//
// A row is Spotify Content when ANY identity field is a spotify: scheme or the
// provider is spotify. Matching is anchored + case-insensitive so `spotify:track:x`,
// `SPOTIFY:...`, and a bare `provider:'spotify'` all fail closed.

// In-memory predicate scheme: case-INSENSITIVE so a mislabeled `SPOTIFY:...` in JS-land fails closed.
const SPOTIFY_SCHEME = /^spotify:/i;
// Mongo-query scheme: case-SENSITIVE. Persisted recordingKey/uri are always lowercase `spotify:`
// (recordingKeyOf emits `spotify:${id}`), and a `/i` regex is non-SARGable — it forces a full
// collection scan and defeats the recordingKey index. Anchored + case-sensitive stays index-friendly.
const SPOTIFY_SCHEME_DB = /^spotify:/;

function isSpotifyKey(value) {
  return typeof value === 'string' && SPOTIFY_SCHEME.test(value.trim());
}

function isSpotifyContent(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.provider ?? '').toLowerCase() === 'spotify') return true;
  return isSpotifyKey(row.recordingKey) || isSpotifyKey(row.uri) || isSpotifyKey(row.canonicalKey);
}

// Standing-data variant used by the corpus purge + leak monitor: a persisted cache ROW is
// Spotify Content when its identity is spotify: OR it carries a bare spotifyId (AudioFeature
// stores the id without a scheme). Shared so the purge selector and the monitor never drift.
function isSpotifyRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.spotifyId != null) return true;
  return isSpotifyKey(row.recordingKey) || isSpotifyKey(row.uri);
}

// The equivalent Mongo selector for countDocuments/deleteMany over the real collections. Uses the
// case-SENSITIVE scheme so the query stays index-friendly (real keys are always lowercase).
function spotifyRowSelector() {
  return {
    $or: [
      { recordingKey: SPOTIFY_SCHEME_DB },
      { uri: SPOTIFY_SCHEME_DB },
      { spotifyId: { $ne: null } },
    ],
  };
}

module.exports = { isSpotifyContent, isSpotifyKey, isSpotifyRow, spotifyRowSelector, SPOTIFY_SCHEME, SPOTIFY_SCHEME_DB };
