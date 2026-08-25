'use strict';

// Pin (audit H-9 follow-up, replaces the prose "MUST bump when the lane goes live" comment with
// an ENFORCED guard). The Garmin server-to-server lane discloses four special-category (GDPR
// Art.9) types — spo2 / respiratory_rate / body_battery / daily_readiness — that Health Connect on
// this client does NOT read. Those may be PERSISTED only once the user re-consents at
// GARMIN_CONSENT_MIN_VERSION.
// Below that (i.e. today, lane dormant, CURRENT_CONSENT_VERSION = 1) they are DROPPED at ingest.
// The HC-lane metrics (HR / HRV / sleep / resting-HR, lawful at v1) are UNGATED.
//
// Real semantics: the REAL consent-version read + REAL predicate + REAL normalizer run; only the
// DB (ConsentRecord.latestFor) and the persistence side-effect (persistMetrics) are faked.
process.env.NODE_ENV = 'test';

jest.mock('../app/services/wearable/metricStore', () => ({ persistMetrics: jest.fn() }));
jest.mock('../app/models/ConsentRecord', () => ({ latestFor: jest.fn() }));
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/services/privacy/wearableErasure', () => ({ WEARABLE_PROVIDERS: [], eraseWearableProvider: jest.fn() }));

// The Garmin normalizer runs FOR REAL for every case below (real summaries -> real metrics); this is
// a PASSTHROUGH spy, not a stub. It exists only so the dailyReadiness block can inject a metric the
// normalizer map cannot emit yet — without it that assertion would pass vacuously.
jest.mock('../app/services/wearable/adapter', () => {
  const actual = jest.requireActual('../app/services/wearable/adapter');
  return { ...actual, normalizeGarminSummaries: jest.fn(actual.normalizeGarminSummaries) };
});

const ConsentRecord = require('../app/models/ConsentRecord');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');
const { normalizeGarminSummaries } = require('../app/services/wearable/adapter');
const { GARMIN_SPECIAL_CATEGORY_METRICS } = require('../app/services/wearable/specialCategoryMetrics');
const {
  CURRENT_CONSENT_VERSION,
  GARMIN_CONSENT_MIN_VERSION,
  garminSpecialCategoryAllowed,
} = require('../app/services/privacy/consent');

const START = 1700000000;
const USER = 'user-9';

// The three Garmin-only special categories (canonical metric names) and the HC-lane set.
const SPECIAL = ['spO2', 'respirationRate', 'bodyBattery'];
const HC_LANE = ['restingHeartRate', 'heartRate', 'hrv'];

// A single push carrying BOTH lanes: HC-lane (dailies → resting-HR + HR, hrv) AND all three
// Garmin-only special categories (pulseox → spO2, respiration → respirationRate,
// stressDetails → bodyBattery). Every value is inside its plausibility range so nothing is
// dropped for being out-of-range — the ONLY thing that can drop a metric is the consent gate.
const mixedPush = () => [
  { type: 'dailies',       summary: { startTimeInSeconds: START, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 61 } } },
  { type: 'hrv',           summary: { startTimeInSeconds: START, lastNightAvg: 45 } },
  { type: 'pulseox',       summary: { startTimeInSeconds: START, timeOffsetSpo2Values: { 0: 97 } } },
  { type: 'respiration',   summary: { startTimeInSeconds: START, timeOffsetEpochToBreaths: { 0: 14 } } },
  { type: 'stressDetails', summary: { startTimeInSeconds: START, timeOffsetBodyBatteryValues: { 0: 70 } } },
];

const grantedAt = (v) => ({ status: 'granted', consentVersion: v });
const persistedMetrics = () => persistMetrics.mock.calls[0][1].map((m) => m.metric);

beforeEach(() => {
  jest.clearAllMocks();
  persistMetrics.mockResolvedValue({ inserted: 0, profileMetrics: {} });
});

