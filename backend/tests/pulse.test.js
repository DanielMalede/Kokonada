'use strict';

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);

// A11 Task 3 — GET /api/pulse/state. Owner-facing decrypted vitals via an EXPLICIT
// whitelist DTO (product ruling: owner may see their own numeric vitals). Two traps:
//   1. stateVector.status is a plain String the service stores PRE-encrypted, so the
//      reader must decrypt() it (a naive read shows ciphertext).
//   2. MedicalProfile sets toJSON:{getters:true} + has many encrypted fields; a
//      res.json(doc) would leak spO2/gpsVelocity/etc. Only the whitelist may ship.

jest.mock('../app/models/MedicalProfile');
const MedicalProfile = require('../app/models/MedicalProfile');
const { encrypt } = require('../app/utils/encryption');
const ctrl = require('../app/controllers/pulseController');

function buildRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

// A real doc would decrypt the encryptedNumber getters; the mock supplies the already
// "decrypted" numbers directly (getters are transparent). stateVector.status is a
// plain field, so it stays ciphertext until the controller decrypts it.
function profileDoc(overrides = {}) {
  return {
    hrv: 68, bodyBattery: 74, dailyReadiness: 81, restingHeartRate: 54,
    // Fields that MUST NOT appear in the DTO:
    spO2: 98, respirationRate: 14, gpsVelocityKmh: 7.2, stepsPerMinute: 90,
    accelerometerVariance: 0.4, maxHeartRate: 190,
    sleepStages: { rem: 80, deep: 95, light: 300 },
    hrZones: { zone1: { label: 'easy' } },
    lastNightSleep: { deep: 90, light: 280, rem: 85, date: new Date('2026-07-03T06:00:00Z') },
    sleepUpdatedAt: new Date('2026-07-03T07:00:00Z'),
    stateVector: { status: encrypt('Peak Athletic Performance'), confidence: 0.86, computedAt: new Date('2026-07-03T11:00:00Z') },
    sampleCount: 4200, lastAnalyzed: new Date('2026-07-03T10:00:00Z'),
    ...overrides,
  };
}

function mockFindOne(doc) {
  const calls = {};
  MedicalProfile.findOne.mockImplementation((filter) => { calls.filter = filter; return Promise.resolve(doc); });
  return calls;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/pulse/state — decrypted vitals + whitelist', () => {
  it('decrypts stateVector.status and returns the owner vitals', async () => {
    const calls = mockFindOne(profileDoc());
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' }, query: {} }, res, jest.fn());

    expect(calls.filter).toEqual({ userId: 'u1' }); // scoped to caller
    expect(res.body.stateVector).toEqual({
      status: 'Peak Athletic Performance', confidence: 0.86, computedAt: expect.any(Date),
    });
    expect(res.body.vitals).toEqual({ hrv: 68, bodyBattery: 74, dailyReadiness: 81, restingHeartRate: 54 });
    expect(res.body.sleep.lastNight).toEqual({ deep: 90, light: 280, rem: 85, date: expect.any(Date) });
    expect(res.body.sampleCount).toBe(4200);
  });

  it('NEVER leaks unlisted physiological fields (deep scan)', async () => {
    mockFindOne(profileDoc());
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' }, query: {} }, res, jest.fn());
    const blob = JSON.stringify(res.body);
    for (const forbidden of ['spO2', 'respirationRate', 'gpsVelocityKmh', 'stepsPerMinute', 'accelerometerVariance', 'maxHeartRate', 'hrZones', 'sleepStages']) {
      expect(blob).not.toContain(forbidden);
    }
    // and the raw ciphertext of the status must never ship — only the plaintext
    expect(blob).not.toContain(profileDoc().stateVector.status);
  });

  it('a corrupt/undecryptable status degrades to null, never throws', async () => {
    mockFindOne(profileDoc({ stateVector: { status: 'not-real-ciphertext', confidence: 0.5, computedAt: null } }));
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' }, query: {} }, res, jest.fn());
    expect(res.body.stateVector.status).toBeNull();
    expect(res.body.stateVector.confidence).toBe(0.5);
  });
});

describe('GET /api/pulse/state — no profile', () => {
  it('returns a full null-safe shape (200, not 404) so the screen renders empty gauges', async () => {
    mockFindOne(null);
    const res = buildRes();
    await ctrl.getPulseState({ user: { _id: 'u1' }, query: {} }, res, jest.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      stateVector: { status: null, confidence: null, computedAt: null },
      vitals: { hrv: null, bodyBattery: null, dailyReadiness: null, restingHeartRate: null },
      sleep: { lastNight: { deep: null, light: null, rem: null, date: null }, updatedAt: null },
      lastAnalyzed: null, sampleCount: 0,
    });
  });
});
