'use strict';

// HX-2 round 1 — H1 (resilience) = N3 (compliance): a Spotify token refresh can undo a disconnect.
//
// A generation in flight holds a User doc read BEFORE the disconnect. When its token needs a
// refresh, getValidToken / withFreshToken used to `setToken` + `user.save()` that stale doc — which
// writes the token back AFTER the disconnect deleted it. The daily sweep then reads the account as
// reconnected and clears the owed erasure, so the Spotify data a failed purge stranded is kept.
//
// Real MongoDB, the real spotify service, the real disconnect controller and the real daily job.
// Only Spotify's token endpoint (axios) is faked — held open so the disconnect lands mid-refresh.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
process.env.SPOTIFY_CLIENT_ID = 'sp_id';
process.env.SPOTIFY_CLIENT_SECRET = 'sp_secret';
process.env.SPOTIFY_REDIRECT_URI = 'http://localhost/cb';

jest.mock('axios');
jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
jest.mock('../app/config/redis', () => {
  const keys = new Set();
  const globToRegex = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const fake = {
    __keys: keys,
    scan: async (_c, _m, pattern) => ['0', [...keys].filter((k) => globToRegex(pattern).test(k))],
    del: async (...args) => args.reduce((n, k) => n + (keys.delete(k) ? 1 : 0), 0),
  };
  return { getRedis: () => fake, __fake: fake };
});

const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent = require('../app/models/ServeEvent');
const MusicProfile = require('../app/models/MusicProfile');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const { __fake: redis } = require('../app/config/redis');
const spotify = require('../app/services/spotify');
const { spotifyDisconnect } = require('../app/controllers/integrationsController');
const { process: runDailyJob } = require('../app/workers/sessionTrim.worker');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_refresh_after_disconnect_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User, PlaylistSession, ServeEvent, MusicProfile, UnclassifiedTrack].map((M) => M.deleteMany({})));
  redis.__keys.clear();
  axios.post.mockReset();
  for (const m of ['log', 'info', 'warn', 'error']) jest.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

async function connectedUser({ expired }) {
  const user = await User.create({
    ssoProvider: 'google', ssoId: `sso-${Date.now()}-${Math.random()}`, email: 'r@example.test',
    musicProvider: 'spotify', spotifySessionPlaylistId: 'hidden-playlist',
  });
  user.setToken('spotifyToken', { accessToken: 'old-at', refreshToken: 'rt', expiresAt: Date.now() + (expired ? -3600e3 : 3600e3) });
  await user.save();
  const userId = user._id;
  await PlaylistSession.create({
    userId, emotionTaps: [{ x: 0, y: 0 }], musicProvider: 'spotify',
    trackIds: ['trk1'], trackSummary: [{ id: 'trk1', title: 'Song A', artist: 'Artist A' }],
  });
  await ServeEvent.create({ userId, canonicalKey: 'isrc:AAA', servedAt: new Date() });
  await MusicProfile.create({ userId, library: [{ id: 'trk1', provider: 'spotify' }] });
  await UnclassifiedTrack.create({ userId, track: { id: 'trk1', provider: 'spotify' } });
  redis.__keys.add(`ledger:${userId}:served`);
  return userId;
}

const HOLDS = { $or: [{ 'trackIds.0': { $exists: true } }, { 'trackSummary.0': { $exists: true } }, { externalPlaylistId: { $ne: null } }] };
async function counts(userId) {
  const u = await User.findById(userId).lean();
  return {
    token: u.spotifyToken ?? null,
    sessions: await PlaylistSession.countDocuments({ userId, musicProvider: 'spotify', ...HOLDS }),
    serveEvents: await ServeEvent.countDocuments({ userId }),
    profiles: await MusicProfile.countDocuments({ userId }),
    playlistId: u.spotifySessionPlaylistId ?? null,
    unclassified: await UnclassifiedTrack.countDocuments({ userId, 'track.provider': 'spotify' }),
    redisKeys: [...redis.__keys].filter((k) => k.includes(String(userId))).length,
  };
}
const ERASED = { token: null, sessions: 0, serveEvents: 0, profiles: 0, playlistId: null, unclassified: 0, redisKeys: 0 };

