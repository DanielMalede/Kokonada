'use strict';

// BE-205 (security-auditor SEC-273-1): the Garmin ingest seam checks the Art. 9 grant itself.
//
// garminIngest.ingestSummaries trusted its caller. Only the webhook controller read consent, so any
// other caller (a job, a script or a new route) would have stored heart rate, resting HR, HRV and
// sleep for a user with no consent record, after a withdrawal, or on a grant of an older version.
// The seam now reads the latest consent row FIRST and fails closed: anything but a current
// grant returns a refusal with zero counts, the normaliser never runs and no store is touched. A consent
// read that fails throws, so the webhook answers 500 and Garmin retries.
//
// Real semantics: the REAL consent read (ConsentRecord.latestFor) on a REAL Mongo (mongodb-memory-server),
// the REAL predicate (consentState.isCurrentGrant), the REAL stores, and the REAL normaliser behind a
// passthrough spy: it records its calls and returns exactly what the real one returns. Redis is absent,
// so the recompute enqueue at the tail of persistMetrics is a no-op.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;

jest.mock('../app/services/wearable/adapter', () => {
  const actual = jest.requireActual('../app/services/wearable/adapter');
  return { ...actual, normalizeGarminSummaries: jest.fn(actual.normalizeGarminSummaries) };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord = require('../app/models/ConsentRecord');
const { normalizeGarminSummaries } = require('../app/services/wearable/adapter');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_consent_gate' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(() => jest.clearAllMocks());

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
// Yesterday's UTC midnight: every reading below is inside retention and behind the clock.
const MIDNIGHT = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;

// One push that reaches all three stores when it is admitted: two heart-rate readings (BiometricLog), a
// resting HR and a night's HRV (VitalSample), and a night's sleep with the resting HR's median
// (MedicalProfile).
const push = () => [
  { type: 'dailies', summary: { startTimeInSeconds: MIDNIGHT, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61, 60: 62 } } },
  { type: 'hrv', summary: { startTimeInSeconds: MIDNIGHT - 2 * HOUR, durationInSeconds: 8 * HOUR, lastNightAvg: 48 } },
  {
    type: 'sleeps',
    summary: {
      startTimeInSeconds: MIDNIGHT - 2 * HOUR,
      durationInSeconds: 8 * HOUR,
      deepSleepDurationInSeconds: 3600,
      lightSleepDurationInSeconds: 14400,
      remSleepInSeconds: 5400,
    },
  },
];

const row = (userId, status, consentVersion) => ConsentRecord.create({
  userId,
  purpose: HEALTH_CONSENT_PURPOSE,
  consentVersion,
  status,
  ...(status === 'granted' ? { grantedAt: new Date() } : { withdrawnAt: new Date() }),
});

const stored = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId }),
  vitals: await VitalSample.countDocuments({ userId }),
  profile: await MedicalProfile.countDocuments({ userId }),
});

describe('ingestSummaries refuses anything but a current Art. 9 grant (BE-205)', () => {
  it.each([
    ['no consent record on file', async () => {}],
    ['the latest row is a withdrawal', async (userId) => {
      await row(userId, 'granted', CURRENT_CONSENT_VERSION);
      await row(userId, 'withdrawn', CURRENT_CONSENT_VERSION);
    }],
    ['the latest row is a grant of an older version (stale)', async (userId) => {
      await row(userId, 'granted', CURRENT_CONSENT_VERSION - 1);
    }],
  ])('%s: 0 rows in all three stores, the refusal code, and the normaliser never runs', async (_label, seed) => {
    const userId = new mongoose.Types.ObjectId();
    await seed(userId);

    const res = await ingestSummaries(userId, push());

    expect(res.refused).toBe('consent_not_current');
    expect(res).toMatchObject({ accepted: 0, inserted: 0, rejected: { count: 0, reasons: [] }, profileMetrics: {} });
    // Every count the seam reports is zero, including any it gains later.
    const counts = Object.entries(res).filter(([, v]) => typeof v === 'number');
    expect(counts.length).toBeGreaterThanOrEqual(3);
    for (const [, n] of counts) expect(n).toBe(0);
    expect(normalizeGarminSummaries).not.toHaveBeenCalled();
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('a consent read that fails throws and writes nothing, so the webhook answers 500 and Garmin retries', async () => {
    const userId = new mongoose.Types.ObjectId();
    await row(userId, 'granted', CURRENT_CONSENT_VERSION);
    // The one injected fault: the consent store does not answer. Everything after it is real.
    const read = jest.spyOn(ConsentRecord, 'latestFor').mockRejectedValueOnce(new Error('consent store unavailable'));
    try {
      await expect(ingestSummaries(userId, push())).rejects.toThrow('consent store unavailable');
    } finally {
      read.mockRestore();
    }

    expect(normalizeGarminSummaries).not.toHaveBeenCalled();
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  // The control: the same push for a user who holds a current grant reaches every store, so the
  // refusals above are the gate's doing and not an empty fixture's.
  it('a current grant: the push is normalised and written to all three stores', async () => {
    const userId = new mongoose.Types.ObjectId();
    await row(userId, 'granted', CURRENT_CONSENT_VERSION);

    const res = await ingestSummaries(userId, push());

    expect(res.refused).toBeNull();
    expect(res.accepted).toBe(7); // 2 heart rate, resting HR, HRV, 3 sleep stages
    expect(normalizeGarminSummaries).toHaveBeenCalledTimes(3);
    expect(await stored(userId)).toEqual({ heartRate: 2, vitals: 2, profile: 1 });
  });

  it('a withdrawal after a grant stops the next push: the rows written before it stay, nothing new lands', async () => {
    const userId = new mongoose.Types.ObjectId();
    await row(userId, 'granted', CURRENT_CONSENT_VERSION);
    await ingestSummaries(userId, push());
    const before = await stored(userId);
    expect(before).toEqual({ heartRate: 2, vitals: 2, profile: 1 });

    await row(userId, 'withdrawn', CURRENT_CONSENT_VERSION);
    const later = push().map(({ type, summary }) => ({ type, summary: { ...summary, startTimeInSeconds: summary.startTimeInSeconds + DAY / 2 } }));
    const res = await ingestSummaries(userId, later);

    expect(res.refused).toBe('consent_not_current');
    expect(await stored(userId)).toEqual(before);
  });
});
