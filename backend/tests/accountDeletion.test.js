'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV       = 'test';

// ── Mock every collection the cascade touches + the auth side-effects ────────────
jest.mock('../app/models/User',            () => ({ deleteOne:  jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/BiometricLog',    () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 42 }) }));
jest.mock('../app/models/VitalSample',     () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 11 }) }));
jest.mock('../app/models/MedicalProfile',  () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/MorningState',    () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 5 }) }));
// W4-011, ADR-0012 Track A. The module exports TWO models; only the user-scoped one is erased.
jest.mock('../app/models/RewardEvent',     () => ({ RewardEvent: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 6 }) } }));
jest.mock('../app/models/PersonalWeights', () => ({ PersonalWeights: { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) } }));
jest.mock('../app/models/MusicProfile',    () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/PlaylistSession', () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 7 }) }));
jest.mock('../app/models/ServeEvent',      () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 9 }) }));
jest.mock('../app/models/Identity',        () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/RefreshToken',    () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }) }));
jest.mock('../app/models/UnclassifiedTrack', () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 4 }) }));
jest.mock('../app/models/ConsentRecord',   () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }) }));
jest.mock('../app/utils/userRedisPurge',   () => ({ purgeUserKeys: jest.fn().mockResolvedValue(3) }));
// J1 (BE-074): the account's learning jobs in the job queue. Mocked like the Redis purge above; the
// jobs are proven gone on real Redis and real Mongo in accountDeletionJobs.redis.test.js.
jest.mock('../app/queues/userJobPurge',    () => ({ purgeUserJobs: jest.fn().mockResolvedValue({ removed: 2, inFlight: 0 }) }));
const mockDisconnectSockets = jest.fn();
jest.mock('../app/sockets/index', () => ({
  getIo: jest.fn(() => ({ in: jest.fn(() => ({ disconnectSockets: mockDisconnectSockets })) })),
}));
jest.mock('../app/utils/tokenDenylist',    () => ({ revoke: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../app/utils/jwt', () => ({
  signToken: jest.fn(), // the cookie setter and clearer are both gone (BE-009)
}));
// authController constructs an OAuth2Client at module load — stub it out.
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('apple-signin-auth',   () => ({ verifyIdToken: jest.fn() }));

