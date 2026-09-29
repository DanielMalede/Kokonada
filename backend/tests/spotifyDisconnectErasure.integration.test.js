'use strict';

// HX-2 M5/M6/M10 — DELETE /api/integrations/spotify/disconnect erases what Kokonada derived from
// the Spotify account, BEFORE it answers, on REAL MongoDB through the REAL controller.
//
// Spotify Developer Terms V.8 + Appendix A §5.b/§5.c: a working disconnect, and deletion on
// disconnect within 5 days. The confirm sheet promises exactly this (M9), so each clause of that
// copy is one count below:
//   (i)   PlaylistSession — the five provider fields on every Spotify session, at any age
//   (ii)  ServeEvent      — every serve row for the user
//   (iii) MusicProfile    — the profile built from the account
//   (iv)  User            — spotifySessionPlaylistId (and the token, scopes, provider)
//   (v)   UnclassifiedTrack — the Spotify rows in the classification pool
//   (vi)  Redis           — every user-scoped key (ledger windows, pools, buffers)
// Kokonada's own record of each moment stays, and nothing of another user or another provider moves.

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));

// Stateful Redis: a key set with real SCAN MATCH glob semantics (as in userRedisPurge.test.js).
jest.mock('../app/config/redis', () => {
  const keys = new Set();
  const globToRegex = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  const fake = {
    __keys: keys,
    scan: async (_cursor, _m, pattern) => ['0', [...keys].filter((k) => globToRegex(pattern).test(k))],
    del: async (...args) => args.reduce((n, k) => n + (keys.delete(k) ? 1 : 0), 0),
  };
  return { getRedis: () => fake, __fake: fake };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User              = require('../app/models/User');
const PlaylistSession   = require('../app/models/PlaylistSession');
const ServeEvent        = require('../app/models/ServeEvent');
const MusicProfile      = require('../app/models/MusicProfile');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const { __fake: redis } = require('../app/config/redis');
const { spotifyDisconnect } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

const DAY = 24 * 3600 * 1000;

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_spotify_disconnect_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User, PlaylistSession, ServeEvent, MusicProfile, UnclassifiedTrack].map((M) => M.deleteMany({})));
  redis.__keys.clear();
});
afterEach(() => jest.restoreAllMocks());

// The values a leak would carry. None may ever appear in a log line (M10).
const CONTENT = ['Song A', 'Artist A', 'trk1', 'isrc:AAA', 'spotify:track:trk1', 'art-1', 'hidden-'];

const HOLDS = {
  $or: [
    { 'trackIds.0': { $exists: true } }, { 'trackKeys.0': { $exists: true } }, { 'trackSummary.0': { $exists: true } },
    { 'targetGenres.0': { $exists: true } }, { externalPlaylistId: { $ne: null } },
  ],
};

async function sessionFor(userId, provider, ageMs) {
  const doc = await PlaylistSession.create({
    userId,
    emotionTaps: [{ x: 0.3, y: 0.3 }],
    moodKey: 'uplift',
    biometricSnapshot: { heartRate: 80, activity: 'walking' },
    targetGenres: ['indie'],
    musicProvider: provider,
    externalPlaylistId: 'hidden-ext',
    trackIds: ['trk1'],
    trackKeys: ['isrc:AAA'],
    trackSummary: [{ id: 'trk1', title: 'Song A', artist: 'Artist A' }],
    skipCount: 1,
  });
  await PlaylistSession.collection.updateOne({ _id: doc._id }, { $set: { createdAt: new Date(Date.now() - ageMs) } });
  return doc._id;
}