const disconnect = async (userId) => spotifyDisconnect(
  { user: await User.findById(userId).select('-spotifyToken -youtubeMusicToken -wearableToken') },
  { json: jest.fn(), status: jest.fn().mockReturnThis() },
  jest.fn(),
);
const tokenAnswer = { data: { access_token: 'new-at', refresh_token: 'rt2', expires_in: 3600 } };

describe('a Spotify token refresh held across a disconnect never writes the token back (H1/N3)', () => {
  it('getValidToken: the refresh fails as not connected, and after the job the token is null and all six counts are 0', async () => {
    const userId = await connectedUser({ expired: true });
    const staleDoc = await User.findById(userId);          // what a generation in flight holds
    const held = deferred();
    axios.post.mockReturnValueOnce(held.promise);
    // Make the disconnect's own purge fail once, so the erasure is OWED and the sweep must finish it.
    jest.spyOn(MusicProfile, 'deleteOne').mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'MongoServerError' }));

    const refresh = spotify.getValidToken(staleDoc);
    await disconnect(userId);
    held.resolve(tokenAnswer);

    await expect(refresh).rejects.toMatchObject({ code: 'spotify_not_connected' });
    expect((await User.findById(userId).lean()).spotifyToken).toBeNull();

    await runDailyJob();

    expect(await counts(userId)).toEqual(ERASED);
  });

  it('withFreshToken (a 401 mid-call): the forced refresh fails as not connected, and the token stays null', async () => {
    const userId = await connectedUser({ expired: false });
    const staleDoc = await User.findById(userId);
    const held = deferred();
    axios.post.mockReturnValueOnce(held.promise);
    const call = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('401'), { response: { status: 401 } }))
      .mockResolvedValueOnce('should not run');

    const run = spotify.withFreshToken(staleDoc, call);
    await new Promise((r) => setImmediate(r));              // the first call has 401'd; refresh is in flight
    await disconnect(userId);
    held.resolve(tokenAnswer);

    await expect(run).rejects.toMatchObject({ code: 'spotify_not_connected' });
    expect(call).toHaveBeenCalledTimes(1);
    expect((await User.findById(userId).lean()).spotifyToken).toBeNull();
  });

  it('two ordinary refreshes racing (two generations at once) both succeed — a lost compare-and-set is not a disconnect', async () => {
    const userId = await connectedUser({ expired: true });
    const [docA, docB] = [await User.findById(userId), await User.findById(userId)];
    const [heldA, heldB] = [deferred(), deferred()];
    axios.post.mockReturnValueOnce(heldA.promise).mockReturnValueOnce(heldB.promise);

    const a = spotify.getValidToken(docA);
    const b = spotify.getValidToken(docB);
    heldA.resolve({ data: { access_token: 'at-A', refresh_token: 'rt-A', expires_in: 3600 } });
    await a;
    heldB.resolve({ data: { access_token: 'at-B', refresh_token: 'rt-B', expires_in: 3600 } });

    await expect(a).resolves.toBe('at-A');
    await expect(b).resolves.toBe('at-A');                   // B adopts what A stored; it writes nothing
    const stored = await User.findById(userId);
    expect(stored.getToken('spotifyToken').refreshToken).toBe('rt-A');
  });

  it('control: with no disconnect the refresh is stored, and the doc is not left dirty for a later save', async () => {
    const userId = await connectedUser({ expired: true });
    const doc = await User.findById(userId);
    axios.post.mockResolvedValueOnce(tokenAnswer);

    await expect(spotify.getValidToken(doc)).resolves.toBe('new-at');
    const stored = await User.findById(userId);
    expect(stored.getToken('spotifyToken').accessToken).toBe('new-at');
    expect(doc.getToken('spotifyToken').accessToken).toBe('new-at');

    // A later disconnect, then that same in-memory doc saved for another reason (the session-playlist
    // writer does this): the token must not come back.
    await disconnect(userId);
    doc.displayName = 'renamed';
    await doc.save();
    expect((await User.findById(userId).lean()).spotifyToken).toBeNull();
  });
});
