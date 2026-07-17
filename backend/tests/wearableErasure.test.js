'use strict';

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

// Per-provider wearable erasure (T3.2): remove exactly one provider's biometric/medical
// footprint + credentials — and NOTHING belonging to another still-connected wearable.

jest.mock('../app/models/BiometricLog', () => ({
  deleteMany:     jest.fn().mockResolvedValue({ deletedCount: 5 }),
  countDocuments: jest.fn().mockResolvedValue(0),
}));
jest.mock('../app/models/MedicalProfile', () => ({
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
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
const MedicalProfile = require('../app/models/MedicalProfile');
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
  MedicalProfile.deleteMany.mockResolvedValue({ deletedCount: 1 });
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

  it('deletes the aggregated MedicalProfile only when NO biometric samples remain (orphaned)', async () => {
    BiometricLog.countDocuments.mockResolvedValue(0); // nothing left → profile derived solely from this provider
    const res = await purgeWearableData(USER, 'garmin');
    expect(MedicalProfile.deleteMany).toHaveBeenCalledWith({ userId: USER });
    expect(res.medicalProfiles).toBe(1);
  });

  it('KEEPS the MedicalProfile when another provider still has samples (removes nothing else)', async () => {
    BiometricLog.countDocuments.mockResolvedValue(12); // apple_health logs remain
    const res = await purgeWearableData(USER, 'garmin');
    expect(MedicalProfile.deleteMany).not.toHaveBeenCalled();
    expect(res.medicalProfiles).toBe(0);
  });

  it('invalidates the derived Redis baseline so it recomputes from what remains', async () => {
    await purgeWearableData(USER, 'garmin');
    expect(fakeRedis.del).toHaveBeenCalledWith(`bio:baseline:${USER}`);
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