// A user connected to Spotify, holding one row of every Spotify-derived kind — plus one YouTube
// session and one YouTube pool row that a SPOTIFY disconnect must leave alone.
async function seedConnectedUser(tag) {
  const user = await User.create({
    ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.test`,
    musicProvider: 'spotify', spotifyScopes: 'user-top-read playlist-modify-private',
    spotifySessionPlaylistId: `hidden-${tag}`,
  });
  user.setToken('spotifyToken', { accessToken: `at-${tag}`, refreshToken: `rt-${tag}`, expiresAt: Date.now() + 3600e3 });
  await user.save();
  const userId = user._id;

  await sessionFor(userId, 'spotify', 2 * DAY);
  await sessionFor(userId, 'spotify', 20 * DAY);
  await sessionFor(userId, 'youtube', 3 * DAY);
  await ServeEvent.insertMany([1, 2, 3].map((i) => ({ userId, canonicalKey: 'isrc:AAA', moodKey: 'uplift', servedAt: new Date(Date.now() - i * DAY) })));
  await MusicProfile.create({
    userId, topArtists: ['Artist A'], knownArtistIds: ['art-1'],
    library: [{ id: 'trk1', provider: 'spotify', name: 'Song A', artist: 'Artist A', uri: 'spotify:track:trk1', canonicalKey: 'isrc:AAA' }],
  });
  await UnclassifiedTrack.create([
    { userId, track: { id: 'trk1', provider: 'spotify', name: 'Song A' } },
    { userId, track: { id: 'yt-1', provider: 'youtube_music', name: 'Video B' } },
  ]);
  for (const k of [`ledger:${userId}:served`, `ledger:${userId}:mood:uplift`, `pool:${userId}:uplift`, `buffer:${userId}:uplift`]) redis.__keys.add(k);
  return userId;
}

// req.user exactly as the auth middleware loads it: token blobs projected OUT.
const authUser = (userId) => User.findById(userId).select('-spotifyToken -youtubeMusicToken -wearableToken');

function makeRes(events = []) {
  return {
    statusCode: 200,
    status: jest.fn(function status(c) { this.statusCode = c; return this; }),
    json: jest.fn(function json() { events.push('response'); return this; }),
  };
}

async function counts(userId) {
  const user = await User.findById(userId).lean();
  return {
    spotifySessionsHoldingContent: await PlaylistSession.countDocuments({ userId, musicProvider: 'spotify', ...HOLDS }),
    serveEvents: await ServeEvent.countDocuments({ userId }),
    profiles: await MusicProfile.countDocuments({ userId }),
    spotifySessionPlaylistId: user.spotifySessionPlaylistId,
    spotifyUnclassified: await UnclassifiedTrack.countDocuments({ userId, 'track.provider': 'spotify' }),
    redisKeys: [...redis.__keys].filter((k) => k.includes(String(userId))).length,
  };
}

const ERASED = {
  spotifySessionsHoldingContent: 0, serveEvents: 0, profiles: 0,
  spotifySessionPlaylistId: null, spotifyUnclassified: 0, redisKeys: 0,
};

describe('spotifyDisconnect — the purge runs, in full, before the success response (M5)', () => {
  it('all six counts are 0 when the success response is sent', async () => {
    const userId = await seedConnectedUser('a');
    const next = jest.fn();
    const res = makeRes();

    await spotifyDisconnect({ user: await authUser(userId) }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: 'Spotify disconnected' });
    expect(await counts(userId)).toEqual(ERASED);
  });

  it('stops using the account: token, scopes and provider are cleared', async () => {
    const userId = await seedConnectedUser('b');

    await spotifyDisconnect({ user: await authUser(userId) }, makeRes(), jest.fn());

    const user = await User.findById(userId);
    expect(user.spotifyToken).toBeNull();
    expect(user.getToken('spotifyToken')).toBeNull();
    expect(user.musicProvider).toBeNull();
    expect(user.spotifyScopes).toBe('');
  });

  it('keeps the moments: Spotify sessions stay as History entries with their own fields', async () => {
    const userId = await seedConnectedUser('c');

    await spotifyDisconnect({ user: await authUser(userId) }, makeRes(), jest.fn());

    const rows = await PlaylistSession.collection.find({ userId, musicProvider: 'spotify' }).toArray();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ trackIds: [], trackKeys: [], trackSummary: [], targetGenres: [], externalPlaylistId: null });
      expect(row).toMatchObject({ moodKey: 'uplift', skipCount: 1, emotionTaps: [{ x: 0.3, y: 0.3 }] });
      expect(row.biometricSnapshot.activity).toBe('walking');
    }
  });

  it('is scoped: the YouTube session, the YouTube pool row and another user are untouched', async () => {
    const userId = await seedConnectedUser('d');
    const other = await seedConnectedUser('e');
    const otherBefore = await counts(other);

    await spotifyDisconnect({ user: await authUser(userId) }, makeRes(), jest.fn());

    expect(await PlaylistSession.countDocuments({ userId, musicProvider: 'youtube', 'trackIds.0': { $exists: true } })).toBe(1);
    expect(await UnclassifiedTrack.countDocuments({ userId, 'track.provider': 'youtube_music' })).toBe(1);
    expect(await counts(other)).toEqual(otherBefore);
    expect(otherBefore.serveEvents).toBe(3); // the control is not vacuous
  });

  it('every purge step completes BEFORE the response is written', async () => {
    const userId = await seedConnectedUser('f');
    const events = [];
    const track = (Model, method, label) => {
      const original = Model[method].bind(Model);
      jest.spyOn(Model, method).mockImplementation(async (...args) => {
        const out = await original(...args);
        events.push(label);
        return out;
      });
    };
    track(PlaylistSession, 'updateMany', 'sessions');
    track(ServeEvent, 'deleteMany', 'serveEvents');
    track(MusicProfile, 'deleteOne', 'profile');
    track(UnclassifiedTrack, 'deleteMany', 'unclassified');

    await spotifyDisconnect({ user: await authUser(userId) }, makeRes(events), jest.fn());

    expect(events).toHaveLength(5);
    expect(events[events.length - 1]).toBe('response');
    expect(new Set(events.slice(0, 4))).toEqual(new Set(['sessions', 'serveEvents', 'profile', 'unclassified']));
  });
});

describe('spotifyDisconnect — logs carry counts only (M10)', () => {
  it('one [spotifyErasure] line of counts, and no title, artist, ID or URI anywhere in the output', async () => {
    const userId = await seedConnectedUser('g');
    const lines = [];
    for (const m of ['log', 'info', 'warn', 'error']) jest.spyOn(console, m).mockImplementation((...a) => lines.push(a.join(' ')));

    await spotifyDisconnect({ user: await authUser(userId) }, makeRes(), jest.fn());

    const erasure = lines.filter((l) => l.includes('[spotifyErasure]'));
    expect(erasure).toEqual([expect.stringMatching(/^\[spotifyErasure\] sessions=2 serveEvents=3 profiles=1 unclassified=1 redisKeys=4$/)]);
    const all = lines.join('\n');
    for (const secret of [...CONTENT, String(userId)]) expect(all).not.toContain(secret);
  });
});

describe('a disconnect whose purge fails is completed within 5 days with no user action (M6)', () => {
  const { process: runDailyJob } = require('../app/workers/sessionTrim.worker');
  const quiet = () => { for (const m of ['log', 'info', 'warn', 'error']) jest.spyOn(console, m).mockImplementation(() => {}); };
  const boom = () => Object.assign(new Error('primary stepped down'), { name: 'MongoServerError' });

  // Every purge step, made to fail once. ServeEvent is the case a "look for Spotify-marked rows"
  // sweep can never find again (a serve row names no provider), so the owed purge must be recorded.
  const FAILURES = [
    ['the session strip', () => jest.spyOn(PlaylistSession, 'updateMany').mockRejectedValueOnce(boom())],
    ['the ServeEvent delete', () => jest.spyOn(ServeEvent, 'deleteMany').mockRejectedValueOnce(boom())],
    ['the MusicProfile delete', () => jest.spyOn(MusicProfile, 'deleteOne').mockRejectedValueOnce(boom())],
    ['the pool-row delete', () => jest.spyOn(UnclassifiedTrack, 'deleteMany').mockRejectedValueOnce(boom())],
    ['the Redis purge', () => {
      const scan = redis.scan;
      redis.scan = async () => { redis.scan = scan; throw new Error('READONLY'); };
    }],
  ];

  it.each(FAILURES)('%s throws: the response errors, the intent is kept, and the next daily run finishes the erasure', async (_label, inject) => {
    const userId = await seedConnectedUser('m6');
    quiet();
    inject();
    const next = jest.fn();
    const res = makeRes();

    await spotifyDisconnect({ user: await authUser(userId) }, res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    const mid = await User.findById(userId);
    expect(mid.spotifyToken).toBeNull();                        // the account is no longer used
    expect(mid.spotifyErasurePendingAt).toBeInstanceOf(Date);   // the owed purge is on record
    expect(await counts(userId)).not.toEqual(ERASED);           // the failure really stranded data

    await runDailyJob();

    expect(await counts(userId)).toEqual(ERASED);
    expect((await User.findById(userId)).spotifyErasurePendingAt).toBeNull();
  });

  it('a disconnect made before HX-2 (token null, no record) is found by its Spotify rows and erased', async () => {
    const userId = await seedConnectedUser('legacy');
    // What the old handler left: token gone, profile/serves/Redis gone, everything else kept.
    await User.updateOne({ _id: userId }, { $set: { spotifyToken: null, musicProvider: null } });
    await Promise.all([MusicProfile.deleteMany({ userId }), ServeEvent.deleteMany({ userId })]);
    redis.__keys.clear();
    quiet();

    await runDailyJob();

    expect(await counts(userId)).toEqual(ERASED);
  });

  it('a user who reconnected before the run keeps the new link\'s data; the stale record is cleared', async () => {
    const userId = await seedConnectedUser('back');
    await User.updateOne({ _id: userId }, { $set: { spotifyErasurePendingAt: new Date(Date.now() - 3600e3) } });
    const before = await counts(userId);
    quiet();

    await runDailyJob();

    expect(await counts(userId)).toEqual(before);
    expect((await User.findById(userId)).spotifyErasurePendingAt).toBeNull();
  });

  it('a connected user with young Spotify sessions is never swept', async () => {
    const userId = await seedConnectedUser('live');
    const before = await counts(userId);
    quiet();

    const res = await runDailyJob();

    expect(res.spotifyErasures).toBe(0);
    expect(await counts(userId)).toEqual(before);
  });

  it('one user\'s failed erasure does not stop another\'s; the run counts it and fails loudly', async () => {
    const a = await seedConnectedUser('s1');
    const b = await seedConnectedUser('s2');
    await User.updateMany({ _id: { $in: [a, b] } }, { $set: { spotifyToken: null, spotifyErasurePendingAt: new Date() } });
    const original = MusicProfile.deleteOne.bind(MusicProfile);
    jest.spyOn(MusicProfile, 'deleteOne').mockImplementation((filter) => (
      String(filter.userId) === String(a) ? Promise.reject(boom()) : original(filter)));
    const lines = [];
    jest.spyOn(console, 'log').mockImplementation((...x) => lines.push(x.join(' ')));
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runDailyJob()).rejects.toThrow(/step/);

    expect(await counts(b)).toEqual(ERASED);
    expect((await User.findById(a)).spotifyErasurePendingAt).toBeInstanceOf(Date); // retried tomorrow
    expect(lines.find((l) => l.startsWith('[sessionTrim]'))).toMatch(/spotifyErasures=1 failures=1$/);
  });
});
