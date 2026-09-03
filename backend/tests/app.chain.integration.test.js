'use strict';

process.env.NODE_ENV       = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';

// OPS-013 / BE-009 — requests driven through the REAL assembled app and the REAL middleware
// chain: helmet → cors → cookieParser → body parsers → apiLimiter → csrfOriginGuard → routers.
//
// Everything else in this suite tests middleware in isolation on hand-built object literals
// (tests/csrf.test.js calls csrfOriginGuard(req, res, next) directly), which proves a
// function's branches and nothing about whether it is mounted, where, or ahead of what.
// These cases only mean something end-to-end, and they are the only proof that the cookie
// retirement actually took: a unit test of auth.js can be green while the deployed chain
// still authenticates a cookie for some reason no unit test models.

const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

jest.mock('../app/config/db', () => jest.fn().mockResolvedValue(undefined));
jest.mock('../app/config/redis', () => ({
  connectRedis: jest.fn().mockResolvedValue(undefined),
  getRedis: jest.fn(() => null),
  createConnection: jest.fn(),
}));
jest.mock('../app/workers', () => ({ startInProcessWorkers: jest.fn(() => []) }));
jest.mock('../app/config/sentry', () => ({
  initSentry: jest.fn(),
  captureException: jest.fn(),
  sentryErrorHandler: (err, req, res, next) => next(err),
}));
jest.mock('../app/utils/tokenDenylist', () => ({
  isRevoked: jest.fn().mockResolvedValue(false),
  revoke: jest.fn().mockResolvedValue(true),
}));

// A real, non-deleted user for any request that gets far enough to look one up.
const USER = { _id: 'user-1', deletedAt: null, email: 'u@example.com', pushTokens: [] };
jest.mock('../app/models/User', () => ({
  findById: jest.fn(() => ({ select: jest.fn().mockResolvedValue(USER) })),
  findOne:  jest.fn().mockResolvedValue(null),
}));

const { app } = require('../app/index');
const { COOKIE_NAME } = require('../app/utils/jwt');

const sign = (userId = 'user-1') =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h', jwtid: crypto.randomUUID() });

describe('BE-009 — the cookie is not a credential, proven through the real chain', () => {
  it('REJECTS a cookie-only request to a state-changing route', async () => {
    const res = await request(app)
      .delete('/api/integrations/watch/token')
      .set('Cookie', `${COOKIE_NAME}=${sign()}`);
    expect(res.status).toBe(401);
  });

  // The most dangerous route in the app, and the one the auditor walked hop by hop.
  it('REJECTS a cookie-only account deletion', async () => {
    const res = await request(app)
      .delete('/api/auth/account')
      .set('Cookie', `${COOKIE_NAME}=${sign()}`);
    expect(res.status).toBe(401);
  });

  it('ACCEPTS the same route with a Bearer header — the real client still works', async () => {
    const res = await request(app)
      .get('/api/integrations/watch/status')
      .set('Authorization', `Bearer ${sign()}`);
    expect(res.status).toBe(200);
  });

  // If a cookie AND a bearer arrive together, the explicit one must win. Unit-pinned in
  // auth.middleware.test.js; asserted here through the mounted chain because that is where
  // cookieParser actually populates req.cookies.
  it('uses the Bearer header even when a cookie is also present', async () => {
    const res = await request(app)
      .get('/api/integrations/watch/status')
      .set('Cookie', `${COOKIE_NAME}=${sign('cookie-user')}`)
      .set('Authorization', `Bearer ${sign('user-1')}`);
    expect(res.status).toBe(200);
  });
});

// The CSRF Origin guard was DELETED with the web surface, so "is it mounted" is no longer a
// question worth asking. What replaced it as the thing to pin is stronger and simpler: an
// `Origin` header now has NO effect on anything, because there is no ambient credential for a
// cross-site page to ride and no CORS middleware to negotiate with. These cases are kept — with
// their expectations changed from 403 to "the Origin is irrelevant" — because deleting them
// outright would leave nothing asserting that a foreign origin cannot influence this API.
describe('a browser Origin has no effect on this API — there is nothing for it to exploit', () => {
  // Asserts the INVARIANT (Origin changes nothing) rather than a specific status: this route's
  // handler calls `user.save()`, which the lightweight User mock here does not provide, so it
  // 500s in this harness. Pinning 200 would have been pinning the mock, not the behaviour —
  // and a status that is identical with and without the header is the actual claim.
  it('a state-changing request behaves IDENTICALLY with and without a foreign Origin', async () => {
    const withOrigin = await request(app)
      .delete('/api/integrations/watch/token')
      .set('Authorization', `Bearer ${sign()}`)
      .set('Origin', 'https://evil.example');
    const without = await request(app)
      .delete('/api/integrations/watch/token')
      .set('Authorization', `Bearer ${sign()}`);
    expect(withOrigin.status).toBe(without.status);
    // and it is NOT the old 403-because-Origin
    expect(withOrigin.status).not.toBe(403);
  });

  it('the same route with NO credential is refused, Origin present or not', async () => {
    const res = await request(app)
      .delete('/api/integrations/watch/token')
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(401);
  });

  it('a SAFE method from a foreign Origin behaves identically to one without', async () => {
    const withOrigin = await request(app)
      .get('/api/integrations/watch/status')
      .set('Authorization', `Bearer ${sign()}`)
      .set('Origin', 'https://evil.example');
    const without = await request(app)
      .get('/api/integrations/watch/status')
      .set('Authorization', `Bearer ${sign()}`);
    expect(withOrigin.status).toBe(without.status);
    expect(withOrigin.status).toBe(200);
  });

  // No CORS middleware is mounted, so no Access-Control-Allow-Origin is ever emitted. That is
  // the posture `origin: false` would give, reached by having no middleware at all.
  it('emits NO Access-Control-Allow-Origin to anyone', async () => {
    const res = await request(app)
      .get('/api/integrations/watch/status')
      .set('Authorization', `Bearer ${sign()}`)
      .set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('unauthenticated surface', () => {
  it('/health answers without any credential at all', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
