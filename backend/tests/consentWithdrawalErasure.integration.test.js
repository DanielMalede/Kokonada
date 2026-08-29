'use strict';

// REAL-Mongo integration test (mongodb-memory-server) for BE-015 / ADR-0015: withdrawing Art.9
// health consent must ACTUALLY erase the learned personalization, because the consent notice
// promises it on the pinned first layer ("It also erases what the app has learned about your
// taste — that doesn't come back"). Before this task the code did not: `RewardEvent` and
// `PersonalWeights` were documented exclusions from the wearable purge and went only on account
// deletion, so the notice made an affirmative false statement about the effect of exercising
// the Art.7(3) right to withdraw.
//
// Written against REAL collections rather than mocks on purpose. `consent.test.js` mocks the
// erasure modules wholesale, so it can only prove the CALL was made; this proves the ROWS are
// gone under real query semantics — and that a second user's learning is untouched.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';
// Left unset on purpose: the local erasure must complete with NO outbound Garmin call.
// (best-effort deregistration is flag-gated OFF until API approval).

jest.mock('../app/config/redis', () => ({ getRedis: () => null })); // no real Redis

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const User = require('../app/models/User');
const BiometricLog = require('../app/models/BiometricLog');
const ConsentRecord = require('../app/models/ConsentRecord');
const { RewardEvent } = require('../app/models/RewardEvent');
const { PersonalWeights } = require('../app/models/PersonalWeights');
const {
  withdrawConsent, recordConsent, HEALTH_CONSENT_PURPOSE, CURRENT_CONSENT_VERSION,
} = require('../app/services/privacy/consent');

jest.setTimeout(120000);

const PURPOSE = HEALTH_CONSENT_PURPOSE;

let mem;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_consent_withdrawal_it' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem.stop();
});
beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}), BiometricLog.deleteMany({}), ConsentRecord.deleteMany({}),
    RewardEvent.deleteMany({}), PersonalWeights.deleteMany({}),
  ]);
});

let infoSpy;
beforeEach(() => { infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { infoSpy.mockRestore(); });

// The one accountability line for this withdrawal (Art.5(2): the controller must be able to
// DEMONSTRATE the erasure ran). Selected by tag rather than by call index so an unrelated
// console.info elsewhere in the cascade cannot make this brittle.
const withdrawalLogLines = () =>
  infoSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[consent-withdrawal]'));

// A listener with a wearable footprint AND a learned taste profile.
async function seedLearner(email, { hourBin = 1 } = {}) {
  const user = await User.create({
    ssoProvider: 'google', ssoId: `sso-${email}`, email,
    wearableProvider: 'garmin', garminUserId: `garmin-${email}`,
  });
  await BiometricLog.create({
    userId: user._id, heartRate: 61, source: 'garmin', activity: 'resting', recordedAt: new Date(),
  });
  await RewardEvent.create({
    userId: user._id,
    bucket: { stateDomain: 'rest', targetBand: 'resting', hourBin },
    rewardSum: 2.5, count: 4, updatedAt: new Date(),
  });
  await PersonalWeights.create({
    userId: user._id, deltas: { taste: 0.2, feature: -0.1, genre: 0, rotation: 0.05 },
    updates: 12, updatedAt: new Date(),
  });
  return user;
}

const learnedCounts = async (userId) => ({
  rewardEvents: await RewardEvent.countDocuments({ userId }),
  personalWeights: await PersonalWeights.countDocuments({ userId }),
});

describe('withdrawConsent — erases the learned personalization (real Mongo)', () => {
  it("deletes the withdrawing user's RewardEvent + PersonalWeights, and NOBODY else's", async () => {
    const userA = await seedLearner('a@x.c', { hourBin: 1 });
    const userB = await seedLearner('b@x.c', { hourBin: 2 });
    await recordConsent(userA._id, { purpose: PURPOSE, dataCategories: ['heart_rate'] });
    await recordConsent(userB._id, { purpose: PURPOSE, dataCategories: ['heart_rate'] });

    await withdrawConsent(userA._id, PURPOSE);

    // The promise on the pinned layer: what the app learned about A's taste is gone.
    expect(await learnedCounts(userA._id)).toEqual({ rewardEvents: 0, personalWeights: 0 });
    // ...and B, who withdrew nothing, keeps every row.
    expect(await learnedCounts(userB._id)).toEqual({ rewardEvents: 1, personalWeights: 1 });
    // The pre-existing wearable erasure still runs, and stays just as scoped.
    expect(await BiometricLog.countDocuments({ userId: userA._id })).toBe(0);
    expect(await BiometricLog.countDocuments({ userId: userB._id })).toBe(1);
  });

  // Art.5(2). consentController discards withdrawConsent's return value, so WITHOUT this line
  // there is no surface anywhere on which an operator could see that the erasure ran, what it
  // removed, or that part of it failed. Counts only — never a value, never a bucket coordinate.
  it('emits ONE structured, count-only accountability line carrying the real counts', async () => {
    const user = await seedLearner('c@x.c');
    await recordConsent(user._id, { purpose: PURPOSE, dataCategories: ['heart_rate'] });

    await withdrawConsent(user._id, PURPOSE);

    const lines = withdrawalLogLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`user=${user._id}`);
    expect(lines[0]).toContain(`purpose=${PURPOSE}`);
    expect(lines[0]).toContain('learning=purged');
    expect(lines[0]).toContain('rewardEvents=1');
    expect(lines[0]).toContain('personalWeights=1');
    expect(lines[0]).toContain('providerErasureFailures=0');
  });

  // THE GUARD. POST /api/consent/withdraw is directly callable by any authenticated client and
  // the UI only HIDES the button — so a mood-only listener who never granted health consent can
  // reach this path. Destroying their taste model would be an erasure they never asked for, of
  // data no consent ever covered. No grant on file → the purge does not run.
  it('does NOT touch the learned rows when there is no grant on file (mood-only listener)', async () => {
    const user = await seedLearner('d@x.c');
    expect(await ConsentRecord.countDocuments({ userId: user._id })).toBe(0);

    await withdrawConsent(user._id, PURPOSE);

    expect(await learnedCounts(user._id)).toEqual({ rewardEvents: 1, personalWeights: 1 });
    expect(withdrawalLogLines()[0]).toContain('learning=skipped');
    // The withdrawal itself is still recorded — the erasure decision does not gate the right.
    const latest = await ConsentRecord.latestFor(user._id, PURPOSE);
    expect(latest.status).toBe('withdrawn');
    expect(latest.consentVersion).toBe(CURRENT_CONSENT_VERSION);
  });
});
