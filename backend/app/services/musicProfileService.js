'use strict';

const MusicProfile = require('../models/MusicProfile');
const spotify      = require('./spotify');
const youtube      = require('./youtube');

const LIBRARY_CAP = 10_000; // max tracks stored per user to stay within 16 MB doc limit

// Listening-history source weights. Spotify killed /audio-features for new apps
// (Nov 2024), so taste is inferred from WHAT the user listens to, not how a track
// "sounds". Heavier weight = stronger taste signal. A within-list position bonus
// (0..1) breaks ties so the #1 top track outranks the #50.
const SOURCE_WEIGHTS = {
  topShort:  6, // current obsessions
  topMedium: 5,
  topLong:   4, // long-term core taste
  saved:     3,
  recent:    2,
  playlist:  1,
};

// ── Pure utilities ─────────────────────────────────────────────────────────────

/**
 * Removes duplicate items by their `id` field, keeping the first occurrence.
 * @param {{ id: string }[]} items
 */
function _deduplicateById(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Ranks an array of string values by descending frequency.
 * Null / undefined values are silently dropped.
 * @param {(string|null|undefined)[]} items
 * @returns {string[]}
 */
function _rankByFrequency(items) {
  const freq = {};
  for (const item of items) {
    if (item == null) continue;
    freq[item] = (freq[item] || 0) + 1;
  }
  return Object.entries(freq)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);
}

// ── Spotify analysis (listening-history based) ──────────────────────────────────

/**
 * Accumulates a weighted affinity score per track across every listening source.
 * Earlier positions within a source get a small bonus so ranking is preserved.
 *
 * @param {{ tracks: object[], weight: number }[]} sources
 * @returns {Map<string, { track: object, affinity: number }>}
 */
function _accumulateTracks(sources) {
  const byId = new Map();
  for (const { tracks, weight } of sources) {
    const n = tracks.length;
    tracks.forEach((track, i) => {
      if (!track?.id) return;
      const positionBonus = n > 0 ? (n - i) / n : 0; // ~1 for #1, →0 for the last
      const score = weight + positionBonus;
      const existing = byId.get(track.id);
      if (existing) {
        existing.affinity += score;
        // Keep the richest track object (one that carries artists/name/uri).
        if (!existing.track.artists?.length && track.artists?.length) existing.track = track;
      } else {
        byId.set(track.id, { track, affinity: score });
      }
    });
  }
  return byId;
}

/**
 * Ranks artists across the (short/medium/long) top-artist lists, summing a
 * weighted, position-bonused score per artist id. Returns artist objects in
 * descending rank, each carrying its genres.
 *
 * @param {{ artists: {id,name,genres}[], weight: number }[]} artistLists
 * @returns {{ id, name, genres, score }[]}
 */
function _rankArtistsFromTops(artistLists) {
  const byId = new Map();
  for (const { artists, weight } of artistLists) {
    const n = artists.length;
    artists.forEach((a, i) => {
      if (!a?.id) return;
      const score = weight + (n > 0 ? (n - i) / n : 0);
      const existing = byId.get(a.id);
      if (existing) {
        existing.score += score;
        if (a.genres?.length) existing.genres = [...new Set([...existing.genres, ...a.genres])];
      } else {
        byId.set(a.id, { id: a.id, name: a.name ?? null, genres: a.genres ?? [], score });
      }
    });
  }
  return [...byId.values()].sort((x, y) => y.score - x.score);
}

/**
 * Builds the full Spotify taste model from raw listening history — no audio
 * features required. Pure & deterministic given its inputs (so it is unit-tested
 * directly), while `_buildSpotifyProfile` handles the network fetching.
 *
 * @param {{
 *   trackSources: { tracks: object[], weight: number }[],
 *   artistLists:  { artists: object[], weight: number }[],
 *   artistGenres: Record<string, string[]>,
 * }} input
 * @returns {{ library, topArtists, topGenres, genreSet, knownArtistIds }}
 */
