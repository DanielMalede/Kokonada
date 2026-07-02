'use strict';

// Phase 7 — the legacy mixer is DELETED. The old mixing entry point and its
// 40/40/20 bucket machinery (tiered rotation, variety windows, sort axes,
// natural merge) were replaced by the selection pipeline (pool → hardFilters →
// score → MMR) with the ServeLedger owning anti-repetition. What remains here
// are the two pure survivors the generation path still uses.

// Provider guard: keeps YouTube library entries from being served as Spotify
// fallbacks (their ids would mint malformed spotify:track:<youtube-id> URIs).
function _matchesProvider(track, provider) {
  if (!provider) return true;
  if (provider === 'spotify') {
    return track?.provider === 'spotify' || String(track?.uri ?? '').startsWith('spotify:');
  }
  if (provider === 'youtube') {
    return String(track?.provider ?? '').startsWith('youtube');
  }
  return true;
}

/**
 * Personalization is the ABSOLUTE filter on a vibe-sourced candidate pool: a track
 * survives only if its genres intersect the user's taste OR it is by a known artist.
 * Off-taste and unverifiable (genre-unknown, unknown-artist) candidates are discarded
 * — so a Rock track pulled from a "Beast Mode" playlist never reaches an Afrobeat
 * listener's playlist. Pure; accepts arrays or Sets; case-insensitive on genres.
 *
 * @param {object[]} tracks  discovery candidates, tagged with `genres` + `artistIds`
 * @param {{ genreSet?: Iterable<string>, knownArtistIds?: Iterable<string> }} profile
 * @returns {object[]} only the on-taste candidates, original order preserved
 */
function personalizeWhitelist(tracks, { genreSet = [], knownArtistIds = [] } = {}) {
  const genres  = new Set([...(genreSet || [])].map(g => String(g).toLowerCase()));
  const artists = new Set([...(knownArtistIds || [])]);
  return (tracks || []).filter((t) => {
    if (!t) return false;
    const g = (t.genres || []).map(x => String(x).toLowerCase());
    if (g.some(x => genres.has(x))) return true;
    return (t.artistIds || []).some(id => artists.has(id));
  });
}

/**
 * Static last-resort playlist when generation fails end-to-end: the user's
 * top-affinity library tracks, provider-filtered so a Spotify player is never
 * seeded with YouTube video ids.
 *
 * @param {{ library?: Array<{ affinity?: number, listenCount?: number, provider?: string }> }} musicProfile
 * @param {'spotify'|'youtube'|null} [provider=null]
 * @param {number} [n=10]
 * @returns {Array}
 */
function generateFallbackPlaylist(musicProfile, provider = null, n = 10) {
  const lib = musicProfile?.library ?? [];
  return [...lib]
    .filter((t) => _matchesProvider(t, provider))
    .sort((a, b) => (b.affinity ?? b.listenCount ?? 0) - (a.affinity ?? a.listenCount ?? 0))
    .slice(0, n);
}

module.exports = { personalizeWhitelist, generateFallbackPlaylist };
