'use strict';

const MusicProfile = require('../models/MusicProfile');
const spotify      = require('./spotify');
const youtube      = require('./youtube');
const { inferArtistGenres } = require('./geminiEngine');
const { cleanYouTubeArtist } = require('./crossPlatform');
const { canonicalKey } = require('./identity/trackIdentity');
const featureService = require('./features/featureService');
const corpusIngest = require('./discovery/corpusIngest');
const musicClassifier = require('./musicClassifier');
const unclassifiedRepo = require('../repositories/unclassifiedRepo');

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
  playlist:  4, // a curated playlist is a DELIBERATE choice — weight it with the long-term core, not the floor (was 1)
};

// How much one subscribed music channel counts toward YouTube's provider weight, relative
// to one liked/playlisted track. A subscription is a coarser ARTIST-level follow (not an
// explicit per-song choice), so it's worth a fraction of a track — enough that many artist
// subscriptions still push a YouTube-heavy user to dominate, without a subs-only account
// out-weighting real listening. Only high-confidence music channels are counted (the
// "- Topic"/VEVO/Official-Artist filter in _subscriptionArtists), which is the guard
// against "unexpected" (non-music) subscriptions ever entering the math.
const SUBSCRIPTION_WEIGHT = 0.5;

// ── Pure utilities ─────────────────────────────────────────────────────────────

/**
 * Removes duplicate items by their `id` field, keeping the first occurrence.
 * @param {{ id: string }[]} items
 */
function _deduplicateById(items, keyFn = (item) => item.id) {
  const seen = new Set();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The canonical YouTube VIDEO id for either shape:
 *   • videos.list item (liked video)  → `item.id` IS the video id
 *   • playlistItems.list item         → `item.id` is the PLAYLIST-ITEM id; the video id
 *                                        lives at `snippet.resourceId.videoId`
 * Preferring resourceId makes the same song dedupe across likes+playlists AND lets topic
 * enrichment resolve the real video for playlist items (previously it used the wrong id).
 */
function _videoIdOf(v) {
  return v?.snippet?.resourceId?.videoId ?? v?.id ?? null;
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
      const seen = _engagementTime(track);
      const existing = byId.get(track.id);
      if (existing) {
        existing.affinity += score;
        // The SAME track can appear as a 2019 playlist add and as a play from this morning.
        // Recency is the most recent evidence, not the first one encountered (W4-010 a).
        if (seen && (!existing.lastSeenAt || seen > existing.lastSeenAt)) existing.lastSeenAt = seen;
        // Keep the richest track object (one that carries artists/name/uri).
        if (!existing.track.artists?.length && track.artists?.length) existing.track = track;
      } else {
        byId.set(track.id, { track, affinity: score, lastSeenAt: seen });
      }
    });
  }
  return byId;
}

/**
 * The most recent moment we can HONESTLY say the user engaged with a track, or null.
 *
 * `playedAt` (recently-played) and `addedAt` (liked songs, playlist items) are attached by
 * the Spotify fetchers, which used to discard the wrapper item that carries them. Top-tracks
 * rows have no timestamp at all — Spotify's term windows are a ranking, not a date — and get
 * null rather than an invented "now", because W4-010's decay treats missing evidence as no
 * penalty. Inventing a timestamp here would be the one way to make that dishonest.
 */
