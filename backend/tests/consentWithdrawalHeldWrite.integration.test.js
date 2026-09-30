'use strict';

// HX-1 — the consent-withdrawal race on the LIVE heart-rate write, on REAL MongoDB.
//
// The race: the push gate admits a reading while the grant is current, then persists it without
// waiting (`_maybePersistLiveReading`: exists, then insert). A withdrawal writes its row and then
// erases. An insert that lands AFTER the erasure's delete survives it. /watch/hr reaches the same
// write through `watchHrIngest` → `handleBiometricReading`. The unmodified
// consentWithdrawalLiveState test only loses this race under CPU load (2 in 61 runs); here the
// live write is HELD, deterministically, until the withdrawal has run — then released into the
// REAL insertManyAccounted and the real collection. Nothing else about the write changes.
//
// Real: the consent and integrations routers, the real withdrawConsent with its erasure cascade,
// ConsentRecord / BiometricLog / MedicalProfile / MorningState documents, the biometric socket
// handler and the real insert. Faked: the socket.io server (a stateful stand-in whose user room
// lists the registered sockets) and the generation's outside dependencies, as in
// consentWithdrawalLiveState.integration.test.js. Faults (A3, A5) are injected at the Mongo
// boundary for one call only.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/config/redis', () => ({ getRedis: () => null, connectRedis: jest.fn(), createConnection: jest.fn() }));

// The held write (scratchpad check/mechanism.sh, made a fixture). Armed per test: the next live
// BiometricLog write waits for `releaseInsert()`, then runs the REAL insert. `returnGate`, when a
// test sets one, holds the caller AFTER the row has landed — the row is in Mongo, the persist path
// does not know yet (A2 needs the row present for the erasure's counts, not yet compensated).
// `throwAfterLanding`, when set, is thrown AFTER the real insert has landed: the server applied the
// write and the caller still gets an error (a write-concern or network failure on the reply).
const mockHeld = { armed: false, holding: false, landed: false, inserted: null, releaseInsert: null, returnGate: null, throwAfterLanding: null };
jest.mock('../app/services/wearable/insertAccounted', () => {
  const real = jest.requireActual('../app/services/wearable/insertAccounted');
  return {
    ...real,
    insertManyAccounted: async (Model, docs, opts = {}) => {
      if (opts.label !== 'BiometricLog.live' || !mockHeld.armed) return real.insertManyAccounted(Model, docs, opts);
      mockHeld.armed = false;
      await new Promise((resolve) => { mockHeld.releaseInsert = resolve; mockHeld.holding = true; });
      const out = await real.insertManyAccounted(Model, docs, opts);
      mockHeld.inserted = out.inserted;
      mockHeld.landed = true;
      if (mockHeld.returnGate) await mockHeld.returnGate;
      if (mockHeld.throwAfterLanding) throw mockHeld.throwAfterLanding;
      return out;
    },
  };
});

