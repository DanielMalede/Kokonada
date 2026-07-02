'use strict';

process.env.NODE_ENV        = 'test';
process.env.ENCRYPTION_KEY  = 'a'.repeat(64);
process.env.SPOTIFY_CLIENT_ID     = 'sp_id';
process.env.SPOTIFY_CLIENT_SECRET = 'sp_secret';
process.env.SPOTIFY_REDIRECT_URI  = 'http://localhost/cb';
process.env.YOUTUBE_CLIENT_ID     = 'yt_id';
process.env.YOUTUBE_CLIENT_SECRET = 'yt_secret';
process.env.YOUTUBE_REDIRECT_URI  = 'http://localhost/yt-cb';

// ── axios mock (used by spotify.js and youtube.js pagination) ─────────────────
jest.mock('axios');
const axios = require('axios');

// ── MusicProfile mock (prevents mongoose connection) ──────────────────────────
jest.mock('../app/models/MusicProfile', () => ({ findOneAndUpdate: jest.fn() }));
const MusicProfile = require('../app/models/MusicProfile');

// ── geminiEngine mock (LLM genre backfill) ────────────────────────────────────
jest.mock('../app/services/geminiEngine', () => ({ inferArtistGenres: jest.fn().mockResolvedValue({}) }));
const geminiEngine = require('../app/services/geminiEngine');

// ── featureService mock (dark-launch hydration enqueue) ──────────────────────
jest.mock('../app/services/features/featureService', () => ({
  hydrate: jest.fn(),
  enqueueHydration: jest.fn().mockResolvedValue({ queued: true }),
}));
const featureService = require('../app/services/features/featureService');

// ── Real service modules (axios mock intercepts their HTTP calls) ──────────────
const spotify = require('../app/services/spotify');
const youtube = require('../app/services/youtube');

// ── Service under test (required after mocks are set up) ─────────────────────
const {
  buildProfile,
  _analyzeSpotifyProfile,
  _analyzeYouTubeTracks,
  _deduplicateById,
  _rankByFrequency,
} = require('../app/services/musicProfileService');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTrack(id, artistName = 'Artist') {
  return { id, name: `Song ${id}`, artists: [{ name: artistName }], album: { genres: [] } };
}

function makeFeature(id, overrides = {}) {
  return { id, tempo: 120, energy: 0.7, valence: 0.6, acousticness: 0.2, danceability: 0.65, ...overrides };
}

function makeYouTubeVideo(id, tags = [], channelTitle = 'ArtistChannel') {
  return {
    id,
    snippet: { title: `Video ${id}`, channelTitle, tags, categoryId: '10' },
  };
}

function makePageResponse(items, next = null) {
  return { data: { items, next, total: items.length } };
}

function makeYTPageResponse(items, nextPageToken = null) {
  return { data: { items, nextPageToken } };
}

function makeMockUser({ hasSpotify = true, hasYouTube = false } = {}) {
  return {
    getToken: jest.fn((key) => {
      if (key === 'spotifyToken' && hasSpotify) return { accessToken: 'sp-token' };
      if (key === 'youtubeMusicToken' && hasYouTube) return { accessToken: 'yt-token' };
      return null;
    }),
  };
}

// ── _rankByFrequency ──────────────────────────────────────────────────────────

describe('_rankByFrequency', () => {
  it('returns empty array for empty input', () => {
    expect(_rankByFrequency([])).toEqual([]);
  });

  it('ranks single item correctly', () => {
    expect(_rankByFrequency(['pop'])).toEqual(['pop']);
  });

  it('orders by descending frequency', () => {
    const items = ['electronic', 'pop', 'electronic', 'indie', 'electronic', 'pop'];
    expect(_rankByFrequency(items)).toEqual(['electronic', 'pop', 'indie']);
  });

  it('filters out null and undefined values', () => {
    expect(_rankByFrequency([null, 'electronic', undefined, 'electronic'])).toEqual(['electronic']);
  });
});

