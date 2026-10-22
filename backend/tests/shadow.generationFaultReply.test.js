'use strict';

// BE-070 round 2 (RA-266-1, SEC-266-2, ARCH-266-1 — PRE-EXISTING, S1): a database fault inside a
// generation was an unhandled rejection. `generateAndEmitPlaylist` had try/finally and no catch,
// `request_playlist` and `track_skipped` called it with no catch, `request_heart_playlist` caught it
// but never answered, `resolveHeartContext` read MedicalProfile outside its try (so the async listener
// itself rejected), and the live lane's regime-change chain did not return the recalibration it
// started, so its catch never covered it. Without SENTRY_DSN Node ends the process for every user;
// with Sentry's default OnUnhandledRejection ("warn") the process stays up and the listener who asked
// gets neither playlist_ready nor playlist_error.
//
// Real: the socket.io server the app builds (createSocketServer, with its JWT handshake and user
// room), a socket.io client over a real websocket, a real JWT for a real User with a real consent
// grant, and User, MedicalProfile and BiometricLog on an in-memory MongoDB. Faked: the generation's
// outside dependencies (LLM, Spotify, discovery, Redis), as in socket.payloadDoor.test.js, and ONE
// `User.findById`, or ONE `MedicalProfile.findOne`, that rejects the way a dropped connection does.
// Under Jest an unhandled rejection fails the running test (jest-circus); the recorder below also
// names it in the assertion.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
process.env.JWT_EXPIRES_IN = '1h';
delete process.env.REDIS_URL;

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

const http = require('http');
const { io: Client } = require('socket.io-client');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const MedicalProfile = require('../app/models/MedicalProfile');
const { signToken } = require('../app/utils/jwt');
const { recordConsent, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { createSocketServer } = require('../app/sockets');
const { _resetDebounceState } = require('../app/sockets/biometricHandler');
const { captureException } = require('../app/config/sentry');
const liveState = require('../app/agents/runtime/physiology/liveStateAdapter');

jest.setTimeout(120000);

let mem;
let io;
let port;
let token;
const clients = [];

// Every rejection nobody handled while a case ran. jest-circus fails the case on its own; this names
// the reason in the assertion instead of leaving it to the runner's report.
const unhandled = [];
const recordUnhandled = (reason) => { unhandled.push(reason); };

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_shadow_generation_fault' });

  const user = new User({ ssoProvider: 'google', ssoId: 'sso-generation-fault', email: 'generation-fault@example.com' });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  await user.save();
  await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
  token = signToken({ userId: user._id });

  const httpServer = http.createServer();
  io = createSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = httpServer.address().port;
  process.on('unhandledRejection', recordUnhandled);
});

afterAll(async () => {
  process.off('unhandledRejection', recordUnhandled);
  for (const c of clients) c.close();
  await new Promise((resolve) => io.close(() => resolve()));
  await mongoose.disconnect();
  await mem.stop();
});

