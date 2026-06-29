const {
  getSpotifyToken, playSpotifyTracks, exportSpotifyPlaylist, getIntegrationsStatus,
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

// Real-shaped 22-char Spotify track URIs (what the API actually accepts).
const T1 = 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh';
const T2 = 'spotify:track:1301WleyT98MSxVHPZCA6M';
const T3 = 'spotify:track:7ouMYWpwJ422jRcDASZB7P';
// Unplayable: a YouTube video id reconstructed as a Spotify URI (the prod bug).
const BAD_YT = 'spotify:track:dQw4w9WgXcQ';

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

  it('returns 401 reconnect_required when the refresh token is rejected', async () => {
    spotify.getValidToken.mockRejectedValue(
      Object.assign(new Error('Spotify session expired — reconnect Spotify'), { statusCode: 401, code: 'reconnect_required' }),
    );
    const res = makeRes();

    await getSpotifyToken({ user: {} }, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({ code: 'reconnect_required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 spotify_not_connected when no token is stored', async () => {
    spotify.getValidToken.mockRejectedValue(
      Object.assign(new Error('Spotify not connected'), { statusCode: 400, code: 'spotify_not_connected' }),
    );
    const res = makeRes();

    await getSpotifyToken({ user: {} }, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'spotify_not_connected' });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards an uncoded error to next', async () => {
    const err = Object.assign(new Error('network down'), { statusCode: 500 });
    spotify.getValidToken.mockRejectedValue(err);
    const res = makeRes();

    await getSpotifyToken({ user: {} }, res, next);

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
    const req = { user: {}, body: { uris: [T1, T2], deviceId: 'dev_123' } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(spotify.playTracks).toHaveBeenCalledWith('tok_abc', [T1, T2], 'dev_123');
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

  it('forwards only the valid URIs when the list is mixed (drops malformed/cross-provider)', async () => {
    spotify.playTracks.mockResolvedValue();
    const req = { user: {}, body: { uris: [T1, BAD_YT, 'spotify:track:short', T2, undefined], deviceId: 'dev_123' } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(spotify.playTracks).toHaveBeenCalledWith('tok_abc', [T1, T2], 'dev_123');
    expect(res.statusCode).toBe(204);
  });

  it('returns 422 no_playable_tracks when no URI is a valid Spotify track', async () => {
    const req = { user: {}, body: { uris: [BAD_YT, 'https://open.spotify.com/track/x', null], deviceId: 'dev_123' } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'no_playable_tracks' });
    expect(spotify.playTracks).not.toHaveBeenCalled();
  });

  it('transfers to the active device when no deviceId is supplied (mobile)', async () => {
    spotify.getActiveDevice.mockResolvedValue('active_dev');
    spotify.playTracks.mockResolvedValue();
    const req = { user: {}, body: { uris: [T1] } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(spotify.getActiveDevice).toHaveBeenCalledWith('tok_abc');
    expect(spotify.playTracks).toHaveBeenCalledWith('tok_abc', [T1], 'active_dev');
    expect(res.statusCode).toBe(204);
  });

  it('returns 409 no_active_device when no deviceId and no active device exists', async () => {
    spotify.getActiveDevice.mockResolvedValue(null);
    const req = { user: {}, body: { uris: [T1] } };
    const res = makeRes();

    await playSpotifyTracks(req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ reason: 'no_active_device' });
    expect(spotify.playTracks).not.toHaveBeenCalled();
  });

  it('calls next with error when playback throws', async () => {
    const err = new Error('Device not found');
    spotify.playTracks.mockRejectedValue(err);
    const req = { user: {}, body: { uris: [T1], deviceId: 'dev_123' } };
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
    const req = { user: {}, body: { uris: [T1, T2], name: 'Focus' } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(spotify.createPlaylist).toHaveBeenCalledWith('tok_abc', 'spuser', 'Focus', expect.any(String));
    expect(spotify.addTracksToPlaylist).toHaveBeenCalledWith('tok_abc', 'pl_1', [T1, T2]);
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({ playlistId: 'pl_1', url: 'https://open.spotify.com/playlist/pl_1' });
  });

  it('sanitizes URIs before adding (drops malformed)', async () => {
    const req = { user: {}, body: { uris: [T1, BAD_YT, T3], name: 'Mix' } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(spotify.addTracksToPlaylist).toHaveBeenCalledWith('tok_abc', 'pl_1', [T1, T3]);
  });

  it('falls back to a default name when none is supplied', async () => {
    const req = { user: {}, body: { uris: [T1] } };
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

  it('returns 422 no_playable_tracks when no URI is valid', async () => {
    const req = { user: {}, body: { uris: [BAD_YT, 'nope'] } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'no_playable_tracks' });
    expect(spotify.createPlaylist).not.toHaveBeenCalled();
  });

  it('returns 409 reconnect_required on insufficient scope (403)', async () => {
    spotify.withFreshToken.mockRejectedValue(
      Object.assign(new Error('reconnect'), { statusCode: 403, code: 'insufficient_scope' }),
    );
    const req = { user: {}, body: { uris: [T1], name: 'X' } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ reason: 'reconnect_required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards other errors to next', async () => {
    const err = new Error('network down');
    spotify.withFreshToken.mockRejectedValue(err);
    const req = { user: {}, body: { uris: [T1] } };
    const res = makeRes();

    await exportSpotifyPlaylist(req, res, next);

    expect(next).toHaveBeenCalledWith(err);
  });
});

// ── getIntegrationsStatus ─────────────────────────────────────────────────────

describe('getIntegrationsStatus', () => {
  it('reports the token-backed provider, not a stale musicProvider string', () => {
    // musicProvider says spotify but only YouTube is connected — heal the desync.
    const req = { user: {
      musicProvider: 'spotify',
      spotifyToken: null,
      youtubeMusicToken: { blob: 'enc-yt' },
      wearableProvider: 'garmin',
    } };
    const res = makeRes();

    getIntegrationsStatus(req, res);

    expect(res.body).toEqual({ musicProvider: 'youtube', biometricProvider: 'garmin' });
  });

  it('reports null music provider when neither token is stored', () => {
    const req = { user: { musicProvider: 'spotify', spotifyToken: null, youtubeMusicToken: null, wearableProvider: null } };
    const res = makeRes();

    getIntegrationsStatus(req, res);

    expect(res.body).toEqual({ musicProvider: null, biometricProvider: null });
  });
});
