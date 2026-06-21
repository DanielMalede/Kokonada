const { getSpotifyToken, playSpotifyTracks } = require('../app/controllers/integrationsController');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const next = jest.fn();

// ── getSpotifyToken ───────────────────────────────────────────────────────────

jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(),
  playTracks:    jest.fn(),
  getAuthUrl: jest.fn(),
  exchangeCode: jest.fn(),
  getProfile: jest.fn(),
  getTopTrackFeatures: jest.fn(),
  paginateLikedSongs: jest.fn(),
  paginatePlaylistTracks: jest.fn(),
  batchAudioFeatures: jest.fn(),
  getRecommendations: jest.fn(),
}));

const spotify = require('../app/services/spotify');

describe('getSpotifyToken', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns access_token when Spotify is connected', async () => {
    spotify.getValidToken.mockResolvedValue('tok_abc');
    const req = { user: { getToken: () => ({ accessToken: 'tok_abc', refreshToken: 'ref', expiresAt: Date.now() + 99999 }) } };
    const res = makeRes();

    await getSpotifyToken(req, res, next);

    expect(res.body).toEqual({ access_token: 'tok_abc' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next with error when getValidToken throws', async () => {
    const err = Object.assign(new Error('Spotify not connected'), { statusCode: 400 });
    spotify.getValidToken.mockRejectedValue(err);
    const req = { user: {} };
    const res = makeRes();

    await getSpotifyToken(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── playSpotifyTracks ─────────────────────────────────────────────────────────

describe('playSpotifyTracks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls spotify.playTracks and responds 204', async () => {
    spotify.getValidToken.mockResolvedValue('tok_abc');
    spotify.playTracks.mockResolvedValue();
    const req = {
      user: {},
      body: { uris: ['spotify:track:aaa', 'spotify:track:bbb'], deviceId: 'dev_123' },
    };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(spotify.playTracks).toHaveBeenCalledWith('tok_abc', ['spotify:track:aaa', 'spotify:track:bbb'], 'dev_123');
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it('returns 400 when uris is empty', async () => {
    const req = { user: {}, body: { uris: [], deviceId: 'dev_123' } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('uris') });
    expect(spotify.playTracks).not.toHaveBeenCalled();
  });

  it('returns 400 when deviceId is missing', async () => {
    const req = { user: {}, body: { uris: ['spotify:track:aaa'] } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: expect.stringContaining('deviceId') });
  });

  it('calls next with error when spotify.playTracks throws', async () => {
    spotify.getValidToken.mockResolvedValue('tok_abc');
    const err = new Error('Device not found');
    spotify.playTracks.mockRejectedValue(err);
    const req = {
      user: {},
      body: { uris: ['spotify:track:aaa'], deviceId: 'dev_123' },
    };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