// The live socket server: sockets register themselves; the user room lists them. Both doors are
// served — the withdrawal's `in(room).fetchSockets()` and watchHrIngest's adapter-room lookup.
const mockLive = [];
jest.mock('../app/sockets/index', () => {
  const inRoom = (room) => mockLive.filter((s) => `user:${s.data.user._id}` === room);
  return {
    getIo: () => ({
      in: (room) => ({ fetchSockets: async () => inRoom(room).map((s) => ({ id: s.id })) }),
      to: () => ({ emit: () => {} }),
      sockets: {
        adapter: { rooms: { get: (room) => { const ids = inRoom(room).map((s) => s.id); return ids.length ? new Set(ids) : undefined; } } },
        sockets: { get: (id) => mockLive.find((s) => s.id === id) },
      },
    }),
  };
});

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

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const ConsentRecord = require('../app/models/ConsentRecord');
const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState = require('../app/models/MorningState');
const { signToken } = require('../app/utils/jwt');
const { captureException } = require('../app/config/sentry');
const { normalize } = require('../app/services/wearable/adapter');
const { recordConsent, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consent');
const { registerBiometricHandler, _resetDebounceState } = require('../app/sockets/biometricHandler');
const consentRouter = require('../app/routes/consent');
const integrationsRouter = require('../app/routes/integrations');

jest.setTimeout(120000);

const app = express();
app.use(express.json());
app.use('/api/consent', consentRouter);
app.use('/api/integrations', integrationsRouter);

// A6 — the ONE shape a compensating line may take: closed tokens, the withdrawal line's own user
// reference (consent.js `user=${userId}`), an error TYPE only on a failure. No value, no time.
const CLOSED_LINE = /^\[biometricHandler\] compensating-delete user=[0-9a-f]{24} lane=(?:socket|watch) reason=(?:consent_not_current|consent_read_error) outcome=(?:deleted0|deleted1|failed error=[A-Za-z][A-Za-z0-9]*)$/;

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_withdrawal_held_write_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let logged;
beforeEach(async () => {
  mockLive.length = 0;
  Object.assign(mockHeld, { armed: false, holding: false, landed: false, inserted: null, releaseInsert: null, returnGate: null, throwAfterLanding: null });
  captureException.mockClear();
  await Promise.all([
    User.deleteMany({}), BiometricLog.deleteMany({}), ConsentRecord.deleteMany({}),
    MedicalProfile.deleteMany({}), MorningState.deleteMany({}),
  ]);
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push({ level, line: args.map(String).join(' ') }); });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  _resetDebounceState();
});

const compensatingLines = () => logged.filter((l) => l.line.includes('compensating-delete')).map((l) => l.line);

