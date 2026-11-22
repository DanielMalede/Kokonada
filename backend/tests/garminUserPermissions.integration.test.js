'use strict';

// BE-219 — Garmin's user permissions: read at connect, narrowed by the `userPermissionsChange` notification, and
// a full revocation (no HEALTH_EXPORT) purges like a deregistration.
//
// The payload shapes this relies on: GET /wellness-api/rest/user/permissions and its five values are in the PKCE
// spec (2025-07-23); its example body `{["…"]}` is not JSON, so a bare array and `{ permissions: [...] }` are read
// and nothing else. The notification's shape (`{ userPermissionsChange: [{ userId, permissions, changeTimeInSeconds,
// … }] }`) is NOT in the sources on file, so the webhook reads only those three fields, closed: an entry whose
// `permissions` is not an array is ignored and counted, never read as "nothing granted".
//
// Real semantics: the REAL webhook and callback controllers, the REAL garmin.js client, the REAL ingest seam with
// its REAL consent gate, the REAL per-provider erasure, and the REAL User (with its encrypted token blob),
// ConsentRecord, BiometricLog, VitalSample and MedicalProfile models on a REAL Mongo (mongodb-memory-server). Only
// the network is faked (axios answers Garmin's endpoints and records the calls). The music fence is mocked OPEN:
// this suite pins what the lane writes once Garmin permits it; while it is closed nothing is written anyway
// (garminMusicFence.*), and garminDeregistrationWebhook.integration.test.js runs the erasure on the closed fence.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV = 'test';
process.env.GARMIN_CONSUMER_KEY = 'garmin_key';
process.env.GARMIN_CONSUMER_SECRET = 'garmin_secret';
process.env.GARMIN_REDIRECT_URI = 'http://localhost:5000/api/integrations/garmin/callback';
const WEBHOOK_SECRET = 'be219-permissions-secret';
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
const garmin = require('../app/services/wearable/garmin');
const { garminWebhook, garminCallback } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_user_permissions' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

// Every console line the code under test writes, so the T1 pins can read them all.
let lines;
beforeEach(async () => {
  jest.clearAllMocks();
  delete process.env.GARMIN_DEREGISTER_ENABLED;
  await Promise.all([User, BiometricLog, VitalSample, MedicalProfile, ConsentRecord].map((m) => m.deleteMany({})));
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
  garminFake();
});
afterEach(() => { jest.restoreAllMocks(); });

// Garmin at the wire. `permissionsBody` is what GET /user/permissions answers.
let permissionsBody;
function garminFake() {
  permissionsBody = ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'];
  axios.post.mockImplementation(async (url, body) => {
    if (url !== 'https://diauth.garmin.com/di-oauth2-service/oauth/token') throw new Error(`unexpected POST ${url}`);
    if (String(body).includes('grant_type=refresh_token')) return { data: { access_token: 'gat-2', refresh_token: 'grt-2', expires_in: 86400 } };
    return { data: { access_token: 'gat', refresh_token: 'grt', expires_in: 86400 } };
  });
  axios.get.mockImplementation(async (url) => {
    if (url === 'https://apis.garmin.com/wellness-api/rest/user/id') return { data: { userId: 'g-connect-1' } };
    if (url === 'https://apis.garmin.com/wellness-api/rest/user/permissions') return { data: permissionsBody };
    throw new Error(`unexpected GET ${url}`);
  });
  axios.delete.mockResolvedValue({ status: 204, data: '' });
}

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
// One push that reaches all three stores when admitted (the fixture of garminIngestConsentGate).
const push = (gid) => ({
  dailies: [{ userId: gid, startTimeInSeconds: MIDNIGHT, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61, 60: 62 } }],
  hrv: [{ userId: gid, startTimeInSeconds: MIDNIGHT - 2 * HOUR, durationInSeconds: 8 * HOUR, lastNightAvg: 48 }],
  sleeps: [{ userId: gid, startTimeInSeconds: MIDNIGHT - 2 * HOUR, durationInSeconds: 8 * HOUR, deepSleepDurationInSeconds: 3600, lightSleepDurationInSeconds: 14400, remSleepInSeconds: 5400 }],
});