// ── _deduplicateById ──────────────────────────────────────────────────────────

describe('_deduplicateById', () => {
  it('returns all items when no duplicates exist', () => {
    const tracks = [makeTrack('1'), makeTrack('2')];
    expect(_deduplicateById(tracks)).toHaveLength(2);
  });

  it('removes duplicate ids, keeping first occurrence', () => {
    const tracks = [makeTrack('1'), makeTrack('1'), makeTrack('2')];
    expect(_deduplicateById(tracks)).toHaveLength(2);
    expect(_deduplicateById(tracks)[0].id).toBe('1');
    expect(_deduplicateById(tracks)[1].id).toBe('2');
  });

  it('handles empty array', () => {
    expect(_deduplicateById([])).toEqual([]);
  });
});

// ── _analyzeSpotifyProfile (listening-history based) ──────────────────────────

describe('_analyzeSpotifyProfile', () => {
  const artist = (id, name, genres = []) => ({ id, name, genres });
  const spTrack = (id, artists = [artist('a1', 'A1')], extra = {}) => ({
    id, name: `Song ${id}`, uri: `spotify:track:${id}`, popularity: 50, artists, ...extra,
  });

  it('ranks tracks by weighted affinity across sources (top > recent)', () => {
    const { library } = _analyzeSpotifyProfile({
      trackSources: [
        { tracks: [spTrack('t1')], weight: 6 }, // top short-term
        { tracks: [spTrack('t2')], weight: 2 }, // recently played
      ],
      artistLists: [],
      artistGenres: {},
    });
    expect(library[0].id).toBe('t1');
    expect(library[0].affinity).toBeGreaterThan(library[1].affinity);
  });

  it('dedupes a track present in multiple sources, summing affinity', () => {
    const t1 = spTrack('t1');
    const { library } = _analyzeSpotifyProfile({
      trackSources: [
        { tracks: [t1], weight: 6 },
        { tracks: [t1], weight: 2 },
      ],
      artistLists: [], artistGenres: {},
    });
    expect(library).toHaveLength(1);
    expect(library[0].affinity).toBeGreaterThan(7); // 6 + 2 + position bonuses
  });

  it('derives topGenres and genreSet from artist objects, not albums', () => {
    const { topGenres, genreSet } = _analyzeSpotifyProfile({
      trackSources: [],
      artistLists: [{ artists: [artist('a1', 'A1', ['indie', 'dream pop'])], weight: 3 }],
      artistGenres: {},
    });
    expect(topGenres).toContain('indie');
    expect(genreSet).toEqual(expect.arrayContaining(['indie', 'dream pop']));
  });

  it('tags each library track with its artists\' genres', () => {
    const { library } = _analyzeSpotifyProfile({
      trackSources: [{ tracks: [spTrack('t1', [artist('a1', 'A1')])], weight: 6 }],
      artistLists: [{ artists: [artist('a1', 'A1', ['techno'])], weight: 3 }],
      artistGenres: {},
    });
    expect(library[0].genres).toContain('techno');
    expect(library[0].artistIds).toContain('a1');
  });

  it('falls back to fetched artistGenres for artists not in the top lists', () => {
    const { library } = _analyzeSpotifyProfile({
      trackSources: [{ tracks: [spTrack('t1', [artist('a9', 'A9')])], weight: 3 }],
      artistLists: [],
      artistGenres: { a9: ['ambient'] },
    });
    expect(library[0].genres).toContain('ambient');
  });

  it('records knownArtistIds spanning top artists and track artists', () => {
    const { knownArtistIds } = _analyzeSpotifyProfile({
      trackSources: [{ tracks: [spTrack('t1', [artist('a2', 'A2')])], weight: 3 }],
      artistLists: [{ artists: [artist('a1', 'A1', ['rock'])], weight: 3 }],
      artistGenres: {},
    });
    expect(knownArtistIds).toEqual(expect.arrayContaining(['a1', 'a2']));
  });

  it('leaves audio fields null (audio-features is gone) and keeps name/uri', () => {
    const { library } = _analyzeSpotifyProfile({
      trackSources: [{ tracks: [spTrack('t1')], weight: 6 }],
      artistLists: [], artistGenres: {},
    });
    expect(library[0].tempo).toBeNull();
    expect(library[0].energy).toBeNull();
    expect(library[0].name).toBe('Song t1');
    expect(library[0].uri).toBe('spotify:track:t1');
    expect(library[0].provider).toBe('spotify');
  });

  it('caps library at 10000 tracks', () => {
    const many = Array.from({ length: 12000 }, (_, i) => spTrack(String(i)));
    const { library } = _analyzeSpotifyProfile({
      trackSources: [{ tracks: many, weight: 1 }],
      artistLists: [], artistGenres: {},
    });
    expect(library).toHaveLength(10000);
  });
});

