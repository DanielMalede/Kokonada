'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV       = 'test';

// ── Mock every collection the cascade touches + the auth side-effects ────────────
jest.mock('../app/models/User',            () => ({ deleteOne:  jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/BiometricLog',    () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 42 }) }));
jest.mock('../app/models/MedicalProfile',  () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/MusicProfile',    () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/PlaylistSession', () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 7 }) }));
jest.mock('../app/models/ServeEvent',      () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 9 }) }));
jest.mock('../app/models/Identity',        () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }) }));
jest.mock('../app/models/RefreshToken',    () => ({ deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }) }));
jest.mock('../app/utils/userRedisPurge',   () => ({ purgeUserKeys: jest.fn().mockResolvedValue(3) }));
const mockDisconnectSockets = jest.fn();
jest.mock('../app/sockets/index', () => ({
  getIo: jest.fn(() => ({ in: jest.fn(() => ({ disconnectSockets: mockDisconnectSockets })) })),
}));
jest.mock('../app/utils/tokenDenylist',    () => ({ revoke: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../app/utils/jwt', () => ({
  signToken:       jest.fn(),
  setAuthCookie:   jest.fn(),
  clearAuthCookie: jest.fn(),
}));
// authController constructs an OAuth2Client at module load — stub it out.
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn() }));
jest.mock('apple-signin-auth',   () => ({ verifyIdToken: jest.fn() }));

const User            = require('../app/models/User');
const BiometricLog    = require('../app/models/BiometricLog');
const MedicalProfile  = require('../app/models/MedicalProfile');
const MusicProfile    = require('../app/models/MusicProfile');
const PlaylistSession = require('../app/models/PlaylistSession');
const ServeEvent      = require('../app/models/ServeEvent');
const Identity        = require('../app/models/Identity');
const RefreshToken    = require('../app/models/RefreshToken');
const { purgeUserKeys } = require('../app/utils/userRedisPurge');
const { revoke }      = require('../app/utils/tokenDenylist');
const { clearAuthCookie } = require('../app/utils/jwt');
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
    expect(MusicProfile.deleteMany).toHaveBeenCalledWith({ userId });
    expect(PlaylistSession.deleteMany).toHaveBeenCalledWith({ userId });
    expect(ServeEvent.deleteMany).toHaveBeenCalledWith({ userId });
    expect(Identity.deleteMany).toHaveBeenCalledWith({ userId });
    expect(RefreshToken.deleteMany).toHaveBeenCalledWith({ userId });
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

  it('revokes the presented JWT and clears the auth cookie', async () => {
    const req = { user: { _id: userId }, auth: { jti: 'jti-1', exp: Math.floor(Date.now() / 1000) + 3600 } };
    const res = buildRes();

    await deleteAccount(req, res, jest.fn());

    expect(revoke).toHaveBeenCalledWith('jti-1', expect.any(Number));
    expect(clearAuthCookie).toHaveBeenCalledWith(res);
  });

  it('forwards errors to next() and does NOT delete the User when a child delete fails', async () => {
    BiometricLog.deleteMany.mockRejectedValueOnce(new Error('db down'));
    const next = jest.fn();

    await deleteAccount({ user: { _id: userId }, auth: {} }, buildRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(User.deleteOne).not.toHaveBeenCalled();
  });
});
