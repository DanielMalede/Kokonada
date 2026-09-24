'use strict';

// H3a (N1) — REAL-Mongo evidence that a heart request without a current Art.9 grant persists NO
// heart rate. This is the backend's stand-in for device evidence: the consent decision is made by
// the REAL ConsentRecord rows, the REAL consent service and the REAL gate helper, and the outcome is
// read back from the REAL PlaylistSession document (whose heartRate is encrypted at rest and
// decrypted by its getter) — not from a mock that was told what to return.
//
// Only the generation's outside dependencies are mocked, exactly as in
// biometricHandler.pipeline.test.js (the LLM, Spotify, discovery, the ledger and buffer stores,
// Redis-backed caches, Sentry), so a playlist can be built without the network.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/config/redis', () => ({ getRedis: () => null, connectRedis: jest.fn(), createConnection: jest.fn() }));
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
  buildEmotionPlaylist: jest.fn(async () => ({ params: { target_bpm: 110 }, tracks: [] })),
  adjustBiometricPlaylist: jest.fn(async () => ({ params: { target_bpm: 110 }, tracks: [] })),
}));
jest.mock('../app/services/playlistMixer', () => ({ personalizeWhitelist: jest.fn((t) => t) }));
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({})) }));
jest.mock('../app/services/generation/orchestrator', () => ({
  generateV2: jest.fn(async () => ({
    familiar: [{ id: 'lib-1', name: 'Familiar 1' }],
    discovery: [],
    merged: [{ id: 'lib-1', name: 'Familiar 1' }],
    targets: { bpmCenter: 110 },
  })),
  buildTargets: jest.fn(async () => ({ bpmCenter: 110 })),
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

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const ConsentRecord = require('../app/models/ConsentRecord');
const PlaylistSession = require('../app/models/PlaylistSession');
const { recordConsent, HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION } = require('../app/services/privacy/consent');
const { registerBiometricHandler, _resetDebounceState } = require('../app/sockets/biometricHandler');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_heart_consent_gate_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), BiometricLog.deleteMany({}), ConsentRecord.deleteMany({}), PlaylistSession.deleteMany({})]);
});
afterEach(() => { _resetDebounceState(); });

let warnSpy;
beforeEach(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

async function newSpotifyUser(tag) {
  const user = new User({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  await user.save();
  return user;
}

function makeSocket(user) {
  const handlers = {};
  return {
    id: `sock-${user._id}`,
    data: { user: { _id: user._id } },
    emit: jest.fn(),
    on: (event, fn) => { handlers[event] = fn; },
    _trigger: (event, payload) => handlers[event]?.(payload),
  };
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

// Fire "Listen to your heart" with the phone's 88 bpm and return the session the server persisted.
async function listenToYourHeart(user) {
  const socket = makeSocket(user);
  registerBiometricHandler(socket);
  socket._trigger('request_heart_playlist', { mode: 'live', reqId: 7, heartRate: 88 });
  const ready = await until(() => socket.emit.mock.calls.find(([e]) => e === 'playlist_ready'), 'playlist_ready');
  const session = await until(() => PlaylistSession.findOne({ userId: user._id }), 'the PlaylistSession write');
  return { ready: ready[1], session, socket };
}

describe('request_heart_playlist — what is persisted, per the REAL consent rows (N1)', () => {
  it('no ConsentRecord: {heartRate:88} persists a session whose decrypted heartRate is null, and no BiometricLog row', async () => {
    const user = await newSpotifyUser('never-consented');
    const { ready, session, socket } = await listenToYourHeart(user);

    expect(ready).toEqual(expect.objectContaining({ trigger: 'heart', reqId: 7 }));
    expect(session.biometricSnapshot.heartRate).toBeNull();
    expect(await BiometricLog.countDocuments({ userId: user._id })).toBe(0);
    expect(socket.emit.mock.calls.filter(([e]) => e === 'playlist_error')).toHaveLength(0);
  });

  it('a withdrawn latest row: the same — nothing of the 88 bpm is kept', async () => {
    const user = await newSpotifyUser('withdrew');
    await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
    await ConsentRecord.create({
      userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION,
      status: 'withdrawn', withdrawnAt: new Date(Date.now() + 1000),
    });
    const { session } = await listenToYourHeart(user);

    expect(session.biometricSnapshot.heartRate).toBeNull();
    expect(await BiometricLog.countDocuments({ userId: user._id })).toBe(0);
  });

  it('control — a current grant: the same request persists 88 (so the fakes above are live)', async () => {
    const user = await newSpotifyUser('consented');
    await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
    const { session } = await listenToYourHeart(user);

    expect(session.biometricSnapshot.heartRate).toBe(88);
  });
});
