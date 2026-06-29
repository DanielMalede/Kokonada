process.env.SPOTIFY_CLIENT_ID     = 'cid';
process.env.SPOTIFY_CLIENT_SECRET = 'csec';

jest.mock('axios');
const axios   = require('axios');
const spotify = require('../app/services/spotify');

function makeUser(token) {
  return {
    _tok: token,
    getToken: jest.fn(function () { return this._tok; }),
    setToken: jest.fn(function (_k, v) { this._tok = v; }),
    save:     jest.fn().mockResolvedValue(true),
  };
}

const FUTURE = () => Date.now() + 3_600_000; // 1h out — comfortably past the 5-min buffer

describe('withFreshToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs fn with a valid token and does not refresh on success', async () => {
    const user = makeUser({ accessToken: 'good', refreshToken: 'ref', expiresAt: FUTURE() });
    const fn = jest.fn().mockResolvedValue('ok');

    const result = await spotify.withFreshToken(user, fn);

    expect(fn).toHaveBeenCalledWith('good');
    expect(result).toBe('ok');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('force-refreshes once and retries on a 401 (token expired right before the call)', async () => {
    const user = makeUser({ accessToken: 'stale', refreshToken: 'ref', expiresAt: FUTURE() });
    axios.post.mockResolvedValue({ data: { access_token: 'fresh', refresh_token: 'ref2', expires_in: 3600 } });
    const fn = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('401'), { response: { status: 401 } }))
      .mockResolvedValueOnce('ok-after-refresh');

    const result = await spotify.withFreshToken(user, fn);

    expect(fn).toHaveBeenNthCalledWith(1, 'stale');
    expect(fn).toHaveBeenNthCalledWith(2, 'fresh');
    expect(user.setToken).toHaveBeenCalled();
    expect(user.save).toHaveBeenCalled();
    expect(result).toBe('ok-after-refresh');
  });

  it('maps a 403 to a typed insufficient_scope error (prompt reconnect)', async () => {
    const user = makeUser({ accessToken: 'good', refreshToken: 'ref', expiresAt: FUTURE() });
    const fn = jest.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403 } }));

    await expect(spotify.withFreshToken(user, fn))
      .rejects.toMatchObject({ code: 'insufficient_scope', statusCode: 403 });
  });

  it('rethrows non-401/403 errors unchanged', async () => {
    const user = makeUser({ accessToken: 'good', refreshToken: 'ref', expiresAt: FUTURE() });
    const err = Object.assign(new Error('boom'), { response: { status: 500 } });
    const fn = jest.fn().mockRejectedValue(err);

    await expect(spotify.withFreshToken(user, fn)).rejects.toBe(err);
  });
});

describe('getActiveDevice', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the active device id when one is active', async () => {
    axios.get.mockResolvedValue({ data: { devices: [
      { id: 'd1', is_active: false }, { id: 'd2', is_active: true },
    ] } });
    expect(await spotify.getActiveDevice('tok')).toBe('d2');
  });

  it('falls back to the first device when none is marked active', async () => {
    axios.get.mockResolvedValue({ data: { devices: [{ id: 'd1', is_active: false }] } });
    expect(await spotify.getActiveDevice('tok')).toBe('d1');
  });

  it('returns null when there are no devices', async () => {
    axios.get.mockResolvedValue({ data: { devices: [] } });
    expect(await spotify.getActiveDevice('tok')).toBeNull();
  });
});

describe('createPlaylist + addTracksToPlaylist', () => {
  beforeEach(() => jest.clearAllMocks());

  it('createPlaylist returns id + url', async () => {
    axios.post.mockResolvedValue({ data: { id: 'pl_9', external_urls: { spotify: 'https://open.spotify.com/playlist/pl_9' } } });
    const out = await spotify.createPlaylist('tok', 'user1', 'My Mix', 'desc');
    expect(out).toEqual({ id: 'pl_9', url: 'https://open.spotify.com/playlist/pl_9' });
  });

  it('addTracksToPlaylist batches in groups of 100', async () => {
    axios.post.mockResolvedValue({ data: {} });
    const uris = Array.from({ length: 250 }, (_, i) => `spotify:track:${i}`);
    await spotify.addTracksToPlaylist('tok', 'pl_9', uris);
    expect(axios.post).toHaveBeenCalledTimes(3); // 100 + 100 + 50
  });
});

