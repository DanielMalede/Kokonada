'use strict';

// BE-016 (DEC-111, DEC-118) — withdrawing health-data consent erases the session heart-rate snapshot
// and the values derived from it, on REAL MongoDB. Every assertion reads the stored rows back: the
// History DTO's own override (A3) is display and is never counted as erasure here.
//
// Real: the session-health erasure module and its models, the encrypted-field plugin, the consent
// history. Faked: Redis, by a small STATEFUL store that answers SCAN/DEL/SET/GET over real keys, so a
// key the purge misses is still there to be found.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
delete process.env.REDIS_URL;

// consentController withholds the user's open sockets after the erasure; there are none here.
jest.mock('../app/sockets/index', () => ({ getIo: () => null }));

jest.mock('../app/config/redis', () => {
  const store = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const fake = {
    store,
    failNext: null, // name of a method that throws once, for the strict-purge failure tests
    calls: [],
    _maybeFail(method) {
      if (fake.failNext === method) {
        fake.failNext = null;
        throw Object.assign(new Error('READONLY You can\'t write against a read only replica (pool:abc)'), { name: 'ReplyError' });
      }
    },
    async scan(cursor, _match, pattern) { fake.calls.push('scan'); fake._maybeFail('scan'); const re = glob(pattern); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
    async del(...keys) { fake.calls.push('del'); fake._maybeFail('del'); return keys.flat().reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0); },
    async set(key, value) { store.set(key, value); return 'OK'; },
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async exists(key) { return store.has(key) ? 1 : 0; },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

const express = require('express');
const request = require('supertest');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent = require('../app/models/ServeEvent');
const { __fake: redis } = require('../app/config/redis');
const {
  eraseSessionHealth, eraseSessionHealthOnWithdrawal, undoRunWrites,
} = require('../app/services/privacy/sessionHealthErasure');
const { signToken } = require('../app/utils/jwt');
const { withdrawConsent } = require('../app/services/privacy/consent');
const consentController = require('../app/controllers/consentController');
const consentRouter = require('../app/routes/consent');
const sessionsRouter = require('../app/routes/sessions');

const app = express();
app.use(express.json());
app.use('/api/consent', consentRouter);
app.use('/api/sessions', sessionsRouter);

jest.setTimeout(120000);

const DAY = 24 * 3600_000;
const MIN = 60_000;
const PURPOSE = 'health_biometric_processing';

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_session_health_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), ConsentRecord.deleteMany({}), PlaylistSession.deleteMany({}), ServeEvent.deleteMany({})]);
  redis.store.clear();
  redis.failNext = null;
  redis.calls.length = 0;
});
afterEach(() => { jest.restoreAllMocks(); });

const ago = (ms) => new Date(Date.now() - ms);

async function listener(tag) {
  return User.create({ ssoProvider: 'google', ssoId: `sso-${tag}`, email: `${tag}@example.com` });
}
// A consent row at an exact time (the history the erasure reads), written straight to the collection.
async function consentAt(user, status, at) {
  await ConsentRecord.collection.insertOne({
    _id: new mongoose.Types.ObjectId(), userId: user._id, purpose: PURPOSE, consentVersion: 1, status,
    ...(status === 'granted' ? { grantedAt: at } : { withdrawnAt: at }), createdAt: at, updatedAt: at,
  });
}

// A generated session as biometricHandler writes one, then back-dated on the raw collection.
async function session(user, createdAt, over = {}) {
  const doc = await PlaylistSession.create({
    userId: user._id,
    emotionTaps: [{ x: 0.3, y: 0.4 }],
    contextPrompt: '',
    moodKey: 'calm',
    biometricSnapshot: { heartRate: null, activity: null },
    targetBpm: 96, targetEnergy: 0.4, targetValence: 0.55,
    targetGenres: ['ambient'],
    musicProvider: 'spotify',
    externalPlaylistId: 'hidden-1',
    trackIds: ['t1', 't2'], trackKeys: ['isrc:A', 'isrc:B'],
    trackSummary: [{ id: 't1', title: 'Song A', artist: 'Artist A' }],
    skipCount: 1,
    ...over,
  });
  await PlaylistSession.collection.updateOne({ _id: doc._id }, { $set: { createdAt } });
  return doc._id;
}
const raw = (id) => PlaylistSession.collection.findOne({ _id: id });
const serve = (user, servedAt, over = {}) => ServeEvent.create({
  userId: user._id, canonicalKey: 'isrc:A', moodKey: 'calm', bioState: { tempoBand: null, activity: null }, sessionId: '7', servedAt, ...over,
}).then((d) => d._id);
const rawServe = (id) => ServeEvent.collection.findOne({ _id: id });

// What the strip must never change on any session row (its own record and its tracks).
const KEPT = ['emotionTaps', 'contextPrompt', 'musicProvider', 'externalPlaylistId', 'trackIds', 'trackKeys', 'trackSummary', 'skipCount', 'createdAt', 'userId'];
const pick = (doc, fields) => Object.fromEntries(fields.map((f) => [f, doc[f]]));

async function snapshotAll() {
  const out = {};
  for (const [name, c] of [['sessions', PlaylistSession.collection], ['serves', ServeEvent.collection], ['users', User.collection]]) {
    out[name] = await c.find({}).sort({ _id: 1 }).toArray();
  }
  out.redis = [...redis.store.keys()].sort();
  return JSON.stringify(out);
}

