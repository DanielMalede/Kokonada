'use strict';

// Route-level test for the consent API (audit H-9). app/index.js auto-starts and does not export
// the app, so we mount the REAL consent router — with its real auth + rate-limiter — on a minimal
// express app and drive it with supertest. The consent SERVICE is mocked: this asserts the HTTP
// contract + auth gating; the service semantics are unit-tested in consent.test.js.
process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

jest.mock('../app/services/privacy/consent', () => ({
  recordConsent:    jest.fn().mockResolvedValue({ ok: true, record: { _id: 'c1' } }),
  withdrawConsent:  jest.fn().mockResolvedValue({ _id: 'c2' }),
  getConsentStatus: jest.fn(),
  CURRENT_CONSENT_VERSION: 1,
}));
// auth middleware loads the caller from the DB; supply a live, non-deleted user.
jest.mock('../app/models/User', () => ({
  findById: jest.fn((id) => ({ select: () => Promise.resolve({ _id: id }) })),
}));

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { signToken } = require('../app/utils/jwt');
const consentService = require('../app/services/privacy/consent');
const consentRouter = require('../app/routes/consent');

const PURPOSE = 'health_biometric_processing';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/consent', consentRouter);
  return app;
}

const app = makeApp();
const token = signToken({ userId: 'u1' });
const bearer = (t = token) => ['Authorization', `Bearer ${t}`];

beforeEach(() => {
  jest.clearAllMocks();
  consentService.getConsentStatus.mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false });
});

describe('POST /api/consent (grant)', () => {
  it('authed → 201, records the grant, and returns the fresh status', async () => {
    const res = await request(app)
      .post('/api/consent')
      .set(...bearer())
      .send({ purpose: PURPOSE, dataCategories: ['heart_rate', 'hrv'] });
    expect(res.status).toBe(201);
    expect(consentService.recordConsent).toHaveBeenCalledWith('u1', { purpose: PURPOSE, dataCategories: ['heart_rate', 'hrv'] });
    expect(res.body).toEqual({ granted: true, currentVersion: 1, staleVersion: false });
  });

  it('missing purpose → 400 and never records', async () => {
    const res = await request(app).post('/api/consent').set(...bearer()).send({});
    expect(res.status).toBe(400);
    expect(consentService.recordConsent).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401 and never records', async () => {
    const res = await request(app).post('/api/consent').send({ purpose: PURPOSE });
    expect(res.status).toBe(401);
    expect(consentService.recordConsent).not.toHaveBeenCalled();
  });

  it('passes clientVersion through to the service when the client sends one', async () => {
    await request(app).post('/api/consent').set(...bearer()).send({ purpose: PURPOSE, clientVersion: 1 });
    expect(consentService.recordConsent).toHaveBeenCalledWith('u1', expect.objectContaining({ clientVersion: 1 }));
  });

  // resilience-audit finding: a stale/mismatched client contract version must be rejected at the
  // HTTP layer with a distinguishable status, not recorded as a false "current" grant.
  it('service rejects a stale/mismatched clientVersion → 409, no status echo (nothing was recorded)', async () => {
    consentService.recordConsent.mockResolvedValueOnce({ ok: false, reason: 'stale_client', currentVersion: 2 });
    const res = await request(app)
      .post('/api/consent')
      .set(...bearer())
      .send({ purpose: PURPOSE, clientVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'stale_client', currentVersion: 2 });
    expect(consentService.getConsentStatus).not.toHaveBeenCalled();
  });
});

describe('GET /api/consent/status', () => {
  it('authed → 200 with the status shape for the requested purpose', async () => {
    consentService.getConsentStatus.mockResolvedValue({ granted: false, currentVersion: 1, staleVersion: false });
    const res = await request(app).get('/api/consent/status').query({ purpose: PURPOSE }).set(...bearer());
    expect(res.status).toBe(200);
    expect(consentService.getConsentStatus).toHaveBeenCalledWith('u1', PURPOSE);
    expect(res.body).toEqual({ granted: false, currentVersion: 1, staleVersion: false });
  });

  it('missing purpose → 400', async () => {
    const res = await request(app).get('/api/consent/status').set(...bearer());
    expect(res.status).toBe(400);
  });

  it('unauthenticated → 401', async () => {
    const res = await request(app).get('/api/consent/status').query({ purpose: PURPOSE });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/consent/withdraw', () => {
  it('authed → 200, withdraws (which triggers the erasure cascade in the service), returns status', async () => {
    consentService.getConsentStatus.mockResolvedValue({ granted: false, currentVersion: 1, staleVersion: false });
    const res = await request(app).post('/api/consent/withdraw').set(...bearer()).send({ purpose: PURPOSE });
    expect(res.status).toBe(200);
    expect(consentService.withdrawConsent).toHaveBeenCalledWith('u1', PURPOSE);
    expect(res.body.granted).toBe(false);
  });

  it('missing purpose → 400 and never withdraws', async () => {
    const res = await request(app).post('/api/consent/withdraw').set(...bearer()).send({});
    expect(res.status).toBe(400);
    expect(consentService.withdrawConsent).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401 and never withdraws', async () => {
    const res = await request(app).post('/api/consent/withdraw').send({ purpose: PURPOSE });
    expect(res.status).toBe(401);
    expect(consentService.withdrawConsent).not.toHaveBeenCalled();
  });
});

describe('rate limiting', () => {
  it('throttles a flood of grant writes (per-user limiter)', async () => {
    const floodToken = signToken({ userId: 'consent-flood-user' });
    let res;
    for (let i = 0; i < 21; i++) {
      res = await request(app).post('/api/consent').set(...bearer(floodToken)).send({ purpose: PURPOSE });
    }
    expect(res.status).toBe(429); // exceeds the consent write cap
  });
});