async function until(check, label, timeoutMs = 5000) {
  const start = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// Poll until `accept(value)`, and resolve with the LAST value read either way — so a missing
// behaviour fails on the assertion that names it (Expected: 0, Received: 1), not on a timeout.
async function eventually(read, accept, timeoutMs = 3000) {
  const start = Date.now();
  let value = await read();
  while (!accept(value) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
    value = await read();
  }
  return value;
}

async function consentingListener(tag, { watchToken } = {}) {
  const user = new User({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
  user.setToken('spotifyToken', { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600_000 });
  if (watchToken) {
    user.watchToken = { hash: crypto.createHash('sha256').update(watchToken).digest('hex'), createdAt: new Date(), lastSeenAt: null };
    user.wearableProvider = 'garmin';
  }
  await user.save();
  await recordConsent(user._id, { purpose: HEALTH_CONSENT_PURPOSE, dataCategories: ['heart_rate'] });
  return user;
}

// The phone's open app socket, registered like the real one and listed in the user's room.
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

const garminRaw = (heartRate, extra = {}) => ({
  heartRate, activityType: 0, startTimeLocal: new Date(Date.now() - 60_000).toISOString(), ...extra,
});

async function withdraw(user) {
  const res = await request(app)
    .post('/api/consent/withdraw')
    .set('Authorization', `Bearer ${signToken({ userId: String(user._id) })}`)
    .send({ purpose: HEALTH_CONSENT_PURPOSE });
  expect(res.status).toBe(200);
  expect(res.body.granted).toBe(false);
}

// Release the held write and wait until the REAL insert has put the row in the collection.
async function releaseHeldWrite() {
  expect(mockHeld.holding).toBe(true);
  mockHeld.releaseInsert();
  await until(() => mockHeld.landed, 'the released live write');
  expect(mockHeld.inserted).toBe(1); // the write really landed — the test is not vacuous
}

const countFor = (Model, user) => Model.countDocuments({ userId: user._id });

describe('HX-1 A1 — a live write admitted before withdrawal does not outlive the erasure (real Mongo)', () => {
  it('socket lane (biometric_push): the write held across the whole withdrawal is removed once it lands', async () => {
    const user = await consentingListener('a1-socket');
    const socket = appSocket(user);
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(131) }); // admitted: the grant is current
    await until(() => mockHeld.holding, 'the held live write');

    await withdraw(user); // the withdrawal row, then the full erasure — both done before the write lands

    await releaseHeldWrite();
    const remaining = await eventually(() => countFor(BiometricLog, user), (n) => n === 0);
    expect(remaining).toBe(0);
    const lines = await eventually(compensatingLines, (l) => l.length > 0);
    expect(lines).toEqual([`[biometricHandler] compensating-delete user=${user._id} lane=socket reason=consent_not_current outcome=deleted1`]);
  });

  it('watch lane (POST /watch/hr → watchHrIngest): the same held write is removed once it lands', async () => {
    const token = 'whr_a1-watch-device-token';
    const user = await consentingListener('a1-watch', { watchToken: token });
    appSocket(user); // /watch/hr delivers into the phone's live socket
    mockHeld.armed = true;
    const res = await request(app)
      .post('/api/integrations/watch/hr')
      .set('Authorization', `Bearer ${token}`)
      .send({ heartRate: 131, activityType: 0, ts: new Date(Date.now() - 60_000).toISOString() });
    expect(res.status).toBe(202);
    await until(() => mockHeld.holding, 'the held live write');

    await withdraw(user);

    await releaseHeldWrite();
    const remaining = await eventually(() => countFor(BiometricLog, user), (n) => n === 0);
    expect(remaining).toBe(0);
    const lines = await eventually(compensatingLines, (l) => l.length > 0);
    expect(lines).toEqual([`[biometricHandler] compensating-delete user=${user._id} lane=watch reason=consent_not_current outcome=deleted1`]);
  });
});

describe('HX-1 A1 (F3) — the compensation removes the READING, not one row of it (real Mongo)', () => {
  it('a same-key row a batch lane wrote concurrently goes with it: 0 rows for that reading remain', async () => {
    const user = await consentingListener('a1-f3');
    const socket = appSocket(user);
    const raw = garminRaw(131);
    const { recordedAt } = normalize('garmin', raw);
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw }); // its exists() check has already passed
    await until(() => mockHeld.holding, 'the held live write');
    await withdraw(user);
    // The same reading, landed by another lane after the erasure too (BiometricLog has no unique key).
    await BiometricLog.create({ userId: user._id, heartRate: 131, source: 'garmin', recordedAt });

    await releaseHeldWrite();
    const remaining = await eventually(() => BiometricLog.countDocuments({ userId: user._id, source: 'garmin', recordedAt }), (n) => n === 0);
    expect(remaining).toBe(0);
    expect(await eventually(compensatingLines, (l) => l.length > 0)).toEqual([
      `[biometricHandler] compensating-delete user=${user._id} lane=socket reason=consent_not_current outcome=deleted1`,
    ]);
  });
});

describe('HX-1 A1 (deleted0) — a reading the erasure already removed is reported truthfully (real Mongo)', () => {
  it('the row landed before the erasure, the persist path learns it after: outcome=deleted0, nothing left behind', async () => {
    const user = await consentingListener('a1-deleted0');
    await MedicalProfile.create({ userId: user._id, restingHeartRate: 58 });
    const socket = appSocket(user);
    let releaseReturn;
    mockHeld.returnGate = new Promise((r) => { releaseReturn = r; });
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(131) });
    await until(() => mockHeld.holding, 'the held live write');
    await releaseHeldWrite(); // in Mongo BEFORE the withdrawal — the erasure's own delete gets it
    await withdraw(user);
    expect(await countFor(BiometricLog, user)).toBe(0);

    releaseReturn(); // only now does the persist path re-check: withdrawn, and nothing left to delete
    const lines = await eventually(compensatingLines, (l) => l.length > 0);
    expect(lines).toEqual([`[biometricHandler] compensating-delete user=${user._id} lane=socket reason=consent_not_current outcome=deleted0`]);
    expect({ biometricLogs: await countFor(BiometricLog, user), medicalProfiles: await countFor(MedicalProfile, user) })
      .toEqual({ biometricLogs: 0, medicalProfiles: 0 });
  });
});

