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

const SPOTIFY_SCHEME = /^spotify:/i;

function isSpotifyKey(value) {
  return typeof value === 'string' && SPOTIFY_SCHEME.test(value.trim());
}

function isSpotifyContent(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.provider ?? '').toLowerCase() === 'spotify') return true;
  return isSpotifyKey(row.recordingKey) || isSpotifyKey(row.uri) || isSpotifyKey(row.canonicalKey);
}

module.exports = { isSpotifyContent, isSpotifyKey, SPOTIFY_SCHEME };
