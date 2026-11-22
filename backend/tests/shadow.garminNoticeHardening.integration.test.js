'use strict';

// BE-219 hardening (resilience audit of #304): the Garmin notices and the connect read must fail safe on what
// they do not recognise, an erasure Garmin started must survive a store failure, a push in flight when the
// erasure lands must write nothing, and a stale check must compare one clock with itself.
//
// Real semantics: the REAL webhook and callback controllers, the REAL garmin.js client, the REAL ingest seam with
// its REAL consent gate, the REAL per-provider erasure, and the REAL User (with its encrypted token blob),
// ConsentRecord, BiometricLog, VitalSample and MedicalProfile models on a REAL Mongo (mongodb-memory-server). Only
// the network is faked (axios answers Garmin's endpoints). The music fence is mocked OPEN so a write is visible.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV = 'test';
process.env.GARMIN_CONSUMER_KEY = 'garmin_key';
process.env.GARMIN_CONSUMER_SECRET = 'garmin_secret';
process.env.GARMIN_REDIRECT_URI = 'http://localhost:5000/api/integrations/garmin/callback';
const WEBHOOK_SECRET = 'be219-dereg-secret';
process.env.GARMIN_WEBHOOK_SECRET = WEBHOOK_SECRET;
delete process.env.REDIS_URL;

jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
jest.mock('../app/services/wearable/garminMusicFence', () => ({
  GARMIN_MAY_SHAPE_MUSIC: true, garminMayShapeMusic: () => true, fencedSources: () => [], generationVitalQuery: () => ({}),
}));
jest.mock('axios');

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const axios = require('axios');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { signOauthState } = require('../app/utils/jwt');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const { garminWebhook, garminCallback } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_notice_hardening' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

let lines;
let permissionsBody;
beforeEach(async () => {
  jest.clearAllMocks();
  delete process.env.GARMIN_DEREGISTER_ENABLED;
  await Promise.all([User, BiometricLog, VitalSample, MedicalProfile, ConsentRecord].map((m) => m.deleteMany({})));
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
  permissionsBody = ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'];
  axios.post.mockImplementation(async (url) => {
    if (url !== 'https://diauth.garmin.com/di-oauth2-service/oauth/token') throw new Error(`unexpected POST ${url}`);
    return { data: { access_token: 'gat', refresh_token: 'grt', expires_in: 86400 } };
  });
  axios.get.mockImplementation(async (url) => {
    if (url === 'https://apis.garmin.com/wellness-api/rest/user/id') return { data: { userId: 'g-connect' } };
    if (url === 'https://apis.garmin.com/wellness-api/rest/user/permissions') return { data: permissionsBody };
    throw new Error(`unexpected GET ${url}`);
  });
  axios.delete.mockResolvedValue({ status: 204, data: '' });
});
afterEach(() => { jest.restoreAllMocks(); });

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
// `day` (0 = yesterday, 1 = the day before) gives a push of its own, so a second one is not deduplicated.
const push = (gid, day = 0) => {
  const start = MIDNIGHT - day * DAY;
  return {
    dailies: [{ userId: gid, startTimeInSeconds: start, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61, 60: 62 } }],
    hrv: [{ userId: gid, startTimeInSeconds: start - 2 * HOUR, durationInSeconds: 8 * HOUR, lastNightAvg: 48 }],
    sleeps: [{ userId: gid, startTimeInSeconds: start - 2 * HOUR, durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: 3600, lightSleepDurationInSeconds: 14400, remSleepInSeconds: 5400 }],
  };
};
// The same push as the seam receives it from the webhook, grouped for one user.
const items = (gid) => Object.entries(push(gid)).flatMap(([type, list]) => list.map((summary) => ({ type, summary })));

const FULL = { heartRate: 2, vitals: 2, profile: 1 };
const NONE = { heartRate: 0, vitals: 0, profile: 0 };
const stored = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId, source: 'garmin' }),
  vitals: await VitalSample.countDocuments({ userId, source: 'garmin' }),
  profile: await MedicalProfile.countDocuments({ userId }),
});

