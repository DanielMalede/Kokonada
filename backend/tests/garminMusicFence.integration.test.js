'use strict';

// BE-245 (DEC-047, ADR-0018) — while the Garmin music fence is closed, nothing Garmin's Health API sends can
// shape the music.
//
// Layer 1, the quarantine at ingest: garminIngest.ingestSummaries still runs the Art. 9 consent gate and the
// consent-version gate, then writes NOTHING: no BiometricLog row, no VitalSample row, no MedicalProfile field,
// no state-vector recompute queued. It answers { fenced: true, fencedDropped: N } and logs one count-only line.
//
// Layer 2, the read filter: a Garmin row already in VitalSample (written before the fence, or some other way)
// is never read by baselines.js or the daily-analysis worker, so it moves no baseline, timezone or MorningState.
//
// End to end: a Health Connect user who also connected Garmin, after Garmin's 14-day push (the last day through
// the REAL webhook controller), the recompute the stores queued (run by the REAL worker) and the REAL daily
// analysis, is served exactly what a Health Connect-only control is: computeBaselines, the profile scalars, the
// state vector, the affect posterior, the MorningState, buildTargets and resolveBiometricContext are equal, and
// so are the Groq request and the Spotify query (a guard: those two are equal without the fence too). A Live
// socket sees nothing of the push. The phone's live lane and the Health Connect lane are untouched. With the
// fence opened (the permitted control), Garmin's values move all of it again, so the equalities are the fence's.
//
// Real semantics: the REAL consent read, normaliser, seam, stores, webhook controller, state-vector worker,
// daily-analysis worker, baseline and affect engines, targets builder and socket handler, on a REAL Mongo
// (mongodb-memory-server). Faked: the BullMQ queue, by a STATEFUL in-memory queue that records every job it is
// handed (so "nothing queued" is measured on the real enqueue call the store makes, and the recompute runs
// exactly the jobs queued); Redis, by a stateful in-memory store; the socket.io server; and axios, so the Groq
// request is read, never sent.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;
delete process.env.WAVE4_AFFECT_DISABLED;
delete process.env.WAVE4_BASELINE_ENGINE_DISABLED;
const WEBHOOK_SECRET = 'be245-it-secret';
process.env.GARMIN_WEBHOOK_SECRET = WEBHOOK_SECRET;
// The OpenAI-compatible (Groq) path, so the egress guard below reads the exact request the LLM would get.
process.env.LLM_API_KEY = 'test-llm-key';
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

