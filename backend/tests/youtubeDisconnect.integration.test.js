'use strict';

// HX-3 T3 (DEC-122, DT-B2 option B) — DELETE /api/integrations/youtube/disconnect is a sealed no-op,
// proven through the REAL assembled app (supertest), the REAL auth middleware and the REAL controller
// against REAL MongoDB (mongodb-memory-server).
//
// Connecting YouTube is sealed in code, so no account can come to hold a link, and production holds
// none (DAN-046). A stored link may never be dropped without revoking it at Google (YouTube Developer
// Policies III.D.2.3.1; the defect BE-022 names), and no revoke is built under DEC-122. So:
//   • no link → 200 { message: 'YouTube disconnected' }, and nothing changes;
//   • a link  → 409 { error: 'youtube_link_present' }; the link is KEPT (for the DEC-122 contingency's
//               revoke-and-purge script) and one fixed line is logged, naming no user and no token.
// Neither branch writes to Mongo or Redis, rebuilds the profile, calls out to any provider, or touches
// `musicProvider`. Every one of those is observed on the real stores below, not on a spy of a mock.
//
// Replaced, because they have no bearing on the handler: the db connector (this file connects mongoose
// itself), the background workers and Sentry. Redis is a small STATEFUL fake that records every call.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/config/db', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../app/workers', () => ({ startInProcessWorkers: jest.fn(() => []) }));
jest.mock('../app/config/sentry', () => ({
  initSentry: jest.fn(),
  captureException: jest.fn(),
  sentryErrorHandler: (err, req, res, next) => next(err),
}));
// Redis: string keys with real SCAN MATCH glob semantics; EVERY call is recorded, whatever its name.
jest.mock('../app/config/redis', () => {
  const keys = new Map();
  const calls = [];
  const glob = (p) => new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const impl = {
    get: async (k) => (keys.has(k) ? keys.get(k) : null),
    set: async (k, v) => { keys.set(k, v); return 'OK'; },
    del: async (...ks) => ks.flat().reduce((n, k) => n + (keys.delete(k) ? 1 : 0), 0),
    scan: async (_c, _m, pattern) => ['0', [...keys.keys()].filter((k) => glob(pattern).test(k))],
  };
  const fake = new Proxy({}, {
    get(_t, prop) {
      if (prop === '__keys') return keys;
      if (prop === '__calls') return calls;
      if (prop === 'then') return undefined;
      return async (...args) => { calls.push([String(prop), ...args]); return impl[prop] ? impl[prop](...args) : null; };
    },
  });
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app } = require('../app/index');
const User = require('../app/models/User');
const MusicProfile = require('../app/models/MusicProfile');
const { __fake: redis } = require('../app/config/redis');

jest.setTimeout(120000);

const REFUSAL_LINE = '[youtube] disconnect refused: link present (sealed)';
const YT_TOKENS = { accessToken: 'ya29.yt-access-SENTINEL', refreshToken: '1//yt-refresh-SENTINEL', expiresAt: Date.now() + 3_600_000 };
const SP_TOKENS = { accessToken: 'sp-access-SENTINEL', refreshToken: 'sp-refresh-SENTINEL', expiresAt: Date.now() + 3_600_000 };

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_youtube_disconnect_it' });
  // Build the indexes now, so no index work can land inside the window the assertions watch.
  await Promise.all([User.init(), MusicProfile.init()]);
});
afterAll(async () => {
  mongoose.set('debug', false);
  await mongoose.disconnect();
  await mem.stop();
});

let ops;
let logged;
let network;
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), MusicProfile.deleteMany({})]);
  redis.__keys.clear();
  redis.__calls.length = 0;
  ops = [];
  logged = [];
  network = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push({ level, line: args.map(String).join(' ') }); });
  }
  for (const verb of ['get', 'post', 'put', 'delete', 'request']) {
    jest.spyOn(axios, verb).mockImplementation(async (...args) => { network.push([verb, String(args[0]?.url ?? args[0])]); throw new Error('no network in tests'); });
  }
});
afterEach(() => {
  mongoose.set('debug', false);
  jest.restoreAllMocks();
});

const bearer = (userId) =>
  `Bearer ${jwt.sign({ userId: String(userId) }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() })}`;

