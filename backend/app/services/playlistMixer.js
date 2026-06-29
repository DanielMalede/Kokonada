'use strict';

const FAMILIAR_RATIO = 0.7;
// Strictly 50 songs per generation (overridable for tests / future tuning).
const PLAYLIST_SIZE = Number(process.env.PLAYLIST_SIZE) || 50;

// ── Pure helpers ───────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function _dedupeById(tracks) {
  const seen = new Set();
  const out = [];
  for (const t of tracks) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/**
 * A track is eligible for a session only if its provider matches the active one
 * (or it is untagged). Mixing providers mints malformed URIs — e.g. a YouTube
 * video id wrapped as `spotify:track:<id>` — which Spotify 400s.
 */
function _matchesProvider(track, provider) {
  if (!provider || !track.provider) return true;
  if (provider === 'spotify') return track.provider === 'spotify';
  if (provider === 'youtube')  return track.provider === 'youtube' || track.provider === 'youtube_music';
  return true;
}

/**
 * A discovery track is "novel" only if neither the track nor any of its artists
 * are already part of the user's library — that is what makes the 30% genuine
 * discovery rather than a replay of the familiar 70%.
 */
function _isNovel(track, libraryIds, knownArtistIds) {
  if (libraryIds.has(track.id)) return false;
  return !(track.artistIds || []).some(id => knownArtistIds.has(id));
}

/**
 * Orders the familiar pool best-first: tracks whose genres overlap the mood's
 * seed genres come first (each tier sorted by listening affinity), then the rest.
 * Provider-filtered so only playable tracks are eligible.
 *
 * Audio-feature (BPM/energy) matching is gone — Spotify killed /audio-features —
 * so familiarity is judged on real taste signals: genre overlap + affinity.
 *
 * @param {object[]} library
 * @param {Set<string>} moodGenres   lower-cased mood seed genres
 * @param {string|null} provider
 */
function _orderFamiliar(library, moodGenres, provider) {
  const byAffinity = (a, b) => (b.affinity ?? 0) - (a.affinity ?? 0);
  const relevant = [];
  const rest     = [];
  for (const t of library) {
    if (!_matchesProvider(t, provider)) continue;
    const g = (t.genres || []).map(x => x.toLowerCase());
    if (moodGenres.size && g.some(x => moodGenres.has(x))) relevant.push(t);
    else rest.push(t);
  }
  return [...relevant.sort(byAffinity), ...rest.sort(byAffinity)];
}

/**
 * Interleaves familiar and discovery tracks in a 2:1 pattern:
 *   [f, f, d, f, f, d, ...]
 * Appends any remaining tracks from either list once the other is exhausted.
 */
function _mergeNatural(familiar, discovery) {
  const merged = [];
  let fi = 0;
  let di = 0;
  let slot = 0; // 0,1 → familiar; 2 → discovery (cycles of 3)

  while (fi < familiar.length || di < discovery.length) {
    if (slot < 2 && fi < familiar.length) {
      merged.push(familiar[fi++]);
    } else if (slot === 2 && di < discovery.length) {
      merged.push(discovery[di++]);
    } else if (fi < familiar.length) {
      merged.push(familiar[fi++]);
    } else {
      merged.push(discovery[di++]);
    }
    slot = (slot + 1) % 3;
  }

  return merged;
}

/**
 * Ranks discovery candidates best-first against the user's real taste:
 *   relevant  — novel + shares a genre with the user's genreSet
 *   looser    — novel but genre-unknown (no artist genres resolved)
 *   outliers  — novel but genres fall entirely outside the user's taste
 *   nonNovel  — already in the library / by a known artist (last-resort only)
 * Each tier is shuffled so repeated generations vary ("fresh every press").
 */
