'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.NODE_ENV = 'test';

// Bounded retention for PlaylistSession SENSITIVE fields (T3.1): a scheduled trim redacts the
// encrypted, re-identifying context (contextPrompt + biometric HR snapshot) once a session
// ages past the window, while KEEPING trackSummary / feedback / activity for the History feed.
jest.mock('../app/models/PlaylistSession', () => ({
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
}));

const PlaylistSession = require('../app/models/PlaylistSession');
const { process: trim } = require('../app/workers/sessionTrim.worker');

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SESSION_SENSITIVE_RETENTION_DAYS;
  PlaylistSession.updateMany.mockResolvedValue({ modifiedCount: 3 });
});

describe('sessionTrim.worker', () => {
  it('redacts the encrypted sensitive fields on sessions older than the window, returning the count', async () => {
    const before = Date.now();
    const res = await trim();

    const [filter, update] = PlaylistSession.updateMany.mock.calls[0];
    expect(filter.createdAt.$lt).toBeInstanceOf(Date);
    const ageMs = before - filter.createdAt.$lt.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(29 * 24 * 3600 * 1000); // ~30d default
    expect(ageMs).toBeLessThanOrEqual(31 * 24 * 3600 * 1000);

    expect(update.$set.contextPrompt).toBeNull();
    expect(update.$set['biometricSnapshot.heartRate']).toBeNull();
    expect(res.trimmed).toBe(3);
  });

  it('keeps the non-sensitive history fields intact (activity label, trackSummary, feedback)', async () => {
    await trim();
    const [, update] = PlaylistSession.updateMany.mock.calls[0];
    expect(update.$set).not.toHaveProperty('biometricSnapshot.activity');
    expect(update.$set).not.toHaveProperty('trackSummary');
    expect(update.$set).not.toHaveProperty('skipCount');
    expect(update.$set).not.toHaveProperty('trackIds');
  });

  it('only targets rows that still carry sensitive data (idempotent re-runs)', async () => {
    await trim();
    const [filter] = PlaylistSession.updateMany.mock.calls[0];
    expect(filter.$or).toEqual(expect.arrayContaining([
      { contextPrompt: { $ne: null } },
      { 'biometricSnapshot.heartRate': { $ne: null } },
    ]));
  });

  it('honours a configurable retention window', async () => {
    process.env.SESSION_SENSITIVE_RETENTION_DAYS = '7';
    const before = Date.now();
    await trim();
    const [filter] = PlaylistSession.updateMany.mock.calls[0];
    const ageMs = before - filter.createdAt.$lt.getTime();
    expect(ageMs).toBeGreaterThanOrEqual(6.5 * 24 * 3600 * 1000);
    expect(ageMs).toBeLessThanOrEqual(7.5 * 24 * 3600 * 1000);
  });
});