// The fence, as shipped: every call delegates to the REAL module (closed). `__control.open` stands for the
// one reviewed literal flip, for the permitted control only; nothing else in this file touches it.
jest.mock('../app/services/wearable/garminMusicFence', () => {
  const real = jest.requireActual('../app/services/wearable/garminMusicFence');
  const __control = { open: false };
  return {
    __control,
    get GARMIN_MAY_SHAPE_MUSIC() { return __control.open ? true : real.GARMIN_MAY_SHAPE_MUSIC; },
    garminMayShapeMusic: () => (__control.open ? true : real.garminMayShapeMusic()),
    fencedSources: () => (__control.open ? [] : real.fencedSources()),
    generationVitalQuery: () => (__control.open ? {} : real.generationVitalQuery()),
  };
});
jest.mock('../app/queues/queue', () => {
  const jobs = [];
  return {
    enqueue: jest.fn(async (name, data, opts) => { jobs.push({ name, data, opts }); return { queued: true }; }),
    __jobs: jobs,
  };
});
// A STATEFUL Redis: strings and sorted sets over real keys, so the baseline blob and the affect posterior the
// readers get are the ones the writers stored.
jest.mock('../app/config/redis', () => {
  const strings = new Map();
  const zsets = new Map();
  const glob = (pattern) => new RegExp(`^${pattern.split('*').map((q) => q.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  const keys = () => [...strings.keys(), ...zsets.keys()];
  const fake = {
    strings, zsets, keys,
    async get(k) { return strings.has(k) ? strings.get(k) : null; },
    async set(k, v) { strings.set(k, v); return 'OK'; },
    async setex(k, _ttl, v) { strings.set(k, v); return 'OK'; },
    async exists(k) { return strings.has(k) || zsets.has(k) ? 1 : 0; },
    async expire() { return 1; },
    async ttl() { return 3600; },
    async del(...ks) { return ks.flat().reduce((n, k) => n + ((strings.delete(k) | zsets.delete(k)) ? 1 : 0), 0); },
    async scan(_c, _m, pattern) { const re = glob(pattern); return ['0', keys().filter((k) => re.test(k))]; },
    async zadd(k, score, member) { if (!zsets.has(k)) zsets.set(k, new Map()); zsets.get(k).set(member, Number(score)); return 1; },
    async zremrangebyscore(k, _min, max) {
      const z = zsets.get(k); if (!z) return 0;
      let n = 0; for (const [m, sc] of z) if (sc <= Number(max)) { z.delete(m); n += 1; }
      return n;
    },
    async zrangebyscore(k, min) { const z = zsets.get(k); return z ? [...z].filter(([, sc]) => sc >= Number(min)).map(([m]) => m) : []; },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});
// The socket server: the live sockets register themselves in their user's room.
const mockLive = [];
jest.mock('../app/sockets/index', () => ({
  getIo: () => ({
    in: (room) => ({ fetchSockets: async () => mockLive.filter((sk) => `user:${sk.data.user._id}` === room).map((sk) => ({ id: sk.id })) }),
    to: () => ({ emit: () => {} }),
  }),
}));
jest.mock('axios');

const axios = require('axios');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState = require('../app/models/MorningState');
const { decryptOwned } = require('../app/models/encryptedField');
const ConsentRecord = require('../app/models/ConsentRecord');
const { __jobs: queued } = require('../app/queues/queue');
const { __fake: redis } = require('../app/config/redis');
const { __control: fenceControl } = require('../app/services/wearable/garminMusicFence');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const baselinesService = require('../app/services/biosonic/baselines');
const { peekAffectState } = require('../app/services/biosonic/affectCache');
const stateVectorWorker = require('../app/workers/stateVector.worker');
const dailyAnalysisWorker = require('../app/workers/dailyAnalysis.worker');
const { buildTargets } = require('../app/services/generation/targetsBuilder');
const { buildEmotionPlaylist } = require('../app/services/geminiEngine');
const { garminWebhook } = require('../app/controllers/integrationsController');
const { registerBiometricHandler, resolveBiometricContext, _resetDebounceState } = require('../app/sockets/biometricHandler');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');

jest.setTimeout(180000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_music_fence' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let logged;
beforeEach(() => {
  queued.length = 0;
  redis.strings.clear();
  redis.zsets.clear();
  mockLive.length = 0;
  fenceControl.open = false;
  baselinesService._resetRefreshCooldown();
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { logged.push({ level, line: args.map(String).join(' ') }); });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  _resetDebounceState();
  fenceControl.open = false;
});

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
// Yesterday's UTC midnight: every reading below is inside retention and behind the clock.
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;

// A full push, every lane the normaliser admits at consent v1: three per-minute heart-rate samples and a
// resting HR (dailies), a night's HRV (hrv), a night's three sleep stages (sleeps) = 8 metrics. Plus a pulse-ox
// summary whose two SpO2 values the consent-version gate drops before the fence ever counts them.
const fullPush = (shift = 0) => [
  { type: 'dailies', summary: { startTimeInSeconds: MIDNIGHT + shift, restingHeartRateInBeatsPerMinute: 71, timeOffsetHeartRateSamples: { 0: 91, 60: 92, 120: 93 } } },
  { type: 'hrv', summary: { startTimeInSeconds: MIDNIGHT + shift - 2 * HOUR, durationInSeconds: 8 * HOUR, lastNightAvg: 23 } },
  {
    type: 'sleeps',
    summary: {
      startTimeInSeconds: MIDNIGHT + shift - 2 * HOUR,
      durationInSeconds: 8 * HOUR,
      deepSleepDurationInSeconds: 600,
      lightSleepDurationInSeconds: 7200,
      remSleepInSeconds: 900,
    },
  },
  { type: 'pulseox', summary: { startTimeInSeconds: MIDNIGHT + shift, timeOffsetSpo2Values: { 0: 95, 60: 96 } } },
];
const FULL_PUSH_ADMITTED = 8;

const grant = (userId, consentVersion = CURRENT_CONSENT_VERSION) => ConsentRecord.create({
  userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion, status: 'granted', grantedAt: new Date(),
});
const stored = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId }),
  vitals: await VitalSample.countDocuments({ userId }),
  profile: await MedicalProfile.countDocuments({ userId }),
});
const lines = () => logged.map((l) => l.line);

// A live Garmin link with its token blob: the seam permits nothing without one (RA-4 of #304). The blob predates
// BE-219 (no permissions key), so nothing is narrowed.
let linked = 0;
async function garminLinkedUserId() {
  linked += 1;
  const gid = `g-l1-${linked}`;
  const user = await User.create({ ssoProvider: 'google', ssoId: `s-${gid}`, email: `${gid}@example.com`, wearableProvider: 'garmin', garminUserId: gid });
  user.setToken('wearableToken', { accessToken: `at-${gid}`, refreshToken: `rt-${gid}`, expiresAt: Date.now() + 3600e3, garminUserId: gid });
  await user.save();
  return user._id;
}

describe('layer 1 — the quarantine at ingest (fence closed, the shipped default)', () => {
  it('a full push for a consented user writes nothing a generation reads, queues nothing, and counts what it dropped', async () => {
    const userId = await garminLinkedUserId();
    await grant(userId);

    const res = await ingestSummaries(userId, fullPush());

    expect(res).toMatchObject({ fenced: true, fencedDropped: FULL_PUSH_ADMITTED, inserted: 0, refused: null });
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    expect(queued).toEqual([]);
  });

  it('logs one count-only line: the number, never the user id or a value (T1)', async () => {
    const userId = await garminLinkedUserId();
    await grant(userId);

    await ingestSummaries(userId, fullPush());

    const fenceLines = lines().filter((l) => l.includes('fenced'));
    expect(fenceLines).toEqual([`[garmin] fenced metrics=${FULL_PUSH_ADMITTED}`]);
    for (const l of lines()) {
      expect(l).not.toContain(String(userId));
      for (const value of ['71', '91', '92', '93', '23', '95', '96']) expect(l).not.toMatch(new RegExp(`\\b${value}\\b`));
    }
  });

  it('the consent gate still runs first: no current grant is a refusal, not a fenced drop, and nothing is logged as fenced', async () => {
    const userId = new mongoose.Types.ObjectId();

    const res = await ingestSummaries(userId, fullPush());

    expect(res.refused).toBe('consent_not_current');
    expect(res.fenced).not.toBe(true);
    expect(lines().filter((l) => l.includes('fenced'))).toEqual([]);
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('the consent-version gate still runs: the SpO2 values it drops are not counted as fenced', async () => {
    const userId = await garminLinkedUserId();
    await grant(userId);

    const res = await ingestSummaries(userId, fullPush().filter(({ type }) => type === 'pulseox'));

    expect(res).toMatchObject({ fenced: true, fencedDropped: 0 });
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('a replayed backfill writes nothing either, however many times it arrives', async () => {
    const userId = await garminLinkedUserId();
    await grant(userId);

    for (let day = 0; day < 5; day += 1) await ingestSummaries(userId, fullPush(-day * DAY));

    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    expect(queued).toEqual([]);
  });
});

// ── the end-to-end fixture ─────────────────────────────────────────────────────────────────────────────────
//
// Two consented accounts with the SAME 14 days of Health Connect history, written through the real store the
// Health Connect lane uses (persistMetrics): heart rate six times a day, a resting HR and an HRV each morning,
// a night's three sleep stages each morning, all at UTC+2. One of them, the Garmin wearer, also connected
// Garmin, and Garmin's Health API then pushes 14 days of very different values (a high resting HR, a low HRV,
// a short deep sleep, per-minute heart rate around 120) at UTC+10: the last day through the REAL webhook
// controller, the rest through the seam. While the fence is closed, every output a generation reads must be
// what the Health Connect-only control gets.
const NOW = Date.now(); // the frozen clock of every end-to-end test (Date.now is pinned to it)
const HOUR_MS = HOUR * 1000;
const DAY_MS = DAY * 1000;
const TODAY = Math.floor(NOW / DAY_MS) * DAY_MS;
const HC_TZ = 120;
const GARMIN_TZ_S = 10 * HOUR;

function healthConnectHistory() {
  const metrics = [];
  const at = (d, h) => new Date(TODAY - d * DAY_MS + h * HOUR_MS);
  const m = (metric, value, unit, recordedAt) => ({ metric, value, unit, recordedAt, source: 'health_connect', tzOffsetMinutes: HC_TZ });
  for (let d = 1; d <= 14; d += 1) {
    for (const h of [2, 4, 9, 13, 18, 22]) metrics.push(m('heartRate', 58 + ((d * 7 + h) % 15), 'bpm', at(d, h)));
    metrics.push(m('restingHeartRate', 56 + (d % 4), 'bpm', at(d, 5)));
    metrics.push(m('hrv', 50 + (d % 5), 'ms', at(d, 5)));
    metrics.push(m('sleepDeep', 80 + (d % 3) * 5, 'min', at(d, 5)));
    metrics.push(m('sleepLight', 230 + (d % 4) * 5, 'min', at(d, 5)));
    metrics.push(m('sleepRem', 95 + (d % 2) * 5, 'min', at(d, 5)));
  }
  return metrics;
}

// One Garmin day, `d` days before today, as Garmin's Health API pushes it.
function garminDay(d) {
  const start = (TODAY - d * DAY_MS) / 1000;
  const hr = {};
  for (let i = 0; i < 30; i += 1) hr[i * 60] = 115 + (i % 11);
  return [
    { type: 'dailies', summary: { startTimeInSeconds: start, startTimeOffsetInSeconds: GARMIN_TZ_S, restingHeartRateInBeatsPerMinute: 82, timeOffsetHeartRateSamples: hr } },
    { type: 'hrv', summary: { startTimeInSeconds: start - 6 * HOUR, startTimeOffsetInSeconds: GARMIN_TZ_S, durationInSeconds: 7 * HOUR, lastNightAvg: 17 } },
    {
      type: 'sleeps',
      summary: {
        startTimeInSeconds: start - 6 * HOUR,
        startTimeOffsetInSeconds: GARMIN_TZ_S,
        durationInSeconds: 7 * HOUR,
        deepSleepDurationInSeconds: 300,
        lightSleepDurationInSeconds: 3000,
        remSleepInSeconds: 600,
      },
    },
  ];
}
const GARMIN_DAY_ADMITTED = 30 + 1 + 1 + 3;

let seq = 0;
async function account(tag, { garmin = false } = {}) {
  seq += 1;
  const gid = `g-${tag}-${seq}`;
  const user = await User.create({
    ssoProvider: 'google', ssoId: `s-${tag}-${seq}`, email: `${tag}-${seq}@example.com`,
    ...(garmin ? { wearableProvider: 'garmin', garminUserId: gid } : {}),
  });
  if (garmin) {
    // The seam permits nothing without a live link's token blob (RA-4 of #304); this one predates BE-219.
    user.setToken('wearableToken', { accessToken: `at-${gid}`, refreshToken: `rt-${gid}`, expiresAt: Date.now() + 3600e3, garminUserId: gid });
    await user.save();
  }
  await grant(user._id);
  return { user, userId: user._id, id: String(user._id), gid };
}

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
async function garminWebhookPush(gid, items) {
  const body = {};
  for (const { type, summary } of items) (body[type] ||= []).push({ ...summary, userId: gid });
  const res = makeRes();
  const next = jest.fn();
  await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body }, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
  return res;
}

// Garmin's 14 days for `who`: the last through the real webhook controller, the others through the seam.
async function garminBackfill(who) {
  await garminWebhookPush(who.gid, garminDay(1));
  for (let d = 2; d <= 14; d += 1) await ingestSummaries(who.userId, garminDay(d));
}

// Run every recompute job the stores queued, as the BullMQ worker would: the REAL processor, once per job.
async function drainRecomputes() {
  const jobs = queued.splice(0);
  for (const job of jobs) await stateVectorWorker.process({ data: job.data });
  return jobs;
}

// Everything but bookkeeping: ids, owners, write times, and the computedAt stamps of a derivation.
const BOOKKEEPING = new Set(['_id', 'id', 'userId', '__v', 'createdAt', 'updatedAt', 'computedAt', 'sleepUpdatedAt']);
function strip(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && value._bsontype) return String(value);
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!BOOKKEEPING.has(k)) out[k] = strip(v);
    return out;
  }
  return value;
}
// The state vector's two labels are encrypted under the owner's id with a fresh IV, so they are compared as
// the owner's reader sees them (decryptOwned, as pulseController reads them), never as ciphertext.
const profileOf = async (userId) => {
  const doc = await MedicalProfile.findOne({ userId });
  if (!doc) return null;
  const view = doc.toObject();
  for (const label of ['status', 'stateId']) {
    if (view.stateVector?.[label]) view.stateVector[label] = decryptOwned(view.stateVector[label], userId);
  }
  return strip(view);
};
const morningOf = async (userId) => (await MorningState.find({ userId }).sort({ date: 1 })).map((d) => strip(d.toObject()));
const baselinesOf = async (userId) => strip(await baselinesService.computeBaselines(userId));
const affectOf = async (userId) => strip(await peekAffectState(String(userId), { now: NOW }));

function freezeClock() {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
}

async function until(read, timeoutMs = 3000) {
  const start = process.hrtime.bigint();
  let value = await read();
  while (!value && Number(process.hrtime.bigint() - start) / 1e6 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
    value = await read();
  }
  return value;
}

describe('layer 2 — the read filter: Garmin rows already in VitalSample never reach a generation reader', () => {
  // Rows that reached the store before the fence, or some other way: written straight to the real model
  // (document saves, so they are encrypted as every row is), six HRV and six resting-HR readings a day at
  // UTC+10, more rows than the whole Health Connect history, so read, they would also flip the habitual
  // timezone the hour-of-day tables are built in.
  async function legacyGarminRows(userId) {
    const docs = [];
    for (let d = 1; d <= 14; d += 1) {
      for (let k = 0; k < 6; k += 1) {
        const recordedAt = new Date(TODAY - d * DAY_MS + (k * 3 + 1) * HOUR_MS);
        docs.push({ userId, metric: 'hrv', value: 15 + k, source: 'garmin', recordedAt, tzOffsetMinutes: 600, hrvMethod: 'rmssd' });
        docs.push({ userId, metric: 'restingHeartRate', value: 85 + k, source: 'garmin', recordedAt, tzOffsetMinutes: 600 });
      }
    }
    await VitalSample.create(docs);
    expect(await VitalSample.countDocuments({ userId, source: 'garmin' })).toBe(14 * 12);
  }

  it('computeBaselines with the Garmin rows present equals the Health Connect-only control (timezone included)', async () => {
    freezeClock();
    const wearer = await account('l2-wearer', { garmin: true });
    const control = await account('l2-control');
    for (const who of [wearer, control]) await persistMetrics(who.userId, healthConnectHistory());
    await legacyGarminRows(wearer.userId);

    const got = await baselinesOf(wearer.userId);
    const want = await baselinesOf(control.userId);

    expect(want.tzOffsetMinutes).toBe(HC_TZ);
    expect(want.coverage?.hrvDays ?? 0).toBeGreaterThan(0); // the comparison is not between two empty blobs
    expect(got).toEqual(want);
  });

  it('the daily analysis with the Garmin rows present writes the control\'s MorningState', async () => {
    freezeClock();
    const wearer = await account('l2-da-wearer', { garmin: true });
    const control = await account('l2-da-control');
    for (const who of [wearer, control]) await persistMetrics(who.userId, healthConnectHistory());
    await legacyGarminRows(wearer.userId);

    await dailyAnalysisWorker.process({ data: { now: NOW } });

    const want = await morningOf(control.userId);
    expect(want).toHaveLength(1);
    expect(await morningOf(wearer.userId)).toEqual(want);
  });

  it('the permitted control: with the fence open, the same rows DO move the baselines (the filter is the difference)', async () => {
    freezeClock();
    const wearer = await account('l2-open-wearer', { garmin: true });
    const control = await account('l2-open-control');
    for (const who of [wearer, control]) await persistMetrics(who.userId, healthConnectHistory());
    await legacyGarminRows(wearer.userId);
    fenceControl.open = true;

    const got = await baselinesOf(wearer.userId);
    const want = await baselinesOf(control.userId);

    expect(got).not.toEqual(want);
    expect(got.tzOffsetMinutes).toBe(600);
  });

  it('the fence is by lane, not by label: the phone\'s live heart rate stored as source \'garmin\' (BE-031) still feeds the baselines', async () => {
    freezeClock();
    const phone = await account('l2-phone');
    const none = await account('l2-none');
    const rows = [];
    for (let d = 1; d <= 7; d += 1) {
      for (const h of [3, 10, 15, 20]) {
        rows.push({ userId: phone.userId, heartRate: 60 + d + h, activity: 'resting', source: 'garmin', recordedAt: new Date(TODAY - d * DAY_MS + h * HOUR_MS), tzOffsetMinutes: HC_TZ });
      }
    }
    await BiometricLog.create(rows);

    const got = await baselinesOf(phone.userId);

    expect(got.sampleCount).toBeGreaterThan(0);
    expect(got).not.toEqual(await baselinesOf(none.userId));
  });
});

describe('end to end — a Health Connect user who also connected Garmin is served exactly what the Health Connect-only control is', () => {
  async function scenario() {
    freezeClock();
    const wearer = await account('e2e-wearer', { garmin: true });
    const control = await account('e2e-control');
    for (const who of [wearer, control]) await persistMetrics(who.userId, healthConnectHistory());
    const beforeGarmin = queued.length;
    await garminBackfill(wearer);
    const queuedByGarmin = queued.length - beforeGarmin;
    await drainRecomputes();
    await dailyAnalysisWorker.process({ data: { now: NOW } });
    return { wearer, control, queuedByGarmin };
  }

  it('Garmin\'s push queued nothing, and the Health Connect rows of both accounts are the same', async () => {
    const { wearer, control, queuedByGarmin } = await scenario();

    expect(queuedByGarmin).toBe(0);
    const rowsOf = async (userId) => ({
      heartRate: await BiometricLog.countDocuments({ userId, source: 'health_connect' }),
      vitals: await VitalSample.countDocuments({ userId, source: 'health_connect' }),
      garmin: (await BiometricLog.countDocuments({ userId, source: 'garmin' })) + (await VitalSample.countDocuments({ userId, source: 'garmin' })),
    });
    expect(await rowsOf(control.userId)).toEqual({ heartRate: 84, vitals: 28, garmin: 0 });
    expect(await rowsOf(wearer.userId)).toEqual(await rowsOf(control.userId));
  });

  it('computeBaselines, the profile scalars, the state vector and the affect posterior equal the control\'s', async () => {
    const { wearer, control } = await scenario();

    expect(await baselinesOf(wearer.userId)).toEqual(await baselinesOf(control.userId));
    const want = await profileOf(control.userId);
    expect(want).toEqual(expect.objectContaining({ restingHeartRate: expect.any(Number), hrv: expect.any(Number), stateVector: expect.any(Object) }));
    expect(await profileOf(wearer.userId)).toEqual(want);
    const affect = await affectOf(control.userId);
    expect(affect).not.toBeNull();
    expect(await affectOf(wearer.userId)).toEqual(affect);
  });

  it('the MorningState the daily analysis writes equals the control\'s', async () => {
    const { wearer, control } = await scenario();

    const want = await morningOf(control.userId);
    expect(want).toHaveLength(1);
    expect(await morningOf(wearer.userId)).toEqual(want);
  });

  it.each([['calm'], ['energize'], [null]])('buildTargets at a fixed now, mood %p, equals the control\'s', async (moodKey) => {
    const { wearer, control } = await scenario();

    const got = await buildTargets({ userId: String(wearer.userId), moodKey, now: NOW });
    const want = await buildTargets({ userId: String(control.userId), moodKey, now: NOW });

    expect(got).toEqual(want);
  });

  it('resolveBiometricContext, the stored vitals a generation is shaped by, equals the control\'s', async () => {
    const { wearer, control } = await scenario();

    const want = await resolveBiometricContext(control.userId, 88);
    expect(want).toEqual(expect.objectContaining({ restingHeartRate: expect.any(Number), hrv: expect.any(Number) }));
    expect(await resolveBiometricContext(wearer.userId, 88)).toEqual(want);
  });

  // A guard, said plainly: since BE-221 and BE-231 no health value reaches Groq or Spotify at all, so these two
  // requests are equal even without the fence. They are pinned here so that stays true across this lane.
  // The LOCAL targets the same run computes are what the fence changes, and they are compared too.
  it('the Groq request and the Spotify discovery query are byte-identical, and so are the local targets', async () => {
    const { wearer, control } = await scenario();
    const VALID = { target_bpm: 110, target_energy: 0.6, target_valence: 0.6, target_acousticness: 0.2, seed_artists: [], seed_genres: ['indie'] };
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(VALID) } }] } });
    const musicProfile = { topGenres: ['indie', 'electronic'], tempoBaseline: 110, energy: 0.6, valence: 0.6, acousticness: 0.2 };
    const run = async (userId) => {
      axios.post.mockClear();
      const fetchTracks = jest.fn(async () => []);
      // The LLM answer cache is keyed by the prompt; it is emptied after each run, so the second run sends
      // its own request instead of reading the first one's answer.
      const keysBefore = new Set(redis.keys());
      const out = await buildEmotionPlaylist({
        musicProfile, emotionTaps: [{ x: 0.4, y: 0.6 }], textPrompt: 'focus', activity: 'working',
        biometricContext: await resolveBiometricContext(userId, 88), fetchTracks, seed: 'be245-fixed',
      });
      for (const k of redis.keys()) if (!keysBefore.has(k)) redis.strings.delete(k);
      return {
        groq: JSON.stringify(axios.post.mock.calls),
        spotify: JSON.stringify(fetchTracks.mock.calls.map(([, query]) => query)),
        local: out.params,
      };
    };

    const got = await run(wearer.userId);
    const want = await run(control.userId);

    expect(JSON.parse(want.groq)).toHaveLength(1);
    expect(got.groq).toBe(want.groq);
    expect(got.spotify).toBe(want.spotify);
    expect(got.local).toEqual(want.local);
  });

  it('a Live-mode socket open while Garmin pushes through the real webhook: nothing emitted, nothing queued', async () => {
    freezeClock();
    const wearer = await account('e2e-live', { garmin: true });
    await persistMetrics(wearer.userId, healthConnectHistory());
    queued.length = 0;
    const handlers = {};
    const socket = {
      id: `sock-${wearer.id}`,
      data: { user: { _id: wearer.userId } },
      emit: jest.fn(),
      on: (event, fn) => { handlers[event] = fn; },
    };
    registerBiometricHandler(socket);
    mockLive.push(socket);
    await handlers.live_mode({ enabled: true });
    const emittedBefore = socket.emit.mock.calls.length;

    const res = await garminWebhookPush(wearer.gid, garminDay(1));
    await new Promise((r) => setTimeout(r, 200));

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, users: 1 }));
    expect(socket.emit.mock.calls.slice(emittedBefore)).toEqual([]);
    expect(queued).toEqual([]);
    expect(lines()).toContain(`[garmin] fenced metrics=${GARMIN_DAY_ADMITTED}`);
  });

  it('the Health Connect lane still writes and queues its recompute after a fenced Garmin push', async () => {
    freezeClock();
    const wearer = await account('e2e-hc', { garmin: true });
    await garminBackfill(wearer);
    expect(queued).toEqual([]);

    await persistMetrics(wearer.userId, healthConnectHistory());

    expect(await BiometricLog.countDocuments({ userId: wearer.userId })).toBe(84);
    expect(await VitalSample.countDocuments({ userId: wearer.userId })).toBe(28);
    expect(queued.map((j) => j.name)).toEqual(['state-vector-recompute']);
  });

  it('the phone\'s live reading (source \'garmin\', the watchHrIngest and BLE lane) is still processed and stored', async () => {
    freezeClock();
    const phone = await account('e2e-phone');
    const handlers = {};
    const socket = { id: `sock-${phone.id}`, data: { user: { _id: phone.userId } }, emit: jest.fn(), on: (e, fn) => { handlers[e] = fn; } };
    registerBiometricHandler(socket);

    await handlers.biometric_push({ source: 'garmin', raw: { heartRate: 74, activityType: 0, startTimeLocal: new Date(NOW - 30_000).toISOString() } });
    const rows = await until(() => BiometricLog.countDocuments({ userId: phone.userId, source: 'garmin' }));

    expect(socket.emit.mock.calls.map(([e]) => e)).toContain('biometric_ack');
    expect(rows).toBe(1);
  });

  it('the permitted control: with the fence open, Garmin\'s push is stored, queued, and moves what the wearer is served', async () => {
    fenceControl.open = true;
    const { wearer, control, queuedByGarmin } = await scenario();

    expect(queuedByGarmin).toBeGreaterThan(0);
    expect(await VitalSample.countDocuments({ userId: wearer.userId, source: 'garmin' })).toBeGreaterThan(0);
    expect(await baselinesOf(wearer.userId)).not.toEqual(await baselinesOf(control.userId));
    expect(await profileOf(wearer.userId)).not.toEqual(await profileOf(control.userId));
    expect(await buildTargets({ userId: String(wearer.userId), moodKey: 'calm', now: NOW }))
      .not.toEqual(await buildTargets({ userId: String(control.userId), moodKey: 'calm', now: NOW }));
    expect(await resolveBiometricContext(wearer.userId, 88)).not.toEqual(await resolveBiometricContext(control.userId, 88));
  });
});
