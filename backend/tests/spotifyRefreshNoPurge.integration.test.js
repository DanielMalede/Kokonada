'use strict';

// HX-2 MUST NOT — a Spotify 400/401 on token refresh is NOT a disconnect, and deletes nothing.
//
// An expired or revoked grant asks the user to reconnect (reconnect_required). Treating it as a
// disconnect would erase a user's History tracks and profile on a transient or recoverable
// condition, without the user ever expressing that intent. Revocation on Spotify's side is its own
// open item (CMP-139: invalid_grant only, a day-4 re-check, a circuit breaker) and is deliberately
// NOT implemented here. Real MongoDB, the real spotify service and controller; only Spotify's token
// endpoint is faked.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
process.env.SPOTIFY_CLIENT_ID = 'sp_id';
process.env.SPOTIFY_CLIENT_SECRET = 'sp_secret';
process.env.SPOTIFY_REDIRECT_URI = 'http://localhost/cb';

jest.mock('axios');
jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
jest.mock('../app/config/redis', () => ({ getRedis: () => null }));

const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent = require('../app/models/ServeEvent');
const MusicProfile = require('../app/models/MusicProfile');
const { getSpotifyToken } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_refresh_no_purge_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User, PlaylistSession, ServeEvent, MusicProfile].map((M) => M.deleteMany({})));
  axios.post.mockReset(); // an automock keeps its calls across tests; restoreAllMocks does not clear it
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function userWithExpiredGrant() {
  const user = await User.create({ ssoProvider: 'google', ssoId: 'sso-exp', email: 'x@example.test', musicProvider: 'spotify' });
  user.setToken('spotifyToken', { accessToken: 'old', refreshToken: 'rt', expiresAt: Date.now() - 3600e3 });
  await user.save();
  await PlaylistSession.create({
    userId: user._id, emotionTaps: [{ x: 0, y: 0 }], musicProvider: 'spotify',
    trackIds: ['trk1'], trackSummary: [{ id: 'trk1', title: 'Song A', artist: 'Artist A' }],
  });
  await ServeEvent.create({ userId: user._id, canonicalKey: 'isrc:AAA', servedAt: new Date() });
  await MusicProfile.create({ userId: user._id, library: [{ id: 'trk1', provider: 'spotify' }] });
  return user._id;
}

describe.each([[400, 'invalid_grant'], [401, 'invalid_client']])('Spotify refresh answers %i (%s)', (status, error) => {
  it('asks for a reconnect and deletes nothing', async () => {
    const userId = await userWithExpiredGrant();
    axios.post.mockRejectedValueOnce(Object.assign(new Error(`Request failed with status code ${status}`), {
      response: { status, data: { error } },
    }));
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };

    await getSpotifyToken({ user: { _id: userId } }, res, jest.fn());

    expect(axios.post).toHaveBeenCalledTimes(1); // the refresh really reached Spotify's token endpoint
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'reconnect_required' }));
    const user = await User.findById(userId);
    expect(user.spotifyToken?.blob).toBeTruthy();
    expect(user.spotifyErasurePendingAt).toBeNull();
    expect(await PlaylistSession.countDocuments({ userId, 'trackIds.0': { $exists: true } })).toBe(1);
    expect(await ServeEvent.countDocuments({ userId })).toBe(1);
    expect(await MusicProfile.countDocuments({ userId })).toBe(1);
  });
});
