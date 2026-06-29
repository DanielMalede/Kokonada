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
});
