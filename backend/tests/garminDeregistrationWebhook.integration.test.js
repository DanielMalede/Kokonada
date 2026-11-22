'use strict';

// BE-219 — Garmin's deregistration notice erases the user's Garmin link and data.
//
// When a user removes the app in Garmin Connect, Garmin drops its registration and tells us with a
// `deregistrations` notification. Before BE-219 the webhook handed that list to the ingest seam as if it were a
// summary type, which normalised to nothing: the link and every Garmin row stayed. It now calls the per-provider
// erasure, eraseWearableProvider(user, 'garmin'), with no call back to Garmin (Garmin started it, and the
// registration it would delete is already gone).
//
// The shape this relies on (`{ deregistrations: [{ userId, … }] }`) is NOT in the sources on file (the PKCE spec
// documents DELETE /user/registration, not the notification), so the webhook reads one field, `userId`, as a
// non-empty string, and ignores and counts every other entry.
//
// Real semantics: the REAL webhook controller, the REAL blind-index lookup, the REAL erasure and the REAL stores
// on a REAL Mongo (mongodb-memory-server), with the SHIPPED, CLOSED music fence: while it is closed a push writes
// nothing, so the Garmin rows here are seeded straight into the real models, as rows from before the fence (or a
// backfill) would be. Only the network is faked: axios records any call to Garmin.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
const WEBHOOK_SECRET = 'be219-dereg-secret';
process.env.GARMIN_WEBHOOK_SECRET = WEBHOOK_SECRET;
delete process.env.REDIS_URL;

jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
jest.mock('axios');

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState = require('../app/models/MorningState');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { garminMayShapeMusic } = require('../app/services/wearable/garminMusicFence');
const garminIngest = require('../app/services/wearable/garminIngest');
const { garminWebhook } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_deregistration' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let lines;
beforeEach(async () => {
  jest.clearAllMocks();
  delete process.env.GARMIN_DEREGISTER_ENABLED;
  await Promise.all([User, BiometricLog, VitalSample, MedicalProfile, MorningState, ConsentRecord].map((m) => m.deleteMany({})));
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
  axios.delete.mockResolvedValue({ status: 204, data: '' });
  axios.get.mockRejectedValue(new Error('no GET expected'));
  axios.post.mockRejectedValue(new Error('no POST expected'));
});
afterEach(() => { jest.restoreAllMocks(); });

async function connected(gid) {
  const user = await User.create({ ssoProvider: 'google', ssoId: `s-${gid}`, email: `${gid}@example.com`, wearableProvider: 'garmin', garminUserId: gid });
  user.setToken('wearableToken', { accessToken: `at-${gid}`, refreshToken: `rt-${gid}`, expiresAt: Date.now() + 3600e3, garminUserId: gid, permissions: ['HEALTH_EXPORT'] });
  user.watchToken = { hash: `wh-${gid}`, createdAt: new Date(), lastSeenAt: null };
  await user.save();
  await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date() });
  return user;
}

// Garmin rows in every store the erasure covers, plus a row of another source that must survive.
async function seed(userId, { other = false } = {}) {
  const recordedAt = new Date(Date.now() - 3600e3);
  await BiometricLog.create({ userId, heartRate: 61, source: 'garmin', activity: 'resting', recordedAt });
  await BiometricLog.create({ userId, heartRate: 62, source: 'garmin', activity: 'resting', recordedAt: new Date(recordedAt.getTime() + 60e3) });
  await VitalSample.create({ userId, metric: 'hrv', value: 48, source: 'garmin', recordedAt, hrvMethod: 'rmssd' });
  await MedicalProfile.create({ userId, restingHeartRate: 52 });
  if (other) await BiometricLog.create({ userId, heartRate: 70, source: 'apple_health', activity: 'resting', recordedAt });
}