function _orderDiscovery(rawDiscovery, { libraryIds, knownArtistIds, genreSet, provider }) {
  const eligible = _dedupeById(rawDiscovery.filter(t => t?.id && _matchesProvider(t, provider)));

  const relevant = [];
  const looser   = [];
  const outliers = [];
  const nonNovel = [];

  for (const t of eligible) {
    if (!_isNovel(t, libraryIds, knownArtistIds)) {
      if (!libraryIds.has(t.id)) nonNovel.push(t); // never resurface a library track as "discovery"
      continue;
    }
    const g = (t.genres || []).map(x => x.toLowerCase());
    if (!g.length) looser.push(t);
    else if (g.some(x => genreSet.has(x))) relevant.push(t);
    else outliers.push(t);
  }

  return [...shuffle(relevant), ...shuffle(looser), ...shuffle(outliers), ...shuffle(nonNovel)];
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Builds a playlist of exactly `playlistSize` unique tracks using a 70/30
 * familiar/discovery split. Discovery is filtered to the user's real taste, and
 * the playlist is always filled to the target by progressively relaxing the
 * discovery filter then backfilling from the library.
 *
 * @param {{
 *   musicProfile:         { library?: object[], genreSet?: string[], knownArtistIds?: string[] },
 *   aiParams:             { seed_genres?: string[] },
 *   fetchDiscoveryTracks: (params: object) => Promise<object[]>,
 *   playlistSize?:        number,
 *   provider?:            'spotify'|'youtube'|null,
 * }} opts
 * @returns {Promise<{ familiar: object[], discovery: object[], merged: object[] }>}
 */
async function mixPlaylist({ musicProfile, aiParams, fetchDiscoveryTracks, playlistSize = PLAYLIST_SIZE, provider = null }) {
  const familiarTarget  = Math.round(playlistSize * FAMILIAR_RATIO);
  const discoveryTarget = playlistSize - familiarTarget;

  const library        = musicProfile.library || [];
  const libraryIds     = new Set(library.map(t => t.id));
  const knownArtistIds = new Set(musicProfile.knownArtistIds || []);
  const genreSet       = new Set((musicProfile.genreSet || []).map(g => g.toLowerCase()));
  const moodGenres     = new Set((aiParams.seed_genres || []).map(g => g.toLowerCase()));

  const familiarPool  = _orderFamiliar(library, moodGenres, provider);
  const rawDiscovery  = (await fetchDiscoveryTracks(aiParams)) || [];
  const discoveryPool = _orderDiscovery(rawDiscovery, { libraryIds, knownArtistIds, genreSet, provider });

  // Initial 70/30 split.
  const familiar  = familiarPool.slice(0, familiarTarget);
  const discovery = discoveryPool.slice(0, discoveryTarget);

  // Always fill to exactly playlistSize unique tracks. Add more discovery first
  // (novelty), then backfill from the library; relax only at the tail.
  const chosen = new Set([...familiar, ...discovery].map(t => t.id));
  const fillFrom = (pool, bucket) => {
    for (const t of pool) {
      if (chosen.size >= playlistSize) break;
      if (!chosen.has(t.id)) { bucket.push(t); chosen.add(t.id); }
    }
  };
  fillFrom(discoveryPool.slice(discovery.length), discovery);
  fillFrom(familiarPool.slice(familiar.length), familiar);

  const merged = _dedupeById(_mergeNatural(familiar, discovery)).slice(0, playlistSize);
  return { familiar, discovery, merged };
}

/**
 * Emergency fallback — no AI. Returns the user's top N most-listened tracks.
 *
 * When a `provider` is given, only tracks from that provider (plus untagged
 * legacy entries) are returned. This prevents a Spotify playback session from
 * being seeded with YouTube library entries: their ids are YouTube video ids, so
 * the pipeline would mint malformed `spotify:track:<youtube-id>` URIs that
 * Spotify 400s. Omitting `provider` keeps the original unfiltered behavior.
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

module.exports = {
  mixPlaylist,
  generateFallbackPlaylist,
  // Exported for unit testing
  _orderFamiliar,
  _orderDiscovery,
  _isNovel,
  _mergeNatural,
  _dedupeById,
};
