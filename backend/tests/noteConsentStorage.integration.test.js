'use strict';

// DAN-131 — REAL-Mongo evidence for the owner's ruling of 2026-10-28: a user with no CURRENT health
// consent can write a note, the note shapes that generation's music, and it is never stored.
//
// Before: the handler held the note in socket state and wrote it to PlaylistSession.contextPrompt
// (encrypted, kept up to 31 days by the daily trim) for every user, with or without a grant. Under the
// owner's reading a note about sleep is medical information, so a user without the grant had it kept.
//
// Now, per generation and from the CURRENT consent status (healthConsentGate's one definition, fail
// closed): no current grant -> the note still reaches buildEmotionPlaylist, the session row stores ''
// (never null: null is the trim's own fingerprint, sessionHealthPolicy.js), and the socket drops the
// held note once its generation has read it. A current grant -> stored as before. A withdrawal on the
// still-open socket drops the held note at once, and the next generation stores none.
//
// Real: the biometric socket handler, the consent service and its ConsentRecord rows, the consent
// router behind the real auth middleware (a real JWT for a real User), the withdrawal with its erasure
// cascade, and the User / PlaylistSession documents on an in-memory MongoDB. Faked: the socket.io server
// (a stateful stand-in whose user room lists the registered sockets) and the generation's outside
// dependencies, as in consentWithdrawalLiveState.integration.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
delete process.env.REDIS_URL;

jest.mock('../app/config/redis', () => ({ getRedis: () => null, connectRedis: jest.fn(), createConnection: jest.fn() }));

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
const ConsentRecord = require('../app/models/ConsentRecord');
const PlaylistSession = require('../app/models/PlaylistSession');
const { signToken } = require('../app/utils/jwt');
const { recordConsent, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { buildEmotionPlaylist, adjustBiometricPlaylist } = require('../app/services/geminiEngine');
const shadowBufferRepo = require('../app/repositories/shadowBufferRepo');
const { captureException } = require('../app/config/sentry');
const { registerBiometricHandler, generateAndEmitPlaylist, _resetDebounceState, _debounceMap } = require('../app/sockets/biometricHandler');
const consentRouter = require('../app/routes/consent');

jest.setTimeout(120000);

const app = express();
app.use(express.json());
app.use('/api/consent', consentRouter);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_note_consent_storage_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  jest.clearAllMocks();
  mockLive.length = 0;
  await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({}), PlaylistSession.deleteMany({})]);
});
afterEach(() => { _resetDebounceState(); });

// Every console line this suite's runs print, kept so a test can prove the note reached none of them.
let printed;
let quiet;
beforeEach(() => {
  printed = [];
  quiet = ['warn', 'info', 'log', 'error'].map((m) => jest.spyOn(console, m).mockImplementation((...args) => {
    printed.push(args.map(String).join(' '));
  }));
});
afterEach(() => { quiet.forEach((s) => s.mockRestore()); });

const NOTE = 'could not sleep last night, need something gentle';

