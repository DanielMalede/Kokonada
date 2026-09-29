'use strict';

// H3a — ONE definition of "a current Art.9 grant" for every server boundary that admits a
// client-supplied biometric (socket events, inline REST gates, the requireConsent middleware).
// Before this the rule `granted && !staleVersion` was copied by hand in five places; the P5
// consent-version transition window would have meant editing all five, and missing one.
//
// The consent service is a STATEFUL fake keyed by user id (its real semantics — the latest row
// wins — are proven in consent.test.js and the integration suites); requireConsent runs for real
// in front of a real express app, so the parity test compares two real gates on the same store.

process.env.NODE_ENV = 'test';

const mockGrants = new Map();
let mockStoreDown = false;
jest.mock('../app/services/privacy/consent', () => ({
  HEALTH_CONSENT_PURPOSE: 'health_biometric_processing',
  getConsentStatus: jest.fn(async (userId, purpose) => {
    if (mockStoreDown) throw new Error('MongoServerSelectionError');
    const row = mockGrants.get(String(userId)) || { granted: false, staleVersion: false };
    return { granted: row.granted, currentVersion: 1, staleVersion: row.staleVersion, purpose };
  }),
}));

const express = require('express');
const request = require('supertest');
const consent = require('../app/services/privacy/consent');
const { isCurrentGrant, denialReason, admitHealthProcessing } = require('../app/services/privacy/healthConsentGate');
const requireConsent = require('../app/middleware/requireConsent');

beforeEach(() => {
  jest.clearAllMocks();
  mockGrants.clear();
  mockStoreDown = false;
});

describe('isCurrentGrant — the one definition', () => {
  it('is true only for {granted:true, staleVersion:false}', () => {
    expect(isCurrentGrant({ granted: true, currentVersion: 1, staleVersion: false })).toBe(true);
    expect(isCurrentGrant({ granted: true, currentVersion: 2, staleVersion: true })).toBe(false);
    expect(isCurrentGrant({ granted: false, currentVersion: 1, staleVersion: false })).toBe(false);
  });

  it('fails closed on null, {}, {granted:true} and {granted:"true"}', () => {
    for (const s of [null, undefined, {}, { granted: true }, { granted: 'true', staleVersion: false }]) {
      expect(isCurrentGrant(s)).toBe(false);
    }
  });
});

describe('denialReason — the machine-readable 403 reasons', () => {
  it('not granted → consent_required, stale → consent_stale, current → null', () => {
    expect(denialReason({ granted: false, staleVersion: false })).toBe('consent_required');
    expect(denialReason({ granted: true, staleVersion: true })).toBe('consent_stale');
    expect(denialReason({ granted: true, staleVersion: false })).toBeNull();
  });

  it('an unshaped status is never admitted', () => {
    expect(denialReason(null)).toBe('consent_required');
    expect(denialReason({ granted: true })).not.toBeNull();
  });
});

describe('admitHealthProcessing — the socket form: never throws, fails closed', () => {
  it('no userId → false without touching the store', async () => {
    await expect(admitHealthProcessing(undefined)).resolves.toBe(false);
    await expect(admitHealthProcessing(null)).resolves.toBe(false);
    expect(consent.getConsentStatus).not.toHaveBeenCalled();
  });

  it('a store rejection → false, never throws', async () => {
    mockStoreDown = true;
    await expect(admitHealthProcessing('user-1')).resolves.toBe(false);
  });

  it('asks getConsentStatus(userId, health_biometric_processing) with the id object unchanged', async () => {
    const oid = { toString: () => 'user-oid' };
    mockGrants.set('user-oid', { granted: true, staleVersion: false });
    await expect(admitHealthProcessing(oid)).resolves.toBe(true);
    expect(consent.getConsentStatus).toHaveBeenCalledTimes(1);
    expect(consent.getConsentStatus.mock.calls[0][0]).toBe(oid);
    expect(consent.getConsentStatus.mock.calls[0][1]).toBe('health_biometric_processing');
  });
});

describe('parity: the REST middleware and the socket gate admit exactly the same grants', () => {
  const app = express();
  app.use((req, _res, next) => { req.user = { _id: req.headers['x-user'] }; next(); });
  app.post('/ingest', requireConsent('health_biometric_processing'), (_req, res) => res.status(200).json({ ingested: true }));

  it.each([
    [true, false],
    [true, true],
    [false, false],
    [false, true],
  ])('granted=%s staleVersion=%s', async (granted, staleVersion) => {
    mockGrants.set('u', { granted, staleVersion });
    const res = await request(app).post('/ingest').set('x-user', 'u');
    const admitted = await admitHealthProcessing('u');
    expect({ rest: res.status === 200, socket: admitted }).toEqual({ rest: admitted, socket: admitted });
    if (res.status !== 200) expect(res.body).toEqual({ error: denialReason({ granted, staleVersion }) });
  });
});
