'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/services/privacy/wearableErasure', () => ({
  WEARABLE_PROVIDERS: ['garmin', 'apple_health', 'health_connect', 'suunto'],
  eraseWearableProvider: jest.fn().mockResolvedValue({ biometricLogs: 5, medicalProfiles: 1 }),
}));

const { eraseWearableProvider } = require('../app/services/privacy/wearableErasure');
const { deleteWearableProvider } = require('../app/controllers/wearableErasureController');

function buildRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

beforeEach(() => jest.clearAllMocks());

describe('DELETE /integrations/wearable/:provider', () => {
  it('erases a valid provider and returns the purge counts', async () => {
    const req = { user: { _id: 'u1' }, params: { provider: 'garmin' } };
    const res = buildRes();
    await deleteWearableProvider(req, res, jest.fn());
    expect(eraseWearableProvider).toHaveBeenCalledWith(req.user, 'garmin');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'garmin',
      purged: { biometricLogs: 5, medicalProfiles: 1 },
    }));
  });

  it('rejects an unknown provider with 400 and never erases', async () => {
    const req = { user: { _id: 'u1' }, params: { provider: 'fitbit' } };
    const res = buildRes();
    await deleteWearableProvider(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(eraseWearableProvider).not.toHaveBeenCalled();
  });

  it('forwards errors to next()', async () => {
    eraseWearableProvider.mockRejectedValueOnce(new Error('db down'));
    const next = jest.fn();
    await deleteWearableProvider({ user: { _id: 'u1' }, params: { provider: 'suunto' } }, buildRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
