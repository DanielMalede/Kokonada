'use strict';

// HX-2 M7 — a disconnect made while the background profile build is running is NOT undone by it.
//
// spotifyCallback starts buildProfile in the background and answers at once; the build ends in
// MusicProfile.findOneAndUpdate(..., { upsert: true }). A user who connects and then disconnects
// within those seconds had their profile re-created by the upsert AFTER the disconnect deleted it —
// Spotify-derived data held with no link, which V.8 forbids. The build must leave exactly the state
// the disconnect leaves: no MusicProfile.
//
// Real MongoDB, the real buildProfile and the real disconnect controller. Only the outside world is
// faked: the Spotify Web API (fixtures, one call held open) and the fire-and-forget corpus/feature
// side channels.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

const mockHeld = { gate: null };
const mockTrack = (i) => ({
  id: `trk${i}`, name: `Song ${i}`, uri: `spotify:track:trk${i}`, popularity: 40,
  artists: [{ id: `art${i}`, name: `Artist ${i}` }], external_ids: { isrc: `ISRC0000000${i}` },
});
jest.mock('../app/services/spotify', () => ({
  getTopTracks: jest.fn(async () => [mockTrack(1), mockTrack(2)]),
  getTopArtists: jest.fn(async () => [{ id: 'art1', name: 'Artist 1', genres: ['indie'] }]),
  // Saved tracks come back only when the test lets them — the build is "in flight" until then.
  paginateLikedSongs: jest.fn(async () => (mockHeld.gate ? mockHeld.gate.promise : [mockTrack(3)])),
  getRecentlyPlayed: jest.fn(async () => []),
  paginatePlaylistTracks: jest.fn(async () => []),
  getArtistsGenres: jest.fn(async () => ({})),
}));
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({ queued: false })) }));
jest.mock('../app/services/discovery/corpusIngest', () => ({ ingestLibrary: jest.fn(async () => ({})) }));
jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
jest.mock('../app/config/redis', () => {
  const keys = new Set();
  return { getRedis: () => ({ scan: async () => ['0', []], del: async () => 0, __keys: keys }) };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const MusicProfile = require('../app/models/MusicProfile');
const spotify = require('../app/services/spotify');
const { buildProfile } = require('../app/services/musicProfileService');
const { spotifyDisconnect } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_build_race_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), MusicProfile.deleteMany({})]);
  mockHeld.gate = null;
  for (const m of ['log', 'info', 'warn']) jest.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// A user who has just connected: the callback has saved the token and hands the FULL doc to the build.
async function justConnected() {
  const user = await User.create({ ssoProvider: 'google', ssoId: `sso-${Date.now()}`, email: 'r@example.test', musicProvider: 'spotify' });
  user.setToken('spotifyToken', { accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600e3 });
  await user.save();
  return User.findById(user._id);
}

const disconnect = async (userId) => {
  const next = jest.fn();
  const reqUser = await User.findById(userId).select('-spotifyToken -youtubeMusicToken -wearableToken');
  await spotifyDisconnect({ user: reqUser }, { json: jest.fn(), status: jest.fn().mockReturnThis() }, next);
  expect(next).not.toHaveBeenCalled();
};

// Resolves once `fn` has been entered — lets a test act while the build is parked inside it.
function reached(mockFn) {
  return new Promise((resolve) => {
    const impl = mockFn.getMockImplementation();
    mockFn.mockImplementationOnce((...args) => { resolve(); return impl(...args); });
  });
}

describe('buildProfile vs a disconnect (M7)', () => {
  it('control: with no disconnect the build writes a profile of the Spotify library', async () => {
    const user = await justConnected();

    await buildProfile(String(user._id), user);

    const profile = await MusicProfile.findOne({ userId: user._id }).lean();
    expect(profile.library.map((t) => t.id).sort()).toEqual(['trk1', 'trk2', 'trk3']);
  });

  it('a disconnect while the Spotify fetch is in flight leaves NO MusicProfile when the build finishes', async () => {
    const user = await justConnected();
    mockHeld.gate = deferred();
    const inFlight = reached(spotify.paginateLikedSongs);

    const build = buildProfile(String(user._id), user);
    await inFlight;
    await disconnect(user._id);
    mockHeld.gate.resolve([mockTrack(3)]);
    await build;

    expect(await MusicProfile.countDocuments({ userId: user._id })).toBe(0);
  });

  it('a disconnect that lands between the build\'s check and its write still leaves NO MusicProfile', async () => {
    const user = await justConnected();
    const write = deferred();
    const writeReached = deferred();
    const realWrite = MusicProfile.findOneAndUpdate.bind(MusicProfile);
    jest.spyOn(MusicProfile, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
      writeReached.resolve();
      await write.promise;
      return realWrite(...args);
    });

    const build = buildProfile(String(user._id), user);
    await writeReached.promise;   // the build has decided to write, and is about to
    await disconnect(user._id);   // …and the disconnect completes first
    write.resolve();
    await build;

    expect(await MusicProfile.countDocuments({ userId: user._id })).toBe(0);
  });

  it('the disconnect is not undone for the user: token still gone and nothing owed afterwards', async () => {
    const user = await justConnected();
    mockHeld.gate = deferred();
    const inFlight = reached(spotify.paginateLikedSongs);

    const build = buildProfile(String(user._id), user);
    await inFlight;
    await disconnect(user._id);
    mockHeld.gate.resolve([mockTrack(3)]);
    await build;

    const after = await User.findById(user._id);
    expect(after.spotifyToken).toBeNull();
    expect(after.spotifyErasurePendingAt).toBeNull();
  });
});
