'use strict';

// H3b (DT-S6 W-A) — REAL-Mongo evidence that a consent withdrawal reaches a socket that is still
// OPEN. Before H3b the withdrawal stopped at the database: the live socket kept its last heart rate
// in memory and the listener's next MOOD generation wrote it into PlaylistSession.biometricSnapshot
// — health data persisted after the user withdrew.
//
// Real: the consent router behind the real auth middleware (a real JWT for a real User), the real
// withdrawConsent with its erasure cascade, the real ConsentRecord / BiometricLog / PlaylistSession
// documents, and the real biometric socket handler holding the state. Faked: the socket.io server
// (a stateful stand-in whose user room lists the sockets registered for that user) and the
// generation's outside dependencies, as in biometricHandler.pipeline.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
// J1 (BE-074): a withdrawal with a grant on file purges the job queue when REDIS_URL is set. This suite
// has no Redis (config/redis is mocked below), so it runs without one even if the shell exports it.
delete process.env.REDIS_URL;

jest.mock('../app/config/redis', () => ({ getRedis: () => null, connectRedis: jest.fn(), createConnection: jest.fn() }));

// The live socket server: sockets register themselves; the user room lists them.
const mockLive = [];
jest.mock('../app/sockets/index', () => ({
  getIo: () => ({
    in: (room) => ({
      fetchSockets: async () => mockLive.filter((s) => `user:${s.data.user._id}` === room).map((s) => ({ id: s.id })),
    }),
  }),
}));

jest.mock('../app/models/MusicProfile', () => ({
  findOne: jest.fn(() => {
    const profile = {
      topGenres: ['pop'], genreSet: ['pop'], knownArtistIds: ['artist-a'],
      library: [{ id: 'lib-1', provider: 'spotify', genres: ['pop'], artist: 'Artist A' }],
    };
    const q = Promise.resolve(profile);
    q.lean = () => Promise.resolve(profile);
    return q;
  }),
}));
jest.mock('../app/services/spotify', () => ({
  getValidToken: jest.fn(async () => 'spotify-access-token'),
  fetchVibeDiscovery: jest.fn(async () => []),
  getArtistsGenres: jest.fn(async () => ({})),
  artistGenresAvailable: jest.fn(() => true),
  markDiscoveryUnavailable: jest.fn(),
}));
jest.mock('../app/services/youtube', () => ({ getValidToken: jest.fn() }));
jest.mock('../app/services/geminiEngine', () => ({
  buildEmotionPlaylist: jest.fn(async () => ({ params: { target_bpm: 100 }, tracks: [] })),
  adjustBiometricPlaylist: jest.fn(async () => ({ params: { target_bpm: 100 }, tracks: [] })),
}));
jest.mock('../app/services/playlistMixer', () => ({ personalizeWhitelist: jest.fn((t) => t) }));
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({})) }));
jest.mock('../app/services/generation/orchestrator', () => ({
  generateV2: jest.fn(async () => ({
    familiar: [{ id: 'lib-1', name: 'Familiar 1' }],
    discovery: [],
    merged: [{ id: 'lib-1', name: 'Familiar 1' }],
    targets: { bpmCenter: 100 },
  })),
  buildTargets: jest.fn(async () => ({ bpmCenter: 100 })),
}));
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn(async () => null) }));
jest.mock('../app/repositories/sleepHistoryRepo', () => ({ readNightHistory: jest.fn(async () => []) }));
jest.mock('../app/services/discovery/discoveryFetch', () => ({ vectorDiscoveryFetch: jest.fn(async () => []) }));
jest.mock('../app/services/discovery/captionService', () => ({ captionDiscovery: jest.fn(async () => new Map()) }));
jest.mock('../app/services/ledger/serveLedger', () => ({ recordServes: jest.fn(async () => ({ recorded: 0 })) }));
jest.mock('../app/repositories/shadowBufferRepo', () => ({
  getBuffer: jest.fn(async () => null),
  setBuffer: jest.fn(async () => true),
}));
jest.mock('../app/agents/runtime/physiology/liveStateAdapter', () => ({ onlineUpdate: jest.fn(async () => ({ regimeChanged: false })) }));
jest.mock('../app/config/sentry', () => ({ captureException: jest.fn(), initSentry: jest.fn() }));
jest.mock('../app/services/crossPlatform', () => ({
  ...jest.requireActual('../app/services/crossPlatform'),
  translateToSpotify: jest.fn(async (tracks) => ({ tracks, translated: 0, missed: 0 })),
}));
jest.mock('../app/services/spotifySessionPlaylist', () => ({
  writeSessionPlaylist: jest.fn(async () => { throw new Error('no Spotify in tests'); }),
}));

