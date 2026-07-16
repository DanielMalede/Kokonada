'use strict';

// Consent service (audit H-9): grant / withdraw / status over the append-only ConsentRecord.
// Withdrawal must ALSO erase the wearable footprint (reusing the per-provider erasure primitive),
// and status must report a stale version when the latest grant predates CURRENT_CONSENT_VERSION.
process.env.NODE_ENV = 'test';

jest.mock('../app/models/ConsentRecord', () => ({
  create:    jest.fn().mockResolvedValue({ _id: 'c1' }),
  latestFor: jest.fn(),
}));
jest.mock('../app/models/User', () => ({
  findById: jest.fn(),
}));
jest.mock('../app/services/privacy/wearableErasure', () => ({
  WEARABLE_PROVIDERS: ['garmin', 'apple_health', 'health_connect', 'suunto'],
  eraseWearableProvider: jest.fn().mockResolvedValue({ biometricLogs: 0, medicalProfiles: 0 }),
}));

const ConsentRecord = require('../app/models/ConsentRecord');
const User = require('../app/models/User');
const { WEARABLE_PROVIDERS, eraseWearableProvider } = require('../app/services/privacy/wearableErasure');
const consent = require('../app/services/privacy/consent');

const PURPOSE = 'health_biometric_processing';
const USER = '507f1f77bcf86cd799439011';

beforeEach(() => jest.clearAllMocks());

describe('CURRENT_CONSENT_VERSION', () => {
  it('is an exported integer (the cross-package contract the mobile team reads)', () => {
    expect(Number.isInteger(consent.CURRENT_CONSENT_VERSION)).toBe(true);
    expect(consent.CURRENT_CONSENT_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe('recordConsent', () => {
  it('writes a GRANTED row at the current version with the requested data categories', async () => {
    await consent.recordConsent(USER, { purpose: PURPOSE, dataCategories: ['heart_rate', 'hrv'] });
    expect(ConsentRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER,
      purpose: PURPOSE,
      consentVersion: consent.CURRENT_CONSENT_VERSION,
      status: 'granted',
      dataCategories: ['heart_rate', 'hrv'],
      grantedAt: expect.any(Date),
    }));
  });
});

describe('getConsentStatus', () => {
  it('granted=true when the latest row is a grant at the current version', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION });
    const s = await consent.getConsentStatus(USER, PURPOSE);
    expect(s).toEqual({ granted: true, currentVersion: consent.CURRENT_CONSENT_VERSION, staleVersion: false });
  });

  it('granted=false when the latest row is a withdrawal (never reads a stale granted row)', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'withdrawn', consentVersion: consent.CURRENT_CONSENT_VERSION });
    const s = await consent.getConsentStatus(USER, PURPOSE);
    expect(s.granted).toBe(false);
  });

  it('granted=false with no record on file', async () => {
    ConsentRecord.latestFor.mockResolvedValue(null);
    const s = await consent.getConsentStatus(USER, PURPOSE);
    expect(s.granted).toBe(false);
    expect(s.staleVersion).toBe(false);
  });

  it('staleVersion=true when the latest grant predates CURRENT_CONSENT_VERSION', async () => {
    // Simulate a bump: latest grant is at version 1, current contract is a higher version.
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION - 1 });
    const s = await consent.getConsentStatus(USER, PURPOSE);
    expect(s.granted).toBe(true);
    expect(s.staleVersion).toBe(true);
  });
});

describe('withdrawConsent', () => {
  it('writes a WITHDRAWN row at the current version', async () => {
    User.findById.mockResolvedValue(null); // no user doc → erasure loop is a no-op
    await consent.withdrawConsent(USER, PURPOSE);
    expect(ConsentRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER,
      purpose: PURPOSE,
      status: 'withdrawn',
      withdrawnAt: expect.any(Date),
    }));
  });

  it('invokes the wearable-erasure primitive for EVERY provider (the purpose spans all wearables)', async () => {
    const user = { _id: USER, save: jest.fn() };
    User.findById.mockResolvedValue(user);
    await consent.withdrawConsent(USER, PURPOSE);
    for (const provider of WEARABLE_PROVIDERS) {
      expect(eraseWearableProvider).toHaveBeenCalledWith(user, provider);
    }
    expect(eraseWearableProvider).toHaveBeenCalledTimes(WEARABLE_PROVIDERS.length);
  });

  it('still records the withdrawal when there is no user doc to erase against', async () => {
    User.findById.mockResolvedValue(null);
    await consent.withdrawConsent(USER, PURPOSE);
    expect(ConsentRecord.create).toHaveBeenCalled();
    expect(eraseWearableProvider).not.toHaveBeenCalled();
  });
});
