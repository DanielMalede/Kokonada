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
// BE-016 (DEC-111): withdrawal ALSO erases the session heart-rate snapshot and the values derived from
// it. A FIXTURE change, not a pin reversal: mocked on the same footing as the two erasures above,
// because this suite has no Mongo and the real module would hand the withdrawal unconnected models
// (the two pins at "a mid-loop erasure failure" and "a learning-erasure failure" then saw an extra
// 'session-health' entry). The rows are proven gone on real Mongo in
// tests/consentWithdrawalSessionHealth.integration.test.js.
jest.mock('../app/services/privacy/sessionHealthErasure', () => ({
  eraseSessionHealthOnWithdrawal: jest.fn().mockResolvedValue({
    status: 'purged', counts: { sessions: 0, sessionTargets: 0, serveEvents: 0, redisKeys: 0 },
  }),
}));

// J1 (BE-074): withdrawal ALSO removes the learning jobs waiting in the job queue. A FIXTURE change on
// the same footing as the mocks above: this suite has no Redis, and with REDIS_URL exported the real
// module would dial it. The jobs are proven gone on real Redis and real Mongo in
// tests/consentWithdrawalJobs.redis.test.js.
// J2 (P13; fixture F1): the purge's result also names each queue's count, as the real one does.
jest.mock('../app/queues/userJobPurge', () => ({
  purgeUserJobs: jest.fn().mockResolvedValue({
    removed: 0, inFlight: 0, byQueue: { 'reward-ingest': { removed: 0, inFlight: 0 }, 'state-vector-recompute': { removed: 0, inFlight: 0 } },
  }),
}));

const ConsentRecord = require('../app/models/ConsentRecord');
const User = require('../app/models/User');
const { purgeUserJobs } = require('../app/queues/userJobPurge');
const { WEARABLE_PROVIDERS, eraseWearableProvider } = require('../app/services/privacy/wearableErasure');
const { purgeLearnedPersonalization } = require('../app/services/privacy/learningErasure');
const { eraseSessionHealthOnWithdrawal } = require('../app/services/privacy/sessionHealthErasure');
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

// BE-016 (DEC-111). The wiring of the session-health erasure; the rows are proven gone in
// tests/consentWithdrawalSessionHealth.integration.test.js.
describe('withdrawConsent — session health (BE-016)', () => {
  const withdrawalLine = (info) => info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[consent-withdrawal]'));

  it('runs once, for the user, AFTER the withdrawal row is written (a racing write then sees the withdrawal)', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION });
    User.findById.mockResolvedValue(null);

    await consent.withdrawConsent(USER, PURPOSE);

    expect(eraseSessionHealthOnWithdrawal).toHaveBeenCalledTimes(1);
    expect(eraseSessionHealthOnWithdrawal).toHaveBeenCalledWith(USER);
    expect(ConsentRecord.create.mock.invocationCallOrder[0]).toBeLessThan(eraseSessionHealthOnWithdrawal.mock.invocationCallOrder[0]);
  });

  it('is NOT gated on a current grant: a repeat withdrawal re-runs it (the module reads the whole history)', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'withdrawn', consentVersion: consent.CURRENT_CONSENT_VERSION });

    await consent.withdrawConsent(USER, PURPOSE);

    expect(eraseSessionHealthOnWithdrawal).toHaveBeenCalledTimes(1);
    expect(purgeLearnedPersonalization).not.toHaveBeenCalled(); // the learning gate is unchanged
  });

  it('runs for the health purpose only', async () => {
    await consent.withdrawConsent(USER, 'some_future_purpose');

    expect(eraseSessionHealthOnWithdrawal).not.toHaveBeenCalled();
  });

  it('a failure is attributed to session-health, never thrown, and the line carries the counts it reached', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION });
    User.findById.mockResolvedValue({ _id: USER, save: jest.fn() });
    eraseSessionHealthOnWithdrawal.mockRejectedValueOnce(Object.assign(new Error('incomplete'), {
      counts: { sessions: 2, sessionTargets: 1, serveEvents: 0, redisKeys: 0 },
      failedSteps: ['serveBands:MongoServerError', 'redisKeys:ReplyError'],
    }));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    const result = await consent.withdrawConsent(USER, PURPOSE);

    expect(result.erasureFailures).toEqual(['session-health']);
    const line = withdrawalLine(info);
    expect(line).toContain('providerErasureFailures=0');
    // N6 (round 1): the failed steps reach the line, as closed step:Type tokens.
    expect(line).toMatch(/ sessionHealth=failed sessions=2 sessionTargets=1 serveEvents=0 redisKeys=0 sessionHealthFailed=serveBands:MongoServerError,redisKeys:ReplyError stateJobs=0$/);
    info.mockRestore();
  });

  it('a failure that names no step is still reported, closed: unknown and the error type', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION });
    User.findById.mockResolvedValue({ _id: USER, save: jest.fn() });
    eraseSessionHealthOnWithdrawal.mockRejectedValueOnce(Object.assign(new TypeError('boom at 10.0.0.1'), {}));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    await consent.withdrawConsent(USER, PURPOSE);

    const line = withdrawalLine(info);
    expect(line).toMatch(/ sessionHealth=failed sessions=0 sessionTargets=0 serveEvents=0 redisKeys=0 sessionHealthFailed=unknown:TypeError stateJobs=0$/);
    expect(line).not.toContain('10.0.0.1');
    info.mockRestore();
  });

  it('the line reports what the module returned', async () => {
    ConsentRecord.latestFor.mockResolvedValue(null);
    eraseSessionHealthOnWithdrawal.mockResolvedValueOnce({ status: 'skipped', counts: { sessions: 0, sessionTargets: 0, serveEvents: 0, redisKeys: 0 } });
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    await consent.withdrawConsent(USER, PURPOSE);

    expect(withdrawalLine(info)).toMatch(/ learning=skipped rewardEvents=0 personalWeights=0 sessionHealth=skipped sessions=0 sessionTargets=0 serveEvents=0 redisKeys=0 sessionHealthFailed=none stateJobs=skipped$/);
    info.mockRestore();
  });
});

