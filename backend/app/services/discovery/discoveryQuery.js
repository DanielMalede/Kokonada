'use strict';

// BE-231 — the music provider's fence. The owner's ruling of 2026-10-28: Spotify receives no value
// derived from medical information, the sleep note's effect included; the health filtering happens
// here, after the results come back.
//
// A DiscoveryQuery is the ONLY thing a provider discovery request is built from. The generation core
// builds it before any health input touches the params (geminiEngine), and the Spotify adapter runs
// it through toDiscoveryQuery again before it sends anything (spotify.fetchVibeDiscovery), so a
// caller that hands the adapter its health-shaped params still sends only these lists.
//
// toDiscoveryQuery is an allow-list, not a strip-list: it copies three OWN keys of non-empty strings
// and drops everything else — every numeric target, the tempo category, the exclude and allow lists,
// and any key nobody listed — so a field added to the params later cannot ride along. The result and
// its lists are frozen.

const DISCOVERY_QUERY_LIMITS = Object.freeze({ seed_genres: 5, mood_keywords: 4, playlist_queries: 4 });

function _strings(source, key) {
  if (!Object.hasOwn(source, key) || !Array.isArray(source[key])) return Object.freeze([]);
  const kept = source[key].filter((v) => typeof v === 'string' && v.trim().length > 0);
  return Object.freeze(kept.slice(0, DISCOVERY_QUERY_LIMITS[key]));
}

/**
 * @param {unknown} input  anything; only its own seed_genres, mood_keywords and playlist_queries are read
 * @returns {Readonly<{ seed_genres: readonly string[], mood_keywords: readonly string[], playlist_queries: readonly string[] }>}
 */
function toDiscoveryQuery(input) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.freeze({
    seed_genres:      _strings(source, 'seed_genres'),
    mood_keywords:    _strings(source, 'mood_keywords'),
    playlist_queries: _strings(source, 'playlist_queries'),
  });
}

/**
 * The heart-rate branch's query: the user's first two top genres and nothing else. Everything else
 * that branch knows (the reading, the band, its keywords, the state label, the ratio, the watch
 * activity) is health-derived, so the query is the same whatever the body does.
 * @param {{ topGenres?: string[] } | null | undefined} musicProfile
 */
function bioDiscoveryQuery(musicProfile) {
  const top = musicProfile && Array.isArray(musicProfile.topGenres) ? musicProfile.topGenres : [];
  return toDiscoveryQuery({ seed_genres: top.slice(0, 2) });
}

module.exports = { toDiscoveryQuery, bioDiscoveryQuery, DISCOVERY_QUERY_LIMITS };
