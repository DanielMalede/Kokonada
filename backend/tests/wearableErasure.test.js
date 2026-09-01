'use strict';

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Per-provider wearable erasure (T3.2): remove exactly one provider's biometric/medical
// footprint + credentials — and NOTHING belonging to another still-connected wearable.

jest.mock('../app/models/BiometricLog', () => ({
  deleteMany:     jest.fn().mockResolvedValue({ deletedCount: 5 }),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/models/VitalSample', () => ({
  deleteMany:     jest.fn().mockResolvedValue({ deletedCount: 3 }),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/models/MedicalProfile', () => ({
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
}));
jest.mock('../app/models/MorningState', () => ({
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
}));
// BE-015 / ADR-0015 NEGATIVE GUARD. wearableErasure.js does not require these two at all, and
// that absence IS the behaviour under test — mocking them is what turns "the module happens not
// to import this" into an assertion that survives someone adding the import. See the describe
// at the foot of this file for why the boundary matters.
jest.mock('../app/models/RewardEvent', () => ({
  RewardEvent: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) },
}));
jest.mock('../app/models/PersonalWeights', () => ({
  PersonalWeights: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }) },
}));

jest.mock('../app/config/redis', () => {
  const fake = { del: jest.fn().mockResolvedValue(1) };
  return { getRedis: jest.fn(() => fake), __fake: fake };
});

// Garmin Health API service — deregistration reaches out to Garmin, so it is mocked here.
jest.mock('../app/services/wearable/garmin', () => ({
  getValidToken:  jest.fn().mockResolvedValue('valid-access-token'),
  deregisterUser: jest.fn().mockResolvedValue(undefined),
}));

const BiometricLog   = require('../app/models/BiometricLog');
const VitalSample    = require('../app/models/VitalSample');
const MedicalProfile = require('../app/models/MedicalProfile');
const MorningState   = require('../app/models/MorningState');
const { RewardEvent }     = require('../app/models/RewardEvent');
const { PersonalWeights } = require('../app/models/PersonalWeights');
const garmin         = require('../app/services/wearable/garmin');
const { getRedis, __fake: fakeRedis } = require('../app/config/redis');
const {
  purgeWearableData, clearWearableCredentials, eraseWearableProvider, WEARABLE_PROVIDERS,
} = require('../app/services/privacy/wearableErasure');

const USER = '507f1f77bcf86cd799439011';

beforeEach(() => {
  jest.clearAllMocks();
  BiometricLog.deleteMany.mockResolvedValue({ deletedCount: 5 });
  BiometricLog.countDocuments.mockResolvedValue(0);
  VitalSample.deleteMany.mockResolvedValue({ deletedCount: 3 });
  VitalSample.countDocuments.mockResolvedValue(0);
  MedicalProfile.deleteMany.mockResolvedValue({ deletedCount: 1 });
  MorningState.deleteMany.mockResolvedValue({ deletedCount: 2 });
  getRedis.mockReturnValue(fakeRedis);
  garmin.getValidToken.mockResolvedValue('valid-access-token');
  garmin.deregisterUser.mockResolvedValue(undefined);
  delete process.env.GARMIN_DEREGISTER_ENABLED; // deregistration is dark by default
});
afterAll(() => { delete process.env.GARMIN_DEREGISTER_ENABLED; });

