'use strict';

// RA-2, resilience audit of #275 at d12510d: the Garmin webhook through the REAL seam and stores.
//
// A summary time a Date cannot hold (|t| > 8.64e12 s) is normalised to records whose recordedAt is an
// Invalid Date. NaN is neither past retention nor past now + MAX_FUTURE_SKEW_MS, so both of the seam's
// filters kept it. A heart-rate reading then reached BiometricLog.find as `$gte: Invalid Date`, Mongoose's
// cast threw, the seam rejected and the webhook answered 500 for the whole push: every later user in it was
// not ingested, and Garmin's retry failed the same way. A resting HR alone was folded into MedicalProfile.
// (The audit's RA-3 case, the webhook counting a user the seam refused, is BE-225: it needs the controller.)
//
// Real semantics: the REAL controller, consent read, normaliser and stores on a REAL Mongo
// (mongodb-memory-server). The socket chain the controller loads is kept out, as in
// garminWebhook.integration.test.js. Redis is absent.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
delete process.env.REDIS_URL;
const WEBHOOK_SECRET = 'ra2-it-secret';
process.env.GARMIN_WEBHOOK_SECRET = WEBHOOK_SECRET;

jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const VitalSample = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const ConsentRecord = require('../app/models/ConsentRecord');
const { CURRENT_CONSENT_VERSION, HEALTH_CONSENT_PURPOSE } = require('../app/services/privacy/consentState');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const { garminWebhook } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_ra2_webhook_seam' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});

const DAY = 24 * 60 * 60;
const YESTERDAY = Math.floor(Date.now() / 1000 / DAY) * DAY - DAY;
const FAR = 1e13; // seconds: past the 8.64e12 s a Date can hold

const grant = (userId) => ConsentRecord.create({
  userId, purpose: HEALTH_CONSENT_PURPOSE, consentVersion: CURRENT_CONSENT_VERSION, status: 'granted', grantedAt: new Date(),
});
const garminUser = (gid) => User.create({ ssoProvider: 'google', ssoId: `s-${gid}`, email: `${gid}@x.c`, wearableProvider: 'garmin', garminUserId: gid });
const stored = async (userId) => ({
  heartRate: await BiometricLog.countDocuments({ userId }),
  vitals: await VitalSample.countDocuments({ userId }),
  profile: await MedicalProfile.countDocuments({ userId }),
});
const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

describe('RA-2: a time a Date cannot hold is dropped by the seam, never thrown or stored', () => {
  it.each([['far future', FAR], ['far past', -FAR]])('%s: heart rate and resting HR resolve with nothing written', async (_label, start) => {
    expect(Number.isNaN(new Date(start * 1000).getTime())).toBe(true); // the fixture really is unrepresentable
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);

    const res = await ingestSummaries(userId, [{
      type: 'dailies', summary: { startTimeInSeconds: start, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61 } },
    }]);

    expect(res.inserted).toBe(0);
    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('a resting HR alone at such a time is not folded into MedicalProfile', async () => {
    const userId = new mongoose.Types.ObjectId();
    await grant(userId);

    await ingestSummaries(userId, [{ type: 'dailies', summary: { startTimeInSeconds: FAR, restingHeartRateInBeatsPerMinute: 52 } }]);

    expect(await stored(userId)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
  });

  it('through the webhook, one user\'s such summary does not cost the next user in the same push', async () => {
    const poisoned = await garminUser('g-ra2-a');
    const healthy = await garminUser('g-ra2-b');
    await grant(poisoned._id);
    await grant(healthy._id);
    const res = makeRes();
    const next = jest.fn();

    await garminWebhook({
      query: { secret: WEBHOOK_SECRET },
      body: {
        dailies: [
          { userId: 'g-ra2-a', startTimeInSeconds: FAR, timeOffsetHeartRateSamples: { 0: 61 } },
          { userId: 'g-ra2-b', startTimeInSeconds: YESTERDAY, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61 } },
        ],
      },
    }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(await stored(poisoned._id)).toEqual({ heartRate: 0, vitals: 0, profile: 0 });
    expect(await stored(healthy._id)).toEqual({ heartRate: 1, vitals: 1, profile: 1 });
  });
});
