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
  findById: jest.fn(() => ({ select: () => Promise.resolve({ _id: 'u1' }) })),
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
});