// User A: granted 10 days ago, withdrew 2 days ago. Every kind of row §1 names.
async function seedWithdrawer(user) {
  const W = ago(2 * DAY);
  await consentAt(user, 'granted', ago(10 * DAY));
  await consentAt(user, 'withdrawn', W);
  const rows = {
    heart: await session(user, ago(5 * DAY), {
      moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 131, activity: 'running' },
      targetBpm: 150, targetEnergy: 0.9, targetValence: 0.62, targetGenres: ['edm', 'drum and bass'], emotionTaps: [{ x: 0, y: 0 }],
    }),
    moodWithHr: await session(user, ago(4 * DAY), { moodKey: 'calm', biometricSnapshot: { heartRate: 88, activity: 'running' } }),
    moodNoHr: await session(user, ago(3 * DAY), { moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: 'running' } }),
    textWithHr: await session(user, ago(3 * DAY), { moodKey: null, contextPrompt: 'long day at work', biometricSnapshot: { heartRate: 77, activity: null } }),
    // older than the trim: sessionTrim already removed the heart rate and the note (DT-1b′)
    trimmedShared: await session(user, ago(40 * DAY), { moodKey: 'uplift', contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'running' } }),
    trimmedChip: await session(user, ago(41 * DAY), { moodKey: 'calm', contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'winding down' } }),
    // after the withdrawal, mood only: lawful targets
    afterWithdrawal: await session(user, ago(1 * DAY), { moodKey: 'unwind', biometricSnapshot: { heartRate: null, activity: 'workout' } }),
  };
  const serves = {
    bio: await serve(user, ago(5 * DAY), { moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } }),
    moodBand: await serve(user, ago(4 * DAY), { moodKey: 'calm', bioState: { tempoBand: 'active', activity: 'running' } }),
    moodActivityOnly: await serve(user, ago(4 * DAY), { moodKey: 'calm', bioState: { tempoBand: null, activity: 'resting' } }),
    plain: await serve(user, ago(3 * DAY), { moodKey: 'calm' }),
  };
  const id = String(user._id);
  for (const key of [`ledger:${id}:served`, `ledger:${id}:mood:bio:peak:running`, `ledger:${id}:mood:calm`, `pool:${id}:bio:peak:running`,
    `pool:${id}:calm`, `buffer:${id}:bio:peak:running`, `bio:baseline:${id}`, `bio:affect:${id}`]) {
    redis.store.set(key, 'x');
  }
  return { W, rows, serves };
}

// User B: a consenting listener who withdraws nothing. Must be untouched by A's erasure.
async function seedBystander(user) {
  await consentAt(user, 'granted', ago(10 * DAY));
  await session(user, ago(5 * DAY), { moodKey: 'bio:active:walking', biometricSnapshot: { heartRate: 101, activity: 'walking' } });
  await session(user, ago(4 * DAY), { moodKey: 'calm', biometricSnapshot: { heartRate: 70, activity: 'running' } });
  await serve(user, ago(5 * DAY), { moodKey: 'bio:active:walking', bioState: { tempoBand: 'active', activity: 'walking' } });
  const id = String(user._id);
  for (const key of [`ledger:${id}:served`, `buffer:${id}:bio:active:walking`, `bio:baseline:${id}`]) redis.store.set(key, 'x');
}
const bystanderState = async (user) => JSON.stringify({
  sessions: await PlaylistSession.collection.find({ userId: user._id }).sort({ _id: 1 }).toArray(),
  serves: await ServeEvent.collection.find({ userId: user._id }).sort({ _id: 1 }).toArray(),
  keys: [...redis.store.keys()].filter((k) => k.includes(String(user._id))).sort(),
});
const GLOBAL_KEYS = ['gemini:openai/gpt-oss-20b:abc', 'af:isrc:A', 'revoked:jti:xyz'];

