'use strict';

const MusicProfile = require('../models/MusicProfile');
const spotify      = require('./spotify');
const youtube      = require('./youtube');
const { inferArtistGenres } = require('./geminiEngine');
const { cleanYouTubeArtist } = require('./crossPlatform');
const { canonicalKey } = require('./identity/trackIdentity');
const featureService = require('./features/featureService');
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
      affinity:     n - i, // earlier in the liked/playlist list → higher affinity
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
  const score = new Map();
  const add = (ranked, weight) => {
    // A provider with no data (weight ≤ 0) or an empty list contributes nothing. The
    // empty guard also prevents a divide-by-zero in the positional term below.
    if (!(weight > 0) || ranked.length === 0) return;
    const n = ranked.length;
    ranked.forEach((item, i) => {
      // Position is normalized PER LIST (1.0 for #1 → 1/n for the last) so a longer list
      // can't out-score a shorter one just by having more entries — ONLY the provider
      // `weight` decides cross-provider dominance, and each list's #1 contributes exactly
      // `weight`. This keeps the Spotify-vs-YouTube balance purely about data richness.
      const positional = (n - i) / n;
      score.set(item, (score.get(item) || 0) + positional * weight);
    });
  };
  add(rankedA, weightA);
  add(rankedB, weightB);
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
      const ytAnalysis = _analyzeYouTubeTracks(allVideos);

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
    const names     = [...new Set(library.map(t => t.artist).filter(Boolean))];
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

  return profile;
}

// Re-derive the taste footprint (topGenres/topArtists/genreSet) from a library. Used after a
// classification purge or a pool-promotion changes which tracks the profile contains.
function recomputeFootprint(library) {
  const list    = Array.isArray(library) ? library : [];
  const genres  = list.flatMap(t => t.genres || []);
  const artists = list.map(t => t.artist).filter(Boolean);
  return {
    topGenres:  _rankByFrequency(genres).slice(0, 10),
    topArtists: _rankByFrequency(artists).slice(0, 20),
    genreSet:   [...new Set(genres)],
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