// ── _analyzeYouTubeTracks ─────────────────────────────────────────────────────

describe('_analyzeYouTubeTracks', () => {
  it('extracts genres from known video tags', () => {
    const videos = [
      makeYouTubeVideo('v1', ['electronic', 'edm']),
      makeYouTubeVideo('v2', ['pop']),
    ];
    const { topGenres } = _analyzeYouTubeTracks(videos);
    expect(topGenres).toContain('electronic');
    expect(topGenres).toContain('pop');
  });

  it('ranks genres by frequency', () => {
    const videos = [
      makeYouTubeVideo('v1', ['electronic']),
      makeYouTubeVideo('v2', ['electronic']),
      makeYouTubeVideo('v3', ['pop']),
    ];
    const { topGenres } = _analyzeYouTubeTracks(videos);
    expect(topGenres[0]).toBe('electronic');
  });

  it('extracts artist names from channelTitle', () => {
    const videos = [
      makeYouTubeVideo('v1', [], 'Bonobo'),
      makeYouTubeVideo('v2', [], 'Bonobo'),
      makeYouTubeVideo('v3', [], 'Tycho'),
    ];
    const { topArtists } = _analyzeYouTubeTracks(videos);
    expect(topArtists[0]).toBe('Bonobo');
  });

  it('includes all videos in library with provider=youtube_music', () => {
    const videos = [makeYouTubeVideo('v1'), makeYouTubeVideo('v2')];
    const { library } = _analyzeYouTubeTracks(videos);
    expect(library).toHaveLength(2);
    expect(library.every(v => v.provider === 'youtube_music')).toBe(true);
  });

  it('handles videos with no tags gracefully (empty genres)', () => {
    const videos = [makeYouTubeVideo('v1', [])];
    const { topGenres, library } = _analyzeYouTubeTracks(videos);
    expect(topGenres).toEqual([]);
    expect(library[0].genres).toEqual([]);
  });

  it('sets audio feature fields to null for YouTube tracks', () => {
    const videos = [makeYouTubeVideo('v1', ['pop'])];
    const { library } = _analyzeYouTubeTracks(videos);
    expect(library[0].tempo).toBeNull();
    expect(library[0].energy).toBeNull();
    expect(library[0].valence).toBeNull();
  });
});

// ── spotify.paginateLikedSongs ────────────────────────────────────────────────