const grant = (userId) => ConsentRecord.create({
  userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
});

async function connected(gid, permissions, extra = {}) {
  const user = await User.create({ ssoProvider: 'google', ssoId: `s-${gid}`, email: `${gid}@example.com`, wearableProvider: 'garmin', garminUserId: gid });
  user.setToken('wearableToken', { accessToken: `at-${gid}`, refreshToken: `rt-${gid}`, expiresAt: Date.now() + 3600e3, garminUserId: gid, permissions, ...extra });
  await user.save();
  await grant(user._id);
  return user;
}

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), redirect: jest.fn(), send: jest.fn() });
async function rawWebhook(body) {
  const res = makeRes();
  const next = jest.fn();
  await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body }, res, next);
  return { res, next };
}
async function webhook(body) {
  const { res, next } = await rawWebhook(body);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
  return res;
}
async function callback(user) {
  const res = makeRes();
  await garminCallback({ query: { code: 'auth-code', state: signOauthState(String(user._id), 'garmin', { cv: 'verifier' }) }, cookies: {} }, res);
  return res;
}
const change = (gid, permissions, changeTimeInSeconds = Math.floor(Date.now() / 1000)) => ({
  userPermissionsChange: [{ userId: gid, permissions, changeTimeInSeconds }],
});
const blobOf = async (userId) => (await User.findById(userId)).getToken('wearableToken');
const linkGone = async (userId) => {
  const saved = await User.findById(userId);
  expect(saved.wearableProvider).toBeNull();
  expect(saved.garminUserIdHmac).toBeNull();
  expect(saved.getToken('wearableToken')).toBeNull();
};