describe('purgeWearableData', () => {
  it('deletes ONLY the biometric samples attributed to that provider (source-scoped)', async () => {
    await purgeWearableData(USER, 'garmin');
    expect(BiometricLog.deleteMany).toHaveBeenCalledWith({ userId: USER, source: 'garmin' });
  });

  // W4-004 / S5: VitalSample is source-attributed too, so a provider disconnect has to take
  // that provider's HRV/SpO2/battery history with it — and nobody else's.
  it('deletes ONLY that provider\'s vital samples, and reports the count', async () => {
    const res = await purgeWearableData(USER, 'garmin');
    expect(VitalSample.deleteMany).toHaveBeenCalledWith({ userId: USER, source: 'garmin' });
    expect(res.vitalSamples).toBe(3);
  });

  it('KEEPS the MedicalProfile (and MorningState) when only VITAL samples remain (HR history exhausted)', async () => {
    BiometricLog.countDocuments.mockResolvedValue(0);  // no HR rows left...
    VitalSample.countDocuments.mockResolvedValue(4);   // ...but another provider's vitals are
    const res = await purgeWearableData(USER, 'garmin');
    expect(MedicalProfile.deleteMany).not.toHaveBeenCalled();
    expect(MorningState.deleteMany).not.toHaveBeenCalled();
    expect(res.medicalProfiles).toBe(0);
    expect(res.morningStates).toBe(0);
  });

  // W4-012 / S5: MorningState is the same category of derived aggregate as MedicalProfile — it
  // rides the identical all-or-nothing rule.
  it('deletes the aggregated MedicalProfile AND MorningState only when NO biometric samples remain (orphaned)', async () => {
    BiometricLog.countDocuments.mockResolvedValue(0); // nothing left → profile derived solely from this provider
    const res = await purgeWearableData(USER, 'garmin');
    expect(MedicalProfile.deleteMany).toHaveBeenCalledWith({ userId: USER });
    expect(MorningState.deleteMany).toHaveBeenCalledWith({ userId: USER });
    expect(res.medicalProfiles).toBe(1);
    expect(res.morningStates).toBe(2);
  });

  it('KEEPS the MedicalProfile and MorningState when another provider still has samples (removes nothing else)', async () => {
    BiometricLog.countDocuments.mockResolvedValue(12); // apple_health logs remain
    const res = await purgeWearableData(USER, 'garmin');
    expect(MedicalProfile.deleteMany).not.toHaveBeenCalled();
    expect(MorningState.deleteMany).not.toHaveBeenCalled();
    expect(res.medicalProfiles).toBe(0);
  });

  it('invalidates the derived Redis baseline so it recomputes from what remains', async () => {
    await purgeWearableData(USER, 'garmin');
    expect(fakeRedis.del).toHaveBeenCalledWith(`bio:baseline:${USER}`);
  });

  // W4-006 (§0.4 S5): the affect posterior is DERIVED from the heart rate and HRV this provider
  // supplied. It stores no vital, but its `label` is an inference about the person, and leaving
  // that cached after they disconnect the sensor is the silent leak S5 exists to prevent.
  it('invalidates the derived affect posterior too', async () => {
    await purgeWearableData(USER, 'garmin');
    expect(fakeRedis.del).toHaveBeenCalledWith(`bio:affect:${USER}`);
  });

  // The two invalidations are independent promises about the user's data, so they carry
  // independent error handling: a Redis failure on the first must not skip the second.
  it('still invalidates the affect posterior when the baseline delete fails', async () => {
    fakeRedis.del.mockRejectedValueOnce(new Error('READONLY'));
    await expect(purgeWearableData(USER, 'garmin')).resolves.toBeDefined();
    expect(fakeRedis.del).toHaveBeenCalledWith(`bio:affect:${USER}`);
  });

  it('never throws when Redis is unavailable', async () => {
    getRedis.mockReturnValue(null);
    await expect(purgeWearableData(USER, 'suunto')).resolves.toBeDefined();
  });
});

describe('clearWearableCredentials', () => {
  it('nulls every Garmin credential field on the user', () => {
    const user = {
      wearableProvider: 'garmin',
      wearableToken: { blob: 'enc' },
      garminUserId: 'g-123',
      garminUserIdHmac: 'hmac-abc',
      watchToken: { hash: 'sha', createdAt: new Date(), lastSeenAt: new Date() },
    };
    const changed = clearWearableCredentials(user, 'garmin');
    expect(changed).toBe(true);
    expect(user.wearableProvider).toBeNull();
    expect(user.wearableToken).toBeNull();
    expect(user.garminUserId).toBeNull();
    expect(user.garminUserIdHmac).toBeNull();
    expect(user.watchToken.hash).toBeNull();
  });

  it('clears a push-based provider credential without touching garmin-only fields', () => {
    const user = { wearableProvider: 'apple_health', wearableToken: null, garminUserId: 'g-9' };
    const changed = clearWearableCredentials(user, 'apple_health');
    expect(changed).toBe(true);
    expect(user.wearableProvider).toBeNull();
    expect(user.garminUserId).toBe('g-9'); // NOT a garmin erasure — untouched
  });

  it('does not clear the active provider when erasing a different one', () => {
    const user = { wearableProvider: 'apple_health', wearableToken: null };
    clearWearableCredentials(user, 'garmin');
    expect(user.wearableProvider).toBe('apple_health');
  });
});

describe('eraseWearableProvider', () => {
  it('clears credentials, persists the user, and purges the provider data', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const user = { _id: USER, wearableProvider: 'garmin', wearableToken: { blob: 'x' }, garminUserId: 'g', save };
    const res = await eraseWearableProvider(user, 'garmin');
    expect(user.wearableProvider).toBeNull();
    expect(save).toHaveBeenCalled();
    expect(BiometricLog.deleteMany).toHaveBeenCalledWith({ userId: USER, source: 'garmin' });
    expect(res.biometricLogs).toBe(5);
  });
});

