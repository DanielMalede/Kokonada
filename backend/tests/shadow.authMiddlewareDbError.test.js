'use strict';
// shadow.authMiddlewareDbError (RA-1, #320). A database failure inside the auth middleware is not an
// auth verdict: under B1 C1 a 401 on a retried request ends the mobile session. Before the fix the
// middleware's catch-all answered every throw with 401.
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';
process.env.JWT_EXPIRES_IN = '1h';
process.env.NODE_ENV = 'test';

const mockSelect = jest.fn();
jest.mock('../app/models/User', () => ({ findById: () => ({ select: mockSelect }) }));

const jwt = require('jsonwebtoken');
const { signToken, signConnectToken } = require('../app/utils/jwt');
const authMiddleware = require('../app/middleware/auth');

const buildRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const bearer = (token) => ({ cookies: {}, headers: { authorization: `Bearer ${token}` } });

describe('shadow.authMiddlewareDbError', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['a cleared pool', Object.assign(new Error('connection pool cleared'), { name: 'MongoPoolClearedError' })],
    ['a server selection timeout', Object.assign(new Error('Server selection timed out'), { name: 'MongoServerSelectionError' })],
    ['a buffering timeout', new Error('Operation `users.findOne()` buffering timed out after 10000ms')],
  ])('%s on the user lookup goes to next(err), never a 401', async (_name, err) => {
    mockSelect.mockRejectedValue(err);
    const res = buildRes();
    const next = jest.fn();
    await authMiddleware(bearer(signToken({ userId: 'u1' })), res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });

  it('a DB failure behind a valid ?ct= connect token also goes to next(err)', async () => {
    const err = Object.assign(new Error('connection pool cleared'), { name: 'MongoPoolClearedError' });
    mockSelect.mockRejectedValue(err);
    const res = buildRes();
    const next = jest.fn();
    await authMiddleware({ cookies: {}, headers: {}, query: { ct: signConnectToken('u1') }, path: '/spotify/connect' }, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });

  it('a malformed token is still 401, with no code', async () => {
    const res = buildRes();
    const next = jest.fn();
    await authMiddleware(bearer('not.a.jwt'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('an expired token is still 401', async () => {
    const res = buildRes();
    const next = jest.fn();
    await authMiddleware(bearer(jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET, { expiresIn: -1 })), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('a malformed ?ct= connect token is still 401, with no code', async () => {
    const res = buildRes();
    const next = jest.fn();
    await authMiddleware({ cookies: {}, headers: {}, query: { ct: 'not.a.jwt' }, path: '/spotify/connect' }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });
});
