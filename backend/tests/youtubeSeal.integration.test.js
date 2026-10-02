'use strict';

// HX-3 T2 (DEC-122) — YouTube connect and callback are sealed in code, proven with the REAL seal module
// through the REAL assembled app (supertest), the REAL auth middleware, the REAL controller, the REAL
// youtube service (observed, never replaced) and a REAL User document in MongoDB (mongodb-memory-server).
//
// Every YouTube variable a deploy could carry is SET below, the Google fallback included, so the
// service reports itself configured. Before DEC-122 that was enough to connect: youtube.js falls back
// to GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, which production sets for sign-in. The refusals here can
// therefore only come from the seal — never from a missing variable, which answers
// `youtube_unconfigured` instead. This is the CI half of DAN-046 P2's production probe.
//
// The sealed answer is a constant deep link, `kokonada://integrations?error=youtube_unavailable`, and
// nothing behind it runs: no PKCE, no auth URL, no code exchange, no channel read, no token stored, no
// save, no profile build, no network call. An unreadable state still gets BE-001's logged 400.
//
// Replaced, because they have no bearing on the seal: the db connector, the background workers,
// Sentry, and Redis (a small stateful key store, so the jti denylist really runs).

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
// Every lever. None may open the seal.
process.env.YOUTUBE_CLIENT_ID = 'yt-client-id';
process.env.YOUTUBE_CLIENT_SECRET = 'yt-client-secret';
process.env.YOUTUBE_REDIRECT_URI = 'https://api.example.test/api/integrations/youtube/callback';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
process.env.YOUTUBE_ENABLED = 'true';
process.env.YOUTUBE_CONNECT_ENABLED = 'true';
process.env.YOUTUBE_EGRESS_ENABLED = 'true';
process.env.YOUTUBE_SPOTIFY_TRANSLATION_ENABLED = 'true';

jest.mock('../app/config/db', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../app/workers', () => ({ startInProcessWorkers: jest.fn(() => []) }));
jest.mock('../app/config/sentry', () => ({
  initSentry: jest.fn(),
  captureException: jest.fn(),
  sentryErrorHandler: (err, req, res, next) => next(err),
}));
jest.mock('../app/config/redis', () => {
  const keys = new Map();
  const fake = {
    __keys: keys,
    get: async (k) => (keys.has(k) ? keys.get(k) : null),
    set: async (k, v) => { keys.set(k, v); return 'OK'; },
    del: async (...ks) => ks.flat().reduce((n, k) => n + (keys.delete(k) ? 1 : 0), 0),
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});
// Observed, not replaced: the real buildProfile runs if anything ever calls it.
jest.mock('../app/services/musicProfileService', () => {
  const actual = jest.requireActual('../app/services/musicProfileService');
  return { ...actual, buildProfile: jest.fn(actual.buildProfile) };
});

const request = require('supertest');
const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { app } = require('../app/index');
const User = require('../app/models/User');
const youtube = require('../app/services/youtube');
const musicProfileService = require('../app/services/musicProfileService');
const { signToken, signConnectToken, signOauthState } = require('../app/utils/jwt');
const { __fake: redis } = require('../app/config/redis');
const seal = require('../app/config/youtubeSeal');

jest.setTimeout(120000);

const SEALED = 'kokonada://integrations?error=youtube_unavailable';
const SEAL_LINE = '[youtube] connect refused: sealed';

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_youtube_seal_it' });
  await User.init();
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let logged;
let network;
let spies;
beforeEach(async () => {
  await User.deleteMany({});
  redis.__keys.clear();
  logged = [];
  network = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push({ level, line: args.map(String).join(' ') }); });
  }
  for (const verb of ['get', 'post', 'put', 'delete', 'request']) {
    jest.spyOn(axios, verb).mockImplementation(async (...args) => { network.push([verb, String(args[0]?.url ?? args[0])]); throw new Error('no network in tests'); });
  }
  // Pass-through spies on the real service and the real document methods.
  spies = {
    generatePKCE: jest.spyOn(youtube, 'generatePKCE'),
    getAuthUrl:   jest.spyOn(youtube, 'getAuthUrl'),
    exchangeCode: jest.spyOn(youtube, 'exchangeCode'),
    getChannel:   jest.spyOn(youtube, 'getChannel'),
    setToken:     jest.spyOn(User.prototype, 'setToken'),
    save:         jest.spyOn(User.prototype, 'save'),
  };
  musicProfileService.buildProfile.mockClear();
});
afterEach(() => jest.restoreAllMocks());