describe('RA-1: a notice whose list holds a value we do not know, and no HEALTH_EXPORT, revokes nothing', () => {
  it.each([
    ['a renamed value', ['HEALTH_EXPORT_V2']],
    ['a lower-case value', ['health_export']],
    ['a known value beside an unknown one', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT_V2']],
  ])('%s: no purge, the stored list kept, counted unrecognized', async (_label, permissions) => {
    const user = await connected('g-ra1', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'], { permissionsAt: 1 });
    await webhook(push('g-ra1'));
    expect(await stored(user._id)).toEqual(FULL);

    await webhook(change('g-ra1', permissions));

    expect(await stored(user._id)).toEqual(FULL);
    const saved = await User.findById(user._id);
    expect(saved.wearableProvider).toBe('garmin');
    expect((await blobOf(user._id)).permissions).toEqual(['ACTIVITY_EXPORT', 'HEALTH_EXPORT']);
    expect(lines.some((l) => /\[garmin\] notices .*revoked=0.*unrecognized=1/.test(l))).toBe(true);
    // The push that follows is still ingested: nothing was narrowed.
    await webhook(push('g-ra1', 1));
    expect(await stored(user._id)).toEqual({ heartRate: 4, vitals: 4, profile: 1 });
  });

  it.each([
    ['an empty list', []],
    ['a fully known list without HEALTH_EXPORT', ['ACTIVITY_EXPORT', 'WORKOUT_IMPORT']],
  ])('control: %s still revokes', async (_label, permissions) => {
    const user = await connected('g-ra1c', ['HEALTH_EXPORT'], { permissionsAt: 1 });
    await webhook(push('g-ra1c'));

    await webhook(change('g-ra1c', permissions));

    expect(await stored(user._id)).toEqual(NONE);
    await linkGone(user._id);
  });

  it('control: an unknown value beside HEALTH_EXPORT narrows to the known values', async () => {
    const user = await connected('g-ra1n', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'], { permissionsAt: 1 });
    await webhook(change('g-ra1n', ['HEALTH_EXPORT', 'SOMETHING_NEW']));
    expect((await blobOf(user._id)).permissions).toEqual(['HEALTH_EXPORT']);
  });
});

describe('RA-2: a /user/permissions body of only values we do not know fails the connect', () => {
  it.each([[['HEALTH_EXPORT_V2']], [['ACTIVITY_EXPORT', 'health_export']], [{ permissions: ['NEW_ONE'] }]])(
    '%p: garmin_failed, no link stored', async (body) => {
      permissionsBody = body;
      const user = await User.create({ ssoProvider: 'google', ssoId: 's-ra2', email: 'ra2@example.com' });

      const res = await callback(user);

      expect(res.redirect).toHaveBeenCalledWith('kokonada://integrations?error=garmin_failed');
      const saved = await User.findById(user._id);
      expect(saved.wearableProvider).toBeNull();
      expect(saved.garminUserId).toBeNull();
      expect(saved.getToken('wearableToken')).toBeNull();
    },
  );

  it('control: an unknown value beside HEALTH_EXPORT connects, storing the known values', async () => {
    permissionsBody = ['HEALTH_EXPORT', 'SOMETHING_NEW'];
    const user = await User.create({ ssoProvider: 'google', ssoId: 's-ra2c', email: 'ra2c@example.com' });
    const res = await callback(user);
    expect(res.redirect).toHaveBeenCalledWith('kokonada://integrations?biometric=garmin');
    expect((await blobOf(user._id)).permissions).toEqual(['HEALTH_EXPORT']);
  });
});

describe('RA-3: an erasure Garmin started survives a store failure: its retry finishes it', () => {
  it.each([
    ['a deregistration', (gid) => ({ deregistrations: [{ userId: gid }] })],
    ['a revocation', (gid) => change(gid, [])],
  ])('%s: the first delivery fails mid-purge (500), the retry erases every row and the link', async (_label, notice) => {
    const user = await connected('g-ra3', ['HEALTH_EXPORT']);
    const bystander = await connected('g-ra3b', ['HEALTH_EXPORT']);
    await webhook(push('g-ra3'));
    await webhook(push('g-ra3b'));
    expect(await stored(user._id)).toEqual(FULL);

    jest.spyOn(VitalSample, 'deleteMany').mockRejectedValueOnce(new Error('store unavailable'));
    const first = await rawWebhook(notice('g-ra3'));
    expect(first.next).toHaveBeenCalledWith(expect.any(Error)); // the webhook answers 500, so Garmin retries

    await webhook(notice('g-ra3'));

    expect(await stored(user._id)).toEqual(NONE);
    await linkGone(user._id);
    expect(await stored(bystander._id)).toEqual(FULL);
  });

  it('a write that lands between the first purge and the cleared link is purged too', async () => {
    const user = await connected('g-ra3w', ['HEALTH_EXPORT']);
    await webhook(push('g-ra3w'));
    const save = User.prototype.save;
    jest.spyOn(User.prototype, 'save').mockImplementation(async function interleaved(...args) {
      // The erasure's own save of the cleared link: a push that read the link before it lands one row first.
      if (this.wearableProvider === null && this.isModified('wearableProvider')) {
        await BiometricLog.create({ userId: user._id, heartRate: 70, source: 'garmin', recordedAt: new Date() });
      }
      return save.apply(this, args);
    });

    await webhook({ deregistrations: [{ userId: 'g-ra3w' }] });

    expect(await stored(user._id)).toEqual(NONE);
    await linkGone(user._id);
  });
});

describe('RA-4: a push in flight when the erasure lands writes nothing', () => {
  it('the seam, reading after the link is erased, permits nothing', async () => {
    const user = await connected('g-ra4', ['HEALTH_EXPORT']);
    // The webhook resolved this user before the erasure; the erasure lands; then the seam runs.
    await webhook({ deregistrations: [{ userId: 'g-ra4' }] });
    await linkGone(user._id);

    const result = await ingestSummaries(user._id, items('g-ra4'));

    expect(result.droppedNotPermitted).toBe(3);
    expect(await stored(user._id)).toEqual(NONE);
  });

  it('a user linked to another wearable is permitted nothing on the Garmin seam', async () => {
    const user = await User.create({ ssoProvider: 'google', ssoId: 's-ra4o', email: 'ra4o@example.com', wearableProvider: 'apple_health' });
    await grant(user._id);
    await ingestSummaries(user._id, items('g-ra4o'));
    expect(await stored(user._id)).toEqual(NONE);
  });

  it('control: a live link whose blob predates BE-219 (no permissions key) is still not narrowed', async () => {
    const user = await User.create({ ssoProvider: 'google', ssoId: 's-ra4c', email: 'ra4c@example.com', wearableProvider: 'garmin', garminUserId: 'g-ra4c' });
    user.setToken('wearableToken', { accessToken: 'at-ra4c', refreshToken: 'rt-ra4c', expiresAt: Date.now() + 3600e3, garminUserId: 'g-ra4c' });
    await user.save();
    await grant(user._id);
    await webhook(push('g-ra4c'));
    expect(await stored(user._id)).toEqual(FULL);
  });
});

describe('RA-6: the stale check compares Garmin\'s clock only with Garmin\'s clock', () => {
  it('a revocation stamped by Garmin a minute before our connect clock still revokes', async () => {
    const user = await User.create({ ssoProvider: 'google', ssoId: 's-ra6', email: 'ra6@example.com' });
    await grant(user._id);
    permissionsBody = ['HEALTH_EXPORT'];
    await callback(user);
    const blob = await blobOf(user._id);
    await webhook(push('g-connect'));
    expect(await stored(user._id)).toEqual(FULL);

    await webhook(change('g-connect', ['ACTIVITY_EXPORT'], blob.permissionsAt - 60));

    expect(await stored(user._id)).toEqual(NONE);
    await linkGone(user._id);
  });

  it('the connect stamps its time as our server clock', async () => {
    const user = await User.create({ ssoProvider: 'google', ssoId: 's-ra6s', email: 'ra6s@example.com' });
    await callback(user);
    expect(await blobOf(user._id)).toMatchObject({ permissionsAtSource: 'server', permissionsAt: expect.any(Number) });
  });

  it('control: after a Garmin-stamped change, an older Garmin-stamped one is stale', async () => {
    const user = await connected('g-ra6c', ['HEALTH_EXPORT']);
    await webhook(change('g-ra6c', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'], 2000));
    expect(await blobOf(user._id)).toMatchObject({ permissionsAt: 2000, permissionsAtSource: 'garmin' });

    await webhook(change('g-ra6c', [], 1000));

    expect((await User.findById(user._id)).wearableProvider).toBe('garmin');
    expect((await blobOf(user._id)).permissions).toEqual(['ACTIVITY_EXPORT', 'HEALTH_EXPORT']);
    expect(lines.some((l) => /\[garmin\] notices .*stale=1/.test(l))).toBe(true);
  });
});

describe('RA-9: two changes for one user in one body: the later changeTimeInSeconds wins, whatever the order', () => {
  const later = { userId: 'g-ra9', permissions: ['HEALTH_EXPORT', 'MCT_EXPORT'], changeTimeInSeconds: 2000 };
  const earlier = { userId: 'g-ra9', permissions: ['HEALTH_EXPORT'], changeTimeInSeconds: 1000 };

  it.each([['later first', [later, earlier]], ['earlier first', [earlier, later]]])('%s', async (_label, entries) => {
    const user = await connected('g-ra9', ['HEALTH_EXPORT'], { permissionsAt: 1 });
    await webhook({ userPermissionsChange: entries });
    expect(await blobOf(user._id)).toMatchObject({ permissions: ['HEALTH_EXPORT', 'MCT_EXPORT'], permissionsAt: 2000 });
  });

  it.each([['revocation first', true], ['revocation second', false]])('a later revocation wins over an earlier narrowing (%s)', async (_label, revokeFirst) => {
    const user = await connected('g-ra9', ['HEALTH_EXPORT'], { permissionsAt: 1 });
    await webhook(push('g-ra9'));
    const revoke = { userId: 'g-ra9', permissions: [], changeTimeInSeconds: 3000 };
    await webhook({ userPermissionsChange: revokeFirst ? [revoke, earlier] : [earlier, revoke] });
    expect(await stored(user._id)).toEqual(NONE);
    await linkGone(user._id);
  });
});