describe('HX-1 A2 (F1) — the compensation leaves the state the erasure would have left (real Mongo)', () => {
  it('a garmin write landing between the first provider delete and the last count: BiometricLog, MedicalProfile and MorningState all end at 0', async () => {
    const user = await consentingListener('a2');
    await MedicalProfile.create({ userId: user._id, restingHeartRate: 58 });
    await MorningState.create({ userId: user._id, date: new Date() });
    const socket = appSocket(user);
    let releaseReturn;
    mockHeld.returnGate = new Promise((r) => { releaseReturn = r; });
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(131) });
    await until(() => mockHeld.holding, 'the held live write');

    // Land the write INSIDE the erasure: right after the first provider's (garmin's) sample delete,
    // before that provider's count — so every count the erasure takes sees the row.
    const realDeleteMany = BiometricLog.deleteMany;
    jest.spyOn(BiometricLog, 'deleteMany').mockImplementation(async function deleteManyThenLand(filter, ...rest) {
      const out = await realDeleteMany.call(BiometricLog, filter, ...rest);
      if (filter?.source === 'garmin' && !('recordedAt' in filter) && !mockHeld.landed) await releaseHeldWrite();
      return out;
    });
    await withdraw(user);

    // Precondition — F1 really happened: the erasure itself kept both aggregates.
    expect({
      biometricLogs: await countFor(BiometricLog, user),
      medicalProfiles: await countFor(MedicalProfile, user),
      morningStates: await countFor(MorningState, user),
    }).toEqual({ biometricLogs: 1, medicalProfiles: 1, morningStates: 1 });

    releaseReturn(); // the persist path learns its write landed
    const lines = await eventually(compensatingLines, (l) => l.length > 0);
    expect({
      biometricLogs: await countFor(BiometricLog, user),
      medicalProfiles: await countFor(MedicalProfile, user),
      morningStates: await countFor(MorningState, user),
    }).toEqual({ biometricLogs: 0, medicalProfiles: 0, morningStates: 0 });
    expect(lines).toEqual([`[biometricHandler] compensating-delete user=${user._id} lane=socket reason=consent_not_current outcome=deleted1`]);
  });
});

