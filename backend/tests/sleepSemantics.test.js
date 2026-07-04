'use strict';

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);

jest.mock('../app/models/BiometricLog', () => ({
  insertMany: jest.fn().mockResolvedValue([]),
  find: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve([]) }) })),
}));
jest.mock('../app/models/MedicalProfile', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
  findOne: jest.fn(() => ({ select: () => ({ lean: () => Promise.resolve(null) }) })),
}));
jest.mock('../app/queues/queue', () => ({
  enqueue: jest.fn().mockResolvedValue({ queued: true }),
}));

const MedicalProfile = require('../app/models/MedicalProfile');
const { enqueue } = require('../app/queues/queue');
const { decrypt } = require('../app/utils/encryption');
const { computeLastNightSleep } = require('../app/services/medicalProfileService');
const { persistMetrics } = require('../app/services/wearable/metricStore');

const sleep = (metric, value, iso) => ({ metric, value, unit: 'min', recordedAt: new Date(iso), source: 'health_connect' });

function mockExistingNight(dateStr) {
  MedicalProfile.findOne.mockReturnValue({
    select: () => ({ lean: () => Promise.resolve(dateStr ? { lastNightSleep: { date: new Date(dateStr) } } : null) }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExistingNight(null);
});

describe('computeLastNightSleep (pure)', () => {
  it('sums per-stage minutes for the LATEST night only', () => {
    const out = computeLastNightSleep([
      sleep('sleepDeep', 55, '2026-06-30T06:30:00Z'),   // older night
      sleep('sleepDeep', 60, '2026-07-01T06:00:00Z'),
      sleep('sleepLight', 200, '2026-07-01T06:00:00Z'),
      sleep('sleepRem', 45, '2026-07-01T06:00:00Z'),
      sleep('sleepDeep', 15, '2026-07-01T07:10:00Z'),   // second session, same night → summed
    ]);

    expect(out).toEqual({ deep: 75, light: 200, rem: 45, date: '2026-07-01' });
  });

  it('returns null with no sleep samples (a median batch must not fabricate a night)', () => {
    expect(computeLastNightSleep([sleep('restingHeartRate', 60, '2026-07-01T06:00:00Z')])).toBeNull();
    expect(computeLastNightSleep([])).toBeNull();
  });

  it('drops corrupt values and dates instead of crashing', () => {
    const out = computeLastNightSleep([
      sleep('sleepDeep', NaN, '2026-07-01T06:00:00Z'),
      sleep('sleepDeep', -30, '2026-07-01T06:00:00Z'),
      { metric: 'sleepDeep', value: 60, recordedAt: 'not-a-date' },
      sleep('sleepDeep', 40, '2026-07-01T06:00:00Z'),
    ]);

    expect(out).toEqual({ deep: 40, light: 0, rem: 0, date: '2026-07-01' });
  });
});

describe('persistMetrics — lastNightSleep persistence', () => {
  const batch = [
    sleep('sleepDeep', 60, '2026-07-01T06:00:00Z'),
    sleep('sleepLight', 200, '2026-07-01T06:00:00Z'),
    sleep('sleepRem', 45, '2026-07-01T06:00:00Z'),
  ];

  it('persists encrypted latest-night sums alongside the median baseline', async () => {
    await persistMetrics('u1', batch);

    const $set = MedicalProfile.findOneAndUpdate.mock.calls[0][1].$set;
    expect(decrypt($set['lastNightSleep.deep'])).toBe('60');
    expect(decrypt($set['lastNightSleep.light'])).toBe('200');
    expect(decrypt($set['lastNightSleep.rem'])).toBe('45');
    expect($set['lastNightSleep.date']).toEqual(new Date('2026-07-01'));
    expect($set.sleepUpdatedAt).toBeInstanceOf(Date);
    // The median baseline fields still write (backward-compatible).
    expect($set['sleepStages.deep']).toBeDefined();
  });

  it('a 6-month backfill can never overwrite a fresher night', async () => {
    mockExistingNight('2026-07-02'); // profile already has a newer night
    await persistMetrics('u1', batch); // batch's latest night: 2026-07-01

    const $set = MedicalProfile.findOneAndUpdate.mock.calls[0][1].$set;
    expect($set['lastNightSleep.deep']).toBeUndefined();
    expect($set['sleepStages.deep']).toBeDefined(); // baseline median still updates
  });

  it('enqueues a state-vector recompute so backfill finally influences generation', async () => {
    await persistMetrics('u1', batch);

    expect(enqueue).toHaveBeenCalledWith(
      'state-vector-recompute',
      { userId: 'u1' },
      expect.objectContaining({ jobId: 'state-vector-u1' })
    );
  });

  it('a queue failure never breaks ingestion', async () => {
    enqueue.mockRejectedValueOnce(new Error('redis down'));

    await expect(persistMetrics('u1', batch)).resolves.toEqual(
      expect.objectContaining({ inserted: 0 })
    );
  });
});
