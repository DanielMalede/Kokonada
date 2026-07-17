'use strict';

// Single source of truth for the YouTube-ToS containment predicate. YouTube API Services
// Terms forbid building an INDEPENDENT persistent database of YouTube API data and require
// deletion within 30 days of a disconnect/revocation, so YouTube Content must never live in
// our cross-user corpus / feature store / embedding index. Every write path (catalog, feature
// hydration, embedding build, purge script, leak monitor) gates on THIS helper so the rule is
// defined once and can never drift between call sites. Mirrors utils/spotifyContent.
//
// A row is YouTube Content when ANY identity field is a youtube: scheme or the provider is
// youtube_music. Matching is anchored + case-insensitive so `youtube:id`, `YOUTUBE:...`, and a
// bare `provider:'youtube_music'` all fail closed.

// In-memory predicate scheme: case-INSENSITIVE so a mislabeled `YOUTUBE:...` in JS-land fails closed.
const YOUTUBE_SCHEME = /^youtube:/i;
// Mongo-query scheme: case-SENSITIVE. Persisted recordingKey/uri are always lowercase `youtube:`
// (recordingKeyOf emits `youtube:${id}`), and a `/i` regex is non-SARGable — it forces a full
// collection scan and defeats the recordingKey index. Anchored + case-sensitive stays index-friendly.
const YOUTUBE_SCHEME_DB = /^youtube:/;

function isYoutubeKey(value) {
  return typeof value === 'string' && YOUTUBE_SCHEME.test(value.trim());
}

function isYoutubeContent(row) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.provider ?? '').toLowerCase() === 'youtube_music') return true;
  return isYoutubeKey(row.recordingKey) || isYoutubeKey(row.uri) || isYoutubeKey(row.canonicalKey);
}

// Standing-data variant used by the corpus purge + leak monitor: a persisted cache ROW is YouTube
// Content when its identity is youtube:. Unlike Spotify (whose AudioFeature rows carry a bare
// spotifyId column), there is NO youtube bare-id column on AudioFeature — youtube rows are ALWAYS
// scheme-keyed (youtube:<videoId>) — so recordingKey/uri fully covers the persisted shape.
function isYoutubeRow(row) {
  if (!row || typeof row !== 'object') return false;
  return isYoutubeKey(row.recordingKey) || isYoutubeKey(row.uri);
}

// The equivalent Mongo selector for countDocuments/deleteMany over the real collections. Uses the
// case-SENSITIVE scheme so the query stays index-friendly (real keys are always lowercase).
function youtubeRowSelector() {
  return {
    $or: [
      { recordingKey: YOUTUBE_SCHEME_DB },
      { uri: YOUTUBE_SCHEME_DB },
    ],
  };
}

module.exports = { isYoutubeContent, isYoutubeKey, isYoutubeRow, youtubeRowSelector, YOUTUBE_SCHEME, YOUTUBE_SCHEME_DB };