// J1 (BE-074). The learning jobs waiting in the job queue go with the learned preferences, under the
// same gate (a grant on file) and BEFORE them, so a waiting job cannot write them back. Wiring only;
// the jobs are proven gone on real Redis in tests/consentWithdrawalJobs.redis.test.js.
describe('withdrawConsent — learning jobs in the job queue (J1)', () => {
  const grantOnFile = () =>
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION });
  const withdrawalLine = (info) => info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[consent-withdrawal]'));
  let info;
  beforeEach(() => { info = jest.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => info.mockRestore());

  it('runs once for the user, after the withdrawal row and BEFORE the learned preferences are purged', async () => {
    grantOnFile();
    User.findById.mockResolvedValue({ _id: USER, save: jest.fn() });

    await consent.withdrawConsent(USER, PURPOSE);

    expect(purgeUserJobs).toHaveBeenCalledTimes(1);
    expect(purgeUserJobs).toHaveBeenCalledWith(USER);
    expect(ConsentRecord.create.mock.invocationCallOrder[0]).toBeLessThan(purgeUserJobs.mock.invocationCallOrder[0]);
    expect(purgeUserJobs.mock.invocationCallOrder[0]).toBeLessThan(purgeLearnedPersonalization.mock.invocationCallOrder[0]);
  });

  it('the line carries learningJobs= with the count, right after providerErasureFailures=', async () => {
    grantOnFile();
    User.findById.mockResolvedValue(null);
    purgeUserJobs.mockResolvedValueOnce({ removed: 3, inFlight: 1, byQueue: { 'reward-ingest': { removed: 3, inFlight: 1 }, 'state-vector-recompute': { removed: 0, inFlight: 0 } } });

    await consent.withdrawConsent(USER, PURPOSE);

    expect(withdrawalLine(info)).toContain(' providerErasureFailures=0 learningJobs=3 learning=purged ');
  });

  it('a user with no grant on file keeps their jobs: not called, and the line says skipped', async () => {
    ConsentRecord.latestFor.mockResolvedValue(null);

    const result = await consent.withdrawConsent(USER, PURPOSE);

    expect(purgeUserJobs).not.toHaveBeenCalled();
    expect(result.erasureFailures).toEqual([]);
    expect(withdrawalLine(info)).toContain(' providerErasureFailures=0 learningJobs=skipped learning=skipped ');
  });

  it('a failure is its own entry, learning-jobs, and the learned preferences are still purged', async () => {
    grantOnFile();
    User.findById.mockResolvedValue({ _id: USER, save: jest.fn() });
    purgeUserJobs.mockRejectedValueOnce(new Error(`connect ECONNREFUSED 10.0.0.7:6379 (${USER})`));

    const result = await consent.withdrawConsent(USER, PURPOSE);

    expect(result.erasureFailures).toEqual(['learning-jobs']);
    expect(purgeLearnedPersonalization).toHaveBeenCalledWith(USER);
    const line = withdrawalLine(info);
    expect(line).toContain(' providerErasureFailures=0 learningJobs=failed learning=purged ');
    expect(line).not.toContain('10.0.0.7');
  });

  it('both learning steps failing are reported as two entries, jobs first', async () => {
    grantOnFile();
    User.findById.mockResolvedValue(null);
    purgeUserJobs.mockRejectedValueOnce(new Error('down'));
    purgeLearnedPersonalization.mockRejectedValueOnce(new Error('mongo timeout'));

    const result = await consent.withdrawConsent(USER, PURPOSE);

    expect(result.erasureFailures).toEqual(['learning-jobs', 'learning']);
    expect(withdrawalLine(info)).toContain(' learningJobs=failed learning=failed ');
  });
});

// J2 (T4): the purge also removes the state-recompute jobs, and its result names each queue's count.
// `learningJobs=` must still count only the learning jobs, never a state job.
describe('withdrawConsent — learningJobs counts learning jobs only (J2)', () => {
  let info;
  beforeEach(() => { info = jest.spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => info.mockRestore());

  it('the purge removed 3 learning jobs and 2 state jobs: learningJobs=3', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: consent.CURRENT_CONSENT_VERSION });
    User.findById.mockResolvedValue(null);
    purgeUserJobs.mockResolvedValueOnce({
      removed: 5, inFlight: 0, byQueue: { 'reward-ingest': { removed: 3, inFlight: 0 }, 'state-vector-recompute': { removed: 2, inFlight: 0 } },
    });

    await consent.withdrawConsent(USER, PURPOSE);

    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[consent-withdrawal]'));
    expect(line).toContain(' providerErasureFailures=0 learningJobs=3 learning=purged ');
  });
});
