'use strict';

// Familiar share of each playlist. Lowered 0.7 → 0.55 so every generation pulls in
// more fresh music (Bug 1: less of the same top-affinity block). Overridable for tuning.
const FAMILIAR_RATIO = Number(process.env.FAMILIAR_RATIO) || 0.55;
// Strictly 50 songs per generation (overridable for tests / future tuning).
const PLAYLIST_SIZE = Number(process.env.PLAYLIST_SIZE) || 50;
// Variety window: shuffle within the top (target × this) highest-affinity tracks so
// repeated presses surface a different on-vibe subset instead of the same static block.
const VARIETY_WINDOW = 1.7;

const EMPTY_SET = new Set();

// ── Pure helpers ───────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Bug 1 fix: shuffle within the top-affinity window so the familiar block varies
 * across presses, while never reaching into the low-affinity long tail. The first
 * `target × VARIETY_WINDOW` tracks (all high-affinity) are shuffled; everything
 * past the window keeps its affinity order as the backfill tail.
 */
function _varietyWindow(ordered, target) {
  if (target <= 0 || ordered.length <= target) return shuffle(ordered);
  const windowSize = Math.min(ordered.length, Math.ceil(target * VARIETY_WINDOW));
  return [...shuffle(ordered.slice(0, windowSize)), ...ordered.slice(windowSize)];
}

/**
 * True if any of a track's (lower-cased) genres matches an entry in a mood's
 * allow/exclude list. Mood lists are hand-authored BASE genres (e.g. "metal",
 * "punk", "house"); track genres are granular artist genres (e.g. "death metal",
 * "pop punk", "big room house"). Exact matching leaks — "death metal" slips past a
 * "metal" exclude — so a granular genre matches when it CONTAINS a base entry. The
 * base entries are specific enough ("metal", "ambient", "acoustic") that substring
 * matching catches subgenres without meaningful false positives.
 */
