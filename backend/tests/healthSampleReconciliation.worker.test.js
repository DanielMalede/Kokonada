'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/models/HealthSample', () => ({ find: jest.fn() }));
jest.mock('../app/services/wearable/healthSampleReconciliation', () => ({
  reconcileHealthSamples: jest.fn(),
  recoverOwedHealthProjectionCleanups: jest.fn(),
}));
jest.mock('../app/services/wearable/healthStoreV2', () => ({
  recoverStagedHealthSamples: jest.fn(),
}));

const HealthSample = require('../app/models/HealthSample');
const {
  reconcileHealthSamples,
  recoverOwedHealthProjectionCleanups,
} = require('../app/services/wearable/healthSampleReconciliation');
const { recoverStagedHealthSamples } = require('../app/services/wearable/healthStoreV2');
const worker = require('../app/workers/healthSampleReconciliation.worker');

function queryReturning(rows) {
  const lean = jest.fn().mockResolvedValue(rows);
  const limit = jest.fn(() => ({ lean }));
  const sort = jest.fn(() => ({ limit }));
  const select = jest.fn(() => ({ sort }));
  HealthSample.find.mockReturnValue({ select });
  return { select, sort, limit, lean };
}

describe('health sample reconciliation repair worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recoverOwedHealthProjectionCleanups.mockResolvedValue({ cleaned: 0, deferred: 0, failed: 0 });
    recoverStagedHealthSamples.mockResolvedValue({ recovered: 0, removed: 0, failed: 0 });
  });

  it('scans at most 100 oldest pending rows and repairs each user/source group once', async () => {
    const query = queryReturning([
      { userId: 'user-a', source: 'apple_health', connectionVersion: 2 },
      { userId: 'user-a', source: 'apple_health', connectionVersion: 2 },
      { userId: 'user-b', source: 'apple_health', connectionVersion: 0 },
      { userId: 'user-a', source: 'health_connect', connectionVersion: 1 },
    ]);
    reconcileHealthSamples.mockResolvedValue({ projected: 1 });

    await expect(worker.process()).resolves.toEqual({
      groups: 3,
      repaired: 3,
      staged: { recovered: 0, removed: 0, failed: 0 },
      projectionCleanup: { cleaned: 0, deferred: 0, failed: 0 },
    });

    expect(recoverStagedHealthSamples).toHaveBeenCalledWith({ limit: 100 });
    expect(HealthSample.find).toHaveBeenCalledWith({
      projectionState: 'pending',
      ingestState: { $ne: 'staged' },
    });
    expect(query.select).toHaveBeenCalledWith({ userId: 1, source: 1, connectionVersion: 1 });
    expect(query.sort).toHaveBeenCalledWith({ updatedAt: 1, _id: 1 });
    expect(query.limit).toHaveBeenCalledWith(100);
    expect(query.lean).toHaveBeenCalledTimes(1);
    expect(reconcileHealthSamples.mock.calls).toEqual([
      ['user-a', 'apple_health', { connectionVersion: 2 }],
      ['user-b', 'apple_health', { connectionVersion: 0 }],
      ['user-a', 'health_connect', { connectionVersion: 1 }],
    ]);
  });

  it('continues repairing later groups after one group fails without logging identity', async () => {
    queryReturning([
      { userId: 'private-user-a', source: 'apple_health' },
      { userId: 'private-user-b', source: 'apple_health' },
    ]);
    reconcileHealthSamples
      .mockRejectedValueOnce(new Error('contains-sensitive-context'))
      .mockResolvedValueOnce({ projected: 1 });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(worker.process()).resolves.toEqual({
      groups: 2,
      repaired: 1,
      staged: { recovered: 0, removed: 0, failed: 0 },
      projectionCleanup: { cleaned: 0, deferred: 0, failed: 0 },
    });

    expect(reconcileHealthSamples).toHaveBeenCalledTimes(2);
    const output = log.mock.calls.flat().join(' ');
    expect(output).not.toMatch(/private-user|contains-sensitive-context|apple_health/);
    log.mockRestore();
  });

  it('does no work when no authoritative row is pending', async () => {
    queryReturning([]);

    await expect(worker.process()).resolves.toEqual({
      groups: 0,
      repaired: 0,
      staged: { recovered: 0, removed: 0, failed: 0 },
      projectionCleanup: { cleaned: 0, deferred: 0, failed: 0 },
    });
    expect(reconcileHealthSamples).not.toHaveBeenCalled();
  });
});