// One webhook body carrying several users' summaries, as Garmin batches them.
const merge = (...bodies) => {
  const out = {};
  for (const body of bodies) for (const [type, list] of Object.entries(body)) (out[type] ||= []).push(...list);
  return out;
};

const stored = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId, source: 'garmin' }),
  vitals: await VitalSample.countDocuments({ userId, source: 'garmin' }),
  profile: await MedicalProfile.countDocuments({ userId }),
});

const grant = (userId) => ConsentRecord.create({
  userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
});

// A user connected the way the callback leaves them: the link, the encrypted token blob with the granted list.
async function connected(gid, permissions, extra = {}) {
  const user = await User.create({ ssoProvider: 'google', ssoId: `s-${gid}`, email: `${gid}@example.com`, wearableProvider: 'garmin', garminUserId: gid });
  user.setToken('wearableToken', { accessToken: `at-${gid}`, refreshToken: `rt-${gid}`, expiresAt: Date.now() + 3600e3, garminUserId: gid, permissions, ...extra });
  await user.save();
  await grant(user._id);
  return user;
}

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), redirect: jest.fn(), send: jest.fn() });
async function webhook(body) {
  const res = makeRes();
  const next = jest.fn();
  await garminWebhook({ query: { secret: WEBHOOK_SECRET }, body }, res, next);
  expect(next).not.toHaveBeenCalled();
  return res;
}
const change = (gid, permissions, changeTimeInSeconds = Math.floor(Date.now() / 1000)) => ({
  userPermissionsChange: [{ userId: gid, summaryId: `x-${gid}`, permissions, changeTimeInSeconds }],
});
const blobOf = async (userId) => (await User.findById(userId)).getToken('wearableToken');

// T1: no line names a Garmin user id, a Kokonada user id or a token.
function expectNoIdentifiersLogged(...secrets) {
  for (const line of lines) for (const s of secrets) expect(line).not.toContain(String(s));
}