const express = require('express');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const ConsentRecord = require('../app/models/ConsentRecord');
const PlaylistSession = require('../app/models/PlaylistSession');
const { signToken } = require('../app/utils/jwt');
const { recordConsent, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { registerBiometricHandler, _resetDebounceState } = require('../app/sockets/biometricHandler');
const consentRouter = require('../app/routes/consent');

jest.setTimeout(120000);

const app = express();
app.use(express.json());
app.use('/api/consent', consentRouter);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_withdrawal_live_state_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  mockLive.length = 0;
  await Promise.all([User.deleteMany({}), BiometricLog.deleteMany({}), ConsentRecord.deleteMany({}), PlaylistSession.deleteMany({})]);
});
afterEach(() => { _resetDebounceState(); });

let quiet;
beforeEach(() => { quiet = ['warn', 'info', 'log'].map((m) => jest.spyOn(console, m).mockImplementation(() => {})); });
afterEach(() => { quiet.forEach((s) => s.mockRestore()); });

async function consentingListener(tag) {
  const user = new User({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  await user.save();
  await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
  return user;
}

// An open app socket that has streamed one live reading: it now HOLDS a confirmed heart rate.
async function openSocketHolding(user, heartRate) {
  const handlers = {};
  const socket = {
    id: `sock-${user._id}`,
    data: { user: { _id: user._id } },
    emit: jest.fn(),
    on: (event, fn) => { handlers[event] = fn; },
    _trigger: (event, payload) => handlers[event]?.(payload),
  };
  registerBiometricHandler(socket);
  mockLive.push(socket);
  await socket._trigger('biometric_push', {
    source: 'garmin',
    raw: { heartRate, activityType: 0, startTimeLocal: new Date(Date.now() - 60_000).toISOString() },
  });
  return socket;
}

async function until(check, label, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// The listener's next MOOD request on the same, still-open socket; returns what was persisted.
async function nextMoodGeneration(socket, user) {
  socket._trigger('emotion_update', { taps: [{ x: 0.3, y: 0.4 }], textPrompt: '', activity: null, mode: 'live' });
  socket._trigger('request_playlist', { mode: 'live', reqId: 9 });
  await until(() => socket.emit.mock.calls.find(([e]) => e === 'playlist_ready'), 'playlist_ready');
  return until(() => PlaylistSession.findOne({ userId: user._id }), 'the PlaylistSession write');
}

describe('consent withdrawal reaches the still-open socket (H3b, real Mongo)', () => {
  it('after withdrawal, the next mood generation on the still-open socket persists no heart rate', async () => {
    const user = await consentingListener('withdraws');
    const socket = await openSocketHolding(user, 131);

    const res = await request(app)
      .post('/api/consent/withdraw')
      .set('Authorization', `Bearer ${signToken({ userId: String(user._id) })}`)
      .send({ purpose: HEALTH_CONSENT_PURPOSE });
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);

    const session = await nextMoodGeneration(socket, user);
    expect(session.biometricSnapshot.heartRate).toBeNull();
    expect(session.biometricSnapshot.activity).toBeNull();
    expect(await BiometricLog.countDocuments({ userId: user._id })).toBe(0); // the erasure ran too
  });

  it('control — without a withdrawal the same socket records the held heart rate (the fakes are live)', async () => {
    const user = await consentingListener('stays');
    const socket = await openSocketHolding(user, 131);

    const session = await nextMoodGeneration(socket, user);
    expect(session.biometricSnapshot.heartRate).toBe(131);
  });
});