describe('HX-1 A3 — a consent-read error after the insert fails closed (real Mongo)', () => {
  it('only the held reading is removed — the rest of a possibly-still-consented history stays — and the line says reason=consent_read_error, never the error text', async () => {
    const user = await consentingListener('a3'); // nothing is withdrawn: the grant may well still be current
    const raw = garminRaw(131);
    const { recordedAt } = normalize('garmin', raw);
    // B1: what a read-error delete must NOT touch. The same user's older garmin reading, another
    // provider's reading at the held reading's exact time, and the profile they back.
    await BiometricLog.create({ userId: user._id, heartRate: 64, source: 'garmin', recordedAt: new Date(recordedAt.getTime() - 2 * 3600_000) });
    await BiometricLog.create({ userId: user._id, heartRate: 66, source: 'health_connect', recordedAt });
    await MedicalProfile.create({ userId: user._id, restingHeartRate: 58 });
    const socket = appSocket(user);
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw });
    await until(() => mockHeld.holding, 'the held live write');

    // The next consent read — the post-insert re-check — hits a store failure whose text quotes values.
    const readError = Object.assign(new Error('connection 7 to 127.0.0.1:27017 closed (heartRate=131)'), { name: 'MongoNetworkError' });
    jest.spyOn(ConsentRecord, 'latestFor').mockRejectedValueOnce(readError);

    await releaseHeldWrite();
    const lines = await eventually(compensatingLines, (l) => l.length > 0);
    expect(lines).toEqual([`[biometricHandler] compensating-delete user=${user._id} lane=socket reason=consent_read_error outcome=deleted1`]);
    expect({
      heldKey: await BiometricLog.countDocuments({ userId: user._id, source: 'garmin', recordedAt }),
      biometricLogs: await countFor(BiometricLog, user),
      medicalProfiles: await countFor(MedicalProfile, user),
    }).toEqual({ heldKey: 0, biometricLogs: 2, medicalProfiles: 1 });
    expect(logged.map((l) => l.line).join('\n')).not.toContain('127.0.0.1');
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe('HX-1 — an insert that throws after the server applied it is still re-checked (real Mongo)', () => {
  const appliedThenFailed = () => Object.assign(new Error('waiting for replication timed out'), { name: 'MongoWriteConcernError' });

  it('withdrawn: the row the failed insert left behind is removed, and the failure is still reported as itself', async () => {
    const user = await consentingListener('throws-withdrawn');
    const socket = appSocket(user);
    mockHeld.throwAfterLanding = appliedThenFailed();
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(131) });
    await until(() => mockHeld.holding, 'the held live write');
    await withdraw(user);

    await releaseHeldWrite(); // the row is in Mongo; the persist path receives an error
    const remaining = await eventually(() => countFor(BiometricLog, user), (n) => n === 0);
    expect(remaining).toBe(0);
    expect(await eventually(compensatingLines, (l) => l.length > 0)).toEqual([
      `[biometricHandler] compensating-delete user=${user._id} lane=socket reason=consent_not_current outcome=deleted1`,
    ]);
    expect(logged.some((l) => l.line.includes('live persistence failed'))).toBe(true);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('control — the grant is current: the catch re-checks, is admitted, and the row stays', async () => {
    const user = await consentingListener('throws-current');
    const socket = appSocket(user);
    const latestFor = jest.spyOn(ConsentRecord, 'latestFor'); // pass-through: only observes the reads
    mockHeld.throwAfterLanding = appliedThenFailed();
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(131) });
    await until(() => mockHeld.holding, 'the held live write');
    const readsBeforeLanding = latestFor.mock.calls.length; // the push gate's own read
    const deletes = jest.spyOn(BiometricLog, 'deleteMany');

    await releaseHeldWrite();
    await until(() => latestFor.mock.calls.length > readsBeforeLanding, 'the consent re-check on the failed insert');
    await Promise.all(latestFor.mock.results.slice(readsBeforeLanding).map((r) => r.value));
    await new Promise((r) => setImmediate(r));

    expect(await countFor(BiometricLog, user)).toBe(1);
    expect(deletes).not.toHaveBeenCalled();
    expect(compensatingLines()).toEqual([]);
  });
});

describe('HX-1 A4 — control: without a withdrawal the row stays', () => {
  it('the post-insert re-check admits it: 1 row, no compensating line, no delete issued', async () => {
    const user = await consentingListener('a4');
    const socket = appSocket(user);
    const latestFor = jest.spyOn(ConsentRecord, 'latestFor'); // pass-through: only observes the reads
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(131) });
    await until(() => mockHeld.holding, 'the held live write');
    const readsBeforeLanding = latestFor.mock.calls.length; // the push gate's own read
    const deletes = jest.spyOn(BiometricLog, 'deleteMany');

    await releaseHeldWrite();
    // Wait for the re-check to be ANSWERED, then let its continuation run to completion: a wrong
    // compensation would have ISSUED its delete by the time the macrotask below fires.
    await until(() => latestFor.mock.calls.length > readsBeforeLanding, 'the post-insert consent re-check');
    await Promise.all(latestFor.mock.results.slice(readsBeforeLanding).map((r) => r.value));
    await new Promise((r) => setImmediate(r));

    expect(await countFor(BiometricLog, user)).toBe(1);
    expect(deletes).not.toHaveBeenCalled();
    expect(compensatingLines()).toEqual([]);
  });
});