describe('connect reads GET /user/permissions and stores the list in the encrypted token blob', () => {
  const callback = async (user) => {
    const res = makeRes();
    await garminCallback({ query: { code: 'auth-code', state: signOauthState(String(user._id), 'garmin', { cv: 'verifier' }) }, cookies: {} }, res);
    return res;
  };

  it('stores the granted list, closed, inside the blob and nowhere in plaintext', async () => {
    permissionsBody = ['HEALTH_EXPORT', 'ACTIVITY_EXPORT', 'SOMETHING_NEW'];
    const user = await User.create({ ssoProvider: 'google', ssoId: 's-c1', email: 'c1@example.com' });

    const res = await callback(user);

    expect(res.redirect).toHaveBeenCalledWith('kokonada://integrations?biometric=garmin');
    expect(axios.get).toHaveBeenCalledWith('https://apis.garmin.com/wellness-api/rest/user/permissions', expect.objectContaining({ headers: { Authorization: 'Bearer gat' } }));
    const blob = await blobOf(user._id);
    expect(blob).toMatchObject({ accessToken: 'gat', garminUserId: 'g-connect-1', permissions: ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'] });
    expect(typeof blob.permissionsAt).toBe('number');
    const raw = await mongoose.connection.db.collection('users').findOne({ _id: user._id });
    expect(JSON.stringify(raw)).not.toMatch(/HEALTH_EXPORT|ACTIVITY_EXPORT/);
    expectNoIdentifiersLogged('g-connect-1', user._id, 'gat', 'grt');
  });

  it('reads the `{ permissions: [...] }` body as well', async () => {
    permissionsBody = { permissions: ['HEALTH_EXPORT'] };
    const user = await User.create({ ssoProvider: 'google', ssoId: 's-c2', email: 'c2@example.com' });
    await callback(user);
    expect((await blobOf(user._id)).permissions).toEqual(['HEALTH_EXPORT']);
  });

  it.each([['{["HEALTH_EXPORT"]}'], [{}], [null]])('an unreadable permissions body (%p) fails the connect and stores no link', async (body) => {
    permissionsBody = body;
    const user = await User.create({ ssoProvider: 'google', ssoId: `s-c3-${String(body).length}`, email: 'c3@example.com' });

    const res = await callback(user);

    expect(res.redirect).toHaveBeenCalledWith('kokonada://integrations?error=garmin_failed');
    const saved = await User.findById(user._id);
    expect(saved.wearableProvider).toBeNull();
    expect(saved.garminUserId).toBeNull();
    expect(saved.getToken('wearableToken')).toBeNull();
  });

  it('a token refresh keeps the stored list (the blob is merged, not replaced)', async () => {
    const user = await connected('g-refresh', ['HEALTH_EXPORT'], { expiresAt: Date.now() - 1000, permissionsAt: 1700000000 });

    const token = await garmin.getValidToken(await User.findById(user._id));

    expect(token).toBe('gat-2');
    expect(await blobOf(user._id)).toMatchObject({ accessToken: 'gat-2', refreshToken: 'grt-2', garminUserId: 'g-refresh', permissions: ['HEALTH_EXPORT'], permissionsAt: 1700000000 });
  });
});

describe('a userPermissionsChange that keeps HEALTH_EXPORT narrows the stored list', () => {
  it('stores the new list; the push that follows is still ingested', async () => {
    const user = await connected('g-narrow', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'], { permissionsAt: 1 });

    const res = await webhook(change('g-narrow', ['HEALTH_EXPORT']));
    expect(res.status).toHaveBeenCalledWith(200);
    expect((await blobOf(user._id)).permissions).toEqual(['HEALTH_EXPORT']);

    await webhook(push('g-narrow'));
    expect(await stored(user._id)).toEqual({ heartRate: 2, vitals: 2, profile: 1 });
    expectNoIdentifiersLogged('g-narrow', user._id, 'at-g-narrow', 'rt-g-narrow');
  });

  it('a replay of the same notice is idempotent', async () => {
    const user = await connected('g-replay', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'], { permissionsAt: 1 });
    const notice = change('g-replay', ['HEALTH_EXPORT', 'MCT_EXPORT'], 1800000000);

    await webhook(notice);
    const once = await blobOf(user._id);
    await webhook(notice);
    const twice = await blobOf(user._id);

    expect(twice).toEqual(once);
    expect(twice).toMatchObject({ permissions: ['HEALTH_EXPORT', 'MCT_EXPORT'], permissionsAt: 1800000000, accessToken: 'at-g-replay' });
  });

  it('an older notice delivered after a newer one does not roll the list back', async () => {
    const user = await connected('g-order', ['HEALTH_EXPORT'], { permissionsAt: 1 });
    await webhook(change('g-order', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'], 2000));
    await webhook(change('g-order', ['HEALTH_EXPORT', 'MCT_EXPORT'], 1000));
    expect((await blobOf(user._id)).permissions).toEqual(['ACTIVITY_EXPORT', 'HEALTH_EXPORT']);
  });
});

describe('the ingest seam drops a summary type outside the stored list (fence open)', () => {
  it('a user who granted no HEALTH_EXPORT at connect: the push writes nothing; the control with it writes', async () => {
    const partial = await connected('g-partial', ['ACTIVITY_EXPORT', 'WORKOUT_IMPORT']);
    const control = await connected('g-control', ['HEALTH_EXPORT']);

    const res = await webhook(merge(push('g-partial'), push('g-control')));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(await stored(partial._id)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    expect(await stored(control._id)).toEqual({ heartRate: 2, vitals: 2, profile: 1 });
  });

  it('a stored list that is not an array fails closed', async () => {
    const corrupt = await connected('g-corrupt', 'HEALTH_EXPORT');
    await webhook(push('g-corrupt'));
    expect(await stored(corrupt._id)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });
});

describe('a userPermissionsChange with no HEALTH_EXPORT is a revocation: it purges like a deregistration', () => {
  it('the Garmin rows are erased and the link is gone; Garmin is not called back', async () => {
    process.env.GARMIN_DEREGISTER_ENABLED = 'true';
    const user = await connected('g-revoke', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT']);
    const bystander = await connected('g-bystander', ['HEALTH_EXPORT']);
    await webhook(push('g-revoke'));
    await webhook(push('g-bystander'));
    expect(await stored(user._id)).toEqual({ heartRate: 2, vitals: 2, profile: 1 });

    const res = await webhook(change('g-revoke', ['ACTIVITY_EXPORT']));

    expect(res.status).toHaveBeenCalledWith(200);
    expect(await stored(user._id)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    const saved = await User.findById(user._id);
    expect(saved.wearableProvider).toBeNull();
    expect(saved.garminUserId).toBeNull();
    expect(saved.garminUserIdHmac).toBeNull();
    expect(saved.getToken('wearableToken')).toBeNull();
    expect(axios.delete).not.toHaveBeenCalled();
    expect(await stored(bystander._id)).toEqual({ heartRate: 2, vitals: 2, profile: 1 });

    // A push that arrives after the revocation reaches nobody.
    await webhook(push('g-revoke'));
    expect(await stored(user._id)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    expectNoIdentifiersLogged('g-revoke', user._id, 'at-g-revoke', 'rt-g-revoke');
  });

  it('an empty list is a revocation too; its replay is a no-op', async () => {
    const user = await connected('g-empty', ['HEALTH_EXPORT']);
    await webhook(push('g-empty'));
    await webhook(change('g-empty', []));
    expect(await stored(user._id)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    const res = await webhook(change('g-empty', []));
    expect(res.status).toHaveBeenCalledWith(200);
    expect((await User.findById(user._id)).wearableProvider).toBeNull();
  });

  it('the revocation runs whatever the consent state (a withdrawn user is purged too)', async () => {
    const user = await connected('g-withdrawn', ['HEALTH_EXPORT']);
    await webhook(push('g-withdrawn'));
    await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'withdrawn', withdrawnAt: new Date() });
    await webhook(change('g-withdrawn', ['ACTIVITY_EXPORT']));
    expect(await stored(user._id)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });
});

describe('closed parsing: what the webhook does not understand changes nothing', () => {
  it.each([
    ['permissions missing', { userId: 'g-closed' }],
    ['permissions a string', { userId: 'g-closed', permissions: 'ACTIVITY_EXPORT' }],
    ['permissions an object', { userId: 'g-closed', permissions: { HEALTH_EXPORT: false } }],
  ])('%s: no purge, no change, counted', async (_label, entry) => {
    const user = await connected('g-closed', ['HEALTH_EXPORT']);
    await webhook(push('g-closed'));

    const res = await webhook({ userPermissionsChange: [entry] });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(await stored(user._id)).toEqual({ heartRate: 2, vitals: 2, profile: 1 });
    expect((await blobOf(user._id)).permissions).toEqual(['HEALTH_EXPORT']);
    expect(lines.some((l) => /\[garmin\] notices .*malformed=1/.test(l))).toBe(true);
  });

  it('an unknown Garmin user is ignored and counted, never logged', async () => {
    const user = await connected('g-known', ['HEALTH_EXPORT']);
    const res = await webhook(change('g-nobody', []));
    expect(res.status).toHaveBeenCalledWith(200);
    expect((await User.findById(user._id)).wearableProvider).toBe('garmin');
    expect(lines.some((l) => /\[garmin\] notices .*unknown=1/.test(l))).toBe(true);
    expectNoIdentifiersLogged('g-nobody', 'g-known');
  });

  it('the notice is never handed to the seam as a summary type', async () => {
    const ingest = jest.spyOn(require('../app/services/wearable/garminIngest'), 'ingestSummaries');
    await connected('g-seam', ['HEALTH_EXPORT']);
    await webhook(change('g-seam', ['HEALTH_EXPORT']));
    expect(ingest).not.toHaveBeenCalled();
  });
});
