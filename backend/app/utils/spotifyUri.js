'use strict';

// Spotify track ids are exactly 22 base-62 chars; a playable URI is
// `spotify:track:<id>`. Anything else — undefined, a YouTube video id, an
// album/episode URI, or a half-built `spotify:track:` — is unplayable and must
// never reach the Spotify Web API: it answers a single malformed URI with an
// opaque 400 for the WHOLE request, killing playback of every valid track too.
const SPOTIFY_TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/;

/**
 * True only for a well-formed Spotify track URI.
 * @param {unknown} uri
 * @returns {boolean}
 */
function isSpotifyTrackUri(uri) {
  return typeof uri === 'string' && SPOTIFY_TRACK_URI_RE.test(uri);
}

/**
 * Filters an arbitrary value down to valid, de-duplicated Spotify track URIs,
 * preserving order. Non-arrays yield `[]`; non-strings, malformed URIs, and
 * duplicates are dropped.
 * @param {unknown} uris
 * @returns {string[]}
 */
function sanitizeSpotifyTrackUris(uris) {
  if (!Array.isArray(uris)) return [];
  const seen = new Set();
  const out = [];
  for (const uri of uris) {
    if (!isSpotifyTrackUri(uri) || seen.has(uri)) continue;
    seen.add(uri);
    out.push(uri);
  }
  return out;
}

module.exports = { isSpotifyTrackUri, sanitizeSpotifyTrackUris, SPOTIFY_TRACK_URI_RE };