function _analyzeSpotifyProfile({ trackSources = [], artistLists = [], artistGenres = {} }) {
  const trackMap      = _accumulateTracks(trackSources);
  const rankedArtists = _rankArtistsFromTops(artistLists);

  // artist id → genres, preferring the rich top-artist objects, then any fetched.
  const genreByArtist = { ...artistGenres };
  for (const a of rankedArtists) {
    if (a.genres?.length) genreByArtist[a.id] = a.genres;
  }

  const library = [...trackMap.values()]
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, LIBRARY_CAP)
    .map(({ track, affinity }) => {
      const artistIds = (track.artists || []).map(a => a.id).filter(Boolean);
      const genres    = [...new Set(artistIds.flatMap(id => genreByArtist[id] || []))];
      return {
        id:           track.id,
        provider:     'spotify',
        name:         track.name ?? null,
        uri:          track.uri  ?? null,
        artist:       track.artists?.[0]?.name ?? null,
        artistIds,
        genres,
        popularity:   track.popularity ?? null,
        affinity:     Number(affinity.toFixed(3)),
        // Audio features are dead for new apps — retained as null for back-compat.
        tempo: null, energy: null, valence: null, acousticness: null, danceability: null,
      };
    });

  const topArtists = rankedArtists.map(a => a.name).filter(Boolean).slice(0, 20);

  // topGenres: artist genres weighted by artist rank, plus a light contribution
  // from each library track's genres (covers users with thin top-artist data).
  const genreFreq = {};
  rankedArtists.forEach((a, idx) => {
    const w = rankedArtists.length - idx;
    for (const g of a.genres || []) genreFreq[g] = (genreFreq[g] || 0) + w;
  });
  for (const t of library) {
    for (const g of t.genres) genreFreq[g] = (genreFreq[g] || 0) + 1;
  }
  const topGenres = Object.entries(genreFreq)
    .sort(([, a], [, b]) => b - a)
    .map(([g]) => g)
    .slice(0, 10);

  // genreSet: the user's full genre footprint — the baseline discovery filters against.
  const genreSet = [...new Set([
    ...rankedArtists.flatMap(a => a.genres || []),
    ...library.flatMap(t => t.genres),
  ])];

  // knownArtistIds: every artist the user already listens to (for novelty filtering).
  const knownArtistIds = [...new Set([
    ...rankedArtists.map(a => a.id),
    ...library.flatMap(t => t.artistIds),
  ])];

  return { library, topArtists, topGenres, genreSet, knownArtistIds };
}

/**
 * Runs a Spotify fetch, degrading to a sentinel on a missing-scope/expired error
 * instead of failing the whole profile build. A 403 means the stored token
 * predates a newly-added scope (e.g. user-top-read / user-library-read) — the
 * user must reconnect once; until then we build from whatever endpoints work.
 */
async function _safeFetch(label, fn) {
  try {
    return await fn();
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      console.warn(`[musicProfile] ${label} unavailable (${status}) — reconnect Spotify to re-grant scopes`);
      return null;
    }
    throw err;
  }
}

/**
 * Fetches the user's listening history from Spotify and runs the analysis.
 */
async function _buildSpotifyProfile(token) {
  const [
    topShort, topMed, topLong,
    topArtShort, topArtMed, topArtLong,
    saved, recent, playlist,
  ] = await Promise.all([
    _safeFetch('top tracks (short)',  () => spotify.getTopTracks(token, 'short_term', 50)),
    _safeFetch('top tracks (medium)', () => spotify.getTopTracks(token, 'medium_term', 50)),
    _safeFetch('top tracks (long)',   () => spotify.getTopTracks(token, 'long_term', 50)),
    _safeFetch('top artists (short)',  () => spotify.getTopArtists(token, 'short_term', 50)),
    _safeFetch('top artists (medium)', () => spotify.getTopArtists(token, 'medium_term', 50)),
    _safeFetch('top artists (long)',   () => spotify.getTopArtists(token, 'long_term', 50)),
    _safeFetch('saved tracks',     () => spotify.paginateLikedSongs(token)),
    _safeFetch('recently played',  () => spotify.getRecentlyPlayed(token, 50)),
    _safeFetch('playlist tracks',  () => spotify.paginatePlaylistTracks(token)),
  ]);

  const trackSources = [
    { tracks: topShort || [], weight: SOURCE_WEIGHTS.topShort },
    { tracks: topMed   || [], weight: SOURCE_WEIGHTS.topMedium },
    { tracks: topLong  || [], weight: SOURCE_WEIGHTS.topLong },
    { tracks: saved    || [], weight: SOURCE_WEIGHTS.saved },
    { tracks: recent   || [], weight: SOURCE_WEIGHTS.recent },
    { tracks: playlist || [], weight: SOURCE_WEIGHTS.playlist },
  ];
  const artistLists = [
    { artists: topArtShort || [], weight: 3 },
    { artists: topArtMed   || [], weight: 2 },
    { artists: topArtLong  || [], weight: 1 },
  ];

  // Resolve genres for track artists not already covered by the top-artist objects.
  const topArtistIds  = new Set(artistLists.flatMap(l => l.artists.map(a => a.id)).filter(Boolean));
  const trackArtistIds = [...new Set(
    trackSources.flatMap(s => s.tracks)
      .flatMap(t => (t.artists || []).map(a => a.id))
      .filter(Boolean),
  )];
  const missingIds = trackArtistIds.filter(id => !topArtistIds.has(id));
  const fetchedGenres = missingIds.length
    ? (await _safeFetch('artist genres', () => spotify.getArtistsGenres(token, missingIds))) || {}
    : {};

  return _analyzeSpotifyProfile({ trackSources, artistLists, artistGenres: fetchedGenres });
}

// ── YouTube analysis ───────────────────────────────────────────────────────────

