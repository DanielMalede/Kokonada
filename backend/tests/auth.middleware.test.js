'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET      = 'test-jwt-secret-for-tests-only';
process.env.JWT_EXPIRES_IN  = '1h';
process.env.NODE_ENV        = 'test';

const { signToken, COOKIE_NAME } = require('../app/utils/jwt');

// ── Mock mongoose User.findById ───────────────────────────────────────────────
const mockSelect = jest.fn();
const mockFindById = jest.fn(() => ({ select: mockSelect }));

jest.mock('../app/models/User', () => ({
  findById: (...args) => mockFindById(...args),
}));

const authMiddleware = require('../app/middleware/auth');

function buildRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockReturnThis(),
  };
  return res;
}

describe('auth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('no token provided', () => {
    it('returns 401 when no cookie and no Authorization header', async () => {
      const req  = { cookies: {}, headers: {} };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header is not Bearer scheme', async () => {
      const req  = { cookies: {}, headers: { authorization: 'Basic dXNlcjpwYXNz' } };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('invalid / tampered token', () => {
    it('returns 401 for a malformed token string', async () => {
      const req  = { cookies: {}, headers: { authorization: 'Bearer not.a.valid.jwt' } };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for a token signed with the wrong secret', async () => {
      const jwt = require('jsonwebtoken');
      const badToken = jwt.sign({ userId: 'u1' }, 'wrong-secret');

      const req  = { cookies: {}, headers: { authorization: `Bearer ${badToken}` } };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for an expired token', async () => {
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { userId: 'u1' },
        process.env.JWT_SECRET,
        { expiresIn: -1 } // already expired
      );

      const req  = { cookies: {}, headers: { authorization: `Bearer ${expiredToken}` } };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('valid token — user lookup', () => {
    const fakeUser = { _id: 'user-123', email: 'test@example.com', deletedAt: null };

    it('attaches user to req and calls next when cookie token is valid', async () => {
      const token = signToken({ userId: fakeUser._id });
      mockSelect.mockResolvedValue(fakeUser);

      const req  = { cookies: { [COOKIE_NAME]: token }, headers: {} };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(mockFindById).toHaveBeenCalledWith(fakeUser._id);
      expect(mockSelect).toHaveBeenCalledWith('-spotifyToken -youtubeMusicToken -wearableToken');
      expect(req.user).toBe(fakeUser);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('attaches user to req and calls next when Bearer header token is valid', async () => {
      const token = signToken({ userId: fakeUser._id });
      mockSelect.mockResolvedValue(fakeUser);

      const req  = { cookies: {}, headers: { authorization: `Bearer ${token}` } };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(req.user).toBe(fakeUser);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('prefers cookie over Bearer header when both present', async () => {
      const cookieToken  = signToken({ userId: 'cookie-user' });
      const bearerToken  = signToken({ userId: 'bearer-user' });
      const cookieUser   = { _id: 'cookie-user', deletedAt: null };
      mockSelect.mockResolvedValue(cookieUser);

      const req = {
        cookies: { [COOKIE_NAME]: cookieToken },
        headers: { authorization: `Bearer ${bearerToken}` },
      };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(mockFindById).toHaveBeenCalledWith('cookie-user');
      expect(req.user).toBe(cookieUser);
    });

    it('returns 401 when user is not found in DB', async () => {
      const token = signToken({ userId: 'ghost-user' });
      mockSelect.mockResolvedValue(null);

      const req  = { cookies: { [COOKIE_NAME]: token }, headers: {} };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'User not found or deactivated' });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 for a soft-deleted user (deletedAt set)', async () => {
      const token       = signToken({ userId: 'deleted-user' });
      const deletedUser = { _id: 'deleted-user', deletedAt: new Date() };
      mockSelect.mockResolvedValue(deletedUser);

      const req  = { cookies: { [COOKIE_NAME]: token }, headers: {} };
      const res  = buildRes();
      const next = jest.fn();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('excludes encrypted token blobs from the DB projection', async () => {
      const token = signToken({ userId: fakeUser._id });
      mockSelect.mockResolvedValue(fakeUser);

      const req  = { cookies: { [COOKIE_NAME]: token }, headers: {} };
      await authMiddleware(req, buildRes(), jest.fn());

      // Verify -spotifyToken etc. are excluded
      const selectArg = mockSelect.mock.calls[0][0];
      expect(selectArg).toContain('-spotifyToken');
      expect(selectArg).toContain('-youtubeMusicToken');
      expect(selectArg).toContain('-wearableToken');
    });
  });
});