function _genreHits(genres, filterSet) {
  if (!filterSet.size) return false;
  for (const g of genres) {
    if (filterSet.has(g)) return true;
    for (const f of filterSet) {
      if (g.includes(f)) return true;
    }
  }
  return false;
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
function _orderFamiliar(library, moodGenres, provider, opts = {}) {
  const excludeGenres = opts.excludeGenres || EMPTY_SET;
  const allowGenres   = opts.allowGenres   || EMPTY_SET;
  const strict        = !!opts.strict;
  const byAffinity = (a, b) => (b.affinity ?? 0) - (a.affinity ?? 0);
  const relevant = [];
  const rest     = [];
  for (const t of library) {
    if (!_matchesProvider(t, provider)) continue;
    const g = (t.genres || []).map(x => x.toLowerCase());
    // Zero-tolerance strict filter (mood active): hard-exclude off-vibe genres and
    // keep ONLY allow-list matches eligible — an off-vibe favourite is dropped, not
    // ranked lower, and is never used to backfill an on-vibe mood.
    if (strict) {
      if (_genreHits(g, excludeGenres)) continue;
      if (allowGenres.size && !_genreHits(g, allowGenres)) continue;
    }
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
function _orderDiscovery(rawDiscovery, { libraryIds, knownArtistIds, genreSet, provider, excludeGenres = EMPTY_SET, strictPersonalize = false }) {
  const eligible = _dedupeById(rawDiscovery.filter(t => t?.id && _matchesProvider(t, provider)));

  const relevant = [];
  const looser   = [];
  const outliers = [];
  const nonNovel = [];

  for (const t of eligible) {
    const g = (t.genres || []).map(x => x.toLowerCase());
    // Zero-tolerance strict filter: drop off-vibe discovery candidates outright so a
    // mood never surfaces an excluded genre (e.g. an acoustic track in an intense mix).
    // Substring-aware so a subgenre ("death metal") is caught by its base ("metal").
    if (_genreHits(g, excludeGenres)) continue;
    if (!_isNovel(t, libraryIds, knownArtistIds)) {
      if (!libraryIds.has(t.id)) nonNovel.push(t); // never resurface a library track as "discovery"
      continue;
    }
    if (!g.length) looser.push(t);
    else if (g.some(x => genreSet.has(x))) relevant.push(t);
    else outliers.push(t);
  }

  // Personalization-first: when sourcing from broad vibe playlists, the user's taste
  // is the ABSOLUTE filter. Discard the off-taste `outliers` (genres outside the user's
  // taste — e.g. Rock for an Afrobeat listener) AND the `looser` genre-unknown tier
  // (unverifiable, can't confirm on-taste) so they can never backfill the playlist.
  // `relevant` (genre overlap) and `nonNovel` (by a known artist) are both on-taste.
  if (strictPersonalize) {
    return [...shuffle(relevant), ...shuffle(nonNovel)];
  }

  return [...shuffle(relevant), ...shuffle(looser), ...shuffle(outliers), ...shuffle(nonNovel)];
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
async function mixPlaylist({ musicProfile, aiParams, fetchDiscoveryTracks, playlistSize = PLAYLIST_SIZE, provider = null, strictPersonalize = false, cooldownIds = null }) {
  const familiarTarget  = Math.round(playlistSize * FAMILIAR_RATIO);
  const discoveryTarget = playlistSize - familiarTarget;
  // Anti-repetition: ids generated in the user's last few playlists are held on a
  // cooldown and filtered out of every bucket, so sequential generations don't
  // overlap. Relaxed only as a last resort (a repeat beats an empty playlist).
  const cooldown = cooldownIds instanceof Set ? cooldownIds : new Set(cooldownIds || []);
  const fresh = (pool) => (cooldown.size ? pool.filter((t) => !cooldown.has(t.id)) : pool);

  const library        = musicProfile.library || [];
  const libraryIds     = new Set(library.map(t => t.id));
  const knownArtistIds = new Set(musicProfile.knownArtistIds || []);
  const genreSet       = new Set((musicProfile.genreSet || []).map(g => g.toLowerCase()));
  const moodGenres     = new Set((aiParams.seed_genres || []).map(g => g.toLowerCase()));
  // Strict sonic filter is active only when the mood attached exclude_genres
  // (the HR/biometric branch attaches none, so it keeps the soft-bias behaviour).
  const excludeGenres  = new Set((aiParams.exclude_genres || []).map(g => g.toLowerCase()));
  const allowGenres    = new Set((aiParams.allow_genres || aiParams.seed_genres || []).map(g => g.toLowerCase()));
  const strict         = excludeGenres.size > 0;

  // Variety window keeps the familiar block fresh across presses; in strict mode the
  // pool is already filtered to on-vibe tracks, so it can never introduce off-vibe.
  const familiarPool  = _varietyWindow(
    _orderFamiliar(library, moodGenres, provider, { excludeGenres, allowGenres, strict }),
    familiarTarget,
  );
  const rawDiscovery  = (await fetchDiscoveryTracks(aiParams)) || [];
  const discoveryPool = _orderDiscovery(rawDiscovery, { libraryIds, knownArtistIds, genreSet, provider, excludeGenres, strictPersonalize });

  // Cooldown-filtered views drive the primary selection; the raw pools are kept for
  // the last-resort backfill below.
  const familiarFresh  = fresh(familiarPool);
  const discoveryFresh = fresh(discoveryPool);

  // Initial split (cooldown-filtered).
  const familiar  = familiarFresh.slice(0, familiarTarget);
  const discovery = discoveryFresh.slice(0, discoveryTarget);

  // Always fill to exactly playlistSize unique tracks. Add more discovery first
  // (novelty), then backfill from the library; relax only at the tail.
  const chosen = new Set([...familiar, ...discovery].map(t => t.id));
  const fillFrom = (pool, bucket) => {
    for (const t of pool) {
      if (chosen.size >= playlistSize) break;
      if (!chosen.has(t.id)) { bucket.push(t); chosen.add(t.id); }
    }
  };
  fillFrom(discoveryFresh.slice(discovery.length), discovery);
  fillFrom(familiarFresh.slice(familiar.length), familiar);

  // Mood relaxation ladder: a narrow zero-tolerance allow-list (e.g. "Calm" only
  // allows ambient/acoustic/lo-fi) can starve BOTH pools when the user's taste
  // doesn't cover the mood and Spotify discovery is dead — which surfaced as the
  // "Could not build a playlist from the current sources" failure. When strict
  // filtering leaves us short, backfill from the user's NON-excluded library with
  // the allow-list dropped. The exclude_genres floor is still honoured (off-vibe
  // genres never leak in), so this never returns an empty playlist for a connected
  // user without weakening the hard sonic floor. Only runs in strict mode, so the
  // soft-bias (HR/biometric) path is byte-identical.
  const relaxedFamiliarPool = () => _varietyWindow(
    _orderFamiliar(library, moodGenres, provider, { excludeGenres, allowGenres: EMPTY_SET, strict: true }),
    familiarTarget,
  );
  if (strict && chosen.size < playlistSize) {
    fillFrom(fresh(relaxedFamiliarPool()), familiar);
  }

  // Last resort: if the cooldown starved the pools, allow cooled tracks back in
  // rather than ship a short playlist (a repeat beats an empty queue).
  if (cooldown.size && chosen.size < playlistSize) {
    fillFrom(discoveryPool, discovery);
    fillFrom(familiarPool, familiar);
    if (strict) fillFrom(relaxedFamiliarPool(), familiar);
  }

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
  personalizeWhitelist,
  generateFallbackPlaylist,
  // Exported for unit testing
  _orderFamiliar,
  _orderDiscovery,
  _isNovel,
  _mergeNatural,
  _dedupeById,
};