describe('the erasure module on real Mongo (T4) — the operation list', () => {
  it('removes exactly the §1 fields from each kind of row, for this user only', async () => {
    const a = await listener('a');
    const b = await listener('b');
    const { W, rows, serves } = await seedWithdrawer(a);
    await seedBystander(b);
    for (const k of GLOBAL_KEYS) redis.store.set(k, 'x');
    const before = {};
    for (const [name, id] of Object.entries(rows)) before[name] = await raw(id);
    const bBefore = await bystanderState(b);

    const counts = await eraseSessionHealth(a._id, { heartRateBefore: new Date(), targetsBefore: W }, { purgeRedis: true });

    const after = {};
    for (const [name, id] of Object.entries(rows)) after[name] = await raw(id);
    // A heart session: the Live mark, no heart rate, no activity, no targets, no band genres. Tracks stay (T1).
    expect(after.heart).toMatchObject({
      moodKey: 'bio:', biometricSnapshot: { heartRate: null, activity: null },
      targetBpm: null, targetEnergy: null, targetValence: null, targetGenres: [],
    });
    // A mood session that carried a heart rate: its activity goes with it (A2); its mood and genres stay.
    expect(after.moodWithHr).toMatchObject({
      moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: null },
      targetBpm: null, targetEnergy: null, targetValence: null, targetGenres: ['ambient'],
    });
    // A young mood session with no heart rate: the chip stays; the targets go (P1).
    expect(after.moodNoHr).toMatchObject({
      moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: 'running' }, targetBpm: null, targetEnergy: null, targetValence: null,
    });
    // A text-only session with a heart rate: the free text stays (C1).
    expect(after.textWithHr).toMatchObject({ moodKey: null, biometricSnapshot: { heartRate: null, activity: null }, targetBpm: null });
    expect(after.textWithHr.contextPrompt).toBe(before.textWithHr.contextPrompt);
    // DT-1b′ O1: older than the trim, "running" may be the watch's → removed; "winding down" is only a chip → kept.
    expect(after.trimmedShared.biometricSnapshot.activity).toBeNull();
    expect(after.trimmedChip.biometricSnapshot.activity).toBe('winding down');
    expect(after.trimmedShared.targetValence).toBeNull();
    expect(after.trimmedChip.targetValence).toBeNull();
    // After the withdrawal, mood only: nothing to remove — its targets were never shaped by the heart rate.
    expect(after.afterWithdrawal).toEqual(before.afterWithdrawal);
    // Every session keeps its own record and its tracks.
    for (const name of Object.keys(rows)) expect(pick(after[name], KEPT)).toEqual(pick(before[name], KEPT));

    // Serve rows: band and activity gone everywhere; a bio key gone; track, time and session kept.
    expect(await rawServe(serves.bio)).toMatchObject({ moodKey: null, bioState: { tempoBand: null, activity: null }, canonicalKey: 'isrc:A', sessionId: '7' });
    expect(await rawServe(serves.moodBand)).toMatchObject({ moodKey: 'calm', bioState: { tempoBand: null, activity: null } });
    expect(await rawServe(serves.moodActivityOnly)).toMatchObject({ moodKey: 'calm', bioState: { tempoBand: null, activity: null } });

    // Redis: A's whole registry is gone; B's keys and the global caches stay.
    expect([...redis.store.keys()].filter((k) => k.includes(String(a._id)))).toEqual([]);
    for (const k of GLOBAL_KEYS) expect(redis.store.has(k)).toBe(true);

    expect(counts).toEqual({ sessions: 4, sessionTargets: 3, serveEvents: 3, redisKeys: 8 });
    expect(await PlaylistSession.countDocuments({ userId: a._id })).toBe(7); // no session is deleted
    expect(await bystanderState(b)).toBe(bBefore);
  });

  // N7 (round 1): inside the withdrawal request, the two exact-name keys are deleted by name. A SCAN
  // walks the whole keyspace, so it is spent only on the namespaces that need a pattern.
  it('the strict purge deletes bio:baseline: and bio:affect: by name and SCANs only the wildcard namespaces', async () => {
    const a = await listener('a');
    await seedWithdrawer(a);
    const scans = jest.spyOn(redis, 'scan');
    const dels = jest.spyOn(redis, 'del');

    const counts = await eraseSessionHealth(a._id, { heartRateBefore: new Date(), targetsBefore: new Date() }, { purgeRedis: true });

    expect(counts.redisKeys).toBe(8);
    expect(scans.mock.calls.map((c) => c[2])).toEqual([`ledger:${a._id}:*`, `pool:${a._id}:*`, `buffer:${a._id}:*`]);
    expect(dels.mock.calls.flat()).toEqual(expect.arrayContaining([`bio:baseline:${a._id}`, `bio:affect:${a._id}`]));
    expect([...redis.store.keys()].filter((k) => k.includes(String(a._id)))).toEqual([]);
  });

  it('is idempotent: a second run changes nothing and counts nothing', async () => {
    const a = await listener('a');
    const { W } = await seedWithdrawer(a);
    const windows = { heartRateBefore: new Date(), targetsBefore: W };
    await eraseSessionHealth(a._id, windows, { purgeRedis: true });
    const once = await snapshotAll();

    const counts = await eraseSessionHealth(a._id, windows, { purgeRedis: true });

    expect(counts).toEqual({ sessions: 0, sessionTargets: 0, serveEvents: 0, redisKeys: 0 });
    expect(await snapshotAll()).toBe(once);
  });

  it('the cutoffs are strict: a row made exactly at a cutoff keeps its values', async () => {
    const a = await listener('a');
    const hb = ago(1 * DAY);
    const tb = ago(2 * DAY);
    const atHb = await session(a, hb, { moodKey: 'bio:active:walking', biometricSnapshot: { heartRate: 101, activity: 'walking' } });
    const atTb = await session(a, tb, { moodKey: 'calm' });
    const serveAtHb = await serve(a, hb, { moodKey: 'bio:active:walking', bioState: { tempoBand: 'active', activity: 'walking' } });

    await eraseSessionHealth(a._id, { heartRateBefore: hb, targetsBefore: tb });

    expect(await raw(atHb)).toMatchObject({ moodKey: 'bio:active:walking', biometricSnapshot: { heartRate: expect.anything(), activity: 'walking' } });
    expect((await raw(atTb)).targetBpm).toBe(96);
    expect(await rawServe(serveAtHb)).toMatchObject({ moodKey: 'bio:active:walking', bioState: { tempoBand: 'active' } });
  });

  it('a re-granted account keeps every row made after the re-grant (lawful), and loses the rest', async () => {
    const a = await listener('a');
    const W = ago(6 * DAY);
    const G2 = ago(4 * DAY);
    const beforeW = await session(a, ago(8 * DAY), { moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 140, activity: 'running' } });
    const between = await session(a, ago(5 * DAY), { moodKey: 'calm', biometricSnapshot: { heartRate: 92, activity: 'running' } });
    const afterG2 = await session(a, ago(1 * DAY), { moodKey: 'bio:active:walking', biometricSnapshot: { heartRate: 101, activity: 'walking' } });
    const lawful = await raw(afterG2);

    await eraseSessionHealth(a._id, { heartRateBefore: G2, targetsBefore: W });

    expect(await raw(beforeW)).toMatchObject({ moodKey: 'bio:', targetBpm: null });
    // Made between the withdrawal and the re-grant: its heart rate went (no grant covered it); its
    // targets were made after the withdrawal and fall outside P1's window only if it had no heart rate.
    expect(await raw(between)).toMatchObject({ biometricSnapshot: { heartRate: null, activity: null }, targetBpm: null });
    expect(await raw(afterG2)).toEqual(lawful);
  });
});

