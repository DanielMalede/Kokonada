'use strict';

// HX-7 (DEC-062, owner ruling 7b) — REAL-Mongo evidence that the retired "Working" and "Focus" chips are
// dropped at the socket door. The new app no longer offers them, but an installed older build keeps
// sending them in emotion_update, and the handler used to cache whatever arrived. That value then fed
// the persisted PlaylistSession.biometricSnapshot.activity, the LLM prompt's activity line and the
// discovery captions (all three read state.lastActivity).
//
// Real: the biometric socket handler, the real User and PlaylistSession documents on an in-memory
// MongoDB, and the whole emotion generation path through to the persisted session. Faked: the
// socket.io socket (a stateful stand-in) and the generation's outside dependencies, as in
// consentWithdrawalLiveState.integration.test.js.

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
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_retired_activity_it' });
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

async function listener(tag) {
  const user = new User({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
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

// What an installed client sends before Generate: its cached intent, then the request.
async function moodGenerationWith(activity, tag) {
  const user = await listener(tag);
  const socket = openSocket(user);
  socket._trigger('emotion_update', { taps: [{ x: 0.3, y: 0.4 }], textPrompt: '', activity, mode: 'manual' });
  const held = _debounceMap.get(socket.id).lastActivity;
  socket._trigger('request_playlist', { mode: 'manual', reqId: 7 });
  await until(() => socket.emit.mock.calls.find(([e]) => e === 'playlist_ready'), 'playlist_ready');
  const session = await until(() => PlaylistSession.findOne({ userId: user._id }), 'the PlaylistSession write');
  const prompt = buildEmotionPlaylist.mock.calls.at(-1)?.[0];
  return { held, session, prompt };
}

describe('emotion_update drops the retired work and study chips from any client (HX-7, real Mongo)', () => {
  it.each([
    ['working', 'old-build-working'],
    ['focus', 'old-build-focus'],
    ['Working', 'old-build-caps'],
    [' focus ', 'old-build-padded'],
  ])('a socket activity %j is held, prompted and stored as null', async (activity, tag) => {
    const { held, session, prompt } = await moodGenerationWith(activity, tag);
    expect(session.biometricSnapshot.activity).toBeNull();
    expect(prompt).toBeDefined();
    expect(prompt.activity).toBeNull();
    expect(held).toBeNull();
  });

  it('control: a chip still offered is held, prompted and stored as sent (the path is live)', async () => {
    const { held, session, prompt } = await moodGenerationWith('running', 'current-running');
    expect(held).toBe('running');
    expect(prompt.activity).toBe('running');
    expect(session.biometricSnapshot.activity).toBe('running');
  });

  // Resilience round 1 (MEDIUM): the door compared only plain strings, so a retired chip wrapped in an
  // array or carrying an invisible character walked through. Zero-width characters are stripped before
  // comparing, and anything that is not a string is dropped.
  it.each([
    [['working'], 'array-working'],
    ['working​', 'zwsp-working'],
    ['wor‍king', 'zwj-working'],
    ['⁠focus﻿', 'wj-bom-focus'],
    [42, 'number'],
    [{ key: 'working' }, 'object'],
    [true, 'boolean'],
  ])('%j is held, prompted and stored as null', async (activity, tag) => {
    const { held, session, prompt } = await moodGenerationWith(activity, tag);
    expect(held).toBeNull();
    expect(prompt.activity).toBeNull();
    expect(session.biometricSnapshot.activity).toBeNull();
  });

  // Resilience round 1 (LOW): the mood branch is chosen by ANY intent: taps, text OR a chip
  // (biometricHandler.js generateAndEmitPlaylist, the useEmotion test). With the retired chip dropped at
  // the door, an older build that sends only that chip now has no mood intent and takes the heart-rate
  // branch. Pinned, so the routing change is deliberate and visible.
  it.each(['working', 'focus'])('a request with only the retired %j chip takes the heart-rate branch', async (activity) => {
    const user = await listener(`chip-only-${activity}`);
    const socket = openSocket(user);
    socket._trigger('emotion_update', { taps: [], textPrompt: '', activity, mode: 'manual' });
    socket._trigger('request_playlist', { mode: 'manual', reqId: 8 });
    await until(() => socket.emit.mock.calls.find(([e]) => e === 'playlist_ready'), 'playlist_ready');
    const session = await until(() => PlaylistSession.findOne({ userId: user._id }), 'the PlaylistSession write');
    expect(buildEmotionPlaylist).not.toHaveBeenCalled();
    expect(adjustBiometricPlaylist).toHaveBeenCalledTimes(1);
    expect(session.emotionTaps.map(({ x, y }) => ({ x, y }))).toEqual([{ x: 0, y: 0 }]); // the no-mood placeholder
    expect(session.biometricSnapshot.activity).toBeNull();
  });

  it('control: a request with only a current chip still takes the mood branch', async () => {
    const user = await listener('chip-only-running');
    const socket = openSocket(user);
    socket._trigger('emotion_update', { taps: [], textPrompt: '', activity: 'running', mode: 'manual' });
    socket._trigger('request_playlist', { mode: 'manual', reqId: 9 });
    await until(() => socket.emit.mock.calls.find(([e]) => e === 'playlist_ready'), 'playlist_ready');
    const session = await until(() => PlaylistSession.findOne({ userId: user._id }), 'the PlaylistSession write');
    expect(buildEmotionPlaylist).toHaveBeenCalledTimes(1);
    expect(buildEmotionPlaylist.mock.calls[0][0].activity).toBe('running');
    expect(adjustBiometricPlaylist).not.toHaveBeenCalled();
    expect(session.biometricSnapshot.activity).toBe('running');
  });

  it('control: a multi-word chip still offered is held, prompted and stored as sent', async () => {
    const { held, session, prompt } = await moodGenerationWith('winding down', 'current-winding');
    expect(held).toBe('winding down');
    expect(prompt.activity).toBe('winding down');
    expect(session.biometricSnapshot.activity).toBe('winding down');
  });
});