describe('Garmin consent version gate', () => {
  // (d) Tripwire: the lane is provably gated OFF at today's version. When someone flips the lane
  // live they MUST bump CURRENT_CONSENT_VERSION to the min — this fails loudly if they forget.
  it('is gated OFF at the current version (GARMIN_CONSENT_MIN_VERSION > CURRENT_CONSENT_VERSION)', () => {
    expect(GARMIN_CONSENT_MIN_VERSION).toBeGreaterThan(CURRENT_CONSENT_VERSION);
    expect(garminSpecialCategoryAllowed(CURRENT_CONSENT_VERSION)).toBe(false);
    expect(garminSpecialCategoryAllowed(GARMIN_CONSENT_MIN_VERSION)).toBe(true);
    expect(garminSpecialCategoryAllowed(GARMIN_CONSENT_MIN_VERSION - 1)).toBe(false);
  });

  // (a) consent below the min → special categories NOT persisted.
  it('consent v1 (below min) → the three Garmin-only special categories are DROPPED', async () => {
    ConsentRecord.latestFor.mockResolvedValue(grantedAt(1));
    await ingestSummaries(USER, mixedPush());
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).not.toContain(s);
  });

  // (c) HC-lane categories persist regardless of version.
  it('HC-lane metrics persist REGARDLESS of version (ungated at v1)', async () => {
    ConsentRecord.latestFor.mockResolvedValue(grantedAt(1));
    await ingestSummaries(USER, mixedPush());
    const persisted = persistedMetrics();
    for (const hc of HC_LANE) expect(persisted).toContain(hc);
  });

  // (b) at/above the min → special categories ARE persisted (alongside the HC-lane).
  it('consent >= GARMIN_CONSENT_MIN_VERSION → the three special categories ARE persisted', async () => {
    ConsentRecord.latestFor.mockResolvedValue(grantedAt(GARMIN_CONSENT_MIN_VERSION));
    await ingestSummaries(USER, mixedPush());
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).toContain(s);
    for (const hc of HC_LANE) expect(persisted).toContain(hc);
  });

  // Fail-closed: no record on file → special categories dropped, HC-lane still flows.
  it('no consent record on file → special categories dropped, HC-lane still persisted', async () => {
    ConsentRecord.latestFor.mockResolvedValue(null);
    await ingestSummaries(USER, mixedPush());
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).not.toContain(s);
    for (const hc of HC_LANE) expect(persisted).toContain(hc);
  });

  // Fail-closed: latest row is a WITHDRAWAL (even stamped at a high version) → not a current grant.
  it('latest row is a withdrawal at a high version → special categories dropped', async () => {
    ConsentRecord.latestFor.mockResolvedValue({ status: 'withdrawn', consentVersion: GARMIN_CONSENT_MIN_VERSION + 5 });
    await ingestSummaries(USER, mixedPush());
    const persisted = persistedMetrics();
    for (const s of SPECIAL) expect(persisted).not.toContain(s);
  });
});

// ── dailyReadiness — the fourth Garmin-only special category (GDPR Art.9) ──────────────────────
// Training Readiness is a special-category health INFERENCE: MedicalProfile.dailyReadiness stores it
// field-level encrypted, aggregateProfileMetrics writes it there from any ingest batch, and it is
// read back as retained profile state. It was missing from GARMIN_SPECIAL_CATEGORY_METRICS, so —
// unlike its three siblings — it was admitted at ANY consent version, including none at all.
//
// Real semantics: the REAL consent read + REAL predicate + REAL ingestSummaries gate run. No
// normalizer emits `dailyReadiness` yet, so the map physically cannot produce one; we INJECT it
// post-normalize (exactly as healthStoreConsentVersionGate.test.js does for its inert backstop) so
// the GATE is what is under test. Asserting on a real summary would pass for the wrong reason.
describe('dailyReadiness is gated exactly like the other Garmin special categories', () => {
  const at = new Date(START * 1000);
  // What the gate receives: one lawful-at-v1 HC-lane metric + the injected special category. The
  // HC-lane metric is the control — it proves the batch reached persistMetrics at all, so a
  // "dropped" assertion can never pass just because nothing was ingested.
  const injected = () => [
    { metric: 'restingHeartRate', value: 52, unit: 'bpm',   recordedAt: at, source: 'garmin' },
    { metric: 'dailyReadiness',   value: 78, unit: 'score', recordedAt: at, source: 'garmin' },
  ];
  const ingestInjected = async (record) => {
    normalizeGarminSummaries.mockReturnValueOnce(injected());
    ConsentRecord.latestFor.mockResolvedValue(record);
    await ingestSummaries(USER, [{ type: 'readiness', summary: {} }]);
    return persistedMetrics();
  };

  // The ONE source of truth both ingest lanes (garminIngest + healthStore) filter on.
  it('is in GARMIN_SPECIAL_CATEGORY_METRICS', () => {
    expect(GARMIN_SPECIAL_CATEGORY_METRICS.has('dailyReadiness')).toBe(true);
  });

  it('consent below the min → dailyReadiness is DROPPED (HC-lane control still persists)', async () => {
    const persisted = await ingestInjected(grantedAt(CURRENT_CONSENT_VERSION));
    expect(persisted).toContain('restingHeartRate');
    expect(persisted).not.toContain('dailyReadiness');
  });

  it('no consent record on file → dailyReadiness dropped (fail-closed)', async () => {
    const persisted = await ingestInjected(null);
    expect(persisted).toContain('restingHeartRate');
    expect(persisted).not.toContain('dailyReadiness');
  });

  it('latest row is a withdrawal at a high version → dailyReadiness dropped (fail-closed)', async () => {
    const persisted = await ingestInjected({ status: 'withdrawn', consentVersion: GARMIN_CONSENT_MIN_VERSION + 5 });
    expect(persisted).toContain('restingHeartRate');
    expect(persisted).not.toContain('dailyReadiness');
  });

  // The gate must not be a blanket ban — re-consented users at the min version are lawful.
  it('consent >= GARMIN_CONSENT_MIN_VERSION → dailyReadiness IS persisted', async () => {
    const persisted = await ingestInjected(grantedAt(GARMIN_CONSENT_MIN_VERSION));
    expect(persisted).toContain('dailyReadiness');
    expect(persisted).toContain('restingHeartRate');
  });
});
