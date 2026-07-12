'use strict';

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-tests-only';

// Route-level test for POST /api/discovery/playback-failed. app/index.js auto-starts
// (connects DB/Redis) and does not export the app, so we mount the REAL discovery router
// — with its real auth + per-user rate-limiter — on a minimal express app and drive it
// with supertest. The catalog repo is mocked: this asserts the HTTP contract + auth
// gating; the native-key guard is unit-tested in trackCatalogRepo.test.js.

jest.mock('../app/repositories/trackCatalogRepo', () => ({
  invalidateResolvedUri: jest.fn().mockResolvedValue({ invalidated: true }),
}));
// auth middleware loads the caller from the DB; supply a live, non-deleted user.
jest.mock('../app/models/User', () => ({
  // echo the token's userId so the per-user rate-limiter keys distinctly per caller
  findById: jest.fn((id) => ({ select: () => Promise.resolve({ _id: id }) })),
}));

const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { signToken } = require('../app/utils/jwt');
const trackCatalogRepo = require('../app/repositories/trackCatalogRepo');
const discoveryRouter = require('../app/routes/discovery');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/discovery', discoveryRouter);
  return app;
}

const app = makeApp();
const token = signToken({ userId: 'u1' });

beforeEach(() => {
  jest.clearAllMocks();
  trackCatalogRepo.invalidateResolvedUri.mockResolvedValue({ invalidated: true });
});

describe('POST /api/discovery/playback-failed', () => {
  it('authed valid recordingKey → 204 and invalidates the cached uri', async () => {
    const res = await request(app)
      .post('/api/discovery/playback-failed')
      .set('Authorization', `Bearer ${token}`)
      .send({ recordingKey: 'youtube:abc' });
    expect(res.status).toBe(204);
    expect(trackCatalogRepo.invalidateResolvedUri).toHaveBeenCalledWith('youtube:abc');
  });

  it('authed missing/empty recordingKey → 400 and never writes', async () => {
    const res = await request(app)
      .post('/api/discovery/playback-failed')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(trackCatalogRepo.invalidateResolvedUri).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401 and never writes', async () => {
    const res = await request(app)
      .post('/api/discovery/playback-failed')
      .send({ recordingKey: 'youtube:abc' });
    expect(res.status).toBe(401);
    expect(trackCatalogRepo.invalidateResolvedUri).not.toHaveBeenCalled();
  });

  it('authed spotify:-keyed recordingKey → 204 (controller forwards; repo guards)', async () => {
    trackCatalogRepo.invalidateResolvedUri.mockResolvedValue({ invalidated: false });
    const res = await request(app)
      .post('/api/discovery/playback-failed')
      .set('Authorization', `Bearer ${token}`)
      .send({ recordingKey: 'spotify:track:xyz' });
    expect(res.status).toBe(204);
    expect(trackCatalogRepo.invalidateResolvedUri).toHaveBeenCalledWith('spotify:track:xyz');
  });

  it('rate-limits per user: the 11th report in a 1-min window returns 429', async () => {
    const floodToken = signToken({ userId: 'flood-user' });
    let res;
    for (let i = 0; i < 11; i++) {
      res = await request(app).post('/api/discovery/playback-failed')
        .set('Authorization', `Bearer ${floodToken}`).send({ recordingKey: 'youtube:x' });
    }
    expect(res.status).toBe(429); // max=10/min — the 11th is throttled
  });

  it('keys the limiter per user — one user at the cap does not throttle another', async () => {
    const heavy = signToken({ userId: 'heavy-user' });
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/discovery/playback-failed')
        .set('Authorization', `Bearer ${heavy}`).send({ recordingKey: 'youtube:x' });
    }
    // heavy-user is now at the cap; a DIFFERENT authed user is unaffected (per-user keying,
    // NOT per-IP — this is the constraint that would silently regress if auth ran after the limiter)
    const other = signToken({ userId: 'other-user' });
    const res = await request(app).post('/api/discovery/playback-failed')
      .set('Authorization', `Bearer ${other}`).send({ recordingKey: 'youtube:y' });
    expect(res.status).toBe(204);
  });
});