describe('eraseWearableProvider — Garmin deregistration (Wave 6 T4, flag-gated OFF)', () => {
  const makeGarminUser = () => ({
    _id: USER, wearableProvider: 'garmin', wearableToken: { blob: 'x' }, garminUserId: 'g',
    save: jest.fn().mockResolvedValue(undefined),
  });

  it('does NOT call Garmin when GARMIN_DEREGISTER_ENABLED is unset (dark by default)', async () => {
    const res = await eraseWearableProvider(makeGarminUser(), 'garmin');
    expect(garmin.getValidToken).not.toHaveBeenCalled();
    expect(garmin.deregisterUser).not.toHaveBeenCalled();
    expect(res.deregistration).toEqual({ attempted: false });
    // local erasure still ran
    expect(BiometricLog.deleteMany).toHaveBeenCalledWith({ userId: USER, source: 'garmin' });
  });

  it('deregisters with a valid token when the flag is enabled', async () => {
    process.env.GARMIN_DEREGISTER_ENABLED = 'true';
    const user = makeGarminUser();
    const res = await eraseWearableProvider(user, 'garmin');
    expect(garmin.getValidToken).toHaveBeenCalledWith(user);
    expect(garmin.deregisterUser).toHaveBeenCalledWith('valid-access-token');
    expect(res.deregistration).toEqual({ attempted: true, ok: true });
  });

  it('never calls Garmin for a non-garmin provider even with the flag enabled', async () => {
    process.env.GARMIN_DEREGISTER_ENABLED = 'true';
    const user = { _id: USER, wearableProvider: 'apple_health', wearableToken: null, save: jest.fn().mockResolvedValue(undefined) };
    const res = await eraseWearableProvider(user, 'apple_health');
    expect(garmin.deregisterUser).not.toHaveBeenCalled();
    expect(res.deregistration).toBeUndefined();
  });

  it('still completes the local erasure when Garmin deregistration fails (best-effort)', async () => {
    process.env.GARMIN_DEREGISTER_ENABLED = 'true';
    garmin.deregisterUser.mockRejectedValue(new Error('garmin 500'));
    const res = await eraseWearableProvider(makeGarminUser(), 'garmin');
    expect(res.deregistration).toEqual({ attempted: true, ok: false });
    // erasure was NOT blocked by the Garmin failure
    expect(BiometricLog.deleteMany).toHaveBeenCalledWith({ userId: USER, source: 'garmin' });
    expect(res.biometricLogs).toBe(5);
  });
});

describe('WEARABLE_PROVIDERS', () => {
  it('enumerates the four supported wearable providers', () => {
    expect([...WEARABLE_PROVIDERS].sort()).toEqual(
      ['apple_health', 'garmin', 'health_connect', 'suunto'],
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// BE-015 / ADR-0015 — THE BOUNDARY BETWEEN "I WITHDREW CONSENT" AND "I UNPAIRED A WATCH"
//
// Withdrawing Art.9 consent now DOES erase the learned personalization (RewardEvent +
// PersonalWeights), because the consent notice promises exactly that on its pinned first layer.
// It is erased by services/privacy/learningErasure.js, called from consent.withdrawConsent ONLY.
//
// It must NOT be erased here, and the reason is arithmetic rather than taste: purgeWearableData
// has THREE callers, and two of them are not withdrawals —
//   · integrationsController.garminDisconnect   ← the LIVE "Disconnect Garmin" button
//   · wearableErasureController.deleteWearableProvider
// Moving the delete into this module (the obvious "tidy-up" for the next reader, since erasure
// already lives here) would silently wire it to both of them: unpairing a watch would destroy a
// listener's whole taste profile. No notice promises that, half of a bucket's evidence is
// behavioural and never touched a wearable, and a scoring weight has no `source` to scope by —
// it is precisely the over-erasure this module's own exclusion rationale argues against, and
// ADR-0015 overrules that rationale at withdrawal scope ONLY.
//
// So this is a guard against a REFACTOR, not against today's code. It passes on arrival; it is
// here to fail the day somebody merges the two scopes. Its non-vacuity was proven by moving the
// delete into purgeWearableData and watching both this suite and the real-Mongo one go red.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('per-provider erasure NEVER touches the learned personalization (ADR-0015)', () => {
  it('purgeWearableData leaves RewardEvent and PersonalWeights alone', async () => {
    await purgeWearableData(USER, 'garmin');
    expect(RewardEvent.deleteMany).not.toHaveBeenCalled();
    expect(PersonalWeights.deleteMany).not.toHaveBeenCalled();
  });

  it('eraseWearableProvider — the LIVE disconnect path — leaves them alone too', async () => {
    const user = { _id: USER, wearableProvider: 'garmin', wearableToken: null, save: jest.fn().mockResolvedValue(undefined) };
    await eraseWearableProvider(user, 'garmin');
    expect(RewardEvent.deleteMany).not.toHaveBeenCalled();
    expect(PersonalWeights.deleteMany).not.toHaveBeenCalled();
    // Sanity: the erasure it IS responsible for really ran, so the assertions above are not
    // passing merely because nothing happened at all.
    expect(BiometricLog.deleteMany).toHaveBeenCalledWith({ userId: USER, source: 'garmin' });
  });
});
