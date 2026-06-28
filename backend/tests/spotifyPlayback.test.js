const {
  getSpotifyToken, playSpotifyTracks, exportSpotifyPlaylist,
} = require('../app/controllers/integrationsController');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRes() {
  const res = { statusCode: 200, body: null, ended: false };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (data) => { res.body = data; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}

const next = jest.fn();

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(),
  // Default: behave like the real helper's happy path — invoke fn with a token.
  withFreshToken: jest.fn(async (_user, fn) => fn('tok_abc')),
  playTracks:    jest.fn(),
  getActiveDevice: jest.fn(),
  getProfile: jest.fn(),
  createPlaylist: jest.fn(),
  addTracksToPlaylist: jest.fn(),
  getAuthUrl: jest.fn(),
  exchangeCode: jest.fn(),
  getTopTrackFeatures: jest.fn(),
  paginateLikedSongs: jest.fn(),
  paginatePlaylistTracks: jest.fn(),
  batchAudioFeatures: jest.fn(),
  getRecommendations: jest.fn(),
}));

const spotify = require('../app/services/spotify');

// ── getSpotifyToken ───────────────────────────────────────────────────────────

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
  beforeEach(() => {
    jest.clearAllMocks();
    spotify.withFreshToken.mockImplementation(async (_user, fn) => fn('tok_abc'));
  });

  it('plays on the given deviceId (desktop SDK) and responds 204', async () => {
    spotify.playTracks.mockResolvedValue();
    const req = {
      user: {},
      body: { uris: ['spotify:track:aaa', 'spotify:track:bbb'], deviceId: 'dev_123' },
    };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(spotify.playTracks).toHaveBeenCalledWith('tok_abc', ['spotify:track:aaa', 'spotify:track:bbb'], 'dev_123');
    expect(spotify.getActiveDevice).not.toHaveBeenCalled();
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

  it('transfers to the active device when no deviceId is supplied (mobile)', async () => {
    spotify.getActiveDevice.mockResolvedValue('active_dev');
    spotify.playTracks.mockResolvedValue();
    const req = { user: {}, body: { uris: ['spotify:track:aaa'] } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(spotify.getActiveDevice).toHaveBeenCalledWith('tok_abc');
    expect(spotify.playTracks).toHaveBeenCalledWith('tok_abc', ['spotify:track:aaa'], 'active_dev');
    expect(res.statusCode).toBe(204);
  });

  it('returns 409 no_active_device when no deviceId and no active device exists', async () => {
    spotify.getActiveDevice.mockResolvedValue(null);
    const req = { user: {}, body: { uris: ['spotify:track:aaa'] } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ reason: 'no_active_device' });
    expect(spotify.playTracks).not.toHaveBeenCalled();
  });

  it('calls next with error when playback throws', async () => {
    const err = new Error('Device not found');
    spotify.playTracks.mockRejectedValue(err);
    const req = { user: {}, body: { uris: ['spotify:track:aaa'], deviceId: 'dev_123' } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── exportSpotifyPlaylist ─────────────────────────────────────────────────────

describe('exportSpotifyPlaylist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    spotify.withFreshToken.mockImplementation(async (_user, fn) => fn('tok_abc'));
    spotify.getProfile.mockResolvedValue({ spotifyId: 'spuser', displayName: 'D', email: 'e' });
    spotify.createPlaylist.mockResolvedValue({ id: 'pl_1', url: 'https://open.spotify.com/playlist/pl_1' });
    spotify.addTracksToPlaylist.mockResolvedValue();
  });

  it('creates a playlist, adds tracks, and returns 201 with id + url', async () => {
    const req = { user: {}, body: { uris: ['spotify:track:aaa', 'spotify:track:bbb'], name: 'Focus' } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(spotify.createPlaylist).toHaveBeenCalledWith('tok_abc', 'spuser', 'Focus', expect.any(String));
    expect(spotify.addTracksToPlaylist).toHaveBeenCalledWith('tok_abc', 'pl_1', ['spotify:track:aaa', 'spotify:track:bbb']);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ playlistId: 'pl_1', url: 'https://open.spotify.com/playlist/pl_1' });
  });

  it('falls back to a default name when none is supplied', async () => {
    const req = { user: {}, body: { uris: ['spotify:track:aaa'] } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(spotify.createPlaylist).toHaveBeenCalledWith('tok_abc', 'spuser', expect.any(String), expect.any(String));
    expect(res.statusCode).toBe(201);
  });

  it('returns 400 when uris is empty', async () => {
    const req = { user: {}, body: { uris: [] } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(spotify.createPlaylist).not.toHaveBeenCalled();
  });

  it('returns 409 reconnect_required on insufficient scope (403)', async () => {
    spotify.withFreshToken.mockRejectedValue(
      Object.assign(new Error('reconnect'), { statusCode: 403, code: 'insufficient_scope' }),
    );
    const req = { user: {}, body: { uris: ['spotify:track:aaa'], name: 'X' } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ reason: 'reconnect_required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards other errors to next', async () => {
    const err = new Error('network down');
    spotify.withFreshToken.mockRejectedValue(err);
    const req = { user: {}, body: { uris: ['spotify:track:aaa'] } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});