let quiet;
beforeEach(() => {
  jest.clearAllMocks();
  unhandled.length = 0;
  quiet = ['warn', 'info', 'log', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  quiet.forEach((s) => s.mockRestore());
  for (const c of clients.splice(0)) c.close();
  _resetDebounceState();
});

function connect() {
  return new Promise((resolve, reject) => {
    const client = Client(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    clients.push(client);
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });
}

// The first of `names` the client receives that `where` accepts. Armed BEFORE the emit it answers.
function nextEvent(client, names, { where = () => true, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const listeners = [];
    const settle = (fn) => {
      clearTimeout(timer);
      for (const [name, fn2] of listeners) client.off(name, fn2);
      fn();
    };
    const timer = setTimeout(
      () => settle(() => reject(new Error(`no ${names.join(' | ')} within ${timeoutMs} ms`))),
      timeoutMs,
    );
    for (const name of names) {
      const onEvent = (payload) => { if (where(payload)) settle(() => resolve({ name, payload })); };
      listeners.push([name, onEvent]);
      client.on(name, onEvent);
    }
  });
}

async function until(check, label, timeoutMs) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// What the app sends on Generate: its intent, then the request, on the SAME socket.
async function generateOn(client, reqId) {
  const ready = nextEvent(client, ['playlist_ready'], { where: (p) => p?.reqId === reqId });
  client.emit('emotion_update', { taps: [{ x: 0.3, y: 0.4 }], textPrompt: 'after the storm', activity: 'running' });
  client.emit('request_playlist', { reqId });
  return (await ready).payload;
}

// What a dropped Atlas connection looks like to a query.
function connectionDropped() {
  return Promise.reject(Object.assign(new Error('connection 7 to 127.0.0.1:27017 closed'), { name: 'MongoNetworkError' }));
}
const aMongoFault = expect.objectContaining({ name: 'MongoNetworkError' });

describe('a database fault inside a generation is answered and reported, never an unhandled rejection (BE-070 round 2, real server)', () => {
  it('request_playlist: a User read that fails answers playlist_error for its reqId, is reported, and the next request on the socket generates', async () => {
    const client = await connect();
    const findById = jest.spyOn(User, 'findById').mockImplementationOnce(connectionDropped);
    const answer = nextEvent(client, ['playlist_error'], { where: (p) => p?.reqId === 41 });

    client.emit('emotion_update', { taps: [{ x: 0.2, y: 0.3 }] });
    client.emit('request_playlist', { reqId: 41 });
    const { payload } = await answer;
    expect(payload.message).toMatch(/try again/i);
    expect(captureException).toHaveBeenCalledWith(aMongoFault, expect.objectContaining({ scope: 'generate.emotion', reqId: 41 }));
    expect(findById).toHaveBeenCalledTimes(1);
    findById.mockRestore();
    expect(unhandled).toEqual([]);

    const ready = await generateOn(client, 42);
    expect(ready.reqId).toBe(42);
    expect(ready.tracks.length).toBeGreaterThan(0);
    expect(client.connected).toBe(true);
  });

  it('request_heart_playlist: a User read that fails answers playlist_error for its reqId, is reported, and the next request generates', async () => {
    const client = await connect();
    const findById = jest.spyOn(User, 'findById').mockImplementationOnce(connectionDropped);
    const answer = nextEvent(client, ['playlist_error'], { where: (p) => p?.reqId === 51 });

    // The phone's own reading is the heart context, so the request reaches the generation.
    client.emit('request_heart_playlist', { reqId: 51, heartRate: 72 });
    const { payload } = await answer;
    expect(payload.message).toMatch(/try again/i);
    expect(captureException).toHaveBeenCalledWith(aMongoFault, expect.objectContaining({ scope: 'generate.heart', reqId: 51 }));
    expect(findById).toHaveBeenCalledTimes(1);
    findById.mockRestore();
    expect(unhandled).toEqual([]);

    const ready = await generateOn(client, 52);
    expect(ready.reqId).toBe(52);
    expect(client.connected).toBe(true);
  });

  it('track_skipped twice (the skip loop): a User read that fails is reported, answers nobody, and the next request generates', async () => {
    const client = await connect();
    const errors = [];
    client.on('playlist_error', (p) => errors.push(p));
    const findById = jest.spyOn(User, 'findById').mockImplementationOnce(connectionDropped);

    client.emit('track_skipped');
    client.emit('track_skipped');
    await until(() => captureException.mock.calls.length > 0, 'the fault reported', 3000);
    expect(captureException).toHaveBeenCalledWith(aMongoFault, expect.objectContaining({ scope: 'generate.skip_loop' }));
    expect(findById).toHaveBeenCalledTimes(1);
    findById.mockRestore();
    expect(unhandled).toEqual([]);

    const ready = await generateOn(client, 61);
    expect(ready.reqId).toBe(61);
    // An automatic trigger has nobody waiting on a reqId: the app keeps what is playing.
    expect(errors).toEqual([]);
    expect(client.connected).toBe(true);
  });

  it('request_heart_playlist: a MedicalProfile read that fails (the resting-HR fallback) answers "no heart-rate data" for its reqId, never a rejection', async () => {
    const client = await connect();
    const findOne = jest.spyOn(MedicalProfile, 'findOne').mockImplementationOnce(connectionDropped);
    const answer = nextEvent(client, ['playlist_error'], { where: (p) => p?.reqId === 71 });

    // No reading anywhere: the resting-HR baseline is the read that fails.
    client.emit('request_heart_playlist', { reqId: 71 });
    const { payload } = await answer;
    expect(payload.message).toMatch(/No heart-rate data yet/);
    expect(findOne).toHaveBeenCalledTimes(1);
    findOne.mockRestore();
    expect(unhandled).toEqual([]);

    const ready = await generateOn(client, 72);
    expect(ready.reqId).toBe(72);
    expect(client.connected).toBe(true);
  });

  it('request_playlist: a MedicalProfile read that fails (the baseline context) still generates, never a rejection', async () => {
    const client = await connect();
    const findOne = jest.spyOn(MedicalProfile, 'findOne').mockImplementationOnce(connectionDropped);

    const ready = await generateOn(client, 81);
    expect(ready.reqId).toBe(81);
    expect(ready.tracks.length).toBeGreaterThan(0);
    expect(findOne).toHaveBeenCalledTimes(1);
    findOne.mockRestore();
    expect(unhandled).toEqual([]);
  });

  it('track_skipped twice: the skip loop reads no MedicalProfile (only the emotion branch does), so a fault there cannot reach it, and it generates', async () => {
    const client = await connect();
    // Armed anyway: a MedicalProfile read added to this branch later would consume it and must still answer.
    const findOne = jest.spyOn(MedicalProfile, 'findOne').mockImplementationOnce(connectionDropped);
    const ready = nextEvent(client, ['playlist_ready'], { where: (p) => p?.trigger === 'skip_loop' });

    client.emit('track_skipped');
    client.emit('track_skipped');
    expect((await ready).payload.tracks.length).toBeGreaterThan(0);
    expect(findOne).not.toHaveBeenCalled();
    findOne.mockRestore();
    expect(unhandled).toEqual([]);
  });

  it('the live lane: a regime change whose cold-key generation hits a User read that fails is reported, never a rejection', async () => {
    const client = await connect();
    const findById = jest.spyOn(User, 'findById').mockImplementationOnce(connectionDropped);
    // The taxonomy posterior confirms a transition on this reading, which the live-mode socket serves.
    liveState.onlineUpdate.mockResolvedValueOnce({ regimeChanged: true });
    const assembling = nextEvent(client, ['live_assembling']);

    client.emit('live_mode', { enabled: true });
    client.emit('biometric_push', {
      source: 'garmin',
      raw: { heartRate: 72, activityType: 'running', startTimeLocal: new Date().toISOString() },
    });
    await assembling; // the cold-key fallback started: its generation is the one that fails
    await until(() => captureException.mock.calls.length > 0, 'the fault reported', 3000);
    expect(captureException).toHaveBeenCalledWith(aMongoFault, expect.objectContaining({ scope: 'generate.biometric' }));
    expect(findById).toHaveBeenCalledTimes(1);
    findById.mockRestore();
    expect(unhandled).toEqual([]);

    const ready = await generateOn(client, 91);
    expect(ready.reqId).toBe(91);
    expect(client.connected).toBe(true);
  });
});