const newUser = async (tag) => {
  const user = await User.create({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com`, musicProvider: 'spotify' });
  spies.save.mockClear(); // the fixture's own save is not the handler's
  return user;
};
const bearer = (user) => `Bearer ${signToken({ userId: String(user._id) })}`;
const rawUser = (id) => mongoose.connection.db.collection('users').findOne({ _id: id });

function expectNothingBehindTheSeal() {
  expect(spies.generatePKCE).not.toHaveBeenCalled();
  expect(spies.getAuthUrl).not.toHaveBeenCalled();
  expect(spies.exchangeCode).not.toHaveBeenCalled();
  expect(spies.getChannel).not.toHaveBeenCalled();
  expect(spies.setToken).not.toHaveBeenCalled();
  expect(spies.save).not.toHaveBeenCalled();
  expect(musicProfileService.buildProfile).not.toHaveBeenCalled();
  expect(network).toEqual([]);
}
const sealLines = () => logged.filter((l) => l.line.includes(SEAL_LINE));

describe('YouTube connect and callback are sealed in code (HX-3 T2, DEC-122)', () => {
  it('runs against the REAL seal, with every YouTube variable set and the service reporting itself configured', () => {
    expect(seal).toEqual({ YOUTUBE_CONNECT_ENABLED: false, YOUTUBE_EGRESS_ENABLED: false });
    expect(jest.isMockFunction(youtube.isConfigured)).toBe(false);
    expect(youtube.isConfigured()).toBe(true); // so a refusal below is the seal, not youtube_unconfigured
  });

  describe('GET /api/integrations/youtube/connect', () => {
    it('?returnTo=app with a session Bearer → 302 to exactly the sealed deep link (the DAN-046 P2 probe)', async () => {
      const user = await newUser('probe');
      const res = await request(app).get('/api/integrations/youtube/connect?returnTo=app').set('Authorization', bearer(user));

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(SEALED);
      expectNothingBehindTheSeal();
      expect(sealLines()).toEqual([{ level: 'warn', line: SEAL_LINE }]);
    });

    it('a web-style connect (no returnTo) gets the same sealed deep link', async () => {
      const user = await newUser('web');
      const res = await request(app).get('/api/integrations/youtube/connect').set('Authorization', bearer(user));

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(SEALED);
      expectNothingBehindTheSeal();
    });

    it('the single-use ?ct= connect-token navigation is sealed the same way', async () => {
      const user = await newUser('ct');
      const res = await request(app).get(`/api/integrations/youtube/connect?ct=${signConnectToken(String(user._id))}&returnTo=app`);

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(SEALED);
      expectNothingBehindTheSeal();
    });

    it('logs no user id and no token', async () => {
      const user = await newUser('quiet');
      const auth = bearer(user);
      await request(app).get('/api/integrations/youtube/connect?returnTo=app').set('Authorization', auth);
      for (const { line } of logged) {
        expect(line).not.toContain(String(user._id));
        expect(line).not.toContain(auth.slice(7));
      }
    });
  });

  describe('GET /api/integrations/youtube/callback (public)', () => {
    it('a validly signed YouTube state with a code → the sealed deep link; no exchange, no token, no save, no build', async () => {
      const user = await newUser('callback');
      const before = await rawUser(user._id);
      const state = signOauthState(String(user._id), 'youtube', { cv: 'pkce-verifier', returnTo: 'app' });
      const res = await request(app).get('/api/integrations/youtube/callback').query({ code: 'google-auth-code', state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(SEALED);
      expectNothingBehindTheSeal();
      const after = await rawUser(user._id);
      expect(after).toEqual(before);                 // nothing stored on the account
      expect(after.youtubeMusicToken ?? null).toBeNull();
      expect(after.musicProvider).toBe('spotify');
      expect(sealLines()).toEqual([{ level: 'warn', line: SEAL_LINE }]);
    });

    it('a web-style state (no returnTo) lands on the same sealed deep link', async () => {
      const user = await newUser('callback-web');
      const state = signOauthState(String(user._id), 'youtube', { cv: 'pkce-verifier' });
      const res = await request(app).get('/api/integrations/youtube/callback').query({ code: 'c', state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(SEALED);
      expectNothingBehindTheSeal();
    });

    it('the seal answers before a provider error is read: error=access_denied still gets youtube_unavailable', async () => {
      const user = await newUser('denied');
      const state = signOauthState(String(user._id), 'youtube', { cv: 'v', returnTo: 'app' });
      const res = await request(app).get('/api/integrations/youtube/callback').query({ error: 'access_denied', state });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(SEALED);
      expectNothingBehindTheSeal();
    });

    it('a tampered state still gets BE-001\'s logged 400 and no destination', async () => {
      const res = await request(app).get('/api/integrations/youtube/callback').query({ code: 'c', state: 'not-a-valid-jwt' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'oauth_state_unreadable' });
      expect(res.headers.location).toBeUndefined();
      expectNothingBehindTheSeal();
      expect(logged.some((l) => l.line.startsWith('[oauth] unroutable callback'))).toBe(true);
    });

    it('a missing state gets the same 400', async () => {
      const res = await request(app).get('/api/integrations/youtube/callback').query({ code: 'c' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'oauth_state_unreadable' });
      expectNothingBehindTheSeal();
    });
  });
});