describe('getRecommendations', () => {
  beforeEach(() => jest.clearAllMocks());

  const PARAMS = {
    seed_genres: ['pop'], target_bpm: 120, target_energy: 0.5,
    target_valence: 0.5, target_acousticness: 0.2, limit: 2,
  };

  it('returns recommendation tracks when the endpoint works', async () => {
    axios.get.mockResolvedValue({ data: { tracks: [{ id: 'r1' }, { id: 'r2' }] } });
    const out = await spotify.getRecommendations('tok', PARAMS);
    expect(out).toEqual([{ id: 'r1' }, { id: 'r2' }]);
  });

  it('returns [] when there are no seed genres (no call made)', async () => {
    expect(await spotify.getRecommendations('tok', { seed_genres: [] })).toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('falls back to genre search when /recommendations is deprecated (404)', async () => {
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { response: { status: 404 } })) // recommendations
      .mockResolvedValueOnce({ data: { tracks: { items: [{ id: 's1' }, { id: 's2' }] } } });        // search
    const out = await spotify.getRecommendations('tok', PARAMS);
    expect(out.map(t => t.id)).toEqual(['s1', 's2']);
  });

  it('also falls back on a 403 (no recommendations access)', async () => {
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('forbidden'), { response: { status: 403 } }))
      .mockResolvedValueOnce({ data: { tracks: { items: [{ id: 's9' }] } } });
    const out = await spotify.getRecommendations('tok', PARAMS);
    expect(out.map(t => t.id)).toEqual(['s9']);
  });

  it('rethrows non-404/403 errors', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } }));
    await expect(spotify.getRecommendations('tok', PARAMS)).rejects.toThrow('boom');
  });

  it('never asks the search endpoint for more than Spotify\'s max of 50 (over-fetch must not 400)', async () => {
    // /recommendations is gone → falls back to search. A large discovery limit
    // (60) with one genre must NOT request limit=60 — Spotify 400s on >50.
    axios.get
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { response: { status: 404 } }))
      .mockResolvedValue({ data: { tracks: { items: [{ id: 's1' }] } } });

    await spotify.getRecommendations('tok', { seed_genres: ['focus'], limit: 60 });

    const searchLimits = axios.get.mock.calls
      .slice(1) // skip the failed /recommendations call
      .map((c) => c[1].params.limit);
    expect(searchLimits.length).toBeGreaterThan(0);
    for (const lim of searchLimits) expect(lim).toBeLessThanOrEqual(50);
  });
});

describe('OAuth scopes', () => {
  it('requests the scopes needed to build a profile from listening history', () => {
    const url = spotify.getAuthUrl('state123');
    const scope = decodeURIComponent(new URL(url).searchParams.get('scope'));
    // Saved tracks (/me/tracks), top tracks/artists, and recently-played all need these.
    expect(scope).toContain('user-library-read');
    expect(scope).toContain('user-top-read');
    expect(scope).toContain('user-read-recently-played');
  });
});

describe('getTopTracks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches /me/top/tracks for the given time range and returns items', async () => {
    axios.get.mockResolvedValue({ data: { items: [{ id: 't1' }, { id: 't2' }] } });
    const out = await spotify.getTopTracks('tok', 'short_term', 50);
    expect(out.map(t => t.id)).toEqual(['t1', 't2']);
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.spotify.com/v1/me/top/tracks',
      expect.objectContaining({ params: { limit: 50, time_range: 'short_term' } }),
    );
  });

  it('returns [] when Spotify returns no items', async () => {
    axios.get.mockResolvedValue({ data: {} });
    expect(await spotify.getTopTracks('tok', 'long_term', 50)).toEqual([]);
  });
});