const TAG_TO_GENRE = {
  electronic: 'electronic', edm: 'electronic', techno: 'electronic',
  house: 'electronic',      trance: 'electronic',
  pop: 'pop', indie: 'indie', rock: 'rock', 'alternative rock': 'rock',
  ambient: 'ambient', jazz: 'jazz', classical: 'classical',
  'hip-hop': 'hip-hop', 'hip hop': 'hip-hop', rap: 'hip-hop',
  'r&b': 'r&b', rnb: 'r&b', soul: 'soul', funk: 'funk',
  metal: 'metal', country: 'country', folk: 'folk', blues: 'blues',
  reggae: 'reggae', latin: 'latin',
};

/**
 * Analyses a flat list of YouTube video objects (liked videos + playlist items)
 * and extracts genre signals from tags and artist names from channelTitle.
 * Audio feature fields are null because YouTube has no audio-features API.
 *
 * @param {{ id: string, snippet: { title?: string, channelTitle: string, tags?: string[] } }[]} videos
 */
function _analyzeYouTubeTracks(videos) {
  const library    = [];
  const genrePool  = [];
  const artistPool = [];
  const n = videos.length;

  videos.forEach((video, i) => {
    const snippet = video.snippet ?? video;
    const rawTags = snippet.tags ?? [];
    const genres  = rawTags
      .map(t => TAG_TO_GENRE[t.toLowerCase()])
      .filter(Boolean);

    library.push({
      id:           video.id ?? snippet.resourceId?.videoId,
      provider:     'youtube_music',
      name:         snippet.title ?? null,
      uri:          null,
      tempo:        null,
      energy:       null,
      valence:      null,
      acousticness: null,
      danceability: null,
      genres,
      artist:       snippet.channelTitle ?? null,
      artistIds:    [],
      popularity:   null,
      affinity:     n - i, // earlier in the liked/playlist list → higher affinity
    });

    genrePool.push(...genres);
    if (snippet.channelTitle) artistPool.push(snippet.channelTitle);
  });

  return {
    library:    library.slice(0, LIBRARY_CAP),
    topGenres:  _rankByFrequency(genrePool).slice(0, 10),
    topArtists: _rankByFrequency(artistPool).slice(0, 20),
  };
}

// ── Profile builder ────────────────────────────────────────────────────────────

/**
 * Fetches the user's complete musical footprint from all connected providers,
 * analyses it, and upserts the result into the MusicProfile collection.
 *
 * @param {string} userId   - MongoDB ObjectId string for the user
 * @param {object} user     - User mongoose doc (must implement getToken())
 * @returns {Promise<MusicProfile>}
 */
async function buildProfile(userId, user) {
  const spotifyToken = user.getToken?.('spotifyToken')?.accessToken      ?? null;
  const youtubeToken = user.getToken?.('youtubeMusicToken')?.accessToken ?? null;

  let library        = [];
  let topGenres      = [];
  let topArtists     = [];
  let genreSet       = [];
  let knownArtistIds = [];
  // Audio-feature baselines are gone (Spotify deprecation); kept null for back-compat.
  const averages = { tempoBaseline: null, energy: null, valence: null, acousticness: null, danceability: null };

  if (spotifyToken) {
    const analysis = await _buildSpotifyProfile(spotifyToken);
    library.push(...analysis.library);
    topGenres      = analysis.topGenres;
    topArtists     = analysis.topArtists;
    genreSet       = analysis.genreSet;
    knownArtistIds = analysis.knownArtistIds;
  }

  if (youtubeToken) {
    const [likedVideos, playlistItems] = await Promise.all([
      youtube.paginateLikedVideos(youtubeToken),
      youtube.paginatePlaylistItems(youtubeToken),
    ]);

    const allVideos  = _deduplicateById([...likedVideos, ...playlistItems]);
    const ytAnalysis = _analyzeYouTubeTracks(allVideos);

    library.push(...ytAnalysis.library);
    // Merge rankings — YouTube fills the genre gap where Spotify is sparse.
    topGenres  = _rankByFrequency([...topGenres,  ...ytAnalysis.topGenres]).slice(0, 10);
    topArtists = _rankByFrequency([...topArtists, ...ytAnalysis.topArtists]).slice(0, 20);
    genreSet   = [...new Set([...genreSet, ...ytAnalysis.topGenres])];
  }

  return MusicProfile.findOneAndUpdate(
    { userId },
    {
      $set: {
        ...averages,
        topGenres,
        topArtists,
        genreSet,
        knownArtistIds,
        library: library.slice(0, LIBRARY_CAP),
        lastAnalyzed: new Date(),
      },
    },
    { upsert: true, new: true }
  );
}

module.exports = {
  buildProfile,
  // Exported for unit testing
  _analyzeSpotifyProfile,
  _analyzeYouTubeTracks,
  _accumulateTracks,
  _rankArtistsFromTops,
  _deduplicateById,
  _rankByFrequency,
};
