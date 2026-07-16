'use strict';

// Grandfather-consent backfill (audit H-9, decision 4): the one existing prod user who already
// consented via OS/OAuth gets a single dated grant so the new server gate doesn't lock them out.
// This is a human-run script; the unit under test is its IDEMPOTENCY guard — running it twice must
// not double-write.
process.env.NODE_ENV = 'test';

jest.mock('../app/models/ConsentRecord', () => ({ findOne: jest.fn() }));
jest.mock('../app/services/privacy/consent', () => ({
  recordConsent: jest.fn().mockResolvedValue({ _id: 'c1' }),
  CURRENT_CONSENT_VERSION: 1,
}));
jest.mock('../app/models/MedicalProfile', () => ({ distinct: jest.fn() }));
jest.mock('../app/models/BiometricLog', () => ({ distinct: jest.fn() }));

const ConsentRecord = require('../app/models/ConsentRecord');
const { recordConsent } = require('../app/services/privacy/consent');
const MedicalProfile = require('../app/models/MedicalProfile');
const BiometricLog = require('../app/models/BiometricLog');
const { hasGrantAtVersion, backfillOne, resolveTargetUserId } =
  require('../scripts/backfillGrandfatherConsent');

const USER = '507f1f77bcf86cd799439011';
const leanOf = (doc) => ({ lean: () => Promise.resolve(doc) });

beforeEach(() => jest.clearAllMocks());

describe('hasGrantAtVersion', () => {
  it('false when no granted row at this version exists', async () => {
    ConsentRecord.findOne.mockReturnValue(leanOf(null));
    expect(await hasGrantAtVersion(USER, 1)).toBe(false);
    expect(ConsentRecord.findOne).toHaveBeenCalledWith({
      userId: USER, purpose: 'health_biometric_processing', consentVersion: 1, status: 'granted',
    });
  });

  it('true when a granted row at this version already exists', async () => {
    ConsentRecord.findOne.mockReturnValue(leanOf({ _id: 'existing' }));
    expect(await hasGrantAtVersion(USER, 1)).toBe(true);
  });
});

describe('backfillOne — idempotency (must not double-write)', () => {
  it('writes exactly one grant on the first run', async () => {
    ConsentRecord.findOne.mockReturnValue(leanOf(null));
    const res = await backfillOne(USER);
    expect(res.written).toBe(true);
    expect(recordConsent).toHaveBeenCalledTimes(1);
    expect(recordConsent).toHaveBeenCalledWith(USER, { purpose: 'health_biometric_processing' });
  });

  it('does NOT write again when a grant already exists (second run is a no-op)', async () => {
    ConsentRecord.findOne.mockReturnValue(leanOf({ _id: 'existing' }));
    const res = await backfillOne(USER);
    expect(res.written).toBe(false);
    expect(recordConsent).not.toHaveBeenCalled();
  });
});

describe('resolveTargetUserId', () => {
  it('returns an explicit userId as-is (no lookup)', async () => {
    const id = await resolveTargetUserId(USER);
    expect(id).toBe(USER);
    expect(MedicalProfile.distinct).not.toHaveBeenCalled();
  });

  it('falls back to the single user with health data when no id is given', async () => {
    MedicalProfile.distinct.mockResolvedValue([USER]);
    const id = await resolveTargetUserId(null);
    expect(String(id)).toBe(USER);
  });

  it('returns null (require an explicit id) when the health-data owner is ambiguous', async () => {
    MedicalProfile.distinct.mockResolvedValue([USER, '507f1f77bcf86cd799439012']);
    BiometricLog.distinct.mockResolvedValue([]);
    expect(await resolveTargetUserId(null)).toBeNull();
  });
});
