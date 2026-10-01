'use strict';

// BE-016 (DEC-111, DEC-118) R-A — a generation that is already running when consent is withdrawn, on
// REAL MongoDB. The withdrawal erases the session health data before it answers, but a generation's
// writes are fire-and-forget: a session, a serve batch or a buffer can land AFTER the erasure ran. So
// once all of a health-shaped run's writes have settled, consent is read again (from the primary) and,
// when it is not current or cannot be read, exactly that run's writes are undone — never the user's
// history.
//
// The writes are HELD, deterministically, until the withdrawal has run (the HX-1 held-write fixture),
// then released into the REAL model, the REAL serve ledger and the REAL buffer repository.
//
// Real: the consent router behind the real auth, the real withdrawConsent and its erasure, the
// biometric socket handler, PlaylistSession / ServeEvent / ConsentRecord / MedicalProfile, serveLedger,
// shadowBufferRepo, candidatePool. Faked: Redis (a small STATEFUL store), the socket.io server, and the
// generation's outside dependencies (the LLM, Spotify, the selection engine), as in the HX-1 suites.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
delete process.env.REDIS_URL;

jest.mock('../app/config/redis', () => {
  const strings = new Map();
  const zsets = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const keys = () => [...strings.keys(), ...zsets.keys()];
  const fake = {
    strings, zsets, keys,
    dels: [],
    async get(k) { return strings.has(k) ? strings.get(k) : null; },
    async set(k, v) { strings.set(k, v); return 'OK'; },
    async exists(k) { return strings.has(k) || zsets.has(k) ? 1 : 0; },
    async expire() { return 1; },
    async del(...ks) { fake.dels.push(...ks.flat()); return ks.flat().reduce((n, k) => n + ((strings.delete(k) | zsets.delete(k)) ? 1 : 0), 0); },
    async scan(_c, _m, pattern) { const re = glob(pattern); return ['0', keys().filter((k) => re.test(k))]; },
    async zadd(k, score, member) { if (!zsets.has(k)) zsets.set(k, new Map()); zsets.get(k).set(member, Number(score)); return 1; },
    async zremrangebyscore(k, _min, max) {
      const z = zsets.get(k); if (!z) return 0;
      let n = 0; for (const [m, s] of z) if (s <= Number(max)) { z.delete(m); n += 1; }
      return n;
    },
    async zrangebyscore(k, min) { const z = zsets.get(k); return z ? [...z].filter(([, s]) => s >= Number(min)).map(([m]) => m) : []; },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

// The live socket server: sockets register themselves; the user room lists them.
const mockLive = [];
jest.mock('../app/sockets/index', () => ({
  getIo: () => ({
    in: (room) => ({ fetchSockets: async () => mockLive.filter((s) => `user:${s.data.user._id}` === room).map((s) => ({ id: s.id })) }),
    to: () => ({ emit: () => {} }),
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
  buildEmotionPlaylist: jest.fn(async () => ({ params: { target_bpm: 96, target_energy: 0.4, target_valence: 0.55, seed_genres: ['ambient'] }, tracks: [] })),
  adjustBiometricPlaylist: jest.fn(async () => ({ params: { target_bpm: 132, target_energy: 0.8, target_valence: 0.6, seed_genres: ['edm'] }, tracks: [] })),
}));
jest.mock('../app/services/playlistMixer', () => ({ personalizeWhitelist: jest.fn((t) => t) }));
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({})) }));
jest.mock('../app/services/generation/orchestrator', () => ({
  generateV2: jest.fn(async () => ({
    familiar: [{ id: 'lib-1', name: 'Familiar 1', artist: 'Artist A' }],
    discovery: [],
    merged: [{ id: 'lib-1', name: 'Familiar 1', artist: 'Artist A' }],
    targets: { bpmCenter: 100 },
  })),
  buildTargets: jest.fn(async () => ({ bpmCenter: 100 })),
}));
jest.mock('../app/services/biosonic/baselines', () => ({ peekBaselines: jest.fn(async () => null) }));
jest.mock('../app/repositories/sleepHistoryRepo', () => ({ readNightHistory: jest.fn(async () => []) }));
jest.mock('../app/services/discovery/discoveryFetch', () => ({ vectorDiscoveryFetch: jest.fn(async () => []) }));
jest.mock('../app/services/discovery/captionService', () => ({ captionDiscovery: jest.fn(async () => new Map()) }));
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
const MedicalProfile = require('../app/models/MedicalProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent = require('../app/models/ServeEvent');
const { __fake: redis } = require('../app/config/redis');
const { signToken } = require('../app/utils/jwt');
const { recordConsent, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const {
  registerBiometricHandler, recalibrateForBand, _resetDebounceState, _debounceMap,
} = require('../app/sockets/biometricHandler');
const shadowBufferRepo = require('../app/repositories/shadowBufferRepo');
const serveLedger = require('../app/services/ledger/serveLedger');
const candidatePool = require('../app/services/selection/candidatePool');
const { undoRunWrites } = require('../app/services/privacy/sessionHealthErasure');
const consentRouter = require('../app/routes/consent');

jest.setTimeout(120000);

const app = express();
app.use(express.json());
app.use('/api/consent', consentRouter);

const DAY = 24 * 3600_000;
const CLOSED_LINE = /^\[sessionHealth\] compensating-strip user=[0-9a-f]{24} lane=(?:generate|buffer-serve) reason=(?:consent_not_current|consent_read_error) outcome=(?:stripped|nothing|failed error=[A-Za-z][A-Za-z0-9]*)$/;

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_session_health_race_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let logged;
beforeEach(async () => {
  mockLive.length = 0;
  redis.strings.clear();
  redis.zsets.clear();
  redis.dels.length = 0;
  await Promise.all([User, BiometricLog, ConsentRecord, MedicalProfile, PlaylistSession, ServeEvent].map((M) => M.deleteMany({})));
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push({ level, line: args.map(String).join(' ') }); });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  _resetDebounceState();
});

const stripLines = () => logged.filter((l) => l.line.includes('compensating-strip')).map((l) => l.line);

async function until(check, label, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
// Poll until accepted; resolve with the LAST value either way, so a missing behaviour fails on the
// assertion that names it rather than on a timeout.
async function eventually(read, accept, timeoutMs = 3000) {
  const start = Date.now();
  let value = await read();
  while (!accept(value) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
    value = await read();
  }
  return value;
}

// One held write: the next call of `target` waits for release(), then runs the REAL method.
function hold(obj, method) {
  const real = obj[method].bind(obj);
  const gate = { holding: false, landed: false, release: null };
  let armed = true;
  jest.spyOn(obj, method).mockImplementation(async (...args) => {
    if (!armed) return real(...args);
    armed = false;
    await new Promise((resolve) => { gate.release = resolve; gate.holding = true; });
    try { return await real(...args); } finally { gate.landed = true; }
  });
  return gate;
}

async function consentingListener(tag) {
  const user = new User({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  await user.save();
  await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
  return user;
}

function appSocket(user) {
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
const ready = (socket) => socket.emit.mock.calls.some(([e]) => e === 'playlist_ready');

async function withdraw(user) {
  const res = await request(app)
    .post('/api/consent/withdraw')
    .set('Authorization', `Bearer ${signToken({ userId: String(user._id) })}`)
    .send({ purpose: HEALTH_CONSENT_PURPOSE });
  expect(res.status).toBe(200);
  expect(res.body.granted).toBe(false);
}

const sessionsOf = (user) => PlaylistSession.collection.find({ userId: user._id }).sort({ createdAt: 1 }).toArray();
const servesOf = (user) => ServeEvent.collection.find({ userId: user._id }).toArray();

// A heart request that is admitted (the grant is current) and generates under bio:peak:unknown.
async function startHeartRun(user) {
  const socket = appSocket(user);
  await socket._trigger('request_heart_playlist', { mode: 'live', reqId: 1, heartRate: 131 });
  return socket;
}

describe('R1–R3 — writes that land after the withdrawal are undone (real Mongo)', () => {
  it('R1: a held session write released after the withdrawal is stripped to the Live mark', async () => {
    const user = await consentingListener('r1');
    const gate = hold(PlaylistSession, 'create');
    const socket = await startHeartRun(user);
    await until(() => gate.holding, 'the held session write');

    await withdraw(user); // the erasure runs here, before the session exists
    expect(await PlaylistSession.countDocuments({ userId: user._id })).toBe(0);

    gate.release();
    await until(() => gate.landed, 'the released session write');
    const [row] = await eventually(() => sessionsOf(user), (rows) => rows[0]?.moodKey === 'bio:');
    expect(row).toMatchObject({
      moodKey: 'bio:', biometricSnapshot: { heartRate: null, activity: null },
      targetBpm: null, targetEnergy: null, targetValence: null, targetGenres: [],
    });
    expect(row.trackIds).toEqual(['lib-1']); // the tracks stay (T1)
    expect(await eventually(stripLines, (l) => l.length > 0)).toEqual([
      `[sessionHealth] compensating-strip user=${user._id} lane=generate reason=consent_not_current outcome=stripped`,
    ]);
    expect(ready(socket)).toBe(true);
  });

  it('R2: a held serve batch released after the withdrawal is scrubbed; the track and the time stay', async () => {
    const user = await consentingListener('r2');
    const gate = hold(ServeEvent, 'insertMany');
    await startHeartRun(user);
    await until(() => gate.holding, 'the held serve batch');

    await withdraw(user);
    gate.release();
    await until(() => gate.landed, 'the released serve batch');

    // The line is written once the undo has finished (its Redis deletes run after its Mongo writes).
    expect(await eventually(stripLines, (l) => l.length > 0)).toEqual([
      `[sessionHealth] compensating-strip user=${user._id} lane=generate reason=consent_not_current outcome=stripped`,
    ]);
    const serves = await servesOf(user);
    expect(serves.length).toBeGreaterThan(0);
    for (const s of serves) {
      expect(s).toMatchObject({ moodKey: null, bioState: { tempoBand: null, activity: null } });
      expect(typeof s.canonicalKey).toBe('string');
      expect(s.servedAt).toBeInstanceOf(Date);
    }
    // the per-mood ledger window it wrote is band-named: gone too
    expect(redis.keys().filter((k) => k.startsWith(`ledger:${user._id}:mood:bio:`))).toEqual([]);
  });

  it('R3: a buffer and a pool key written after the purge are deleted', async () => {
    const user = await consentingListener('r3');
    const gate = hold(shadowBufferRepo, 'setBuffer');
    await startHeartRun(user);
    await until(() => gate.holding, 'the held buffer write');

    await withdraw(user);
    // a late candidate-pool write for the same band lands after the purge, too
    await redis.set(`pool:${user._id}:bio:peak:unknown`, '{"builtFrom":0,"tracks":[]}');
    gate.release();
    await until(() => gate.landed, 'the released buffer write');

    await eventually(stripLines, (l) => l.length > 0);
    expect(redis.keys().filter((k) => k.includes(String(user._id)) && k.includes(':bio:'))).toEqual([]);
  });
});

describe('R4 — control: no withdrawal, nothing is undone', () => {
  it('the re-check admits the run: rows keep their values, no strip or delete is issued, no line', async () => {
    const user = await consentingListener('r4');
    const latestFor = jest.spyOn(ConsentRecord, 'latestFor');
    const strips = jest.spyOn(PlaylistSession, 'updateOne');
    const scrubs = jest.spyOn(ServeEvent, 'updateMany');
    const socket = await startHeartRun(user);
    await until(() => ready(socket), 'playlist_ready');
    const [row] = await until(async () => { const rows = await sessionsOf(user); return rows.length ? rows : null; }, 'the session');
    // the re-check happens after the writes settle; wait for it to be ANSWERED, then a macrotask
    const reads = latestFor.mock.calls.length;
    await until(() => latestFor.mock.calls.length > 1, 'the post-write consent re-check');
    await Promise.all(latestFor.mock.results.map((r) => r.value));
    await new Promise((r) => setImmediate(r));

    expect(reads).toBeGreaterThanOrEqual(1);
    expect(row).toMatchObject({ moodKey: 'bio:peak:unknown', targetBpm: 132 });
    expect((await sessionsOf(user))[0].biometricSnapshot.heartRate).not.toBeNull();
    expect(strips).not.toHaveBeenCalled();
    expect(scrubs).not.toHaveBeenCalled();
    expect(redis.dels).toEqual([]);
    expect(stripLines()).toEqual([]);
  });
});

describe('R5 — a consent read error at the re-check fails closed, narrowly', () => {
  it('only this run\'s rows and keys go; an older heart session, older serves and other keys stay', async () => {
    const user = await consentingListener('r5');
    const older = await PlaylistSession.create({
      userId: user._id, emotionTaps: [{ x: 0, y: 0 }], moodKey: 'bio:active:walking',
      biometricSnapshot: { heartRate: 101, activity: 'walking' }, targetBpm: 110, musicProvider: 'spotify',
    });
    const olderBefore = await PlaylistSession.collection.findOne({ _id: older._id });
    await ServeEvent.create({ userId: user._id, canonicalKey: 'isrc:OLD', moodKey: 'bio:active:walking', bioState: { tempoBand: 'active', activity: 'walking' }, servedAt: new Date(Date.now() - DAY) });
    await redis.set(`buffer:${user._id}:bio:active:walking`, '{}');
    const gate = hold(PlaylistSession, 'create');
    await startHeartRun(user);
    await until(() => gate.holding, 'the held session write');
    const readError = Object.assign(new Error('connection 5 to 127.0.0.1:27017 closed (heartRate=131)'), { name: 'MongoNetworkError' });
    jest.spyOn(ConsentRecord, 'latestFor').mockRejectedValueOnce(readError);

    gate.release();

    const lines = await eventually(stripLines, (l) => l.length > 0);
    expect(lines).toEqual([`[sessionHealth] compensating-strip user=${user._id} lane=generate reason=consent_read_error outcome=stripped`]);
    const rows = await sessionsOf(user);
    expect(rows.find((r) => String(r._id) === String(older._id))).toEqual(olderBefore);
    expect(rows.find((r) => String(r._id) !== String(older._id))).toMatchObject({ moodKey: 'bio:', biometricSnapshot: { heartRate: null } });
    expect((await ServeEvent.collection.findOne({ canonicalKey: 'isrc:OLD' })).bioState).toEqual({ tempoBand: 'active', activity: 'walking' });
    expect(redis.strings.has(`buffer:${user._id}:bio:active:walking`)).toBe(true);
    expect(logged.map((l) => l.line).join('\n')).not.toContain('127.0.0.1');
  });
});

describe('R6 — a mood-only generation is not health-shaped: no consent re-read at all', () => {
  it('no heart rate held, no stored health profile: the run writes, and consent is never read again', async () => {
    const user = await consentingListener('r6');
    const socket = appSocket(user);
    const latestFor = jest.spyOn(ConsentRecord, 'latestFor');
    socket._trigger('emotion_update', { taps: [{ x: 0.3, y: 0.4 }], textPrompt: '', activity: 'running', mode: 'live' });
    socket._trigger('request_playlist', { mode: 'live', reqId: 6 });
    await until(() => ready(socket), 'playlist_ready');
    await until(async () => (await sessionsOf(user)).length === 1 && (await servesOf(user)).length > 0, 'the run\'s writes');
    await new Promise((r) => setTimeout(r, 100));

    expect(latestFor).not.toHaveBeenCalled();
    expect((await sessionsOf(user))[0]).toMatchObject({ biometricSnapshot: { heartRate: null, activity: 'running' } });
  });
});

describe('R7 — a mood run shaped by the stored health profile lands after the withdrawal', () => {
  it('its targets are nulled; the chosen chip and the mood stay (no heart rate, so A2 does not apply)', async () => {
    const user = await consentingListener('r7');
    await MedicalProfile.create({ userId: user._id, restingHeartRate: 58, hrv: 42 });
    const socket = appSocket(user);
    const gate = hold(PlaylistSession, 'create');
    socket._trigger('emotion_update', { taps: [{ x: 0.3, y: 0.4 }], textPrompt: '', activity: 'running', mode: 'live' });
    socket._trigger('request_playlist', { mode: 'live', reqId: 7 });
    await until(() => gate.holding, 'the held session write');

    await withdraw(user);
    gate.release();

    const [row] = await eventually(() => sessionsOf(user), (rows) => rows[0]?.targetBpm === null);
    expect(row).toMatchObject({ targetBpm: null, targetEnergy: null, targetValence: null, biometricSnapshot: { heartRate: null, activity: 'running' } });
    expect(row.moodKey).not.toBeNull();
    expect(row.moodKey.startsWith('bio:')).toBe(false);
    expect(await eventually(stripLines, (l) => l.length > 0)).toEqual([
      `[sessionHealth] compensating-strip user=${user._id} lane=generate reason=consent_not_current outcome=stripped`,
    ]);
  });
});

describe('N2 (round 1) — a mood run that began with a heart rate, and lost it to the withdrawal mid-run', () => {
  // No chip and no stored profile: the session is written with heart rate null, a preset moodKey and
  // the watch's activity (effectiveActivity, read when the run began). Only "a heart rate was held when
  // the run began" (hrAtStart) shows it was shaped by health data, and only it strips that activity.
  it('the watch activity stored without a heart rate is stripped, with exactly one stripped line', async () => {
    const user = await consentingListener('n2');
    const socket = appSocket(user);
    await socket._trigger('biometric_push', {
      source: 'garmin', raw: { heartRate: 131, activityType: 0, startTimeLocal: new Date(Date.now() - 60_000).toISOString() },
    });
    const state = _debounceMap.get(socket.id);
    expect(state.stableHR).not.toBeNull();
    expect(state.latestActivity).toBe('resting');
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0); // no stored vitals: not profile-shaped
    const { buildEmotionPlaylist } = require('../app/services/geminiEngine');
    const gate = { holding: false, release: null };
    buildEmotionPlaylist.mockImplementationOnce(async () => {
      await new Promise((resolve) => { gate.release = resolve; gate.holding = true; });
      return { params: { target_bpm: 96, target_energy: 0.4, target_valence: 0.55, seed_genres: ['ambient'] }, tracks: [] };
    });
    socket._trigger('emotion_update', { taps: [{ x: 0.3, y: 0.4 }], textPrompt: '', mode: 'live' }); // no chip
    socket._trigger('request_playlist', { mode: 'live', reqId: 21 });
    await until(() => gate.holding, 'the held LLM step');

    await withdraw(user);
    expect(state.stableHR).toBeNull(); // the withdrawal withheld this socket's heart rate mid-run
    gate.release();

    const [row] = await eventually(() => sessionsOf(user), (rows) => rows.length === 1 && rows[0].biometricSnapshot.activity === null);
    expect(row).toMatchObject({ biometricSnapshot: { heartRate: null, activity: null }, targetBpm: null });
    expect(row.moodKey.startsWith('bio:')).toBe(false);
    expect(await eventually(stripLines, (l) => l.length > 0)).toEqual([
      `[sessionHealth] compensating-strip user=${user._id} lane=generate reason=consent_not_current outcome=stripped`,
    ]);
  });
});

describe('R8 — a stale grant at the re-check: a narrow undo, never a user-wide erasure', () => {
  it('this run is undone; an older heart session keeps its values', async () => {
    const user = await consentingListener('r8');
    const older = await PlaylistSession.create({
      userId: user._id, emotionTaps: [{ x: 0, y: 0 }], moodKey: 'bio:active:walking',
      biometricSnapshot: { heartRate: 101, activity: 'walking' }, targetBpm: 110, musicProvider: 'spotify',
    });
    const olderBefore = await PlaylistSession.collection.findOne({ _id: older._id });
    const gate = hold(PlaylistSession, 'create');
    await startHeartRun(user);
    await until(() => gate.holding, 'the held session write');
    // The grant on file becomes stale (an older contract version is the latest row).
    await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: 0, status: 'granted', grantedAt: new Date() });

    gate.release();

    const lines = await eventually(stripLines, (l) => l.length > 0);
    expect(lines).toEqual([`[sessionHealth] compensating-strip user=${user._id} lane=generate reason=consent_not_current outcome=stripped`]);
    const rows = await sessionsOf(user);
    expect(rows.find((r) => String(r._id) === String(older._id))).toEqual(olderBefore);
    expect(rows.find((r) => String(r._id) !== String(older._id)).moodKey).toBe('bio:');
  });
});

describe('the buffer-serve lane — a warm buffer served as consent is withdrawn', () => {
  it('the held serve batch is scrubbed and the band-named keys go; the line says lane=buffer-serve', async () => {
    const user = await consentingListener('buffer');
    const socket = appSocket(user);
    socket._trigger('live_mode', { enabled: true });
    await socket._trigger('biometric_push', {
      source: 'garmin', raw: { heartRate: 131, activityType: 0, startTimeLocal: new Date(Date.now() - 60_000).toISOString() },
    });
    const state = _debounceMap.get(socket.id);
    expect(state.stableHR).not.toBeNull();
    const key = 'bio:peak:resting';
    await redis.set(`buffer:${user._id}:${key}`, JSON.stringify({ tracks: [{ id: 'lib-1', name: 'Familiar 1', uri: 'spotify:track:lib1', provider: 'spotify' }], familiar: 1, discovery: 0 }));
    const gate = hold(ServeEvent, 'insertMany');

    const serving = recalibrateForBand(socket, state);
    await until(() => gate.holding, 'the held buffer-serve batch');
    await withdraw(user);
    gate.release();
    await serving;

    // The line is written once the undo has finished (its Redis deletes run after its Mongo writes).
    expect(await eventually(stripLines, (l) => l.length > 0)).toEqual([
      `[sessionHealth] compensating-strip user=${user._id} lane=buffer-serve reason=consent_not_current outcome=stripped`,
    ]);
    const serves = await servesOf(user);
    expect(serves.length).toBeGreaterThan(0);
    for (const s of serves) expect(s).toMatchObject({ moodKey: null, bioState: { tempoBand: null, activity: null } });
    expect(redis.keys().filter((k) => k.includes(String(user._id)) && k.includes(':bio:'))).toEqual([]);
  });
});

describe('the compensating line carries closed tokens only', () => {
  it('matches the closed pattern, with no bpm, band, activity, time or error text', async () => {
    const user = await consentingListener('line');
    const gate = hold(PlaylistSession, 'create');
    await startHeartRun(user);
    await until(() => gate.holding, 'the held session write');
    await withdraw(user);
    gate.release();

    const [line] = await eventually(stripLines, (l) => l.length > 0);
    expect(line).toMatch(CLOSED_LINE);
    expect(line.replace(/user=[0-9a-f]{24}/, '')).not.toMatch(/\d|peak|resting|unknown|bio:/);
  });

  it('a strip that fails says outcome=failed with the error type only', async () => {
    const user = await consentingListener('fail');
    const gate = hold(PlaylistSession, 'create');
    await startHeartRun(user);
    await until(() => gate.holding, 'the held session write');
    await withdraw(user);
    jest.spyOn(PlaylistSession, 'updateOne').mockRejectedValueOnce(Object.assign(new Error('heartRate=131 at 10.0.0.9'), { name: 'MongoServerError' }));
    gate.release();

    const [line] = await eventually(stripLines, (l) => l.length > 0);
    expect(line).toBe(`[sessionHealth] compensating-strip user=${user._id} lane=generate reason=consent_not_current outcome=failed error=MongoServerError`);
    expect(logged.find((l) => l.line === line).level).toBe('error');
    expect(logged.map((l) => l.line).join('\n')).not.toMatch(/10\.0\.0\.9|heartRate=131/);
  });
});

describe('the keys the undo deletes are the keys their writers write', () => {
  it('buffer, pool and per-mood ledger window, built by the real writers, are exactly what undoRunWrites removes', async () => {
    const user = await consentingListener('keys');
    const id = String(user._id);
    const key = 'bio:active:walking';
    await shadowBufferRepo.setBuffer(id, key, { tracks: [] });
    await candidatePool.buildPool({ userId: id, moodKey: key, musicProfile: { library: [{ id: 'x', provider: 'spotify', name: 'X', artist: 'Y' }] } });
    await serveLedger.recordServes({ userId: id, entries: [{ canonicalKey: 'isrc:K', moodKey: key }] });
    await new Promise((r) => setImmediate(r)); // the pool write is fire-and-forget
    const written = redis.keys().filter((k) => k.includes(key)).sort();
    expect(written).toHaveLength(3);

    await undoRunWrites({ userId: user._id, moodKey: key });

    expect(redis.keys().filter((k) => k.includes(key))).toEqual([]);
    expect(redis.keys()).toContain(`ledger:${id}:served`); // not band-named: kept
  });
});