function _engagementTime(track) {
  const raw = track?.playedAt ?? track?.addedAt ?? null;
  if (!raw) return null;
  const t = new Date(raw);
  return Number.isFinite(t.getTime()) ? t : null;
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
    .map(({ track, affinity, lastSeenAt }) => {
      const artistIds = (track.artists || []).map(a => a.id).filter(Boolean);
      const genres    = [...new Set(artistIds.flatMap(id => genreByArtist[id] || []))];
      const entry = {
        id:           track.id,
        provider:     'spotify',
        name:         track.name ?? null,
        uri:          track.uri  ?? null,
        artist:       track.artists?.[0]?.name ?? null,
        artistIds,
        genres,
        popularity:   track.popularity ?? null,
        affinity:     Number(affinity.toFixed(3)),
        lastSeenAt:   lastSeenAt ?? null,
        isrc:         track.external_ids?.isrc ?? null,
        // Audio features are dead for new apps — retained as null for back-compat.
        tempo: null, energy: null, valence: null, acousticness: null, danceability: null,
      };
      entry.canonicalKey = canonicalKey(entry);
      return entry;
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

// YouTube affinity, on the SAME scale as the Spotify sources (D17).
//
// It used to be `n - i` over the merged list, so a 500-video account produced affinities up
// to 500 while Spotify's `weight + positionBonus` tops out around 30. Both end up in ONE
// array, normalised by a single global maxAffinity in the selection pipeline — so for any
// user with both providers connected, every Spotify track collapsed toward 0 and their
// Spotify taste effectively vanished from ranking.
//
// A liked video is a per-song save (SOURCE_WEIGHTS.saved); a playlist item is a deliberate
// curation choice (SOURCE_WEIGHTS.playlist) — the same reading the Spotify side already
// takes. The 0..1 position bonus stays a tie-breaker within the source.
function _youtubeAffinity(liked, rank, total) {
  const base = liked ? SOURCE_WEIGHTS.saved : SOURCE_WEIGHTS.playlist;
  const positionBonus = total > 0 ? (total - rank) / total : 0;
  return Number((base + positionBonus).toFixed(3));
}

/**
 * Analyses a flat list of YouTube video objects (liked videos + playlist items)
 * and extracts genre signals from tags and artist names from channelTitle.
 * Audio feature fields are null because YouTube has no audio-features API.
 *
 * Affinity is on the SAME scale as the Spotify side (`SOURCE_WEIGHTS` + a 0..1 position
 * bonus) — see the D17 note on `_youtubeAffinity`.
 *
 * @param {{ id: string, snippet: { title?: string, channelTitle: string, tags?: string[] } }[]} videos
 *        deduped video objects, liked first then playlist items (the caller's merge order)
 * @param {{ likedIds?: Set<string>|null }} [opts]  which video ids came from the LIKED list;
 *        every other video is a playlist item. Omitted → all treated as liked (back-compat).
 */
/** The moment a playlist item was added to its playlist, or null if unusable. */
function _playlistAddTime(snippet) {
  const raw = snippet?.publishedAt ?? null;
  if (!raw) return null;
  const t = new Date(raw);
  return Number.isFinite(t.getTime()) ? t : null;
}

function _analyzeYouTubeTracks(videos, { likedIds = null } = {}) {
  const library    = [];
  const genrePool  = [];
  const artistPool = [];

  // Per-source totals + running ranks, so the position bonus measures rank WITHIN a source
  // (as it does for Spotify) rather than position in the concatenated array.
  const isLiked = (video) => !likedIds || likedIds.has(_videoIdOf(video));
  const likedTotal = videos.reduce((c, v) => c + (isLiked(v) ? 1 : 0), 0);
  const playlistTotal = videos.length - likedTotal;
  let likedRank = 0;
  let playlistRank = 0;

  videos.forEach((video, i) => {
    const snippet = video.snippet ?? video;
    const rawTags = snippet.tags ?? [];
    const genres  = rawTags
      .map(t => TAG_TO_GENRE[t.toLowerCase()])
      .filter(Boolean);

    // Clean the channel decorations ("- Topic"/VEVO/…) so a video's artist matches the SAME
    // artist coming from a subscription — otherwise the weighting fragments one artist into two.
    const artist = cleanYouTubeArtist(snippet.channelTitle) || snippet.channelTitle || null;

    const entry = {
      id:           _videoIdOf(video),
      provider:     'youtube_music',
      name:         snippet.title ?? null,
      uri:          null,
      tempo:        null,
      energy:       null,
      valence:      null,
      acousticness: null,
      danceability: null,
      genres,
      artist,
      artistIds:    [],
      popularity:   null,
      isrc:         null,
      affinity:     _youtubeAffinity(isLiked(video),
        isLiked(video) ? likedRank++ : playlistRank++,
        isLiked(video) ? likedTotal  : playlistTotal),
      // W4-010 (a): a playlistItems `snippet.publishedAt` is when the USER added the video —
      // engagement, and admissible. A videos.list (liked) `snippet.publishedAt` is when the
      // CONTENT was uploaded; reading it as engagement would decay a 1970s song liked
      // yesterday to nothing. Liked videos therefore carry NO recency claim, which the decay
      // reads as "no penalty" rather than "old".
      lastSeenAt:   isLiked(video) ? null : _playlistAddTime(snippet),
    };
    entry.canonicalKey = canonicalKey(entry);
    library.push(entry);

    genrePool.push(...genres);
    if (artist) artistPool.push(artist);
  });

  return {
    library:    library.slice(0, LIBRARY_CAP),
    topGenres:  _rankByFrequency(genrePool).slice(0, 10),
    topArtists: _rankByFrequency(artistPool).slice(0, 20),
  };
}

// Wikipedia music-genre topic slugs (from videos.topicDetails.topicCategories) → our
// canonical genres. The generic "/wiki/Music" topic is intentionally excluded (too coarse).
const WIKI_TOPIC_TO_GENRE = {
  'pop': 'pop', 'rock': 'rock', 'hip hop': 'hip-hop', 'hip-hop': 'hip-hop',
  'electronic': 'electronic', 'electronic dance': 'electronic',
  'independent': 'indie', 'country': 'country', 'jazz': 'jazz',
  'classical': 'classical', 'soul': 'soul', 'rhythm and blues': 'r&b',
  'reggae': 'reggae', 'folk': 'folk', 'heavy metal': 'metal', 'metal': 'metal',
  'blues': 'blues', 'funk': 'funk', 'latin': 'latin',
};

/**
 * Extract canonical genres from a video's Wikipedia topicCategories URLs
 * (e.g. "https://en.wikipedia.org/wiki/Rock_music" → "rock"). Unmapped / too-coarse
 * topics are dropped. Pure — unit-testable.
 */
function _genresFromTopicCategories(topicCategories) {
  const out = [];
  for (const url of topicCategories || []) {
    const slug = String(url).split('/wiki/')[1];
    if (!slug) continue;
    const name = decodeURIComponent(slug).replace(/_/g, ' ').toLowerCase().replace(/\s*music$/, '').trim();
    if (WIKI_TOPIC_TO_GENRE[name]) out.push(WIKI_TOPIC_TO_GENRE[name]);
  }
  return out;
}

/**
 * Extract artist names from the user's channel subscriptions, keeping only high-confidence
 * MUSIC channels (auto-generated "… - Topic" / "…VEVO" / "… - Official Artist Channel").
 * Non-music subscriptions (news, gaming, …) are excluded so they can't pollute taste.
 * Pure — unit-testable.
 */
function _subscriptionArtists(subscriptions) {
  const out = [];
  const MUSIC_MARKER = /-\s*Topic\s*$|VEVO\s*$|-\s*Official Artist Channel\s*$/i;
  for (const s of subscriptions || []) {
    const title = s?.snippet?.title || '';
    if (!MUSIC_MARKER.test(title)) continue;
    // Shared cleaner → the artist name matches the SAME artist from a liked/playlist video.
    const name = cleanYouTubeArtist(title);
    if (name) out.push(name);
  }
  return out;
}

/**
 * Merge two providers' RANKED signal lists (genres or artists), weighting each provider
 * by how much of the combined library it contributed. This is the "brain" that lets a
 * richer YouTube history dominate the taste profile: an item's score is (rank position ×
 * provider weight), summed across providers, then re-ranked. With YouTube 500 tracks vs
 * Spotify 50, YouTube signals carry ~10× the weight.
 *
 * @param {string[]} rankedA  provider A's ranked list (highest-affinity first)
 * @param {number}   weightA  provider A's weight (its library size)
 * @param {string[]} rankedB  provider B's ranked list
 * @param {number}   weightB  provider B's weight (its library size)
 * @param {number}   cap      max items to return
 */
function _weightedMergeRanked(rankedA, weightA, rankedB, weightB, cap) {
  return _mergeRankedLists([{ ranked: rankedA, weight: weightA }, { ranked: rankedB, weight: weightB }], cap);
}

// W4-010 (b): provider influence SATURATES with library size instead of scaling with it.
//
// Raw size made the merge a row count: 50 curated Spotify tracks against one imported
// 2000-item YouTube playlist is a 40:1 vote, so the Spotify side's #1 genre could not reach
// the merged top-10 at all. But the marginal taste evidence in a library's 2000th row is
// nothing like that in its 50th — the information grows roughly logarithmically, not
// linearly. log1p is the honest curve for that, and it is the same shape W4-010 (b) asks
// for: the richer provider still leads (log1p(2000)/log1p(50) ≈ 1.9), it just no longer
// erases the other one. log1p(0) = 0, so the "no data contributes nothing" guard is
// preserved exactly, and monotonicity — more data never counts for less — is preserved too.
const _providerWeight = (size) => (Number.isFinite(size) && size > 0 ? Math.log1p(size) : 0);

/**
 * N-way version of the same merge, so `recomputeFootprint` can reuse it without folding
 * pairwise (which would apply the saturation twice to an already-merged accumulator).
 * @param {{ ranked: string[], weight: number }[]} lists
 */
function _mergeRankedLists(lists, cap) {
  const score = new Map();
  for (const { ranked, weight } of lists) {
    const w = _providerWeight(weight);
    // A provider with no data (weight ≤ 0) or an empty list contributes nothing. The
    // empty guard also prevents a divide-by-zero in the positional term below.
    if (!(w > 0) || !Array.isArray(ranked) || ranked.length === 0) continue;
    const n = ranked.length;
    ranked.forEach((item, i) => {
      // Position is normalized PER LIST (1.0 for #1 → 1/n for the last) so a longer list
      // can't out-score a shorter one just by having more entries — ONLY the provider
      // `weight` decides cross-provider dominance, and each list's #1 contributes exactly
      // `weight`. This keeps the Spotify-vs-YouTube balance purely about data richness.
      const positional = (n - i) / n;
      score.set(item, (score.get(item) || 0) + positional * w);
    });
  }
  return [...score.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([item]) => item)
    .slice(0, cap);
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
async function buildProfile(userId, user, onProgress = () => {}) {
  const report = (pct, label) => { try { onProgress(pct, label); } catch { /* never let UI feedback break the build */ } };
  report(8, 'Starting analysis');
  const spotifyToken = user.getToken?.('spotifyToken')?.accessToken      ?? null;
  const youtubeToken = user.getToken?.('youtubeMusicToken')?.accessToken ?? null;

  let library        = [];
  let topGenres      = [];
  let topArtists     = [];
  let genreSet       = [];
  let knownArtistIds = [];
  // Audio-feature baselines are gone (Spotify deprecation); kept null for back-compat.
  const averages = { tempoBaseline: null, energy: null, valence: null, acousticness: null, danceability: null };

  // Each provider is failure-ISOLATED: a stale/expired token (or any unexpected
  // error) for one provider must never abort the other's analysis or block the save.
  // (Bug: an unguarded YouTube 401 threw past the Spotify analysis, so the whole
  // build aborted and no MusicProfile was ever persisted → generation produced
  // nothing.) `_buildSpotifyProfile` already degrades per-endpoint via _safeFetch;
  // this outer guard catches anything that still escapes.
  if (spotifyToken) {
    try {
      const analysis = await _buildSpotifyProfile(spotifyToken);
      library.push(...analysis.library);
      topGenres      = analysis.topGenres;
      topArtists     = analysis.topArtists;
      genreSet       = analysis.genreSet;
      knownArtistIds = analysis.knownArtistIds;
    } catch (err) {
      console.warn(`[musicProfile] Spotify analysis skipped: ${err.message}`);
    }
  }
  report(55, 'Analysed your Spotify library');

  if (youtubeToken) {
    try {
      // Deep ingestion: liked videos + EVERY user playlist's items (paginatePlaylistItems
      // walks all playlists). Watch history is intentionally absent — the YouTube Data API
      // has not exposed it since 2016, so "all available" is likes + playlists.
      const [likedVideos, playlistItems] = await Promise.all([
        youtube.paginateLikedVideos(youtubeToken),
        youtube.paginatePlaylistItems(youtubeToken),
      ]);

      // Dedupe by the real VIDEO id (not the playlist-item id) so the same song appearing
      // in likes AND one or more playlists collapses to a single library entry.
      const allVideos  = _deduplicateById([...likedVideos, ...playlistItems], _videoIdOf);
      // Which ids are LIKES decides the affinity weight (D17). Likes are merged first, so a
      // song that is both liked and playlisted keeps its liked identity through the dedupe.
      const likedIds   = new Set(likedVideos.map(_videoIdOf).filter(Boolean));
      const ytAnalysis = _analyzeYouTubeTracks(allVideos, { likedIds });

      // ── Extra legal Data-API sources that enrich the taste signals ──────────────────
      // (a) Subscribed MUSIC channels → strong artist-affinity signal. Best-effort: a
      //     failure here must not lose the liked/playlist analysis above.
      let subArtists = [];
      try {
        subArtists = _subscriptionArtists(await youtube.paginateSubscriptions(youtubeToken));
      } catch (e) { console.warn(`[musicProfile] YouTube subscriptions skipped: ${e.message}`); }

      // (b) Video topicDetails → Wikipedia music-genre topics (richer than the sparse
      //     per-video tags), fetched for likes AND every playlist item (via the real video
      //     id). Bounded + batched inside fetchVideoTopics. Best-effort.
      let topicGenres = [];
      const metaById  = {};
      try {
        const videoIds = allVideos.map(_videoIdOf).filter(Boolean);
        const topics   = await youtube.fetchVideoTopics(youtubeToken, videoIds);
        topicGenres    = topics.flatMap(t => _genresFromTopicCategories(t.topicCategories));
        // Reuse the categoryId + topics we just fetched as classifier meta (no extra call).
        for (const m of topics) metaById[m.id] = { categoryId: m.categoryId, topicCategories: m.topicCategories };
      } catch (e) { console.warn(`[musicProfile] YouTube topics skipped: ${e.message}`); }

      // Ingest gate (§D1): classify every YouTube track (Groq on) and keep only music. Junk
      // is dropped so it never enters the library; the undecidable (Groq outage) is pooled
      // for the periodic reclassify worker — never added to the profile unverified.
      try {
        // Pass youtubeToken so the classifier can fetch metadata (categoryId/topics) for any
        // ambiguous track not covered by the pre-fetched topics — Music-tagged tracks are then
        // always kept, and a track whose metadata can't be fetched is pooled, never dropped.
        const verdict = await musicClassifier.classifyTracks(ytAnalysis.library, { useLLM: true, metaById, youtubeToken });
        ytAnalysis.library = verdict.music;
        if (verdict.unclassified.length) {
          await unclassifiedRepo.addMany(userId, verdict.unclassified, 'ingest');
        }
      } catch (e) { console.warn(`[musicProfile] YouTube classification skipped: ${e.message}`); }

      // Fold the new signals into YouTube's ranked lists before the cross-provider merge.
      const ytGenresRanked  = _rankByFrequency([...ytAnalysis.topGenres,  ...topicGenres]).slice(0, 12);
      const ytArtistsRanked = _rankByFrequency([...ytAnalysis.topArtists, ...subArtists]).slice(0, 25);

      // Weighting ("the brain"): each provider's taste signals count in proportion to how
      // much it contributed. YouTube's contribution = its library tracks + a fractional
      // (SUBSCRIPTION_WEIGHT) credit per subscribed artist, so a user rich on YouTube (big
      // library and/or many artist subs) strongly dominates the core taste — while a
      // subs-only account can't out-weight real listening. Capture Spotify's size BEFORE
      // pushing YouTube tracks so the weights stay accurate.
      const spotifyLibSize = library.length;
      const youtubeLibSize = ytAnalysis.library.length + subArtists.length * SUBSCRIPTION_WEIGHT;
      const spotifyTopGenres  = topGenres;
      const spotifyTopArtists = topArtists;

      library.push(...ytAnalysis.library);
      topGenres  = _weightedMergeRanked(spotifyTopGenres,  spotifyLibSize, ytGenresRanked,  youtubeLibSize, 10);
      topArtists = _weightedMergeRanked(spotifyTopArtists, spotifyLibSize, ytArtistsRanked, youtubeLibSize, 20);
      genreSet   = [...new Set([...genreSet, ...ytGenresRanked])];

      report(70, youtubeLibSize > spotifyLibSize
        ? 'Weighted your richer YouTube library (likes, playlists, subscriptions, topics)'
        : 'Merged your YouTube library (likes, playlists, subscriptions, topics)');
    } catch (err) {
      console.warn(`[musicProfile] YouTube analysis skipped: ${err.message}`);
    }
  }

  // LLM genre backfill: Spotify increasingly serves EMPTY artist `genres`, leaving
  // genreSet empty so the mood filters can't differentiate ("calm" == "intense").
  // When no genres came through, ask the LLM (Groq) for the library artists' genres
  // ONCE here — this is the background build, not the latency-sensitive generation
  // path — then tag the library and re-derive the genre signals. Fails open.
  if (genreSet.length === 0 && library.length > 0) {
    report(72, 'Tagging genres with AI');
    // Wave-0 (H-3): Spotify Content must never reach the LLM (Spotify Developer Policy
    // AI-ingestion ban). ALLOWLIST — only KNOWN non-Spotify providers are eligible, so a
    // provider-less / mis-tagged track fails CLOSED (its artist name is never sent) rather
    // than slipping through a denylist.
    const LLM_BACKFILL_PROVIDERS = new Set(['youtube_music']);
    const names     = [...new Set(library.filter(t => LLM_BACKFILL_PROVIDERS.has(t.provider)).map(t => t.artist).filter(Boolean))];
    const llmGenres = await inferArtistGenres(names);
    if (Object.keys(llmGenres).length > 0) {
      for (const t of library) {
        if ((!t.genres || t.genres.length === 0) && t.artist && llmGenres[t.artist]) {
          t.genres = llmGenres[t.artist];
        }
      }
      genreSet  = [...new Set(library.flatMap(t => t.genres || []))];
      topGenres = _rankByFrequency(library.flatMap(t => t.genres || [])).slice(0, 10);
    }
  }

  report(95, 'Saving your profile');
  const profile = await MusicProfile.findOneAndUpdate(
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
  report(100, 'Profile ready');

  // Dark launch: queue audio-feature hydration for the freshly built library.
  // Fire-and-forget — profile building never waits on (or fails with) the store.
  featureService.enqueueHydration(library).catch(() => {});
  // Third-party-ToS containment (defense-in-depth): the discovery corpus is a persistent,
  // cross-user cache, so neither Spotify nor YouTube Content may be seeded into it (Spotify
  // Developer Terms + YouTube API Services Terms both forbid an independent persistent database
  // of their API data). Strip spotify + youtube_music rows before ingest — the catalog choke
  // (toCatalogEntry) drops them too, but filtering here keeps the corpus caller honest and the
  // excluded counts auditable. Only CC0 mbid: content survives into the shared corpus.
  const corpusLibrary  = library.filter(t => t.provider !== 'spotify' && t.provider !== 'youtube_music');
  const excludedSpotify = library.filter(t => t.provider === 'spotify').length;
  const excludedYoutube = library.filter(t => t.provider === 'youtube_music').length;
  if (excludedSpotify > 0 || excludedYoutube > 0) console.info(`[musicProfile] corpus ingest excluded ${excludedSpotify} spotify + ${excludedYoutube} youtube_music track(s) (ToS containment)`);
  corpusIngest.ingestLibrary(corpusLibrary).catch(() => {}); // grow the discovery corpus (CC0 mbid: only)

  return profile;
}

// Re-derive the taste footprint (topGenres/topArtists/genreSet) from a library. Used after a
// classification purge or a pool-promotion changes which tracks the profile contains.
//
// W4-010 (c) — DUAL-ALGORITHM DRIFT, closed. This used to rank by raw row FREQUENCY while
// `buildProfile` ranked by weighted affinity and then merged the providers by library size.
// The two therefore disagreed on the same library: one ambient track the user plays daily
// (affinity 24) lost to three tail playlist rows tagged "workout" (affinity 1 each), so a
// classification purge silently replaced the user's taste profile with a different one that
// no rebuild would ever reproduce.
//
// The recompute now uses the build-time shape, restricted to what a stored library actually
// carries: rank WITHIN each provider by summed affinity, then merge ACROSS providers through
// the same log-saturated `_mergeRankedLists`. Entries written before affinity existed (or
// with a non-positive/NaN one) count as 1, which is exactly the old frequency ranking — so
// legacy libraries re-derive as they always did, and enriched ones re-derive as they were
// built.
function _rankByWeight(entries, keyFn) {
  const weight = new Map();
  for (const t of entries) {
    const raw = Number(t?.affinity);
    const w = Number.isFinite(raw) && raw > 0 ? raw : 1;
    for (const key of keyFn(t)) {
      if (typeof key !== 'string' || !key) continue;
      weight.set(key, (weight.get(key) || 0) + w);
    }
  }
  return [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function recomputeFootprint(library) {
  const list = (Array.isArray(library) ? library : []).filter(Boolean);

  // Group by provider so the cross-provider merge is the build-time one. An entry with no
  // provider (legacy rows, test fixtures) forms its own group rather than being dropped.
  const groups = new Map();
  for (const t of list) {
    const key = typeof t.provider === 'string' && t.provider ? t.provider : 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const genreLists  = [];
  const artistLists = [];
  for (const entries of groups.values()) {
    genreLists.push({ ranked: _rankByWeight(entries, t => (Array.isArray(t.genres) ? t.genres : [])), weight: entries.length });
    artistLists.push({ ranked: _rankByWeight(entries, t => [t.artist]), weight: entries.length });
  }

  return {
    topGenres:  _mergeRankedLists(genreLists, 10),
    topArtists: _mergeRankedLists(artistLists, 20),
    genreSet:   [...new Set(list.flatMap(t => (Array.isArray(t.genres) ? t.genres : [])).filter(g => typeof g === 'string' && g))],
  };
}

module.exports = {
  buildProfile,
  recomputeFootprint,
  SOURCE_WEIGHTS,
  // Exported for unit testing
  _analyzeSpotifyProfile,
  _analyzeYouTubeTracks,
  _accumulateTracks,
  _rankArtistsFromTops,
  _deduplicateById,
  _videoIdOf,
  _rankByFrequency,
  _weightedMergeRanked,
  _genresFromTopicCategories,
  _subscriptionArtists,
};
