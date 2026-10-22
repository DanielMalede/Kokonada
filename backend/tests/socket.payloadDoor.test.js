'use strict';

// BE-070 (HIGH) — one packet from any signed-in client could stop the backend for every user.
//
// socket.io calls each listener inside process.nextTick with no try/catch (socket.io's
// Socket#dispatch), and backend/app registers no handler of its own: without SENTRY_DSN Node ends the
// process on a throw and on an unhandled rejection; with it, Sentry's defaults still exit on a
// synchronous throw and only log a rejection, so the listener gets no answer. Five doors destructured
// the client's payload with a `= {}` default, which only covers a payload that is ABSENT: `null`
// threw at the destructure, `{taps:null}` threw at `taps.length`, and the two async doors
// (biometric_push, request_heart_playlist) turned the same throw into an unhandled rejection. A field
// that a log line interpolates threw the same way when it was an object whose own
// `toString` is not a function: `{"toString":1}` is valid JSON, and interpolating it throws
// "Cannot convert object to primitive value".
//
// Real: the socket.io server the app builds (createSocketServer, with its JWT handshake, expiry
// middleware and user room), a socket.io client over a real websocket, a real JWT for a real User
// with a real consent grant, and the documents on an in-memory MongoDB. Faked: the generation's
// outside dependencies (LLM, Spotify, discovery, Redis), as in
// emotionUpdateRetiredActivity.integration.test.js. Under Jest an uncaught exception or an unhandled
// rejection fails the running test (jest-circus installs the process handlers), which is where the
// production exit shows up here.

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
// The serve ledger is REAL (ServeEvent rows on the in-memory MongoDB): the shape cases below read back
// what a generation wrote into sessionId.
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
const ServeEvent = require('../app/models/ServeEvent');
const { signToken } = require('../app/utils/jwt');
const { recordConsent, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { createSocketServer } = require('../app/sockets');
const { _debounceMap, _resetDebounceState } = require('../app/sockets/biometricHandler');

jest.setTimeout(120000);

let mem;
let io;
let port;
let token;
let userId;
const clients = [];

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_socket_payload_door' });

  // A real listener: Spotify connected, and a current Art.9 grant, so both async doors get past the
  // consent gate and answer, instead of stopping silently in front of it.
  const user = new User({ ssoProvider: 'google', ssoId: 'sso-payload-door', email: 'payload-door@example.com' });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  await user.save();
  userId = user._id;
  await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
  token = signToken({ userId: user._id });

  const httpServer = http.createServer();
  io = createSocketServer(httpServer);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  for (const c of clients) c.close();
  // io.close() closes the http server too.
  await new Promise((resolve) => io.close(() => resolve()));
  await mongoose.disconnect();
  await mem.stop();
});

let quiet;
beforeEach(() => { quiet = ['warn', 'info', 'log'].map((m) => jest.spyOn(console, m).mockImplementation(() => {})); });
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

let nextReqId = 1000;

describe('every socket door survives a payload the client controls (BE-070, real server)', () => {
  // The third column is the door's own answer. The two async doors answer only after their database
  // reads, so the test waits for that answer: a throw that came later would fail whichever test
  // happened to be running, not this one.
  it.each([
    ['emotion_update', null, null],
    ['emotion_update', { taps: null }, null],
    ['live_mode', null, null],
    ['request_playlist', null, null], // its answer is the generation the follow-up below joins
    ['biometric_push', null, 'connection_error'],
    ['request_heart_playlist', null, 'playlist_error'],
    // An object field a log line interpolates: its own `toString` is a number, not a function.
    ['emotion_update', { taps: { length: { toString: 1 } } }, null],
    ['emotion_update', { mode: { toString: 1 } }, null],
    ['request_playlist', { reqId: { toString: 1 } }, null],
    ['request_playlist', { mode: [{ toString: 1 }] }, null],
    ['request_heart_playlist', { reqId: { toString: 1 } }, 'playlist_error'],
  ])('%s with %j: the process stays up and the same socket still gets playlist_ready', async (event, payload, answer) => {
    const client = await connect();
    const doorAnswer = answer ? nextEvent(client, [answer]) : null;
    client.emit(event, payload);
    if (doorAnswer) await doorAnswer;

    const reqId = (nextReqId += 1);
    const ready = await generateOn(client, reqId);

    expect(ready.reqId).toBe(reqId);
    expect(ready.tracks.length).toBeGreaterThan(0);
    expect(client.connected).toBe(true);
    // What the socket holds afterwards is the normalized shape, whatever arrived.
    const held = _debounceMap.get(client.id);
    expect(held.lastReqId).toBe(reqId);
    expect(typeof held.lastMode).toBe('string');
    expect(held.lastEmotionTaps).toEqual([{ x: 0.3, y: 0.4 }]);
    expect(held.lastTextPrompt).toBe('after the storm');
  });

  it('every null door on ONE socket, each answered or normalized, then a real request on it gets playlist_ready', async () => {
    const client = await connect();

    // One socket's events are dispatched in order, so the answer to biometric_push also proves the
    // three before it ran.
    const pushAnswer = nextEvent(client, ['connection_error']);
    client.emit('emotion_update', null);
    client.emit('emotion_update', { taps: null });
    client.emit('live_mode', null);
    client.emit('biometric_push', null);
    expect((await pushAnswer).payload.message).toMatch(/Unknown wearable source/);

    const held = _debounceMap.get(client.id);
    expect(held.lastEmotionTaps).toEqual([]);
    expect(held.lastTextPrompt).toBe('');
    expect(held.lastActivity).toBeNull();
    expect(held.liveMode).toBe(false);

    // A heart request with no heart rate anywhere answers with an error, not silence.
    const heartAnswer = nextEvent(client, ['playlist_error']);
    client.emit('request_heart_playlist', null);
    expect((await heartAnswer).payload.message).toMatch(/No heart-rate data yet/);

    // A null request is a request with no fields: it generates, and answers.
    const nullAnswer = nextEvent(client, ['playlist_ready', 'playlist_error', 'playlist_building']);
    client.emit('request_playlist', null);
    expect((await nullAnswer).name).toBe('playlist_ready');

    const reqId = (nextReqId += 1);
    const ready = await generateOn(client, reqId);
    expect(ready.reqId).toBe(reqId);
    expect(ready.tracks.length).toBeGreaterThan(0);
    expect(client.connected).toBe(true);
  });
});