// A linked account as the old callback left it: tokens encrypted through the REAL setToken, a built
// profile, and a cached pool in Redis.
async function account(tag, { youtube = false, spotify = false } = {}) {
  const user = new User({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  if (spotify) user.setToken('spotifyToken', SP_TOKENS);
  if (youtube) user.setToken('youtubeMusicToken', YT_TOKENS);
  user.musicProvider = youtube ? 'youtube' : (spotify ? 'spotify' : null);
  await user.save();
  await MusicProfile.create({
    userId: user._id,
    topGenres: ['ambient', 'yt-topic-genre'],
    topArtists: ['Spotify Artist', 'YouTube Channel Artist'],
    genreSet: ['ambient', 'yt-topic-genre'],
    library: [
      { id: 'sp1', provider: 'spotify', name: 'Spotify Song', artist: 'Spotify Artist', genres: ['ambient'] },
      ...(youtube ? [{ id: 'vid1', provider: 'youtube_music', name: 'YouTube Song', artist: 'YouTube Channel Artist', genres: ['yt-topic-genre'] }] : []),
    ],
  });
  redis.__keys.set(`pool:${user._id}:calm`, JSON.stringify({ tracks: ['x'] }));
  redis.__calls.length = 0;
  return user;
}

// The raw stored documents, read through the driver (not mongoose) so the read is not itself an op.
const rawUser = (id) => mongoose.connection.db.collection('users').findOne({ _id: id });
const rawProfile = (id) => mongoose.connection.db.collection('musicprofiles').findOne({ userId: id });

const READS = new Set(['find', 'findOne', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'aggregate']);

async function disconnect(user) {
  const before = { user: await rawUser(user._id), profile: await rawProfile(user._id), redis: new Map(redis.__keys) };
  const auth = bearer(user._id);
  redis.__calls.length = 0;
  mongoose.set('debug', (collection, method) => { ops.push(`${collection}.${method}`); });
  const res = await request(app).delete('/api/integrations/youtube/disconnect').set('Authorization', auth);
  mongoose.set('debug', false);
  const after = { user: await rawUser(user._id), profile: await rawProfile(user._id), redis: new Map(redis.__keys) };
  return { res, before, after };
}

const writesIn = (list) => list.filter((op) => !READS.has(op.split('.').pop()));
// The auth middleware's own jti denylist read is the only Redis traffic a request may cause.
const redisCallsBesidesAuth = () => redis.__calls.filter(([cmd, key]) => !(cmd === 'get' && String(key).startsWith('revoked:jti:')));

function expectNothingChanged({ before, after }) {
  expect(writesIn(ops)).toEqual([]);
  expect(redisCallsBesidesAuth()).toEqual([]);
  expect(after.user).toEqual(before.user);       // token blobs, musicProvider, updatedAt, __v — all of it
  expect(after.profile).toEqual(before.profile); // library NOT emptied, NOT rebuilt
  expect(after.redis).toEqual(before.redis);     // the cached pool is still there
  expect(network).toEqual([]);                   // no rebuild from Spotify, no call to Google
}

describe('DELETE /api/integrations/youtube/disconnect — a sealed no-op on real MongoDB (HX-3 T3)', () => {
  it('no YouTube link, Spotify linked → 200 YouTube disconnected; nothing is written, rebuilt or emptied', async () => {
    const user = await account('spotify-only', { spotify: true });
    const run = await disconnect(user);

    expect(run.res.status).toBe(200);
    expect(run.res.body).toEqual({ message: 'YouTube disconnected' });
    expect(run.after.user.musicProvider).toBe('spotify');
    expect(run.after.user.spotifyToken.blob).toBe(run.before.user.spotifyToken.blob);
    expectNothingChanged(run);
    expect(ops.length).toBeGreaterThan(0); // the recorder is live: auth and the handler's own reads show up
  });

  it('no link at all → 200; the library is not emptied (the old footgun) and nothing else moves', async () => {
    const user = await account('nothing-linked');
    const run = await disconnect(user);

    expect(run.res.status).toBe(200);
    expect(run.res.body).toEqual({ message: 'YouTube disconnected' });
    expect(run.after.profile.library).toHaveLength(1);
    expectNothingChanged(run);
  });

  it('a stored YouTube link → 409 youtube_link_present; the link is KEPT, with Spotify linked too', async () => {
    const user = await account('both-linked', { youtube: true, spotify: true });
    const run = await disconnect(user);

    expect(run.res.status).toBe(409);
    expect(run.res.body).toEqual({ error: 'youtube_link_present' });
    expect(run.after.user.youtubeMusicToken.blob).toBe(run.before.user.youtubeMusicToken.blob);
    expect(run.after.user.musicProvider).toBe('youtube');
    // The kept blob still decrypts to the grant — available to the contingency's revoke.
    const reloaded = await User.findById(user._id);
    expect(reloaded.getToken('youtubeMusicToken')).toMatchObject({ refreshToken: YT_TOKENS.refreshToken });
    expectNothingChanged(run);
  });

  it('a stored YouTube link and no Spotify → 409; the YouTube rows are not stripped and the library is not emptied', async () => {
    const user = await account('youtube-only', { youtube: true });
    const run = await disconnect(user);

    expect(run.res.status).toBe(409);
    expect(run.res.body).toEqual({ error: 'youtube_link_present' });
    expect(run.after.profile.library.map((t) => t.provider)).toEqual(['spotify', 'youtube_music']);
    expectNothingChanged(run);
  });

  it('the 409 logs exactly one fixed error line, and no line names the user, the token or the body', async () => {
    const user = await account('log-check', { youtube: true, spotify: true });
    const stored = await rawUser(user._id);
    await disconnect(user);

    const refusals = logged.filter((l) => l.line.includes('[youtube]'));
    expect(refusals).toEqual([{ level: 'error', line: REFUSAL_LINE }]);
    const secrets = [
      String(user._id), user.email,
      YT_TOKENS.accessToken, YT_TOKENS.refreshToken, stored.youtubeMusicToken.blob,
      SP_TOKENS.accessToken, SP_TOKENS.refreshToken, stored.spotifyToken.blob,
    ];
    for (const { line } of logged) {
      for (const secret of secrets) expect(line).not.toContain(secret);
    }
  });

  it('the instruments are live: a real write shows in the op log, and the request reaches Redis', async () => {
    const user = await account('instruments', { spotify: true });
    mongoose.set('debug', (collection, method) => { ops.push(`${collection}.${method}`); });
    await User.updateOne({ _id: user._id }, { $set: { musicProvider: 'spotify' } });
    mongoose.set('debug', false);
    expect(writesIn(ops)).toEqual(['users.updateOne']);

    await disconnect(user);
    // The auth middleware's denylist read is filtered out of the assertions, so it must be visible here.
    expect(redis.__calls.some(([cmd, key]) => cmd === 'get' && String(key).startsWith('revoked:jti:'))).toBe(true);
  });

  it('the 200 branch logs nothing', async () => {
    const user = await account('quiet', { spotify: true });
    await disconnect(user);
    expect(logged.filter((l) => l.line.includes('[youtube]'))).toEqual([]);
  });
});