describe('getTopArtists', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches /me/top/artists and returns artist objects with genres', async () => {
    axios.get.mockResolvedValue({ data: { items: [
      { id: 'a1', name: 'Artist One', genres: ['indie', 'dream pop'] },
    ] } });
    const out = await spotify.getTopArtists('tok', 'medium_term', 50);
    expect(out[0]).toMatchObject({ id: 'a1', genres: ['indie', 'dream pop'] });
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.spotify.com/v1/me/top/artists',
      expect.objectContaining({ params: { limit: 50, time_range: 'medium_term' } }),
    );
  });
});

describe('getRecentlyPlayed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('unwraps items[].track and drops null entries', async () => {
    axios.get.mockResolvedValue({ data: { items: [
      { track: { id: 'r1' } }, { track: null }, { track: { id: 'r2' } },
    ] } });
    const out = await spotify.getRecentlyPlayed('tok', 50);
    expect(out.map(t => t.id)).toEqual(['r1', 'r2']);
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.spotify.com/v1/me/player/recently-played',
      expect.objectContaining({ params: { limit: 50 } }),
    );
  });
});

describe('getArtistsGenres', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns an id→genres map and makes no call for empty ids', async () => {
    expect(await spotify.getArtistsGenres('tok', [])).toEqual({});
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('batches ids in groups of 50 and merges genres', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `a${i}`);
    axios.get.mockImplementation((_url, cfg) => {
      const batch = cfg.params.ids.split(',');
      return Promise.resolve({ data: { artists: batch.map(id => ({ id, genres: [`g-${id}`] })) } });
    });
    const map = await spotify.getArtistsGenres('tok', ids);
    expect(axios.get).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    expect(map['a0']).toEqual(['g-a0']);
    expect(map['a119']).toEqual(['g-a119']);
    expect(Object.keys(map)).toHaveLength(120);
  });
});

// ── Saved tracks (Bug 7 — Like / Liked Songs) ──────────────────────────────────

describe('saveTracks / removeSavedTracks / areTracksSaved', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveTracks PUTs ids to /me/tracks, batched in groups of 50', async () => {
    axios.put.mockResolvedValue({ data: '' });
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    await spotify.saveTracks('tok', ids);
    expect(axios.put).toHaveBeenCalledTimes(3); // 50 + 50 + 20
    expect(axios.put.mock.calls[0][0]).toContain('/me/tracks');
    expect(axios.put.mock.calls[0][1]).toEqual({ ids: ids.slice(0, 50) });
  });

  it('saveTracks no-ops on an empty id list', async () => {
    await spotify.saveTracks('tok', []);
    expect(axios.put).not.toHaveBeenCalled();
  });

  it('removeSavedTracks DELETEs ids from /me/tracks (ids in the request body), batched by 50', async () => {
    axios.delete.mockResolvedValue({ data: '' });
    const ids = Array.from({ length: 60 }, (_, i) => `id${i}`);
    await spotify.removeSavedTracks('tok', ids);
    expect(axios.delete).toHaveBeenCalledTimes(2);
    expect(axios.delete.mock.calls[0][0]).toContain('/me/tracks');
    expect(axios.delete.mock.calls[0][1]).toEqual(expect.objectContaining({ data: { ids: ids.slice(0, 50) } }));
  });

  it('areTracksSaved GETs /me/tracks/contains and returns an id→bool map', async () => {
    axios.get.mockResolvedValue({ data: [true, false] });
    const out = await spotify.areTracksSaved('tok', ['a', 'b']);
    expect(axios.get.mock.calls[0][0]).toContain('/me/tracks/contains');
    expect(axios.get.mock.calls[0][1].params.ids).toBe('a,b');
    expect(out).toEqual({ a: true, b: false });
  });

  it('areTracksSaved returns {} for empty ids without calling the API', async () => {
    expect(await spotify.areTracksSaved('tok', [])).toEqual({});
    expect(axios.get).not.toHaveBeenCalled();
  });
});