describe('spotify.paginateLikedSongs', () => {
  beforeEach(() => axios.get.mockReset());

  it('returns all tracks from a single page', async () => {
    axios.get.mockResolvedValueOnce(makePageResponse([{ track: makeTrack('1') }]));
    const result = await spotify.paginateLikedSongs('token');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('follows pagination until next is null', async () => {
    axios.get
      .mockResolvedValueOnce({ data: {
        items: [{ track: makeTrack('1') }],
        next: 'https://api.spotify.com/v1/me/tracks?offset=1',
        total: 2,
      }})
      .mockResolvedValueOnce({ data: {
        items: [{ track: makeTrack('2') }],
        next: null,
        total: 2,
      }});
    const result = await spotify.paginateLikedSongs('token');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.id)).toEqual(['1', '2']);
  });

  it('skips null track entries (unavailable/local tracks)', async () => {
    axios.get.mockResolvedValueOnce(
      makePageResponse([{ track: null }, { track: makeTrack('1') }])
    );
    const result = await spotify.paginateLikedSongs('token');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('retries once on HTTP 429 and then succeeds', async () => {
    const err429 = Object.assign(new Error('rate limited'), {
      response: { status: 429, headers: { 'retry-after': '0' } },
    });
    axios.get
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce(makePageResponse([{ track: makeTrack('1') }]));
    const result = await spotify.paginateLikedSongs('token');
    expect(result).toHaveLength(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('propagates the error after exhausting all retries', async () => {
    const err429 = Object.assign(new Error('rate limited'), {
      response: { status: 429, headers: { 'retry-after': '0' } },
    });
    axios.get.mockRejectedValue(err429); // always rejects
    await expect(spotify.paginateLikedSongs('token')).rejects.toThrow('rate limited');
  });
});

// ── spotify.paginatePlaylistTracks ────────────────────────────────────────────

describe('spotify.paginatePlaylistTracks', () => {
  beforeEach(() => axios.get.mockReset());

  it('returns empty array when user has no playlists', async () => {
    axios.get.mockResolvedValueOnce({ data: { items: [], next: null, total: 0 } });
    const result = await spotify.paginatePlaylistTracks('token');
    expect(result).toEqual([]);
  });

  it('fetches tracks from each playlist', async () => {
    // Page 1: one playlist
    axios.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'pl1' }], next: null, total: 1 } })
      // Tracks from pl1
      .mockResolvedValueOnce({ data: { items: [{ track: makeTrack('t1') }], next: null } });
    const result = await spotify.paginatePlaylistTracks('token');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });

  it('paginates across multiple playlists', async () => {
    axios.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'pl1' }, { id: 'pl2' }], next: null, total: 2 } })
      .mockResolvedValueOnce({ data: { items: [{ track: makeTrack('t1') }], next: null } })
      .mockResolvedValueOnce({ data: { items: [{ track: makeTrack('t2') }], next: null } });
    const result = await spotify.paginatePlaylistTracks('token');
    expect(result.map(t => t.id)).toEqual(['t1', 't2']);
  });
});

// ── spotify.batchAudioFeatures ────────────────────────────────────────────────

