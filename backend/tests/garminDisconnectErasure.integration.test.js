'use strict';

// REAL end-to-end integration test (mongodb-memory-server) for the LIVE "Disconnect Garmin"
// route (DELETE /api/integrations/garmin/disconnect → garminDisconnect). The GDPR erasure
// module (services/privacy/wearableErasure.js) was fully built and unit-tested, but the actual
// disconnect handler only nulled the credential fields and NEVER purged the biometric/medical
// footprint — so a user's Garmin physiology survived a "disconnect", contradicting
// docs/PRIVACY_DECLARATIONS.md. Prior tests only asserted the OLD field-nulling behavior against
// a mocked user; NONE exercised the real route against real Mongo, so the gap went unseen.
//
// This test creates real BiometricLog + MedicalProfile rows and calls the REAL garminDisconnect
// controller against a real Mongo, asserting the rows are ACTUALLY gone. On the un-fixed code
// (field-nulling only) the rows survive, so this fails hard — no false-green. It also proves the
// erasure stays SCOPED: a still-connected provider's samples and another user's Garmin samples
// must survive.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
// GARMIN_DEREGISTER_ENABLED is intentionally left unset — the local data purge must complete
// with NO outbound Garmin call (best-effort deregistration is flag-gated OFF until approval).

// Keep the heavy socket chain out of the controller under test; leave the erasure module REAL.
jest.mock('../app/sockets', () => ({ getIo: () => null }));
jest.mock('../app/sockets/biometricHandler', () => ({ handleBiometricReading: jest.fn() }));
// No real Redis; purgeWearableData's baseline-blob invalidation no-ops (best-effort by design).
jest.mock('../app/config/redis', () => ({ getRedis: () => null }));

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User           = require('../app/models/User');
const BiometricLog   = require('../app/models/BiometricLog');
const MedicalProfile = require('../app/models/MedicalProfile');
const { garminDisconnect } = require('../app/controllers/integrationsController');

jest.setTimeout(120000);

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_garmin_disconnect_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await User.deleteMany({});
  await BiometricLog.deleteMany({});
  await MedicalProfile.deleteMany({});
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}
const log = (userId, source, hr = 60) =>
  BiometricLog.create({ userId, heartRate: hr, source, activity: 'resting', recordedAt: new Date() });

describe('garminDisconnect — real route erases the Garmin footprint (real Mongo)', () => {
  it('purges the disconnecting user\'s Garmin biometric + medical rows AND clears the credentials', async () => {
    const user = await User.create({
      ssoProvider: 'google', ssoId: 's-1', email: 'a@x.c',
      wearableProvider: 'garmin', garminUserId: 'garmin-1',
    });
    await log(user._id, 'garmin'); await log(user._id, 'garmin'); await log(user._id, 'garmin');
    await MedicalProfile.create({ userId: user._id, restingHeartRate: 57 });

    const res = makeRes();
    const next = jest.fn();
    await garminDisconnect({ user }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Garmin disconnected' }));

    // Credentials cleared on the saved user (blind index + garminUserId gone).
    const saved = await User.findById(user._id);
    expect(saved.wearableProvider).toBeNull();
    expect(saved.garminUserId).toBeNull();

    // The whole point: the physiological footprint is ACTUALLY gone (this FAILS on field-null-only code).
    expect(await BiometricLog.countDocuments({ userId: user._id })).toBe(0);
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(0);
  });

  it('stays SCOPED — a still-connected provider\'s samples and another user\'s Garmin samples survive', async () => {
    const user  = await User.create({ ssoProvider: 'google', ssoId: 's-2', email: 'b@x.c', wearableProvider: 'garmin', garminUserId: 'garmin-2' });
    const other = await User.create({ ssoProvider: 'google', ssoId: 's-3', email: 'c@x.c', wearableProvider: 'garmin', garminUserId: 'garmin-3' });
    await log(user._id, 'garmin'); await log(user._id, 'garmin');
    await log(user._id, 'apple_health'); // a second wearable the user still relies on
    await log(other._id, 'garmin');      // a DIFFERENT user — must never be touched
    await MedicalProfile.create({ userId: user._id, restingHeartRate: 60 });

    await garminDisconnect({ user }, makeRes(), jest.fn());

    expect(await BiometricLog.countDocuments({ userId: user._id, source: 'garmin' })).toBe(0);        // erased
    expect(await BiometricLog.countDocuments({ userId: user._id, source: 'apple_health' })).toBe(1);  // kept
    expect(await BiometricLog.countDocuments({ userId: other._id, source: 'garmin' })).toBe(1);       // other user kept
    // Apple Health samples remain → the aggregate profile is not solely Garmin-derived → kept.
    expect(await MedicalProfile.countDocuments({ userId: user._id })).toBe(1);
  });
});