describe('HX-1 A5 — a failed compensating delete is its own outcome', () => {
  it('logs outcome=failed with the error TYPE only — not "live persistence failed", no captureException call', async () => {
    const user = await consentingListener('a5');
    const socket = appSocket(user);
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(131) });
    await until(() => mockHeld.holding, 'the held live write');
    await withdraw(user);

    // The compensating delete (the one keyed on the reading's recordedAt) fails once; its message
    // quotes values, the way Mongoose's messages do.
    const realDeleteMany = BiometricLog.deleteMany;
    jest.spyOn(BiometricLog, 'deleteMany').mockImplementation(function failTheKeyedDelete(filter, ...rest) {
      if (filter && 'recordedAt' in filter) {
        return Promise.reject(Object.assign(new Error(`Cast to date failed for value "${filter.recordedAt.toISOString()}" heartRate=131`), { name: 'CastError' }));
      }
      return realDeleteMany.call(BiometricLog, filter, ...rest);
    });

    await releaseHeldWrite();
    const lines = await eventually(compensatingLines, (l) => l.length > 0);
    expect(lines).toEqual([`[biometricHandler] compensating-delete user=${user._id} lane=socket reason=consent_not_current outcome=failed error=CastError`]);
    expect(logged.find((l) => l.line.includes('compensating-delete'))?.level).toBe('error');
    expect(logged.some((l) => l.line.includes('live persistence failed'))).toBe(false);
    expect(captureException).not.toHaveBeenCalled();
    // Truthful: the delete failed, so the row is still there — the line is what a second pass finds.
    expect(await countFor(BiometricLog, user)).toBe(1);
  });
});

describe('HX-1 A6 — the compensating line carries closed tokens only', () => {
  it('matches the closed pattern and carries no bpm, time, activity, offset, source or error text', async () => {
    const user = await consentingListener('a6');
    const socket = appSocket(user);
    const raw = garminRaw(173, { activityType: 1, tzOffsetMinutes: 330 });
    const n = normalize('garmin', raw);
    mockHeld.armed = true;
    await socket._trigger('biometric_push', { source: 'garmin', raw });
    await until(() => mockHeld.holding, 'the held live write');
    await withdraw(user);

    await releaseHeldWrite();
    const [line] = await eventually(compensatingLines, (l) => l.length > 0);
    expect(line).toMatch(CLOSED_LINE);
    for (const value of [String(n.heartRate), n.recordedAt.toISOString(), String(n.recordedAt.getTime()), n.activity, n.source, String(n.tzOffsetMinutes)]) {
      expect(line).not.toContain(value);
    }
    // No number anywhere but the user reference and the outcome's own 0/1.
    expect(line.replace(/user=[0-9a-f]{24}/, '').replace(/outcome=deleted[01]/, '')).not.toMatch(/\d/);
  });

  it('every compensating line any lane writes matches the same pattern', async () => {
    for (const [tag, lane] of [['a6-socket', 'socket'], ['a6-watch', 'watch']]) {
      const token = `whr_${tag}`;
      const user = await consentingListener(tag, { watchToken: token });
      const socket = appSocket(user);
      mockHeld.armed = true;
      if (lane === 'socket') await socket._trigger('biometric_push', { source: 'garmin', raw: garminRaw(99) });
      else await request(app).post('/api/integrations/watch/hr').set('Authorization', `Bearer ${token}`).send({ heartRate: 99, activityType: 0, ts: new Date(Date.now() - 60_000).toISOString() });
      await until(() => mockHeld.holding, 'the held live write');
      await withdraw(user);
      await releaseHeldWrite();
      await eventually(compensatingLines, (l) => l.some((x) => x.includes(`lane=${lane}`)));
      Object.assign(mockHeld, { holding: false, landed: false, inserted: null, releaseInsert: null });
    }
    const lines = compensatingLines();
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(CLOSED_LINE);
  });
});
