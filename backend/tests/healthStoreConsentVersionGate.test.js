'use strict';

// Defense-in-depth pin (audit follow-up to H-9 / PR #170). The Health-Connect / HealthKit batch
// lane (healthStore.ingestBatch) must NOT persist the three Garmin-only special-category (GDPR
// Art.9) canonical metrics — spO2 / respirationRate / bodyBattery — unless the user's latest GRANTED
// consent version is >= GARMIN_CONSENT_MIN_VERSION, mirroring garminIngest exactly. The primary fix
// keeps them out of the HC-lane normalizer, so today they never reach here; this gate is the backstop
// that holds even if a future map regression (or a hostile client) slips one in. We INJECT the special
// categories post-normalize (mock the normalizer) so the GATE is exercised independently of the map.
//
// Real semantics: the REAL consent-version read + REAL predicate + REAL ingestBatch gate run; only the
// DB (ConsentRecord.latestFor), the persistence side-effect (persistMetrics), and the normalizer are faked.
process.env.NODE_ENV = 'test';

jest.mock('../app/services/wearable/metricStore', () => ({ persistMetrics: jest.fn() }));
jest.mock('../app/models/ConsentRecord', () => ({ latestFor: jest.fn() }));
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/services/privacy/wearableErasure', () => ({ WEARABLE_PROVIDERS: [], eraseWearableProvider: jest.fn() }));
jest.mock('../app/services/wearable/adapter', () => ({ normalizeHealthStoreSamples: jest.fn() }));

const ConsentRecord = require('../app/models/ConsentRecord');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const { normalizeHealthStoreSamples } = require('../app/services/wearable/adapter');
const { ingestBatch } = require('../app/services/wearable/healthStore');
const { CURRENT_CONSENT_VERSION, GARMIN_CONSENT_MIN_VERSION } = require('../app/services/privacy/consent');

const USER = 'user-hc';
const at = new Date('2026-01-15T03:30:00Z');

// The three Garmin-only special categories (canonical metric names) and the HC-lane set.
const SPECIAL = ['spO2', 'respirationRate', 'bodyBattery'];
const HC_LANE = ['restingHeartRate', 'heartRate', 'hrv'];

// What ingestBatch would receive back from the normalizer: the legitimate HC-lane metrics PLUS the
// three injected special categories (simulating a map regression / hostile client). The gate is the
// ONLY thing that can drop the special categories here.
const mixedMetrics = () => [
  { metric: 'restingHeartRate', value: 52, unit: 'bpm',  recordedAt: at, source: 'health_connect' },
  { metric: 'heartRate',        value: 61, unit: 'bpm',  recordedAt: at, source: 'health_connect' },
  { metric: 'hrv',              value: 45, unit: 'ms',   recordedAt: at, source: 'health_connect' },
  { metric: 'spO2',             value: 97, unit: '%',    recordedAt: at, source: 'health_connect' },
  { metric: 'respirationRate',  value: 14, unit: 'brpm', recordedAt: at, source: 'health_connect' },
  { metric: 'bodyBattery',      value: 70, unit: 'score',recordedAt: at, source: 'health_connect' },
];

const grantedAt = (v) => ({ status: 'granted', consentVersion: v });
const persistedMetrics = () => persistMetrics.mock.calls[0][1].map((m) => m.metric);

beforeEach(() => {
  jest.clearAllMocks();
  normalizeHealthStoreSamples.mockReturnValue(mixedMetrics());
  persistMetrics.mockResolvedValue({ inserted: 0, profileMetrics: {} });
});

describe('healthStore.ingestBatch — Art.9 special-category consent-version gate', () => {
  // (a) consent below the min → special categories NOT persisted.
  it('consent v1 (below min) → the three special categories are DROPPED', async () => {
    ConsentRecord.latestFor.mockResolvedValue(grantedAt(CURRENT_CONSENT_VERSION));
    await ingestBatch(USER, 'health_connect', [{ type: 'x' }]);
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).not.toContain(s);
  });

  // (c) HC-lane categories persist regardless of version.
  it('HC-lane metrics persist REGARDLESS of version (ungated at v1)', async () => {
    ConsentRecord.latestFor.mockResolvedValue(grantedAt(CURRENT_CONSENT_VERSION));
    await ingestBatch(USER, 'health_connect', [{ type: 'x' }]);
    const persisted = persistedMetrics();
    for (const hc of HC_LANE) expect(persisted).toContain(hc);
  });

  // (b) at/above the min → special categories ARE persisted (alongside the HC-lane).
  it('consent >= GARMIN_CONSENT_MIN_VERSION → the three special categories ARE persisted', async () => {
    ConsentRecord.latestFor.mockResolvedValue(grantedAt(GARMIN_CONSENT_MIN_VERSION));
    await ingestBatch(USER, 'health_connect', [{ type: 'x' }]);
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).toContain(s);
    for (const hc of HC_LANE) expect(persisted).toContain(hc);
  });

  // Fail-closed: no record on file → special categories dropped, HC-lane still flows.
  it('no consent record on file → special categories dropped, HC-lane still persisted', async () => {
    ConsentRecord.latestFor.mockResolvedValue(null);
    await ingestBatch(USER, 'health_connect', [{ type: 'x' }]);
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).not.toContain(s);
    for (const hc of HC_LANE) expect(persisted).toContain(hc);
  });

  // Fail-closed: latest row is a WITHDRAWAL (even stamped at a high version) → not a current grant.
  it('latest row is a withdrawal at a high version → special categories dropped', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'withdrawn', consentVersion: GARMIN_CONSENT_MIN_VERSION + 5 });
    await ingestBatch(USER, 'health_connect', [{ type: 'x' }]);
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).not.toContain(s);
  });
});