const User            = require('../app/models/User');
const BiometricLog    = require('../app/models/BiometricLog');
const MedicalProfile  = require('../app/models/MedicalProfile');
const MorningState    = require('../app/models/MorningState');
const { RewardEvent } = require('../app/models/RewardEvent');
const { PersonalWeights } = require('../app/models/PersonalWeights');
const MusicProfile    = require('../app/models/MusicProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent      = require('../app/models/ServeEvent');
const Identity        = require('../app/models/Identity');
const RefreshToken    = require('../app/models/RefreshToken');
const UnclassifiedTrack = require('../app/models/UnclassifiedTrack');
const VitalSample     = require('../app/models/VitalSample');
const ConsentRecord   = require('../app/models/ConsentRecord');
const { purgeUserKeys } = require('../app/utils/userRedisPurge');
const { purgeUserJobs } = require('../app/queues/userJobPurge');
const { revoke }      = require('../app/utils/tokenDenylist');
const { deleteAccount }   = require('../app/controllers/authController');

function buildRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe('deleteAccount (GDPR hard-delete)', () => {
  const userId = 'user-123';
  beforeEach(() => jest.clearAllMocks());

  it('hard-deletes the user and every associated collection by userId', async () => {
    const req = { user: { _id: userId }, auth: { jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 3600 } };
    const res = buildRes();

    await deleteAccount(req, res, jest.fn());

    expect(BiometricLog.deleteMany).toHaveBeenCalledWith({ userId });
    expect(MedicalProfile.deleteMany).toHaveBeenCalledWith({ userId });
    expect(MorningState.deleteMany).toHaveBeenCalledWith({ userId });
    expect(RewardEvent.deleteMany).toHaveBeenCalledWith({ userId });
    expect(PersonalWeights.deleteMany).toHaveBeenCalledWith({ userId }); // W4-013 B7, S5
    expect(MusicProfile.deleteMany).toHaveBeenCalledWith({ userId });
    expect(PlaylistSession.deleteMany).toHaveBeenCalledWith({ userId });
    expect(ServeEvent.deleteMany).toHaveBeenCalledWith({ userId });
    expect(Identity.deleteMany).toHaveBeenCalledWith({ userId });
    expect(RefreshToken.deleteMany).toHaveBeenCalledWith({ userId });
    expect(UnclassifiedTrack.deleteMany).toHaveBeenCalledWith({ userId });
    expect(User.deleteOne).toHaveBeenCalledWith({ _id: userId });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/permanently deleted/i),
    }));
  });

  it('purges user-scoped Redis keys (ledger windows, pool partitions, baseline blob)', async () => {
    await deleteAccount({ user: { _id: userId }, auth: {} }, buildRes(), jest.fn());
    expect(purgeUserKeys).toHaveBeenCalledWith(userId);
  });

  it('force-disconnects the user\'s live sockets so no zombie session outlives the account', async () => {
    await deleteAccount({ user: { _id: userId }, auth: {} }, buildRes(), jest.fn());
    expect(mockDisconnectSockets).toHaveBeenCalledWith(true);
  });

  it('deletes child collections before the User doc (retry-safe ordering)', async () => {
    const order = [];
    BiometricLog.deleteMany.mockImplementation(async () => { order.push('child'); return {}; });
    MedicalProfile.deleteMany.mockImplementation(async () => { order.push('child'); return {}; });
    MusicProfile.deleteMany.mockImplementation(async () => { order.push('child'); return {}; });
    PlaylistSession.deleteMany.mockImplementation(async () => { order.push('child'); return {}; });
    ServeEvent.deleteMany.mockImplementation(async () => { order.push('child'); return {}; });
    Identity.deleteMany.mockImplementation(async () => { order.push('child'); return {}; });
    RefreshToken.deleteMany.mockImplementation(async () => { order.push('child'); return {}; });
    User.deleteOne.mockImplementation(async () => { order.push('user'); return {}; });

    await deleteAccount({ user: { _id: userId }, auth: {} }, buildRes(), jest.fn());

    expect(order[order.length - 1]).toBe('user');
    expect(order.filter((s) => s === 'child')).toHaveLength(7);
  });

  it('revokes the presented JWT', async () => {
    const req = { user: { _id: userId }, auth: { jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 3600 } };
    const res = buildRes();

    await deleteAccount(req, res, jest.fn());

    expect(revoke).toHaveBeenCalledWith('jti-1', expect.any(Number));
  });

  // J1 (BE-074). FIRST: a waiting learning job that ran after the Mongo delete would write the
  // account's learned preferences back.
  it('removes the account\'s learning jobs from the job queue before any collection is touched', async () => {
    await deleteAccount({ user: { _id: userId }, auth: {} }, buildRes(), jest.fn());

    expect(purgeUserJobs).toHaveBeenCalledTimes(1);
    expect(purgeUserJobs).toHaveBeenCalledWith(userId);
    const deletes = [BiometricLog, VitalSample, MedicalProfile, MorningState, RewardEvent, PersonalWeights, MusicProfile,
      PlaylistSession, ServeEvent, Identity, RefreshToken, UnclassifiedTrack, ConsentRecord]
      .map((model) => model.deleteMany.mock.invocationCallOrder[0]);
    expect(deletes.every(Number.isInteger)).toBe(true);
    expect(purgeUserJobs.mock.invocationCallOrder[0]).toBeLessThan(Math.min(...deletes));
  });

  describe('when the learning-jobs purge fails (J1, best-effort and reported)', () => {
    let logged;
    beforeEach(() => {
      logged = [];
      for (const level of ['log', 'info', 'warn', 'error']) {
        jest.spyOn(console, level).mockImplementation((...args) => { logged.push(args.map(String).join(' ')); });
      }
    });
    afterEach(() => jest.restoreAllMocks());

    it.each([
      ['an unreachable Redis', Object.assign(new Error(`connect ECONNREFUSED 10.0.0.7:6379 (${userId})`), { name: 'Error' }), 'Error'],
      ['the spent budget', Object.assign(new Error('the job queue did not answer within 2500 ms'), { name: 'JobPurgeTimeoutError' }), 'JobPurgeTimeoutError'],
    ])('%s: the account is still deleted, and one fixed line with no id is logged', async (_why, failure, type) => {
      purgeUserJobs.mockRejectedValueOnce(failure);
      const res = buildRes();
      const next = jest.fn();

      await deleteAccount({ user: { _id: userId }, auth: {} }, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(RewardEvent.deleteMany).toHaveBeenCalledWith({ userId });
      expect(User.deleteOne).toHaveBeenCalledWith({ _id: userId });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/permanently deleted/i) }));
      expect(logged.filter((l) => l.startsWith('[account-deletion]'))).toEqual([`[account-deletion] learning-jobs purge failed (${type})`]);
      expect(logged.join('\n')).not.toContain(userId);
      expect(logged.join('\n')).not.toContain('10.0.0.7');
    });
  });

  it('forwards errors to next() and does NOT delete the User when a child delete fails', async () => {
    BiometricLog.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const next = jest.fn();

    await deleteAccount({ user: { _id: userId }, auth: {} }, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(User.deleteOne).not.toHaveBeenCalled();
  });
});
