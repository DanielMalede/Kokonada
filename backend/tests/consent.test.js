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
// BE-015 / ADR-0015: withdrawal ALSO erases the learned personalization. Mocked on the same
// footing as the wearable primitive above, and the mock is MANDATORY rather than tidy — this is
// a pure unit suite with no Mongo, so the real module would hand the withdrawal path two
// unconnected Mongoose models and every withdrawal test would die on the 10s buffer timeout.
// What it CANNOT do is prove a row was deleted; it only proves the call was made with the right
// argument, under the right condition. The rows are proven actually gone against real query
// semantics in tests/consentWithdrawalErasure.integration.test.js — read the two together.
jest.mock('../app/services/privacy/learningErasure', () => ({
  purgeLearnedPersonalization: jest.fn().mockResolvedValue({ rewardEvents: 0, personalWeights: 0 }),
}));

const ConsentRecord = require('../app/models/ConsentRecord');
const User = require('../app/models/User');
const { WEARABLE_PROVIDERS, eraseWearableProvider } = require('../app/services/privacy/wearableErasure');
const { purgeLearnedPersonalization } = require('../app/services/privacy/learningErasure');
const consent = require('../app/services/privacy/consent');

const PURPOSE = 'health_biometric_processing';
const USER = '507f1f77bcf86cd799439011';

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks clears CALL DATA but NOT implementations, so a `mockResolvedValue` set in one
  // describe leaks into every describe after it. That is not hypothetical here: the withdrawal
  // block below inherited getConsentStatus's last "granted" row and silently changed which
  // branch it was testing. Reset to the honest default — no record on file — and let each test
  // state the consent history it actually means to exercise.
  ConsentRecord.latestFor.mockReset();
});

