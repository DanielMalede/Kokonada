'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// biometricHandler pulls in models + services at require time. We only exercise
// the pure toClientTrack/toClientTracks here, so stub the heavy deps to avoid
// any import side effects (DB/model registration). resolveMusicProvider stays
// real — it is a pure util.
jest.mock('../app/services/wearable/adapter', () => ({ normalize: jest.fn() }));
jest.mock('../app/models/User', () => ({}));
jest.mock('../app/models/MusicProfile', () => ({}));
jest.mock('../app/models/BiometricLog', () => ({}));
jest.mock('../app/models/PlaylistSession', () => ({}));
jest.mock('../app/services/spotify', () => ({ getValidToken: jest.fn(), getRecommendations: jest.fn() }));
jest.mock('../app/services/youtube', () => ({ getValidToken: jest.fn(), searchRecommendations: jest.fn() }));
jest.mock('../app/services/geminiEngine', () => ({ buildEmotionPlaylist: jest.fn(), adjustBiometricPlaylist: jest.fn() }));
jest.mock('../app/services/playlistMixer', () => ({ mixPlaylist: jest.fn(), generateFallbackPlaylist: jest.fn() }));

const { toClientTrack, toClientTracks } = require('../app/sockets/biometricHandler');

const REAL_SPOTIFY_URI = 'spotify:track:7ouMYWpwJ422jRcDASZB7P';

describe('toClientTrack — provider-correct normalization', () => {
  it('reconstructs a Spotify URI for an untagged library track (legacy entry)', () => {
    expect(toClientTrack({ id: 'lib-1', name: 'Familiar 1' }, 'spotify')).toMatchObject({
      id: 'lib-1', uri: 'spotify:track:lib-1', title: 'Familiar 1',
    });
  });

  it('reconstructs a Spotify URI for a track explicitly tagged provider=spotify', () => {
    expect(toClientTrack({ id: 'abc', provider: 'spotify', name: 'X' }, 'spotify').uri)
      .toBe('spotify:track:abc');
  });

  it('DROPS a youtube_music-tagged familiar track in a Spotify session (the prod bug)', () => {
    // Its id is a YouTube video id; spotify:track:<youtube-id> would 400 the play.
    expect(toClientTrack(
      { id: 'dQw4w9WgXcQ', provider: 'youtube_music', artist: 'Omer Adam - Topic' },
      'spotify',
    )).toBeNull();
  });

  it('passes a real Spotify URI through unchanged', () => {
    expect(toClientTrack({ id: 'x', uri: REAL_SPOTIFY_URI, name: 'Y' }, 'spotify').uri)
      .toBe(REAL_SPOTIFY_URI);
  });

  it('maps name/artists fallbacks for Spotify recommendation objects', () => {
    const rec = { id: 'z', uri: REAL_SPOTIFY_URI, name: 'Song', artists: [{ name: 'Band' }] };
    expect(toClientTrack(rec, 'spotify')).toMatchObject({ title: 'Song', artist: 'Band' });
  });

  it('falls back to Unknown title/artist when both are missing', () => {
    expect(toClientTrack({ id: 'q', uri: REAL_SPOTIFY_URI }, 'spotify')).toMatchObject({
      title: 'Unknown title', artist: 'Unknown artist',
    });
  });

  it('drops a YouTube track with no uri (no reconstruction for non-Spotify providers)', () => {
    expect(toClientTrack({ id: 'ytid', name: 'Chill' }, 'youtube')).toBeNull();
  });

  it('returns null for nullish input', () => {
    expect(toClientTrack(null, 'spotify')).toBeNull();
    expect(toClientTrack(undefined, 'spotify')).toBeNull();
  });
});

describe('toClientTracks — filtering', () => {
  it('filters out cross-provider tracks, keeping only playable Spotify ones', () => {
    const merged = [
      { id: 'lib-1', name: 'Familiar' },                                   // untagged → kept
      { id: 'dQw4w9WgXcQ', provider: 'youtube_music', artist: 'A - Topic' }, // dropped
      { id: 'z', uri: REAL_SPOTIFY_URI, name: 'Disc' },                    // real uri → kept
    ];
    const out = toClientTracks(merged, 'spotify');
    expect(out).toHaveLength(2);
    expect(out.map(t => t.uri)).toEqual(['spotify:track:lib-1', REAL_SPOTIFY_URI]);
  });

  it('returns [] when every track is a YouTube library entry in a Spotify session', () => {
    const ytLibrary = [
      { id: 'ytA', provider: 'youtube_music', artist: 'Omer Adam - Topic' },
      { id: 'ytB', provider: 'youtube_music', artist: 'Sergio Mendes - Topic' },
    ];
    expect(toClientTracks(ytLibrary, 'spotify')).toEqual([]);
  });

  it('returns [] for a non-array', () => {
    expect(toClientTracks(null, 'spotify')).toEqual([]);
    expect(toClientTracks(undefined, 'spotify')).toEqual([]);
  });
});

describe('buildReceipt — discovery receipt shape', () => {
  const disc = (over = {}) => ({ id: 'x', uri: REAL_SPOTIFY_URI, name: 'Disc', artist: 'A', isDiscovery: true, ...over });

  it('a discovery track yields exactly { label, detail? } — no other fields when there is no caption', () => {
    const withDetail = toClientTrack(disc(), 'spotify', { trigger: 'emotion' });
    expect(withDetail.receipt).toEqual({ label: 'New discovery', detail: 'Matched to your mood' });

    const noDetail = toClientTrack(disc(), 'spotify', {});
    expect(noDetail.receipt).toEqual({ label: 'New discovery' });
  });
});
