'use strict';

// J2 (BE-087, BE-094, BE-028; Plan B T11, the batch-lane race) — a health-data sync still being written when
// the account is deleted leaves a profile under the deleted id; the nightly analysis does not touch it, and
// the next daily sessionTrim run erases it.
//
// The batch ingest lane (wearable/metricStore.persistMetrics) upserts MedicalProfile itself and has no
// re-check after its write (BE-028). A sync that started before DELETE /api/auth/account and writes after the
// cascade re-creates the profile under an id no User doc carries. Before J2 that profile was kept for good
// and fed every night by dailyAnalysis. Now: S1 skips it, and the sweep removes it within a day once it is
// armed (DT-13 FINAL: after the production record and the owner's clean, when no orphan is left).
//
// Real: MongoDB, the ingest path, the deletion controller and cascade, dailyAnalysis, sessionTrim and the
// sweep. No Redis (REDIS_URL unset): the queue and the cache are not what this measures. The literal
// compliance #verify with a real queue and worker (delete within 60 s, count after 70 s) is
// stateVectorAcceptance.redis.test.js.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
delete process.env.REDIS_URL;
delete process.env.ORPHAN_SWEEP_DISABLED;

jest.mock('../app/sockets/index', () => ({ getIo: () => null }));
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('apple-signin-auth', () => ({ verifyIdToken: jest.fn() }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const ConsentRecord = require('../app/models/ConsentRecord');
const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState = require('../app/models/MorningState');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const { deleteAccount } = require('../app/controllers/authController');
const { process: runDailyAnalysis } = require('../app/workers/dailyAnalysis.worker');
const { process: runSessionTrim } = require('../app/workers/sessionTrim.worker');
const { HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION } = require('../app/services/privacy/consent');
const { armOrphanSweep } = require('../app/services/privacy/orphanSweep');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_j2_leftover_acceptance' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});

let lines;
beforeEach(() => {
  lines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    jest.spyOn(console, level).mockImplementation((...args) => { lines.push(args.map(String).join(' ')); });
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.ORPHAN_SWEEP_DISABLED;
});

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const sync = (at) => [
  { metric: 'restingHeartRate', value: 58, unit: 'bpm', recordedAt: at, source: 'health_connect' },
  { metric: 'hrv', value: 61, unit: 'ms', recordedAt: at, source: 'health_connect' },
];

/** A second, live account, so the sweep's guard sees a database that holds accounts. */
async function bystander() {
  const user = await User.create({ ssoProvider: 'google', ssoId: `sso-by-${Date.now()}`, email: `by-${Date.now()}@example.com` });
  await MedicalProfile.create({ userId: user._id });
  return user;
}

it('a sync that writes after the deletion leaves a profile; the nightly analysis skips it; the next sessionTrim erases it', async () => {
  const live = await bystander();
  const user = await User.create({ ssoProvider: 'google', ssoId: 'sso-leftover', email: 'leftover@example.com' });
  await ConsentRecord.create({ userId: user._id, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date() });
  // Armed as production will be: after the clean, with no orphan left.
  await expect(armOrphanSweep({ confirm: 'arm-orphan-sweep', recordSha256: 'f'.repeat(64), deployedCommit: 'c'.repeat(40) })).resolves.toEqual({ armed: true, v: 1 });

  // Hold the ingest's profile upsert (metricStore.js, the batch lane) until the deletion has finished.
  let release;
  let reached;
  const held = new Promise((r) => { release = r; });
  const atUpsert = new Promise((r) => { reached = r; });
  const upsert = MedicalProfile.findOneAndUpdate.bind(MedicalProfile);
  jest.spyOn(MedicalProfile, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
    reached();
    await held;
    return upsert(...args);
  });

  const ingest = persistMetrics(user._id, sync(new Date(Date.now() - 3600_000)));
  await atUpsert;
  await deleteAccount({ user: { _id: user._id }, auth: {} }, res(), jest.fn());
  expect(await User.exists({ _id: user._id })).toBeNull();
  release();
  await ingest;

  // The race happened: a profile under the deleted id (BE-028's batch lane).
  expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(1);

  // S1: the nightly analysis leaves it alone (no MorningState, no access line under the deleted id).
  const summary = await runDailyAnalysis({ data: {} });
  expect(summary.eligible).toBe(1);
  expect(await MorningState.countDocuments({ userId: user._id })).toBe(0);
  expect(lines.join('\n')).not.toContain(String(user._id));

  // The next daily run erases it, and says so.
  const out = await runSessionTrim();
  expect(out).toEqual(expect.objectContaining({ orphanErasures: 1, orphanBacklog: 0, failures: 0 }));
  expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
  expect(await MedicalProfile.countDocuments({ userId: live._id })).toBe(1);
  expect(lines.filter((l) => l.startsWith('[sessionTrim]'))[0]).toContain(' orphanErasures=1 orphanBacklog=0 ');
  expect(lines.join('\n')).not.toContain(String(user._id));
});