describe('eraseSessionHealthOnWithdrawal — the withdrawal entry point (T4)', () => {
  it('a user who never granted is untouched, and no erasure is recorded as owed', async () => {
    const a = await listener('a');
    await consentAt(a, 'withdrawn', ago(1 * MIN));
    await session(a, ago(3 * DAY), { moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 131, activity: 'running' } });
    redis.store.set(`buffer:${a._id}:bio:peak:running`, 'x');
    const before = await snapshotAll();

    const out = await eraseSessionHealthOnWithdrawal(a._id);

    expect(out.status).toBe('skipped');
    expect(await snapshotAll()).toBe(before);
  });

  it('reads the history itself: granted then withdrawn erases, and the pending record is set while it runs and cleared after', async () => {
    const a = await listener('a');
    await consentAt(a, 'granted', ago(10 * DAY));
    await consentAt(a, 'withdrawn', ago(1 * MIN));
    const heart = await session(a, ago(3 * DAY), { moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 131, activity: 'running' } });
    const seenPending = [];
    const realUpdateMany = ServeEvent.updateMany.bind(ServeEvent);
    jest.spyOn(ServeEvent, 'updateMany').mockImplementation(async (...args) => {
      seenPending.push((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt);
      return realUpdateMany(...args);
    });

    const out = await eraseSessionHealthOnWithdrawal(a._id);

    expect(out).toEqual({ status: 'purged', counts: { sessions: 1, sessionTargets: 0, serveEvents: 0, redisKeys: 0 } });
    expect((await raw(heart)).moodKey).toBe('bio:');
    expect(seenPending.length).toBeGreaterThan(0);
    for (const v of seenPending) expect(v).toBeInstanceOf(Date);
    expect((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt).toBeNull();
  });

  it('a failing step: every other step still runs, the pending record stays, and the error names the step and its type only', async () => {
    const a = await listener('a');
    const { rows, serves } = await seedWithdrawer(a);
    const realUpdateMany = ServeEvent.updateMany.bind(ServeEvent);
    let failed = false;
    jest.spyOn(ServeEvent, 'updateMany').mockImplementation(async (filter, ...rest) => {
      if (!failed && filter?.moodKey) {
        failed = true;
        throw Object.assign(new Error('connection 3 to 10.0.0.7:27017 closed (heartRate=131)'), { name: 'MongoNetworkError' });
      }
      return realUpdateMany(filter, ...rest);
    });

    const err = await eraseSessionHealthOnWithdrawal(a._id).then(() => null, (e) => e);

    expect(err).not.toBeNull();
    expect(err.failedSteps).toEqual(['serveBioKeys:MongoNetworkError']);
    expect(err.message).not.toMatch(/10\.0\.0\.7|131/);
    // the band step still ran over all three banded rows, the bio one included
    expect(err.counts).toEqual({ sessions: 4, sessionTargets: 3, serveEvents: 3, redisKeys: 8 });
    expect((await raw(rows.heart)).moodKey).toBe('bio:');
    expect((await rawServe(serves.moodBand)).bioState.tempoBand).toBeNull(); // the next serve step ran
    expect((await rawServe(serves.bio)).moodKey).toBe('bio:peak:running'); // the failed one did not
    expect((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt).toBeInstanceOf(Date);
  });

  it('a strict Redis failure is a failed step: the Mongo steps ran, the pending record stays', async () => {
    const a = await listener('a');
    const { rows } = await seedWithdrawer(a);
    redis.failNext = 'scan';

    const err = await eraseSessionHealthOnWithdrawal(a._id).then(() => null, (e) => e);

    expect(err.failedSteps).toEqual(['redisKeys:ReplyError']);
    expect((await raw(rows.heart)).moodKey).toBe('bio:');
    expect((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt).toBeInstanceOf(Date);
  });

  it('compare-and-set: a newer pending record written while this run works survives its success', async () => {
    const a = await listener('a');
    await seedWithdrawer(a);
    const newer = new Date(Date.now() + 60_000);
    const realUpdateMany = PlaylistSession.updateMany.bind(PlaylistSession);
    let once = false;
    jest.spyOn(PlaylistSession, 'updateMany').mockImplementation(async (...args) => {
      if (!once) { once = true; await User.collection.updateOne({ _id: a._id }, { $set: { healthErasurePendingAt: newer } }); }
      return realUpdateMany(...args);
    });

    await eraseSessionHealthOnWithdrawal(a._id);

    expect((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt).toEqual(newer);
  });
});

describe('a missing user id never widens a filter (mass-erasure guard, real Mongo)', () => {
  it.each([undefined, null, '', 'not-an-id', 'aaaaaaaaaaaa'])('%p changes nothing for anyone', async (bad) => {
    const a = await listener('a');
    const b = await listener('b');
    await seedWithdrawer(a);
    await seedBystander(b);
    const before = await snapshotAll();

    await expect(eraseSessionHealthOnWithdrawal(bad)).resolves.toMatchObject({ status: 'skipped' });
    await expect(eraseSessionHealth(bad, { heartRateBefore: new Date(), targetsBefore: new Date() }, { purgeRedis: true }))
      .resolves.toEqual({ sessions: 0, sessionTargets: 0, serveEvents: 0, redisKeys: 0 });
    await expect(undoRunWrites({ userId: bad, sessionId: undefined, servedAt: undefined, moodKey: 'bio:peak:running', stripActivity: true }))
      .resolves.toEqual({ changed: 0 });

    expect(await snapshotAll()).toBe(before);
  });
});

// N9 (round 1): a cutoff that is not a finite Date never reaches a filter. Mongoose would cast a date
// string and run the erasure, and an Invalid Date would fail every step.
describe('cutoffs that are not finite Dates erase nothing (defence in depth, real Mongo)', () => {
  const W = () => ago(2 * DAY);
  it.each([
    ['a missing heart-rate cutoff', () => ({ targetsBefore: W() })],
    ['a missing targets cutoff', () => ({ heartRateBefore: new Date() })],
    ['an Invalid Date', () => ({ heartRateBefore: new Date(NaN), targetsBefore: W() })],
    ['a date string', () => ({ heartRateBefore: new Date().toISOString(), targetsBefore: W().toISOString() })],
    ['a number', () => ({ heartRateBefore: Date.now(), targetsBefore: W().getTime() })],
  ])('%s: zero counts and every row unchanged', async (_label, windows) => {
    const a = await listener('a');
    await seedWithdrawer(a);
    const before = await snapshotAll();

    await expect(eraseSessionHealth(a._id, windows(), { purgeRedis: true }))
      .resolves.toEqual({ sessions: 0, sessionTargets: 0, serveEvents: 0, redisKeys: 0 });

    expect(await snapshotAll()).toBe(before);
  });
});

describe('undoRunWrites — exactly this run\'s writes, never the user\'s history (R-A)', () => {
  it('strips this run\'s session by id, scrubs this run\'s serve batch by time, and deletes this run\'s band keys', async () => {
    const a = await listener('a');
    const id = String(a._id);
    const older = await session(a, ago(2 * DAY), { moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 133, activity: 'running' } });
    const olderBefore = await raw(older);
    const run = await session(a, ago(1 * MIN), { moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 131, activity: 'running' }, targetGenres: ['edm'] });
    const servedAt = ago(1 * MIN);
    const runServe = await serve(a, servedAt, { moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } });
    const otherServe = await serve(a, ago(2 * DAY), { moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } });
    for (const k of [`buffer:${id}:bio:peak:running`, `pool:${id}:bio:peak:running`, `ledger:${id}:mood:bio:peak:running`,
      `ledger:${id}:served`, `pool:${id}:calm`, `buffer:${id}:bio:active:walking`, `bio:baseline:${id}`]) redis.store.set(k, 'x');

    const out = await undoRunWrites({ userId: a._id, sessionId: run, servedAt, moodKey: 'bio:peak:running', stripActivity: true });

    expect(out.changed).toBeGreaterThan(0);
    expect(await raw(run)).toMatchObject({ moodKey: 'bio:', biometricSnapshot: { heartRate: null, activity: null }, targetBpm: null, targetGenres: [] });
    expect(await raw(older)).toEqual(olderBefore);
    expect(await rawServe(runServe)).toMatchObject({ moodKey: null, bioState: { tempoBand: null, activity: null } });
    expect(await rawServe(otherServe)).toMatchObject({ moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } });
    expect([...redis.store.keys()].sort()).toEqual([`bio:baseline:${id}`, `buffer:${id}:bio:active:walking`, `ledger:${id}:served`, `pool:${id}:calm`].sort());
  });

  it('a mood run shaped by the stored health profile loses its targets; with no heart rate its chip stays', async () => {
    const a = await listener('a');
    const run = await session(a, ago(1 * MIN), { moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: 'running' } });

    await undoRunWrites({ userId: a._id, sessionId: run, servedAt: null, moodKey: 'calm', stripActivity: false });

    expect(await raw(run)).toMatchObject({ moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: 'running' }, targetBpm: null, targetEnergy: null, targetValence: null, targetGenres: ['ambient'] });
  });

  it('a run that started with a heart rate loses its activity even when the row was written without one', async () => {
    const a = await listener('a');
    const run = await session(a, ago(1 * MIN), { moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: 'resting' } });

    await undoRunWrites({ userId: a._id, sessionId: run, servedAt: null, moodKey: 'calm', stripActivity: true });

    expect((await raw(run)).biometricSnapshot.activity).toBeNull();
  });

  it('a run whose session holds nothing to strip changes nothing, and says so (changed=0)', async () => {
    const a = await listener('a');
    const run = await session(a, ago(1 * MIN), {
      moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: null }, targetBpm: null, targetEnergy: null, targetValence: null,
    });
    const before = await raw(run);

    const out = await undoRunWrites({ userId: a._id, sessionId: run, servedAt: null, moodKey: 'calm', stripActivity: true });

    expect(out).toEqual({ changed: 0 });
    expect(await raw(run)).toEqual(before); // not even updatedAt moves
  });

  it('with no valid session id and no serve time it issues no Mongo write at all', async () => {
    const a = await listener('a');
    await session(a, ago(1 * MIN), { moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 131, activity: 'running' } });
    await serve(a, ago(1 * MIN), { moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } });
    const before = await snapshotAll();
    const sessionWrites = jest.spyOn(PlaylistSession, 'updateOne');
    const serveWrites = jest.spyOn(ServeEvent, 'updateMany');

    await undoRunWrites({ userId: a._id, sessionId: 'nope', servedAt: 'yesterday', moodKey: 'calm', stripActivity: true });

    expect(sessionWrites).not.toHaveBeenCalled();
    expect(serveWrites).not.toHaveBeenCalled();
    expect(await snapshotAll()).toBe(before);
  });
});

