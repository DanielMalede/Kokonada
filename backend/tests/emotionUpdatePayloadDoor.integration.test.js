'use strict';

// BE-070 (MEDIUM) — REAL-Mongo evidence that emotion_update keeps only what the session row can store.
//
// The handler held the client's taps and prompt exactly as sent. The PlaylistSession schema stores 1 to
// 3 taps, each with a numeric x and y in [-1, 1] (models/PlaylistSession.js), so four taps, or one
// malformed tap, failed the write: the row was dropped and the moment never reached History. The
// prompt had no server-side type or length bound, so it reached the stored row as sent (the raw text
// never reaches an LLM: geminiEngine's extractIntent reduces it to closed-vocabulary tags first).
//
// The door now keeps what the app's own cold lane keeps (emotionSlice.ts sanitizeTaps): taps whose x
// and y are finite numbers, the LAST three of them, rebuilt as {x, y}; and a string prompt cut to the
// app's 500-character cap (promptSanitizer.ts MAX_PROMPT_LENGTH), anything else being no prompt. A tap
// outside [-1, 1] is DROPPED, not clamped: the app clamps every tap to the unit disc before it sends it
// (laneCommit.ts clampToDisc), so such a tap is malformed rather than imprecise, and clamping it would
// store, and generate from, the strongest feeling on that axis, one the listener never chose.
//
// Real: the biometric socket handler, the User and PlaylistSession documents on an in-memory MongoDB, and
// the whole emotion generation path through to the persisted session. Faked: the socket.io socket (a
// stateful stand-in) and the generation's outside dependencies, as in
// emotionUpdateRetiredActivity.integration.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/config/redis', () => ({ getRedis: () => null, connectRedis: jest.fn(), createConnection: jest.fn() }));
jest.mock('../app/sockets/index', () => ({
  getIo: () => ({ in: () => ({ fetchSockets: async () => [] }) }),
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

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const PlaylistSession = require('../app/models/PlaylistSession');
const { buildEmotionPlaylist, adjustBiometricPlaylist } = require('../app/services/geminiEngine');
const { registerBiometricHandler, _resetDebounceState, _debounceMap } = require('../app/sockets/biometricHandler');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_emotion_payload_door_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  jest.clearAllMocks();
  await Promise.all([User.deleteMany({}), PlaylistSession.deleteMany({})]);
});
afterEach(() => { _resetDebounceState(); });

let quiet;
beforeEach(() => { quiet = ['warn', 'info', 'log'].map((m) => jest.spyOn(console, m).mockImplementation(() => {})); });
afterEach(() => { quiet.forEach((s) => s.mockRestore()); });

let seq = 0;
async function listener() {
  seq += 1;
  const user = new User({ ssoProvider: 'google', ssoId: `sso-door-${seq}`, email: `door-${seq}@example.com` });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  await user.save();
  return user;
}

function openSocket(user) {
  const handlers = {};
  const socket = {
    id: `sock-${user._id}`,
    data: { user: { _id: user._id } },
    emit: jest.fn(),
    on: (event, fn) => { handlers[event] = fn; },
    _trigger: (event, payload) => handlers[event]?.(payload),
  };
  registerBiometricHandler(socket);
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

const plainTaps = (taps) => taps.map(({ x, y }) => ({ x, y }));

// What a client sends before Generate: its intent, then the request. Returns what the socket held,
// the session row written for this moment, and what the model was asked.
async function generationAfter(intent) {
  const user = await listener();
  const socket = openSocket(user);
  socket._trigger('emotion_update', { mode: 'manual', ...intent });
  const held = _debounceMap.get(socket.id);
  const heldTaps = held.lastEmotionTaps;
  const heldPrompt = held.lastTextPrompt;
  socket._trigger('request_playlist', { mode: 'manual', reqId: 7 });
  await until(() => socket.emit.mock.calls.find(([e]) => e === 'playlist_ready'), 'playlist_ready');
  const session = await until(() => PlaylistSession.findOne({ userId: user._id }), 'the PlaylistSession write');
  const asked = buildEmotionPlaylist.mock.calls.at(-1)?.[0];
  return { heldTaps, heldPrompt, session, asked };
}

const A = { x: 0.1, y: 0.2 };
const B = { x: -0.5, y: 0.5 };
const C = { x: 0.4, y: -0.6 };
const D = { x: 0.7, y: 0.3 };

describe('emotion_update keeps at most three valid taps, and the moment is written (BE-070, real Mongo)', () => {
  it('four taps: the LAST three are held, asked and stored, in order', async () => {
    const { heldTaps, session, asked } = await generationAfter({ taps: [A, B, C, D] });
    expect(heldTaps).toEqual([B, C, D]);
    expect(asked.emotionTaps).toEqual([B, C, D]);
    expect(plainTaps(session.emotionTaps)).toEqual([B, C, D]);
  });

  it.each([
    ['a string coordinate', { x: '0.5', y: 0.1 }],
    ['null', null],
    ['a bare number', 0.4],
    ['a string', '0.3,0.3'],
    ['an array', [0.3, 0.3]],
    ['missing y', { x: 0.3 }],
    ['NaN', { x: Number.NaN, y: 0.2 }],
    ['Infinity', { x: Number.POSITIVE_INFINITY, y: 0.2 }],
    ['-Infinity', { x: 0.2, y: Number.NEGATIVE_INFINITY }],
    ['x above 1', { x: 1.5, y: 0 }],
    ['y below -1', { x: 0, y: -1.01 }],
  ])('a tap that is %s is dropped, and the valid taps around it are stored', async (_label, bad) => {
    const { heldTaps, session, asked } = await generationAfter({ taps: [A, bad, B] });
    expect(heldTaps).toEqual([A, B]);
    expect(asked.emotionTaps).toEqual([A, B]);
    expect(plainTaps(session.emotionTaps)).toEqual([A, B]);
  });

  it('control: the edges of the circumplex are taps too, x and y of exactly 1 and -1 are kept', async () => {
    const edges = [{ x: 1, y: -1 }, { x: -1, y: 1 }];
    const { heldTaps, session } = await generationAfter({ taps: edges });
    expect(heldTaps).toEqual(edges);
    expect(plainTaps(session.emotionTaps)).toEqual(edges);
  });

  it('only x and y travel: any other field on a tap is dropped before it is held', async () => {
    const { heldTaps, session } = await generationAfter({ taps: [{ ...A, note: 'free text', at: 3 }] });
    expect(heldTaps).toEqual([A]);
    expect(Object.keys(heldTaps[0]).sort()).toEqual(['x', 'y']);
    expect(plainTaps(session.emotionTaps)).toEqual([A]);
  });

  it('a malformed tap does not count toward the three: the last three VALID taps are kept', async () => {
    const { heldTaps, session } = await generationAfter({ taps: [A, B, C, D, { x: 9, y: 9 }, null] });
    expect(heldTaps).toEqual([B, C, D]);
    expect(plainTaps(session.emotionTaps)).toEqual([B, C, D]);
  });

  it.each([
    ['a string', 'abc'],
    ['an object with a length', { length: 2, 0: A, 1: B }],
    ['a number', 5],
  ])('taps that are %s are no taps: the prompt still drives the mood and the row is written', async (_label, taps) => {
    const { heldTaps, session, asked } = await generationAfter({ taps, textPrompt: 'calm evening' });
    expect(heldTaps).toEqual([]);
    expect(asked.emotionTaps).toEqual([]);
    expect(asked.textPrompt).toBe('calm evening');
    expect(plainTaps(session.emotionTaps)).toEqual([{ x: 0, y: 0 }]); // the schema's no-tap placeholder
    expect(session.contextPrompt).toBe('calm evening');
  });

  // Dropping, not clamping, has one visible consequence, pinned so it is deliberate: when every tap is
  // malformed and nothing else was chosen, there is no mood intent, so no mood is claimed. The request
  // takes the heart-rate branch, as a request with no intent always has, and the row is still written.
  it('every tap malformed and no other intent: no mood is claimed, and the row is written', async () => {
    const user = await listener();
    const socket = openSocket(user);
    socket._trigger('emotion_update', { taps: [{ x: 5, y: 0 }, null], textPrompt: '', activity: null, mode: 'manual' });
    socket._trigger('request_playlist', { mode: 'manual', reqId: 8 });
    await until(() => socket.emit.mock.calls.find(([e]) => e === 'playlist_ready'), 'playlist_ready');
    const session = await until(() => PlaylistSession.findOne({ userId: user._id }), 'the PlaylistSession write');
    expect(buildEmotionPlaylist).not.toHaveBeenCalled();
    expect(adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
    expect(plainTaps(session.emotionTaps)).toEqual([{ x: 0, y: 0 }]);
    expect(session.contextPrompt).toBe('');
  });
});

describe('emotion_update keeps a bounded string prompt, and the moment is written (BE-070, real Mongo)', () => {
  it.each([
    ['a number', 42],
    ['a boolean', true],
    ['an object', { text: 'hello' }],
    ['an array', ['calm', 'evening']],
    ['an object whose toString is not a function', { toString: 1 }],
  ])('a prompt that is %s is no prompt: stored as "" and never sent to the model', async (_label, textPrompt) => {
    const { heldPrompt, session, asked } = await generationAfter({ taps: [A], textPrompt });
    expect(heldPrompt).toBe('');
    expect(asked.textPrompt).toBeNull();
    expect(session.contextPrompt).toBe('');
    expect(plainTaps(session.emotionTaps)).toEqual([A]);
  });

  it('a 501-character prompt is cut to its first 500 characters, held, asked and stored', async () => {
    const prompt = `${'a'.repeat(499)}bc`;
    const { heldPrompt, session, asked } = await generationAfter({ taps: [A], textPrompt: prompt });
    expect(heldPrompt).toBe(`${'a'.repeat(499)}b`);
    expect(asked.textPrompt).toBe(`${'a'.repeat(499)}b`);
    expect(session.contextPrompt).toBe(`${'a'.repeat(499)}b`);
  });

  it('control: a 500-character prompt is kept whole', async () => {
    const prompt = `${'z'.repeat(499)}!`;
    const { heldPrompt, session, asked } = await generationAfter({ taps: [A], textPrompt: prompt });
    expect(heldPrompt).toBe(prompt);
    expect(asked.textPrompt).toBe(prompt);
    expect(session.contextPrompt).toBe(prompt);
  });
});