describe('spotify.batchAudioFeatures', () => {
  beforeEach(() => axios.get.mockReset());

  it('returns empty array for empty input', async () => {
    const result = await spotify.batchAudioFeatures('token', []);
    expect(result).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('fetches all features in one request when ids <= 100', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id${i}`);
    const features = ids.map(id => makeFeature(id));
    axios.get.mockResolvedValueOnce({ data: { audio_features: features } });
    const result = await spotify.batchAudioFeatures('token', ids);
    expect(result).toHaveLength(50);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('splits into two requests when ids > 100', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
    const batch1 = ids.slice(0, 100).map(id => makeFeature(id));
    const batch2 = ids.slice(100).map(id => makeFeature(id));
    axios.get
      .mockResolvedValueOnce({ data: { audio_features: batch1 } })
      .mockResolvedValueOnce({ data: { audio_features: batch2 } });
    const result = await spotify.batchAudioFeatures('token', ids);
    expect(result).toHaveLength(150);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('filters out null entries from Spotify response', async () => {
    const ids = ['id1', 'id2'];
    axios.get.mockResolvedValueOnce({
      data: { audio_features: [makeFeature('id1'), null] }, // null = track has no features
    });
    const result = await spotify.batchAudioFeatures('token', ids);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });
});

// ── youtube.paginateLikedVideos ───────────────────────────────────────────────

describe('youtube.paginateLikedVideos', () => {
  beforeEach(() => axios.get.mockReset());

  it('returns all videos from a single page', async () => {
    axios.get.mockResolvedValueOnce(makeYTPageResponse([makeYouTubeVideo('v1')]));
    const result = await youtube.paginateLikedVideos('token');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('v1');
  });

  it('follows nextPageToken until exhausted', async () => {
    axios.get
      .mockResolvedValueOnce(makeYTPageResponse([makeYouTubeVideo('v1')], 'TOKEN_PAGE2'))
      .mockResolvedValueOnce(makeYTPageResponse([makeYouTubeVideo('v2')], null));
    const result = await youtube.paginateLikedVideos('token');
    expect(result).toHaveLength(2);
  });

  it('retries on 429 and then succeeds', async () => {
    const err429 = Object.assign(new Error('rate limited'), {
      response: { status: 429, headers: { 'retry-after': '0' } },
    });
    axios.get
      .mockRejectedValueOnce(err429)
      .mockResolvedValueOnce(makeYTPageResponse([makeYouTubeVideo('v1')]));
    const result = await youtube.paginateLikedVideos('token');
    expect(result).toHaveLength(1);
  });
});

// ── youtube.paginatePlaylistItems ─────────────────────────────────────────────

describe('youtube.paginatePlaylistItems', () => {
  beforeEach(() => axios.get.mockReset());

  it('returns empty array when user has no playlists', async () => {
    axios.get.mockResolvedValueOnce(makeYTPageResponse([]));
    const result = await youtube.paginatePlaylistItems('token');
    expect(result).toEqual([]);
  });

  it('fetches items from each playlist', async () => {
    // Playlists response
    axios.get
      .mockResolvedValueOnce(makeYTPageResponse([{ id: 'pl1', snippet: { title: 'My Mix' } }]))
      // Playlist items response
      .mockResolvedValueOnce(makeYTPageResponse([
        { snippet: { title: 'Song', channelTitle: 'Artist', tags: ['pop'], resourceId: { videoId: 'v1' } } }
      ]));
    const result = await youtube.paginatePlaylistItems('token');
    expect(result).toHaveLength(1);
  });
});

// ── buildProfile — integration ────────────────────────────────────────────────

describe('buildProfile', () => {
  // Spotify track with artist IDs (needed for genre tagging via artist objects)
  const spTrack = (id, artistId = 'a1', artistName = 'Bonobo') => ({
    id, name: `Song ${id}`, uri: `spotify:track:${id}`, popularity: 50,
    artists: [{ id: artistId, name: artistName }],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Top tracks only on short_term; top artists only on medium_term — proves all
    // ranges are queried and merged.
    jest.spyOn(spotify, 'getTopTracks').mockImplementation((_t, range) =>
      Promise.resolve(range === 'short_term' ? [spTrack('t1', 'a1', 'Bonobo')] : []));
    jest.spyOn(spotify, 'getTopArtists').mockImplementation((_t, range) =>
      Promise.resolve(range === 'medium_term'
        ? [{ id: 'a1', name: 'Bonobo', genres: ['electronic', 'downtempo'] }] : []));
    jest.spyOn(spotify, 'paginateLikedSongs').mockResolvedValue([spTrack('t2', 'a2', 'Tycho')]);
    jest.spyOn(spotify, 'getRecentlyPlayed').mockResolvedValue([spTrack('t3', 'a1', 'Bonobo')]);
    jest.spyOn(spotify, 'paginatePlaylistTracks').mockResolvedValue([]);
    jest.spyOn(spotify, 'getArtistsGenres').mockResolvedValue({ a2: ['ambient'] });
    jest.spyOn(spotify, 'batchAudioFeatures');
    jest.spyOn(youtube, 'paginateLikedVideos').mockResolvedValue([]);
    jest.spyOn(youtube, 'paginatePlaylistItems').mockResolvedValue([]);
    jest.spyOn(youtube, 'paginateSubscriptions').mockResolvedValue([]);
    jest.spyOn(youtube, 'fetchVideoTopics').mockResolvedValue([]);
    MusicProfile.findOneAndUpdate.mockResolvedValue({ userId: 'user123' });
  });

  afterEach(() => jest.restoreAllMocks());

  const savedSet = () => MusicProfile.findOneAndUpdate.mock.calls[0][1].$set;

  it('enqueues feature hydration for the built library (dark launch, fire-and-forget)', async () => {
    await buildProfile('user123', makeMockUser({ hasSpotify: true }));

    expect(featureService.enqueueHydration).toHaveBeenCalledTimes(1);
    const [libraryArg] = featureService.enqueueHydration.mock.calls[0];
    expect(Array.isArray(libraryArg)).toBe(true);
    expect(libraryArg.length).toBeGreaterThan(0);
  });

  it('a hydration enqueue failure never breaks profile building', async () => {
    featureService.enqueueHydration.mockRejectedValueOnce(new Error('queue down'));

    await expect(buildProfile('user123', makeMockUser({ hasSpotify: true }))).resolves.toBeDefined();
  });

  it('builds from listening history (top/saved/recent) without calling audio-features', async () => {
    await buildProfile('user123', makeMockUser({ hasSpotify: true }));
    expect(spotify.getTopTracks).toHaveBeenCalled();
    expect(spotify.getTopArtists).toHaveBeenCalled();
    expect(spotify.getRecentlyPlayed).toHaveBeenCalledWith('sp-token', 50);
    expect(spotify.batchAudioFeatures).not.toHaveBeenCalled(); // regression guard
  });

  it('saves topGenres from artist objects, plus genreSet, knownArtistIds and topArtists', async () => {
    await buildProfile('user123', makeMockUser({ hasSpotify: true }));
    const saved = savedSet();
    expect(saved.topGenres).toContain('electronic');
    expect(saved.genreSet).toEqual(expect.arrayContaining(['electronic', 'downtempo']));
    expect(saved.knownArtistIds).toEqual(expect.arrayContaining(['a1']));
    expect(saved.topArtists).toContain('Bonobo');
    expect(saved.lastAnalyzed).toBeInstanceOf(Date);
  });

  it('ranks a top track above a recently-played track by affinity', async () => {
    await buildProfile('user123', makeMockUser({ hasSpotify: true }));
    const lib = savedSet().library;
    const t1 = lib.find(t => t.id === 't1'); // from top tracks (short_term)
    const t3 = lib.find(t => t.id === 't3'); // from recently played
    expect(t1.affinity).toBeGreaterThan(t3.affinity);
  });

  it('degrades gracefully when top endpoints 403 (token predates new scopes)', async () => {
    const forbidden = Object.assign(new Error('forbidden'), { response: { status: 403 } });
    spotify.getTopTracks.mockRejectedValue(forbidden);
    spotify.getTopArtists.mockRejectedValue(forbidden);
    await buildProfile('user123', makeMockUser({ hasSpotify: true }));
    // Still builds from saved + recently-played rather than throwing.
    expect(savedSet().library.length).toBeGreaterThan(0);
  });

  it('upserts the MusicProfile (creates if not exists)', async () => {
    await buildProfile('user123', makeMockUser({ hasSpotify: true }));
    expect(MusicProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user123' },
      expect.objectContaining({ $set: expect.any(Object) }),
      { upsert: true, new: true },
    );
  });

  it('fetches YouTube library when YouTube is connected and skips Spotify', async () => {
    await buildProfile('user123', makeMockUser({ hasSpotify: false, hasYouTube: true }));
    expect(youtube.paginateLikedVideos).toHaveBeenCalledWith('yt-token');
    expect(spotify.getTopTracks).not.toHaveBeenCalled();
  });

  it('ingests subscriptions (artists) + topic genres for BOTH liked videos AND playlist items', async () => {
    // Liked video (id IS the video id) + a PLAYLIST ITEM (video id nested in resourceId).
    youtube.paginateLikedVideos.mockResolvedValue([
      { id: 'v1', snippet: { title: 'Some Song', channelTitle: 'Aphex Twin - Topic' } },
    ]);
    youtube.paginatePlaylistItems.mockResolvedValue([
      { id: 'plItem1', snippet: { title: 'Playlist Song', channelTitle: 'Bonobo - Topic', resourceId: { videoId: 'v2' } } },
    ]);
    youtube.paginateSubscriptions.mockResolvedValue([
      { snippet: { title: 'Boards of Canada - Topic' } },
      { snippet: { title: 'Random News Channel' } }, // non-music → excluded
    ]);
    youtube.fetchVideoTopics.mockResolvedValue([
      { id: 'v1', topicCategories: ['https://en.wikipedia.org/wiki/Electronic_music'], tags: [] },
      { id: 'v2', topicCategories: ['https://en.wikipedia.org/wiki/Jazz'], tags: [] }, // from the playlist item
    ]);

    await buildProfile('user123', makeMockUser({ hasSpotify: false, hasYouTube: true }));
    const saved = savedSet();

    expect(youtube.paginateSubscriptions).toHaveBeenCalledWith('yt-token');
    // Topics fetched for the liked video AND the playlist item's REAL video id (v2, not plItem1).
    expect(youtube.fetchVideoTopics).toHaveBeenCalledWith('yt-token', ['v1', 'v2']);
    expect(saved.topArtists).toContain('Boards of Canada'); // subscribed artist channel
    expect(saved.topArtists).not.toContain('Random News Channel');
    expect(saved.topGenres).toEqual(expect.arrayContaining(['electronic', 'jazz'])); // liked + playlist topics
    expect(saved.genreSet).toEqual(expect.arrayContaining(['electronic', 'jazz']));
  });

  it('saves empty arrays gracefully when no provider is connected', async () => {
    await buildProfile('user123', makeMockUser({ hasSpotify: false, hasYouTube: false }));
    const saved = savedSet();
    expect(saved.library).toEqual([]);
    expect(saved.topGenres).toEqual([]);
    expect(saved.topArtists).toEqual([]);
    expect(saved.genreSet).toEqual([]);
    expect(saved.knownArtistIds).toEqual([]);
  });

  it('returns the saved MusicProfile document', async () => {
    const mockProfile = { userId: 'user123' };
    MusicProfile.findOneAndUpdate.mockResolvedValue(mockProfile);
    const result = await buildProfile('user123', makeMockUser({ hasSpotify: true }));
    expect(result).toEqual(mockProfile);
  });

  it('isolates a YouTube failure so the Spotify profile is still saved (stale YT token must not abort)', async () => {
    // Real-world bug: a stale YouTube token threw an unguarded 401 that aborted the
    // ENTIRE build before the (good) Spotify data was saved — so no profile existed
    // and generation produced nothing. A provider failure must be isolated.
    const unauthorized = Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } });
    youtube.paginateLikedVideos.mockRejectedValue(unauthorized);
    youtube.paginatePlaylistItems.mockRejectedValue(unauthorized);

    await expect(
      buildProfile('user123', makeMockUser({ hasSpotify: true, hasYouTube: true })),
    ).resolves.toBeDefined();

    // The good Spotify data is still persisted despite YouTube failing.
    expect(MusicProfile.findOneAndUpdate).toHaveBeenCalled();
    expect(savedSet().library.length).toBeGreaterThan(0);
  });

  it('backfills genres via the LLM when Spotify returns none (moods need genres)', async () => {
    // Spotify serves NO artist genres (the real prod situation) → genreSet would be empty.
    spotify.getTopArtists.mockResolvedValue([{ id: 'a1', name: 'Bonobo', genres: [] }]);
    spotify.getArtistsGenres.mockResolvedValue({});
    geminiEngine.inferArtistGenres.mockResolvedValue({ Bonobo: ['downtempo', 'electronic'] });

    await buildProfile('user123', makeMockUser({ hasSpotify: true }));

    expect(geminiEngine.inferArtistGenres).toHaveBeenCalled();
    const saved = savedSet();
    // genreSet is populated from the LLM, and library tracks by that artist get tagged.
    expect(saved.genreSet).toEqual(expect.arrayContaining(['downtempo', 'electronic']));
    const bonoboTrack = saved.library.find((t) => t.artist === 'Bonobo');
    expect(bonoboTrack.genres).toEqual(expect.arrayContaining(['downtempo', 'electronic']));
  });

  it('does NOT call the LLM backfill when Spotify already provided genres', async () => {
    // Default beforeEach gives Bonobo genres via getTopArtists → no backfill needed.
    await buildProfile('user123', makeMockUser({ hasSpotify: true }));
    expect(geminiEngine.inferArtistGenres).not.toHaveBeenCalled();
  });

  it('isolates a Spotify failure so a YouTube profile is still saved', async () => {
    const unauthorized = Object.assign(new Error('Request failed with status code 401'), { response: { status: 401 } });
    // An unexpected Spotify throw (not a per-endpoint 403 caught by _safeFetch) must
    // not abort a YouTube-connected user's build either.
    spotify.getTopTracks.mockRejectedValue(unauthorized);
    spotify.getTopArtists.mockRejectedValue(unauthorized);
    spotify.paginateLikedSongs.mockRejectedValue(unauthorized);
    spotify.getRecentlyPlayed.mockRejectedValue(unauthorized);
    spotify.paginatePlaylistTracks.mockRejectedValue(unauthorized);
    youtube.paginateLikedVideos.mockResolvedValue([makeYouTubeVideo('v1', ['pop'])]);

    await expect(
      buildProfile('user123', makeMockUser({ hasSpotify: true, hasYouTube: true })),
    ).resolves.toBeDefined();
    expect(MusicProfile.findOneAndUpdate).toHaveBeenCalled();
  });
});

// ── canonical identity attachment (variance engine, Phase 1) ─────────────────

describe('canonical identity attachment', () => {
  const artist = (id, name, genres = []) => ({ id, name, genres });
  const spTrack = (id, artists = [artist('a1', 'A1')], extra = {}) => ({
    id, name: `Song ${id}`, uri: `spotify:track:${id}`, popularity: 50, artists, ...extra,
  });

  it('spotify library entries carry the ISRC and an isrc-based canonicalKey', () => {
    const { library } = _analyzeSpotifyProfile({
      trackSources: [
        { tracks: [spTrack('t1', undefined, { external_ids: { isrc: 'US-UM7-12-34567' } })], weight: 6 },
      ],
      artistLists: [], artistGenres: {},
    });
    expect(library[0].isrc).toBe('US-UM7-12-34567');
    expect(library[0].canonicalKey).toBe('isrc:USUM71234567');
  });

  it('spotify entries without an ISRC get the artist|title fingerprint', () => {
    const { library } = _analyzeSpotifyProfile({
      trackSources: [{ tracks: [spTrack('t1', [artist('a1', 'Beyoncé')])], weight: 6 }],
      artistLists: [], artistGenres: {},
    });
    expect(library[0].isrc).toBeNull();
    expect(library[0].canonicalKey).toBe('at:beyonce|song t1');
  });

  it('youtube entries parse the video title/channel into the same key as the Spotify copy', () => {
    const videos = [
      { id: 'v1', snippet: { title: 'Beyoncé - Halo (Official Video)', channelTitle: 'BeyoncéVEVO', tags: [] } },
    ];
    const { library: ytLibrary } = _analyzeYouTubeTracks(videos);
    const { library: spLibrary } = _analyzeSpotifyProfile({
      trackSources: [{ tracks: [{ ...spTrack('t9', [artist('a1', 'Beyoncé')]), name: 'Halo' }], weight: 6 }],
      artistLists: [], artistGenres: {},
    });

    expect(ytLibrary[0].canonicalKey).toBe('at:beyonce|halo');
    expect(ytLibrary[0].canonicalKey).toBe(spLibrary[0].canonicalKey);
  });
});