// ── T5: the withdrawal itself, through the real consent router and the real withdrawConsent ─────────

// The same kinds of row as seedWithdrawer, for a user whose grant is CURRENT: the HTTP call writes
// the withdrawal.
async function seedConsentingListener(user) {
  await consentAt(user, 'granted', ago(10 * DAY));
  const rows = {
    heart: await session(user, ago(5 * DAY), {
      moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 131, activity: 'running' },
      targetBpm: 150, targetEnergy: 0.9, targetValence: 0.62, targetGenres: ['edm'], emotionTaps: [{ x: 0, y: 0 }],
    }),
    moodWithHr: await session(user, ago(4 * DAY), { moodKey: 'calm', biometricSnapshot: { heartRate: 88, activity: 'running' } }),
    moodNoHr: await session(user, ago(3 * DAY), { moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: 'walking' } }),
    textWithHr: await session(user, ago(3 * DAY), { moodKey: null, contextPrompt: 'long day at work', biometricSnapshot: { heartRate: 77, activity: null } }),
    trimmedShared: await session(user, ago(40 * DAY), { moodKey: 'uplift', contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'running' } }),
    trimmedChip: await session(user, ago(41 * DAY), { moodKey: 'calm', contextPrompt: null, biometricSnapshot: { heartRate: null, activity: 'winding down' } }),
  };
  const serves = {
    bio: await serve(user, ago(5 * DAY), { moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } }),
    moodBand: await serve(user, ago(4 * DAY), { moodKey: 'calm', bioState: { tempoBand: 'active', activity: 'running' } }),
    plain: await serve(user, ago(3 * DAY), { moodKey: 'calm' }),
  };
  const id = String(user._id);
  for (const key of [`ledger:${id}:served`, `ledger:${id}:mood:bio:peak:running`, `pool:${id}:bio:peak:running`,
    `buffer:${id}:bio:peak:running`, `bio:baseline:${id}`, `bio:affect:${id}`]) redis.store.set(key, 'x');
  return { rows, serves };
}

