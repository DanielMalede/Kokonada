'use strict';

// H3a (DT-S5 option S-A; BE-010 addendum) — POST /api/integrations/suunto/webhook wrote Suunto
// samples into BiometricLog with NO Art.9 check. It sits behind router.use(auth), so it is
// unreachable by Suunto itself, but with SUUNTO_WEBHOOK_SECRET unset outside production any
// signed-in client could post to it. Gated INLINE with the shared helper (the route file stays as
// it is; deleting the whole lane stays with BE-010).
//
// Drives the real controller in a real express app. The consent service is a stateful fake keyed
// by user id; the Suunto service is the WRITE path (it inserts BiometricLog rows), so a recorder
// stands in for it — "never called" proves no write happened.

process.env.NODE_ENV = 'test';

jest.mock('../app/sockets', () => ({ getIo: jest.fn(), createSocketServer: jest.fn() }));
jest.mock('../app/sockets/biometricHandler', () => ({
  handleBiometricReading: jest.fn(),
  registerBiometricHandler: jest.fn(),
  generateAndEmitPlaylist: jest.fn(),
}));
jest.mock('../app/models/User');

const mockGrants = new Map();
let mockStoreDown = false;
jest.mock('../app/services/privacy/consent', () => ({
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
  getConsentStatus: jest.fn(async (userId) => {
    if (mockStoreDown) throw new Error('MongoServerSelectionError');
    const row = mockGrants.get(String(userId)) || { granted: false, staleVersion: false };
    return { granted: row.granted, currentVersion: 1, staleVersion: row.staleVersion };
  }),
}));
jest.mock('../app/services/wearable/suunto', () => ({
  handleWebhook: jest.fn(async () => ({ received: true, ingested: 1 })),
}));

const express = require('express');
const request = require('supertest');
const suunto = require('../app/services/wearable/suunto');
const { suuntoWebhook } = require('../app/controllers/integrationsController');

const RAW = Buffer.from(JSON.stringify({ samples: [{ hr: 71 }] }));

const app = express();
app.post('/suunto/webhook', (req, _res, next) => {
  req.user = { _id: req.headers['x-user'] };
  req.rawBody = RAW;
  next();
}, suuntoWebhook);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(500).json({ error: 'internal' }));

const post = (user) => request(app).post('/suunto/webhook').set('x-user', user).set('x-suunto-signature', 'sig-1');

beforeEach(() => {
  jest.clearAllMocks();
  mockGrants.clear();
  mockStoreDown = false;
});

describe('POST /suunto/webhook — the Art.9 gate', () => {
  it('no grant → 403 consent_required, and handleWebhook (the BiometricLog write) is never called', async () => {
    const res = await post('mood-only');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'consent_required' });
    expect(suunto.handleWebhook).not.toHaveBeenCalled();
  });

  it('a stale grant → 403 consent_stale, nothing written', async () => {
    mockGrants.set('stale', { granted: true, staleVersion: true });
    const res = await post('stale');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'consent_stale' });
    expect(suunto.handleWebhook).not.toHaveBeenCalled();
  });

  it('a consent-store failure never reaches the write (the error goes to next)', async () => {
    mockStoreDown = true;
    const res = await post('anyone');
    expect(res.status).toBe(500);
    expect(suunto.handleWebhook).not.toHaveBeenCalled();
  });

  it('a current grant → delegates unchanged (same user, raw body and signature)', async () => {
    mockGrants.set('consented', { granted: true, staleVersion: false });
    const res = await post('consented');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, ingested: 1 });
    expect(suunto.handleWebhook).toHaveBeenCalledWith('consented', RAW, 'sig-1');
  });
});
