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

// ── Real service modules (axios mock intercepts their HTTP calls) ──────────────
const spotify = require('../app/services/spotify');
const youtube = require('../app/services/youtube');

// ── Service under test (required after mocks are set up) ─────────────────────
const {
  buildProfile,
  _analyzeSpotifyTracks,
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

// ── _analyzeSpotifyTracks ─────────────────────────────────────────────────────

describe('_analyzeSpotifyTracks', () => {
  it('calculates correct averages for energy, valence, acousticness and tempo', () => {
    const tracks = [makeTrack('1', 'ArtistA'), makeTrack('2', 'ArtistB')];
    const features = [
      makeFeature('1', { tempo: 100, energy: 0.5, valence: 0.4, acousticness: 0.3 }),
      makeFeature('2', { tempo: 140, energy: 0.9, valence: 0.8, acousticness: 0.1 }),
    ];
    const { averages } = _analyzeSpotifyTracks(tracks, features);
    expect(averages.tempoBaseline).toBeCloseTo(120);
    expect(averages.energy).toBeCloseTo(0.7);
    expect(averages.valence).toBeCloseTo(0.6);
    expect(averages.acousticness).toBeCloseTo(0.2);
  });

  it('ranks artists by appearance frequency', () => {
    const tracks = [
      makeTrack('1', 'Bonobo'), makeTrack('2', 'Bonobo'), makeTrack('3', 'Tycho'),
    ];
    const features = tracks.map(t => makeFeature(t.id));
    const { topArtists } = _analyzeSpotifyTracks(tracks, features);
    expect(topArtists[0]).toBe('Bonobo');
    expect(topArtists[1]).toBe('Tycho');
  });

  it('returns null averages when no features match tracks', () => {
    const tracks = [makeTrack('1')];
    const features = [makeFeature('999')]; // mismatched id
    const { averages } = _analyzeSpotifyTracks(tracks, features);
    expect(averages.tempoBaseline).toBeNull();
    expect(averages.energy).toBeNull();
  });

  it('includes all tracks in library with provider=spotify', () => {
    const tracks = [makeTrack('1'), makeTrack('2')];
    const features = tracks.map(t => makeFeature(t.id));
    const { library } = _analyzeSpotifyTracks(tracks, features);
    expect(library).toHaveLength(2);
    expect(library.every(t => t.provider === 'spotify')).toBe(true);
  });

  it('caps library at 10000 tracks', () => {
    const tracks = Array.from({ length: 12000 }, (_, i) => makeTrack(String(i)));
    const features = tracks.map(t => makeFeature(t.id));
    const { library } = _analyzeSpotifyTracks(tracks, features);
    expect(library).toHaveLength(10000);
  });

  it('handles tracks with no matching audio features (sets null fields)', () => {
    const tracks = [makeTrack('1')];
    const features = []; // no features
    const { library } = _analyzeSpotifyTracks(tracks, features);
    expect(library[0].tempo).toBeNull();
    expect(library[0].energy).toBeNull();
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
  let spotifyLikedSpy, spotifyPlaylistSpy, spotifyFeaturesSpy;
  let ytLikedSpy, ytPlaylistSpy;
  const TRACKS = [makeTrack('t1', 'Bonobo'), makeTrack('t2', 'Tycho')];
  const FEATURES = TRACKS.map(t => makeFeature(t.id));
  const VIDEOS = [makeYouTubeVideo('v1', ['electronic'], 'Aphex Twin')];

  beforeEach(() => {
    jest.clearAllMocks();
    spotifyLikedSpy    = jest.spyOn(spotify, 'paginateLikedSongs').mockResolvedValue(TRACKS);
    spotifyPlaylistSpy = jest.spyOn(spotify, 'paginatePlaylistTracks').mockResolvedValue([]);
    spotifyFeaturesSpy = jest.spyOn(spotify, 'batchAudioFeatures').mockResolvedValue(FEATURES);
    ytLikedSpy         = jest.spyOn(youtube, 'paginateLikedVideos').mockResolvedValue(VIDEOS);
    ytPlaylistSpy      = jest.spyOn(youtube, 'paginatePlaylistItems').mockResolvedValue([]);
    MusicProfile.findOneAndUpdate.mockResolvedValue({ userId: 'user123' });
  });

  afterEach(() => jest.restoreAllMocks());

  it('fetches Spotify liked songs and playlist tracks in parallel', async () => {
    const user = makeMockUser({ hasSpotify: true });
    await buildProfile('user123', user);
    expect(spotifyLikedSpy).toHaveBeenCalledWith('sp-token');
    expect(spotifyPlaylistSpy).toHaveBeenCalledWith('sp-token');
  });

  it('deduplicates tracks appearing in both liked songs and playlists', async () => {
    // t1 appears in both liked songs and playlists
    spotifyPlaylistSpy.mockResolvedValue([makeTrack('t1'), makeTrack('t3', 'Burial')]);
    const allFeatures = [...FEATURES, makeFeature('t3')];
    spotifyFeaturesSpy.mockResolvedValue(allFeatures);

    const user = makeMockUser({ hasSpotify: true });
    await buildProfile('user123', user);

    // batchAudioFeatures should only receive unique ids: t1, t2, t3
    const calledIds = spotifyFeaturesSpy.mock.calls[0][1];
    expect(calledIds.filter(id => id === 't1')).toHaveLength(1);
    expect(calledIds).toHaveLength(3);
  });

  it('saves computed averages and topArtists to MusicProfile', async () => {
    const user = makeMockUser({ hasSpotify: true });
    await buildProfile('user123', user);

    const savedData = MusicProfile.findOneAndUpdate.mock.calls[0][1].$set;
    expect(savedData.tempoBaseline).toBeCloseTo(120);
    expect(savedData.energy).toBeCloseTo(0.7);
    expect(savedData.topArtists).toContain('Bonobo');
    expect(savedData.topArtists).toContain('Tycho');
    expect(savedData.lastAnalyzed).toBeInstanceOf(Date);
  });

  it('upserts the MusicProfile (creates if not exists)', async () => {
    const user = makeMockUser({ hasSpotify: true });
    await buildProfile('user123', user);
    expect(MusicProfile.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: 'user123' },
      expect.objectContaining({ $set: expect.any(Object) }),
      { upsert: true, new: true }
    );
  });

  it('fetches YouTube library when YouTube is connected', async () => {
    const user = makeMockUser({ hasSpotify: false, hasYouTube: true });
    await buildProfile('user123', user);
    expect(ytLikedSpy).toHaveBeenCalledWith('yt-token');
    expect(ytPlaylistSpy).toHaveBeenCalledWith('yt-token');
    expect(spotifyLikedSpy).not.toHaveBeenCalled();
  });

  it('merges genres from both Spotify and YouTube when both are connected', async () => {
    // Spotify track has album genres
    const trackWithGenre = { ...makeTrack('t1'), album: { genres: ['indie'] } };
    spotifyLikedSpy.mockResolvedValue([trackWithGenre]);
    spotifyFeaturesSpy.mockResolvedValue([makeFeature('t1')]);
    // YouTube video has different genre tag
    ytLikedSpy.mockResolvedValue([makeYouTubeVideo('v1', ['electronic'])]);

    const user = makeMockUser({ hasSpotify: true, hasYouTube: true });
    await buildProfile('user123', user);

    const savedData = MusicProfile.findOneAndUpdate.mock.calls[0][1].$set;
    expect(savedData.topGenres).toContain('electronic');
  });

  it('saves an empty library gracefully when no provider is connected', async () => {
    const user = makeMockUser({ hasSpotify: false, hasYouTube: false });
    await buildProfile('user123', user);

    const savedData = MusicProfile.findOneAndUpdate.mock.calls[0][1].$set;
    expect(savedData.library).toEqual([]);
    expect(savedData.topGenres).toEqual([]);
    expect(savedData.topArtists).toEqual([]);
  });

  it('returns the saved MusicProfile document', async () => {
    const mockProfile = { userId: 'user123', tempoBaseline: 120 };
    MusicProfile.findOneAndUpdate.mockResolvedValue(mockProfile);
    const user = makeMockUser({ hasSpotify: true });
    const result = await buildProfile('user123', user);
    expect(result).toEqual(mockProfile);
  });
});