let seq = 0;
async function listener(grant) {
  seq += 1;
  const user = new User({ ssoProvider: 'google', ssoId: `sso-note-${seq}`, email: `note-${seq}@example.com` });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  await user.save();
  if (grant === 'current') {
    await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
  } else if (grant === 'stale') {
    // A grant at an older contract version than the server's: granted, but not CURRENT.
    await ConsentRecord.create({
      userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: 0,
      dataCategories: ['heart_rate'], status: 'granted', grantedAt: new Date(),
    });
  }
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
  mockLive.push(socket);
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

// What the app sends on Generate: its intent, then the request. Resolves once the run has answered,
// its lock is free (the run has fully settled) and its session row is written.
async function generateWith(socket, user, textPrompt, reqId) {
  const before = await PlaylistSession.countDocuments({ userId: user._id });
  const readyBefore = socket.emit.mock.calls.filter(([e]) => e === 'playlist_ready').length;
  socket._trigger('emotion_update', { taps: [{ x: 0.2, y: -0.3 }], textPrompt, activity: null, mode: 'manual' });
  socket._trigger('request_playlist', { mode: 'manual', reqId });
  await until(() => socket.emit.mock.calls.filter(([e]) => e === 'playlist_ready').length > readyBefore, 'playlist_ready');
  await until(() => _debounceMap.get(socket.id)?.generating === false, 'the generation lock to free');
  await until(async () => (await PlaylistSession.countDocuments({ userId: user._id })) > before, 'the PlaylistSession write');
  return PlaylistSession.findOne({ userId: user._id }).sort({ createdAt: -1, _id: -1 });
}

const held = (socket) => _debounceMap.get(socket.id).lastTextPrompt;
const reachedSentry = (text) => JSON.stringify(captureException.mock.calls).includes(text);
const reachedConsole = (text) => printed.some((line) => line.includes(text));

describe('DAN-131 — a note without a current health grant shapes the music and is never kept (real Mongo)', () => {
  it('no grant on file: the note reaches the generation, the session stores "", and the socket no longer holds it', async () => {
    const user = await listener('none');
    const socket = openSocket(user);

    const session = await generateWith(socket, user, NOTE, 1);

    expect(buildEmotionPlaylist).toHaveBeenCalledTimes(1);
    expect(buildEmotionPlaylist.mock.calls[0][0].textPrompt).toBe(NOTE); // the note shaped this generation
    expect(session.contextPrompt).toBe(''); // never null: null is only the trim's fingerprint
    expect(held(socket)).toBe('');
    expect(reachedConsole(NOTE)).toBe(false);
    expect(reachedSentry(NOTE)).toBe(false);
    expect(JSON.stringify(shadowBufferRepo.setBuffer.mock.calls)).not.toContain(NOTE);
  });

  it('a stale grant (older contract version) is not current: the note is used and not stored', async () => {
    const user = await listener('stale');
    const socket = openSocket(user);

    const session = await generateWith(socket, user, NOTE, 2);

    expect(buildEmotionPlaylist.mock.calls[0][0].textPrompt).toBe(NOTE);
    expect(session.contextPrompt).toBe('');
    expect(held(socket)).toBe('');
  });

  it('the consent store cannot be read: fail closed, the note is used and not stored', async () => {
    const user = await listener('current');
    const socket = openSocket(user);
    const latestFor = jest.spyOn(ConsentRecord, 'latestFor').mockRejectedValue(new Error('MongoServerSelectionError'));
    try {
      const session = await generateWith(socket, user, NOTE, 3);
      expect(buildEmotionPlaylist.mock.calls[0][0].textPrompt).toBe(NOTE);
      expect(session.contextPrompt).toBe('');
      expect(held(socket)).toBe('');
      expect(reachedSentry(NOTE)).toBe(false);
    } finally {
      latestFor.mockRestore();
    }
  });

  it('control — a current grant: the note is stored as before and the socket keeps holding it', async () => {
    const user = await listener('current');
    const socket = openSocket(user);

    const session = await generateWith(socket, user, NOTE, 4);

    expect(buildEmotionPlaylist.mock.calls[0][0].textPrompt).toBe(NOTE);
    expect(session.contextPrompt).toBe(NOTE);
    expect(held(socket)).toBe(NOTE);
  });

  it('a withdrawal on the still-open socket drops the held note at once, and the next generation stores none', async () => {
    const user = await listener('current');
    const socket = openSocket(user);

    const first = await generateWith(socket, user, NOTE, 5);
    expect(first.contextPrompt).toBe(NOTE);
    expect(held(socket)).toBe(NOTE);

    const res = await request(app)
      .post('/api/consent/withdraw')
      .set('Authorization', `Bearer ${signToken({ userId: String(user._id) })}`)
      .send({ purpose: HEALTH_CONSENT_PURPOSE });
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);
    expect(held(socket)).toBe('');

    const second = await generateWith(socket, user, 'before bed, slow please', 6);
    expect(buildEmotionPlaylist.mock.calls.at(-1)[0].textPrompt).toBe('before bed, slow please');
    expect(second.contextPrompt).toBe('');
    expect(held(socket)).toBe('');
  });

  it('a grant given mid-session stores from the next generation on (consent is read per generation)', async () => {
    const user = await listener('none');
    const socket = openSocket(user);

    const first = await generateWith(socket, user, NOTE, 7);
    expect(first.contextPrompt).toBe('');

    await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
    const second = await generateWith(socket, user, 'rainy walk', 8);
    expect(second.contextPrompt).toBe('rainy walk');
  });
});

// RA-1 on #289: only a MOOD run reads consent for the note, so only a mood run may drop it. The app's
// building retry re-sends request_playlist WITHOUT a fresh emotion_update (socketClient.ts), so a
// biometric, heart or skip_loop run landing first must leave the held note for that retried mood run:
// otherwise a note-only intent falls to the heart branch and a consented note goes unstored.
describe.each([
  ['a current grant', 'current', NOTE],
  ['no grant', 'none', ''],
])('DAN-131 — %s: a non-mood run leaves the held note to the retried mood run (real Mongo)', (_label, grant, stored) => {
  it.each(['biometric', 'heart', 'skip_loop'])('a %s run first, then the retried request', async (trigger) => {
    const user = await listener(grant);
    const socket = openSocket(user);
    // A note-only intent: no taps, no chip — the note alone routes the retry to the mood pipeline.
    socket._trigger('emotion_update', { taps: [], textPrompt: NOTE, activity: null, mode: 'manual' });
    const state = _debounceMap.get(socket.id);

    await generateAndEmitPlaylist(socket, trigger, state);
    expect(held(socket)).toBe(NOTE);

    await until(() => state.generating === false, 'the first lock to free');
    // The first run writes its own row (contextPrompt ''): wait for it, so the retry's row is the next one.
    const first = await until(() => PlaylistSession.findOne({ userId: user._id }), 'the first run\'s session row');
    expect(first.contextPrompt).toBe('');
    buildEmotionPlaylist.mockClear();
    adjustBiometricPlaylist.mockClear();

    await generateAndEmitPlaylist(socket, 'emotion', state);

    expect(buildEmotionPlaylist).toHaveBeenCalledTimes(1);
    expect(buildEmotionPlaylist.mock.calls[0][0].textPrompt).toBe(NOTE);
    expect(adjustBiometricPlaylist).not.toHaveBeenCalled();
    const session = await until(
      () => PlaylistSession.findOne({ userId: user._id, _id: { $ne: first._id } }),
      'the retry\'s session row',
    );
    expect(session.contextPrompt).toBe(stored);
    expect(held(socket)).toBe(stored);
  });
});