// BE-070 round 2 (SEC-266-1, ARCH-266-3): reqId and mode were kept as ANY non-object, so a string reqId up
// to socket.io's 1 MB packet limit was printed by the always-on `[gen]` lines (a "\n" inside it forges a
// log line, the [biometric-access] accountability line included), echoed on playlist_ready, and written
// into ServeEvent.sessionId on every served track, about fifty rows per request kept thirty days. The app
// sends a non-negative integer counter and never sends mode (socketClient.ts). The door now keeps reqId
// only as a non-negative safe integer and mode only as 'live' or 'export'; anything else counts as not sent.
const ONE_MB = 1_000_000;             // engine.io's default maxHttpBufferSize: the most a client can send
const BIG = 'r'.repeat(ONE_MB - 256); // the packet's framing takes the rest
const FORGED = '7\n[biometric-access] user=someone-else purpose=forged';

describe("a reqId or mode outside the app's shape counts as not sent (BE-070 round 2, real server)", () => {
  const consoleLines = () => quiet.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(' ')));
  const rowsSince = (since) => until(async () => {
    const rows = await ServeEvent.find({ userId, servedAt: { $gte: since } }).lean();
    return rows.length > 0 ? rows : null;
  }, 'the serve ledger row of the door\'s own generation', 5000);

  // The fourth column is what a log line or a stored row would carry if the value got through.
  it.each([
    ['request_playlist', 'a reqId just under the 1 MB packet limit', { reqId: BIG }, BIG.slice(0, 64)],
    ['request_playlist', 'a reqId that forges a log line', { reqId: FORGED }, '[biometric-access]'],
    ['request_playlist', 'a boolean reqId', { reqId: true }, 'reqId=true'],
    ['request_playlist', 'a negative reqId', { reqId: -1 }, 'reqId=-1'],
    ['request_playlist', 'a mode just under the 1 MB packet limit', { mode: BIG }, BIG.slice(0, 64)],
    ['emotion_update', "a mode of '__proto__'", { taps: [{ x: 0.3, y: 0.4 }], mode: '__proto__' }, '__proto__'],
  ])('%s with %s: not held, not logged, not echoed, not written, and the socket still generates', async (event, _label, payload, needle) => {
    const client = await connect();
    const since = new Date();
    const doorReady = nextEvent(client, ['playlist_ready']);
    if (event === 'request_playlist') client.emit('emotion_update', { taps: [{ x: 0.3, y: 0.4 }] });
    client.emit(event, payload);
    if (event === 'emotion_update') client.emit('request_playlist', {});
    const reply = (await doorReady).payload;

    // Not echoed: the reply carries no reqId (none was sent) and the default mode.
    expect(reply.reqId).toBeUndefined();
    expect(reply.mode).toBe('live');
    // Not held.
    const held = _debounceMap.get(client.id);
    expect(held.lastReqId).toBeUndefined();
    expect(held.lastMode).toBe('live');
    // Not logged: no always-on line carries the value (an 80-character prefix names an offender).
    expect(consoleLines().filter((l) => l.includes(needle)).map((l) => l.slice(0, 80))).toEqual([]);
    // Not written: every row of the door's own generation has an empty sessionId.
    const rows = await rowsSince(since);
    expect(rows.map((r) => (r.sessionId ?? '').slice(0, 80))).toEqual(rows.map(() => ''));

    const reqId = (nextReqId += 1);
    const ready = await generateOn(client, reqId);
    expect(ready.reqId).toBe(reqId);
    expect(client.connected).toBe(true);
  });

  it.each([0, 7, Number.MAX_SAFE_INTEGER])("the app's integer reqId %s comes back on playlist_ready and reaches the ledger", async (reqId) => {
    const client = await connect();
    const since = new Date();
    const ready = await generateOn(client, reqId);
    expect(ready.reqId).toBe(reqId);
    expect(_debounceMap.get(client.id).lastReqId).toBe(reqId);
    const rows = await rowsSince(since);
    expect(rows.map((r) => r.sessionId)).toEqual(rows.map(() => String(reqId)));
  });
});