function withdrawOverHttp(user) {
  return request(app)
    .post('/api/consent/withdraw')
    .set('Authorization', `Bearer ${signToken({ userId: String(user._id) })}`)
    .send({ purpose: PURPOSE });
}

// The ONE accountability line: the BE-015 tokens, then BE-016's. Closed tokens and counts only.
const WITHDRAWAL_LINE = /^\[consent-withdrawal\] user=[0-9a-f]{24} purpose=health_biometric_processing providerErasureFailures=\d+ learning=(?:purged|skipped|failed) rewardEvents=\d+ personalWeights=\d+ sessionHealth=(?:purged|skipped|failed) sessions=\d+ sessionTargets=\d+ serveEvents=\d+ redisKeys=\d+ sessionHealthFailed=(?:none|[a-zA-Z]+:[A-Za-z][A-Za-z0-9]*(?:,[a-zA-Z]+:[A-Za-z][A-Za-z0-9]*)*)$/;

let lines;
function captureLogs() {
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
}
const withdrawalLines = () => lines.filter((l) => l.startsWith('[consent-withdrawal]'));

describe('POST /api/consent/withdraw erases the session health data (T5, real router, real Mongo)', () => {
  beforeEach(captureLogs);

  it('before it answers: every §1 field is gone for A, B keeps everything, the session count holds, one counts-only line', async () => {
    const a = await listener('a');
    const b = await listener('b');
    const { rows, serves } = await seedConsentingListener(a);
    await seedBystander(b);
    const bBefore = await bystanderState(b);
    const textBefore = (await raw(rows.textWithHr)).contextPrompt;

    const res = await withdrawOverHttp(a);

    // Read straight after the response, with no wait: the erasure ran before it was written.
    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);
    expect(await raw(rows.heart)).toMatchObject({ moodKey: 'bio:', biometricSnapshot: { heartRate: null, activity: null }, targetBpm: null, targetEnergy: null, targetValence: null, targetGenres: [] });
    expect((await raw(rows.heart)).trackIds).toEqual(['t1', 't2']);
    expect(await raw(rows.moodWithHr)).toMatchObject({ moodKey: 'calm', biometricSnapshot: { heartRate: null, activity: null }, targetValence: null, targetGenres: ['ambient'] });
    expect(await raw(rows.moodNoHr)).toMatchObject({ biometricSnapshot: { heartRate: null, activity: 'walking' }, targetBpm: null });
    expect(await raw(rows.textWithHr)).toMatchObject({ moodKey: null, biometricSnapshot: { heartRate: null, activity: null } });
    expect((await raw(rows.textWithHr)).contextPrompt).toBe(textBefore);
    expect((await raw(rows.trimmedShared)).biometricSnapshot.activity).toBeNull();
    expect((await raw(rows.trimmedChip)).biometricSnapshot.activity).toBe('winding down');
    expect(await rawServe(serves.bio)).toMatchObject({ moodKey: null, bioState: { tempoBand: null, activity: null }, canonicalKey: 'isrc:A' });
    expect(await rawServe(serves.moodBand)).toMatchObject({ moodKey: 'calm', bioState: { tempoBand: null, activity: null } });
    expect([...redis.store.keys()].filter((k) => k.includes(String(a._id)))).toEqual([]);
    expect(await PlaylistSession.countDocuments({ userId: a._id })).toBe(6);
    expect((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt).toBeNull();
    expect(await bystanderState(b)).toBe(bBefore);

    // bio:baseline and bio:affect go first, in the wearable erasure; the strict purge takes the other four.
    expect(withdrawalLines()).toEqual([
      `[consent-withdrawal] user=${a._id} purpose=${PURPOSE} providerErasureFailures=0 learning=purged rewardEvents=0 personalWeights=0 sessionHealth=purged sessions=4 sessionTargets=3 serveEvents=2 redisKeys=4 sessionHealthFailed=none`,
    ]);
  });

  it('every erasure step completes BEFORE the response is written', async () => {
    const a = await listener('a');
    await seedConsentingListener(a);
    const events = [];
    const realSessions = PlaylistSession.updateMany.bind(PlaylistSession);
    const realServes = ServeEvent.updateMany.bind(ServeEvent);
    jest.spyOn(PlaylistSession, 'updateMany').mockImplementation(async (...args) => { const out = await realSessions(...args); events.push('sessions'); return out; });
    jest.spyOn(ServeEvent, 'updateMany').mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, 50)); // slow, so a fire-and-forget erasure would lose the race
      const out = await realServes(...args);
      events.push('serves');
      return out;
    });
    const realScan = redis.scan;
    jest.spyOn(redis, 'scan').mockImplementation(async (...args) => { const out = await realScan(...args); events.push('redis'); return out; });
    const res = {
      statusCode: 200,
      status: jest.fn(function status(c) { this.statusCode = c; return this; }),
      json: jest.fn(function json() { events.push('response'); return this; }),
    };

    await consentController.withdraw({ user: { _id: a._id }, body: { purpose: PURPOSE } }, res, jest.fn());

    expect(events.filter((e) => e === 'sessions')).toHaveLength(4);
    expect(events.filter((e) => e === 'serves')).toHaveLength(2);
    expect(events).toContain('redis');
    expect(events[events.length - 1]).toBe('response');
    expect(events.indexOf('redis')).toBeGreaterThan(events.lastIndexOf('serves')); // Redis after Mongo (RD1)
  });

  it('a repeat withdrawal changes nothing and counts nothing (idempotent)', async () => {
    const a = await listener('a');
    await seedConsentingListener(a);
    await withdrawOverHttp(a);
    const before = JSON.parse(await snapshotAll());
    lines.length = 0;

    const res = await withdrawOverHttp(a);

    expect(res.status).toBe(200);
    const after = JSON.parse(await snapshotAll());
    expect(after.sessions).toEqual(before.sessions);
    expect(after.serves).toEqual(before.serves);
    expect(after.redis).toEqual(before.redis);
    expect(withdrawalLines()[0]).toMatch(/learning=skipped .* sessionHealth=purged sessions=0 sessionTargets=0 serveEvents=0 redisKeys=0 sessionHealthFailed=none$/);
  });

  it('a user who never granted is untouched (G3) and the line says sessionHealth=skipped', async () => {
    const a = await listener('a');
    await session(a, ago(3 * DAY), { moodKey: 'bio:peak:running', biometricSnapshot: { heartRate: 131, activity: 'running' } });
    await serve(a, ago(3 * DAY), { moodKey: 'bio:peak:running', bioState: { tempoBand: 'peak', activity: 'running' } });
    const before = JSON.parse(await snapshotAll());

    expect((await withdrawOverHttp(a)).status).toBe(200);

    const after = JSON.parse(await snapshotAll());
    expect(after.sessions).toEqual(before.sessions);
    expect(after.serves).toEqual(before.serves);
    expect(withdrawalLines()[0]).toMatch(/learning=skipped .* sessionHealth=skipped sessions=0 sessionTargets=0 serveEvents=0 redisKeys=0 sessionHealthFailed=none$/);
  });

  it('a withdrawal made before this change is finished by a repeat withdrawal (the retry path); learning stays skipped', async () => {
    const a = await listener('a');
    const { rows } = await seedConsentingListener(a);
    await consentAt(a, 'withdrawn', ago(1 * DAY)); // withdrawn yesterday, under the old code: nothing erased

    expect((await withdrawOverHttp(a)).status).toBe(200);

    expect((await raw(rows.heart)).moodKey).toBe('bio:');
    expect((await raw(rows.moodWithHr)).biometricSnapshot.heartRate).toBeNull();
    expect(withdrawalLines()[0]).toMatch(/learning=skipped .* sessionHealth=purged sessions=4 /);
  });

  it('a ServeEvent step that fails once: the withdrawal still answers 200, session-health is recorded, the owed record stays', async () => {
    const a = await listener('a');
    const { rows } = await seedConsentingListener(a);
    const realServes = ServeEvent.updateMany.bind(ServeEvent);
    let failed = false;
    jest.spyOn(ServeEvent, 'updateMany').mockImplementation(async (filter, ...rest) => {
      if (!failed) { failed = true; throw Object.assign(new Error('heartRate=131 at 10.1.1.1'), { name: 'MongoServerError' }); }
      return realServes(filter, ...rest);
    });

    const res = await withdrawOverHttp(a);

    expect(res.status).toBe(200);
    expect(res.body.granted).toBe(false);
    expect((await raw(rows.heart)).moodKey).toBe('bio:'); // the steps that could run, ran
    expect((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt).toBeInstanceOf(Date);
    const [line] = withdrawalLines();
    expect(line).toMatch(WITHDRAWAL_LINE);
    expect(line).toContain('providerErasureFailures=0');
    expect(line).toContain('sessionHealth=failed');
    expect(line).toMatch(/ sessionHealthFailed=serveBioKeys:MongoServerError$/); // N6: the step and its type, never the message
    expect(lines.join('\n')).not.toMatch(/10\.1\.1\.1|heartRate=131/);
  });

  it('withdrawConsent reports the failure as session-health, never as a provider or learning', async () => {
    const a = await listener('a');
    await seedConsentingListener(a);
    jest.spyOn(ServeEvent, 'updateMany').mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'MongoServerError' }));

    const out = await withdrawConsent(a._id, PURPOSE);

    expect(out.erasureFailures).toEqual(['session-health']);
    expect(out.record.status).toBe('withdrawn');
  });

  it('a strict Redis failure: still 200, sessionHealth=failed, the owed record stays for the daily sweep', async () => {
    const a = await listener('a');
    await seedConsentingListener(a);
    redis.failNext = 'scan';

    const res = await withdrawOverHttp(a);

    expect(res.status).toBe(200);
    expect(withdrawalLines()[0]).toContain('sessionHealth=failed');
    expect(withdrawalLines()[0]).toMatch(/ sessionHealthFailed=redisKeys:ReplyError$/); // N6: a Redis failure, told apart from a Mongo one
    expect((await User.collection.findOne({ _id: a._id })).healthErasurePendingAt).toBeInstanceOf(Date);
  });

  it('the line is closed tokens and counts only: no heart rate, band, activity, time or note', async () => {
    const a = await listener('a');
    await seedConsentingListener(a);

    await withdrawOverHttp(a);

    const [line] = withdrawalLines();
    expect(line).toMatch(WITHDRAWAL_LINE);
    const all = lines.join('\n');
    for (const secret of ['131', '88', '77', 'running', 'peak', 'winding down', 'long day', 'edm', 'isrc:']) expect(all).not.toContain(secret);
    expect(all).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

// ── T8: what History shows for the real rows after a withdrawal (H1 with the designer's A2/A3) ────────
describe('GET /api/sessions over the real rows after a withdrawal (T8, DEC-118 H1)', () => {
  beforeEach(captureLogs);

  it('the heart session reads "A moment" / Live; mood rows keep their own word; a text-only row reads "A moment"', async () => {
    const a = await listener('a');
    const { rows } = await seedConsentingListener(a);
    await withdrawOverHttp(a);

    const res = await request(app)
      .get('/api/sessions?limit=50')
      .set('Authorization', `Bearer ${signToken({ userId: String(a._id) })}`);

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
    expect(res.body.items).toHaveLength(6); // no row disappears from History
    expect(byId[String(rows.heart)]).toMatchObject({ title: 'A moment', source: 'live', moodKey: null, activity: null, activityLabel: null });
    expect(byId[String(rows.moodWithHr)]).toMatchObject({ title: 'Calm', source: 'manual', moodKey: 'calm', activity: null, activityLabel: null });
    expect(byId[String(rows.moodNoHr)]).toMatchObject({ title: 'Calm', source: 'manual', activity: 'walking' });
    expect(byId[String(rows.textWithHr)]).toMatchObject({ title: 'A moment', source: 'manual', contextPrompt: 'long day at work' });
    expect(JSON.stringify(res.body)).not.toMatch(/Peak Energy|bio:|heartRate/);
  });
});
