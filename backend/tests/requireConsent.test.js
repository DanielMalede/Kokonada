'use strict';

// Server-side hard gate (audit H-9, decision 2): special-category health/biometric ingestion may
// proceed ONLY with a current-version Art.9 consent on file. This drives the real middleware in
// front of a spy "ingest" handler — the spy stands in for the downstream WRITE, so asserting it
// never runs on a 403 proves no ingestion happened.
process.env.NODE_ENV = 'test';

jest.mock('../app/services/privacy/consent', () => ({
  getConsentStatus: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { getConsentStatus } = require('../app/services/privacy/consent');
const requireConsent = require('../app/middleware/requireConsent');

const PURPOSE = 'health_biometric_processing';

// A stand-in for a real ingest handler (healthBatchIngest / appleHealthPush): the WRITE path.
const ingest = jest.fn((req, res) => res.status(200).json({ ingested: true }));

function makeApp() {
  const app = express();
  app.use(express.json());
  // Simulate the auth middleware having populated req.user (these routes sit behind auth).
  app.use((req, _res, next) => { req.user = { _id: 'u1' }; next(); });
  app.post('/ingest', requireConsent(PURPOSE), ingest);
  return app;
}

const app = makeApp();

beforeEach(() => {
  jest.clearAllMocks();
  ingest.mockImplementation((req, res) => res.status(200).json({ ingested: true }));
});

describe('requireConsent middleware', () => {
  it('no consent on file → 403 consent_required and the write handler never runs', async () => {
    getConsentStatus.mockResolvedValue({ granted: false, currentVersion: 1, staleVersion: false });
    const res = await request(app).post('/ingest').send({ samples: [] });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'consent_required' });
    expect(ingest).not.toHaveBeenCalled(); // NO write happened
  });

  it('granted but stale version → 403 consent_stale (distinct reason) and no write', async () => {
    getConsentStatus.mockResolvedValue({ granted: true, currentVersion: 2, staleVersion: true });
    const res = await request(app).post('/ingest').send({ samples: [] });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'consent_stale' });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('current-version grant → passes through to the write handler', async () => {
    getConsentStatus.mockResolvedValue({ granted: true, currentVersion: 1, staleVersion: false });
    const res = await request(app).post('/ingest').send({ samples: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ingested: true });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(getConsentStatus).toHaveBeenCalledWith('u1', PURPOSE);
  });
});
