'use strict';

// Isolated orchestration test: real normalizeGarminSummaries (pure) + mocked
// persistMetrics, so we assert flatten/dispatch without touching the DB. ingestSummaries now also
// reads the consent version (Garmin special-category gate) — grant at the min so nothing is gated
// here; the gate itself is pinned by tests/garminConsentVersionGate.test.js.
jest.mock('../app/services/wearable/metricStore', () => ({ persistMetrics: jest.fn() }));
jest.mock('../app/models/ConsentRecord', () => ({ latestFor: jest.fn() }));
jest.mock('../app/models/User', () => ({ findById: jest.fn() }));
jest.mock('../app/services/privacy/wearableErasure', () => ({ WEARABLE_PROVIDERS: [], eraseWearableProvider: jest.fn() }));

const ConsentRecord = require('../app/models/ConsentRecord');
const { persistMetrics } = require('../app/services/wearable/metricStore');
const { GARMIN_CONSENT_MIN_VERSION } = require('../app/services/privacy/consent');
const { ingestSummaries } = require('../app/services/wearable/garminIngest');

const START = 1700000000;

describe('garminIngest.ingestSummaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ConsentRecord.latestFor.mockResolvedValue({ status: 'granted', consentVersion: GARMIN_CONSENT_MIN_VERSION });
  });

  it('flattens mixed summaries to canonical metrics and persists them', async () => {
    persistMetrics.mockResolvedValue({ inserted: 1, profileMetrics: { sleepDeep: 60 }, droppedOutsideRetention: 0 });

    const res = await ingestSummaries('user-1', [
      { type: 'sleeps', summary: { startTimeInSeconds: START, deepSleepDurationInSeconds: 3600 } },
      { type: 'dailies', summary: { startTimeInSeconds: START, timeOffsetHeartRateSamples: { '0': 60 } } },
    ]);

    expect(persistMetrics).toHaveBeenCalledTimes(1);
    const [userArg, metricsArg] = persistMetrics.mock.calls[0];
    expect(userArg).toBe('user-1');
    expect(metricsArg).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'sleepDeep', value: 60, source: 'garmin' }),
      expect.objectContaining({ metric: 'heartRate', value: 60, source: 'garmin' }),
    ]));
    // Additive (T2): every earlier field keeps its meaning; the retention count is the one new field.
    expect(res).toEqual({ accepted: 2, inserted: 1, profileMetrics: { sleepDeep: 60 }, droppedOutsideRetention: 0 });
  });

  it('skips unknown summary types (accepted=0, no metrics)', async () => {
    persistMetrics.mockResolvedValue({ inserted: 0, profileMetrics: {}, droppedOutsideRetention: 0 });
    const res = await ingestSummaries('u', [{ type: 'userMetrics', summary: { startTimeInSeconds: START } }]);
    expect(persistMetrics).toHaveBeenCalledWith('u', [], { dropOutsideRetention: true });
    expect(res.accepted).toBe(0);
  });

  // T2: Garmin hands this lane history (a 182-day backfill, the personal lane's first pull), so it is
  // the one caller that asks the store to drop what its TTL would reap, and it passes the count on.
  // The drop itself runs on a real Mongo in garminRetentionFilter.integration.test.js.
  it('asks the store to drop what is past retention, and reports the count it gets back', async () => {
    persistMetrics.mockResolvedValue({ inserted: 0, profileMetrics: {}, droppedOutsideRetention: 4 });
    const res = await ingestSummaries('u', [
      { type: 'dailies', summary: { startTimeInSeconds: START, restingHeartRateInBeatsPerMinute: 52, timeOffsetHeartRateSamples: { 0: 60, 60: 61, 120: 62 } } },
    ]);
    expect(persistMetrics.mock.calls[0][2]).toEqual({ dropOutsideRetention: true });
    expect(res.accepted).toBe(4);
    expect(res.droppedOutsideRetention).toBe(4);
  });
});