const garminRows = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId, source: 'garmin' }),
  vitals: await VitalSample.countDocuments({ userId, source: 'garmin' }),
});

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
async function webhook(body, query = { secret: WEBHOOK_SECRET }) {
  const res = makeRes();
  const next = jest.fn();
  await garminWebhook({ query, body }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
}
const deregistration = (...gids) => ({ deregistrations: gids.map((userId) => ({ userId, userAccessToken: `uat-${userId}` })) });

function expectNoIdentifiersLogged(...secrets) {
  for (const line of lines) for (const s of secrets) expect(line).not.toContain(String(s));
}

const expectUnlinked = async (userId) => {
  const saved = await User.findById(userId);
  expect(saved.wearableProvider).toBeNull();
  expect(saved.garminUserId).toBeNull();
  expect(saved.garminUserIdHmac).toBeNull();
  expect(saved.getToken('wearableToken')).toBeNull();
  expect(saved.watchToken?.hash ?? null).toBeNull();
};

it('the fence under this suite is the shipped, closed one', () => {
  expect(garminMayShapeMusic()).toBe(false);
});

describe('a deregistration for a known Garmin user erases the link and the data', () => {
  it('0 Garmin rows, no link, the profile gone with its last sample; 200; no call back to Garmin', async () => {
    process.env.GARMIN_DEREGISTER_ENABLED = 'true'; // even when outbound deregistration is armed
    const user = await connected('g-dereg');
    await seed(user._id);

    const res = await webhook(deregistration('g-dereg'));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true }));
    expect(await garminRows(user._id)).toEqual({ heartRate: 0, vitals: 0 });
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    await expectUnlinked(user._id);
    expect(axios.delete).not.toHaveBeenCalled();
    expect(lines.some((l) => /\[garmin\] notices deregistered=1 /.test(l))).toBe(true);
    expectNoIdentifiersLogged('g-dereg', user._id, 'at-g-dereg', 'rt-g-dereg', 'uat-g-dereg');
  });

  it('stays scoped: another source\'s rows and another Garmin user\'s rows survive', async () => {
    const user = await connected('g-scope');
    const other = await connected('g-other');
    await seed(user._id, { other: true });
    await seed(other._id);

    await webhook(deregistration('g-scope'));

    expect(await garminRows(user._id)).toEqual({ heartRate: 0, vitals: 0 });
    expect(await BiometricLog.countDocuments({ userId: user._id, source: 'apple_health' })).toBe(1);
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(1); // still backed by Apple Health
    expect(await garminRows(other._id)).toEqual({ heartRate: 2, vitals: 1 });
    expect((await User.findById(other._id)).wearableProvider).toBe('garmin');
  });

  it('runs whatever the consent state: a user who withdrew is erased too', async () => {
    const user = await connected('g-withdrawn');
    await seed(user._id);
    await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'withdrawn', withdrawnAt: new Date() });

    await webhook(deregistration('g-withdrawn'));

    expect(await garminRows(user._id)).toEqual({ heartRate: 0, vitals: 0 });
    await expectUnlinked(user._id);
  });

  it('a replay is idempotent: 200, nothing more erased, the second delivery counted as unknown', async () => {
    const user = await connected('g-replay');
    const other = await connected('g-keep');
    await seed(user._id);
    await seed(other._id);

    await webhook(deregistration('g-replay'));
    const res = await webhook(deregistration('g-replay'));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(await garminRows(user._id)).toEqual({ heartRate: 0, vitals: 0 });
    expect(await garminRows(other._id)).toEqual({ heartRate: 2, vitals: 1 });
    expect(lines.some((l) => /\[garmin\] notices deregistered=0 .*unknown=1/.test(l))).toBe(true);
  });

  it('one user listed twice in one notice is erased once', async () => {
    const user = await connected('g-twice');
    await seed(user._id);
    const res = await webhook(deregistration('g-twice', 'g-twice'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(lines.some((l) => /\[garmin\] notices deregistered=1 /.test(l))).toBe(true);
  });
});

describe('what the webhook cannot match or read changes nothing', () => {
  it('an unknown Garmin user: no effect, counted, never logged', async () => {
    const user = await connected('g-known');
    await seed(user._id);

    const res = await webhook(deregistration('g-nobody'));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(await garminRows(user._id)).toEqual({ heartRate: 2, vitals: 1 });
    expect((await User.findById(user._id)).wearableProvider).toBe('garmin');
    expect(lines.some((l) => /\[garmin\] notices .*unknown=1/.test(l))).toBe(true);
    expectNoIdentifiersLogged('g-nobody', 'g-known');
  });

  it.each([
    ['an operator object as userId', { deregistrations: [{ userId: { $gt: '' } }] }],
    ['an empty userId', { deregistrations: [{ userId: '' }] }],
    ['no userId', { deregistrations: [{ userAccessToken: 'x' }] }],
    ['a list that is not an array', { deregistrations: { userId: 'g-closed' } }],
    ['a null entry', { deregistrations: [null] }],
  ])('%s: nobody is erased, the entry is counted malformed', async (_label, body) => {
    const user = await connected('g-closed');
    await seed(user._id);

    const res = await webhook(body);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(await garminRows(user._id)).toEqual({ heartRate: 2, vitals: 1 });
    expect((await User.findById(user._id)).wearableProvider).toBe('garmin');
    expect(lines.some((l) => /\[garmin\] notices .*malformed=1/.test(l))).toBe(true);
  });

  it('a wrong secret: 401 and nobody is erased', async () => {
    const user = await connected('g-secret');
    await seed(user._id);
    const res = await webhook(deregistration('g-secret'), { secret: 'wrong' });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(await garminRows(user._id)).toEqual({ heartRate: 2, vitals: 1 });
  });
});

describe('the fenced path', () => {
  it('the notice is never handed to the seam as a summary type', async () => {
    const ingest = jest.spyOn(garminIngest, 'ingestSummaries');
    const user = await connected('g-seam');
    await webhook(deregistration('g-seam'));
    expect(ingest).not.toHaveBeenCalled();
    await expectUnlinked(user._id);
  });

  it('a body carrying a push and a deregistration for the same user: erased, and the push writes nothing', async () => {
    const user = await connected('g-both');
    await seed(user._id);
    const midnight = Math.floor(Date.now() / 86400e3) * 86400 - 86400;

    const res = await webhook({
      dailies: [{ userId: 'g-both', startTimeInSeconds: midnight, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61 } }],
      ...deregistration('g-both'),
    });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(await garminRows(user._id)).toEqual({ heartRate: 0, vitals: 0 });
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
    await expectUnlinked(user._id);
  });

  it('a summary push alone is still fenced and acknowledged (no regression of BE-245)', async () => {
    const user = await connected('g-push');
    const midnight = Math.floor(Date.now() / 86400e3) * 86400 - 86400;
    const res = await webhook({ dailies: [{ userId: 'g-push', startTimeInSeconds: midnight, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61 } }] });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ received: true, users: 1 }));
    expect(await garminRows(user._id)).toEqual({ heartRate: 0, vitals: 0 });
    expect(lines).toContain('[garmin] fenced metrics=2');
  });
});
