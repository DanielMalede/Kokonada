'use strict';

const MusicProfile = require('../models/MusicProfile');
const spotify      = require('./spotify');
const youtube      = require('./youtube');

const LIBRARY_CAP = 10_000; // max tracks stored per user to stay within 16 MB doc limit

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

function _average(values) {
  const valid = values.filter(v => v != null);
  if (!valid.length) return null;
  return valid.reduce((sum, v) => sum + v, 0) / valid.length;
}

// ── Spotify analysis ───────────────────────────────────────────────────────────

/**
 * Merges a track list with its audio features and produces the compact library
 * entries plus aggregate averages and rankings used by the recommendation engine.
 *
 * @param {{ id: string, artists: {name:string}[], album: {genres:string[]} }[]} tracks
 * @param {{ id: string, tempo: number, energy: number, valence: number,
 *            acousticness: number, danceability: number }[]}                     features
 */
function _analyzeSpotifyTracks(tracks, features) {
  const featMap = Object.fromEntries(features.map(f => [f.id, f]));

  const library = tracks.slice(0, LIBRARY_CAP).map(track => {
    const f = featMap[track.id] ?? null;
    return {
      id:           track.id,
      provider:     'spotify',
      tempo:        f?.tempo        ?? null,
      energy:       f?.energy       ?? null,
      valence:      f?.valence      ?? null,
      acousticness: f?.acousticness ?? null,
      danceability: f?.danceability ?? null,
      genres:       track.album?.genres ?? [],
      artist:       track.artists?.[0]?.name ?? null,
    };
  });

  const withFeatures = library.filter(t => t.tempo !== null);

  return {
    library,
    averages: {
      tempoBaseline: _average(withFeatures.map(t => t.tempo)),
      energy:        _average(withFeatures.map(t => t.energy)),
      valence:       _average(withFeatures.map(t => t.valence)),
      acousticness:  _average(withFeatures.map(t => t.acousticness)),
      danceability:  _average(withFeatures.map(t => t.danceability)),
    },
    topArtists: _rankByFrequency(library.map(t => t.artist)).slice(0, 20),
    // Album-level genres are sparse on Spotify; they still contribute to the
    // merged ranking when the user has no YouTube library.
    topGenres:  _rankByFrequency(library.flatMap(t => t.genres)).slice(0, 10),
  };
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
 * @param {{ id: string, snippet: { channelTitle: string, tags?: string[] } }[]} videos
 */
function _analyzeYouTubeTracks(videos) {
  const library    = [];
  const genrePool  = [];
  const artistPool = [];

  for (const video of videos) {
    const snippet = video.snippet ?? video;
    const rawTags = snippet.tags ?? [];
    const genres  = rawTags
      .map(t => TAG_TO_GENRE[t.toLowerCase()])
      .filter(Boolean);

    library.push({
      id:           video.id ?? snippet.resourceId?.videoId,
      provider:     'youtube_music',
      tempo:        null,
      energy:       null,
      valence:      null,
      acousticness: null,
      danceability: null,
      genres,
      artist:       snippet.channelTitle ?? null,
    });

    genrePool.push(...genres);
    if (snippet.channelTitle) artistPool.push(snippet.channelTitle);
  }

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
  const spotifyToken = user.getToken?.('spotifyToken')?.accessToken   ?? null;
  const youtubeToken = user.getToken?.('youtubeMusicToken')?.accessToken ?? null;

  let library    = [];
  let averages   = { tempoBaseline: null, energy: null, valence: null, acousticness: null, danceability: null };
  let topGenres  = [];
  let topArtists = [];

  if (spotifyToken) {
    // Fetch liked songs and all playlist tracks concurrently
    const [likedTracks, playlistTracks] = await Promise.all([
      spotify.paginateLikedSongs(spotifyToken),
      spotify.paginatePlaylistTracks(spotifyToken),
    ]);

    const allTracks = _deduplicateById([...likedTracks, ...playlistTracks]);
    const features  = await spotify.batchAudioFeatures(spotifyToken, allTracks.map(t => t.id));
    const analysis  = _analyzeSpotifyTracks(allTracks, features);

    library.push(...analysis.library);
    averages   = analysis.averages;
    topGenres  = analysis.topGenres;
    topArtists = analysis.topArtists;
  }

  if (youtubeToken) {
    const [likedVideos, playlistItems] = await Promise.all([
      youtube.paginateLikedVideos(youtubeToken),
      youtube.paginatePlaylistItems(youtubeToken),
    ]);

    const allVideos  = _deduplicateById([...likedVideos, ...playlistItems]);
    const ytAnalysis = _analyzeYouTubeTracks(allVideos);

    library.push(...ytAnalysis.library);
    // Merge rankings — YouTube fills the genre gap where Spotify album genres are sparse
    topGenres  = _rankByFrequency([...topGenres,  ...ytAnalysis.topGenres]).slice(0, 10);
    topArtists = _rankByFrequency([...topArtists, ...ytAnalysis.topArtists]).slice(0, 20);
  }

  return MusicProfile.findOneAndUpdate(
    { userId },
    {
      $set: {
        ...averages,
        topGenres,
        topArtists,
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
  _analyzeSpotifyTracks,
  _analyzeYouTubeTracks,
  _deduplicateById,
  _rankByFrequency,
};