describe('CURRENT_CONSENT_VERSION', () => {
  it('is an exported integer (the cross-package contract the mobile team reads)', () => {
    expect(Number.isInteger(consent.CURRENT_CONSENT_VERSION)).toBe(true);
    expect(consent.CURRENT_CONSENT_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe('recordConsent', () => {
  it('writes a GRANTED row at the current version with the requested data categories', async () => {
    const result = await consent.recordConsent(USER, { purpose: PURPOSE, dataCategories: ['heart_rate', 'hrv'] });
    expect(ConsentRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER,
      purpose: PURPOSE,
      consentVersion: consent.CURRENT_CONSENT_VERSION,
      status: 'granted',
      dataCategories: ['heart_rate', 'hrv'],
      grantedAt: expect.any(Date),
    }));
    expect(result.ok).toBe(true);
  });

  it('no clientVersion sent (back-compat) → records as before, no mismatch check', async () => {
    const result = await consent.recordConsent(USER, { purpose: PURPOSE, dataCategories: [] });
    expect(ConsentRecord.create).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('clientVersion matches CURRENT_CONSENT_VERSION → records normally', async () => {
    const result = await consent.recordConsent(USER, {
      purpose: PURPOSE, dataCategories: [], clientVersion: consent.CURRENT_CONSENT_VERSION,
    });
    expect(ConsentRecord.create).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  // resilience-audit finding: a server-only CURRENT_CONSENT_VERSION bump makes an un-updated
  // app's grant silently record as "current" even though it displayed the OLD terms/categories.
  // The client must declare which contract version its copy represents; a mismatch is rejected
  // — the row is never written — rather than recorded as a false "current" consent.
  it('clientVersion OLDER than CURRENT_CONSENT_VERSION → REJECTED, no row written', async () => {
    const result = await consent.recordConsent(USER, {
      purpose: PURPOSE, dataCategories: [], clientVersion: consent.CURRENT_CONSENT_VERSION - 1,
    });
    expect(result).toEqual({ ok: false, reason: 'stale_client', currentVersion: consent.CURRENT_CONSENT_VERSION });
    expect(ConsentRecord.create).not.toHaveBeenCalled();
  });

  it('clientVersion NEWER than CURRENT_CONSENT_VERSION (server behind a rolled-back client) → also rejected, not silently trusted', async () => {
    const result = await consent.recordConsent(USER, {
      purpose: PURPOSE, dataCategories: [], clientVersion: consent.CURRENT_CONSENT_VERSION + 1,
    });
    expect(result.ok).toBe(false);
    expect(ConsentRecord.create).not.toHaveBeenCalled();
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

  it('a mid-loop erasure failure does NOT abort erasure of the remaining providers (resilience-audit finding)', async () => {
    const user = { _id: USER, save: jest.fn() };
    User.findById.mockResolvedValue(user);
    // Second provider throws; the withdrawal row was already written before the loop runs, and the
    // remaining providers must still be attempted rather than the loop aborting on the first failure.
    eraseWearableProvider
      .mockResolvedValueOnce({ biometricLogs: 0, medicalProfiles: 0 })
      .mockRejectedValueOnce(new Error('mongo timeout'))
      .mockResolvedValueOnce({ biometricLogs: 0, medicalProfiles: 0 })
      .mockResolvedValueOnce({ biometricLogs: 0, medicalProfiles: 0 });

    const result = await consent.withdrawConsent(USER, PURPOSE);

    expect(eraseWearableProvider).toHaveBeenCalledTimes(WEARABLE_PROVIDERS.length);
    for (const provider of WEARABLE_PROVIDERS) {
      expect(eraseWearableProvider).toHaveBeenCalledWith(user, provider);
    }
    // The failure is surfaced (not silently swallowed) so an operator can see incomplete erasure,
    // but withdrawConsent itself does not throw — the consent withdrawal already succeeded.
    expect(result.erasureFailures).toEqual([WEARABLE_PROVIDERS[1]]);
  });
});

// BE-015 / ADR-0015. The Art.9 notice promises on its pinned first layer that withdrawal "also
// erases what the app has learned about your taste". These pin the WIRING of that promise; the
// integration suite pins that the rows are really gone.
describe('withdrawConsent — learned personalization (ADR-0015)', () => {
  const grantOnFile = () =>
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION });

  it('purges the learned personalization ONCE — outside the per-provider loop', async () => {
    grantOnFile();
    User.findById.mockResolvedValue({ _id: USER, save: jest.fn() });

    await consent.withdrawConsent(USER, PURPOSE);

    // Once for the USER, not once per provider: a taste profile has no provider in it, so four
    // calls would be the same whole-user delete repeated — and would read as if the purge
    // belonged inside the loop, which is exactly the placement ADR-0015 rules out.
    expect(purgeLearnedPersonalization).toHaveBeenCalledTimes(1);
    expect(purgeLearnedPersonalization).toHaveBeenCalledWith(USER);
  });

  it('purges even when there is no User doc — these rows are keyed by userId, not by a credential', async () => {
    grantOnFile();
    User.findById.mockResolvedValue(null); // provider loop is a no-op...

    await consent.withdrawConsent(USER, PURPOSE);

    expect(eraseWearableProvider).not.toHaveBeenCalled();
    expect(purgeLearnedPersonalization).toHaveBeenCalledTimes(1); // ...the promise is kept anyway
  });

  // THE GUARD. POST /api/consent/withdraw is directly callable and the UI only HIDES the button,
  // so a mood-only listener who never granted health consent reaches this path. Erasing their
  // taste model would destroy data no consent ever covered — the over-erasure wearableErasure.js
  // rightly argues against.
  it('does NOT purge when there is no grant on file', async () => {
    ConsentRecord.latestFor.mockResolvedValue(null);
    User.findById.mockResolvedValue({ _id: USER, save: jest.fn() });

    await consent.withdrawConsent(USER, PURPOSE);

    expect(purgeLearnedPersonalization).not.toHaveBeenCalled();
    expect(eraseWearableProvider).toHaveBeenCalledTimes(WEARABLE_PROVIDERS.length); // still erased
  });

  it('does NOT purge when the latest row is ALREADY a withdrawal (a repeat call re-erases nothing)', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'withdrawn', consentVersion: consent.CURRENT_CONSENT_VERSION });

    await consent.withdrawConsent(USER, PURPOSE);

    expect(purgeLearnedPersonalization).not.toHaveBeenCalled();
  });

  it('a learning-erasure failure is attributed to LEARNING, never misreported as a provider', async () => {
    grantOnFile();
    User.findById.mockResolvedValue({ _id: USER, save: jest.fn() });
    purgeLearnedPersonalization.mockRejectedValueOnce(new Error('mongo timeout'));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = await consent.withdrawConsent(USER, PURPOSE);

    // 'learning' is deliberately NOT a provider name: an operator who read this as a provider
    // failure would retry the wrong erasure and never learn the taste profile is still there.
    expect(result.erasureFailures).toEqual(['learning']);
    expect(eraseWearableProvider).toHaveBeenCalledTimes(WEARABLE_PROVIDERS.length); // not aborted
    // Art.5(2): the FAILURE path is the one that most needs a demonstrable record.
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[consent-withdrawal]'));
    expect(line).toContain('learning=failed');
    expect(line).toContain('providerErasureFailures=0'); // the count excludes the learning entry
    info.mockRestore();
  });
});
