'use strict';

process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.JWT_SECRET     = 'test-jwt-secret-for-tests-only';
process.env.NODE_ENV       = 'test';

jest.mock('../app/models/User', () => ({
  findByIdAndUpdate: jest.fn().mockResolvedValue({}),
}));

const User = require('../app/models/User');
const { resolveEntitlements, applyRevenueCatEvent } = require('../app/services/entitlements/entitlements');
const { revenueCatWebhook } = require('../app/controllers/webhooksController');

function buildRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}
const next = (err) => { if (err) throw err; };

beforeEach(() => {
  jest.clearAllMocks();
  process.env.REVENUECAT_WEBHOOK_SECRET = 'rc-secret';
});

describe('resolveEntitlements', () => {
  it('defaults to free when the user has no entitlements at all', () => {
    expect(resolveEntitlements({})).toEqual({ tier: 'free', premium: false, expiresAt: null });
    expect(resolveEntitlements(null)).toEqual({ tier: 'free', premium: false, expiresAt: null });
  });

  it('honours an active premium period', () => {
    const end = new Date(Date.now() + 86400e3);
    const r = resolveEntitlements({ entitlements: { tier: 'premium', currentPeriodEnd: end } });
    expect(r.premium).toBe(true);
    expect(r.tier).toBe('premium');
  });

  it('demotes to free at read time once currentPeriodEnd has passed', () => {
    const end = new Date(Date.now() - 1000);
    const r = resolveEntitlements({ entitlements: { tier: 'premium', currentPeriodEnd: end } });
    expect(r.premium).toBe(false);
    expect(r.tier).toBe('free');
  });

  it('treats premium without an end date as non-expiring (manual grants)', () => {
    const r = resolveEntitlements({ entitlements: { tier: 'premium', currentPeriodEnd: null } });
    expect(r.premium).toBe(true);
  });
});

describe('applyRevenueCatEvent', () => {
  it('grants premium on INITIAL_PURCHASE with the period end', async () => {
    const expiration = Date.now() + 30 * 86400e3;
    const r = await applyRevenueCatEvent({ type: 'INITIAL_PURCHASE', app_user_id: 'user-1', expiration_at_ms: expiration });
    expect(r.handled).toBe(true);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith('user-1', expect.objectContaining({
      $set: expect.objectContaining({
        entitlements: expect.objectContaining({ tier: 'premium', source: 'revenuecat' }),
      }),
    }));
  });

  it('revokes premium on EXPIRATION', async () => {
    const r = await applyRevenueCatEvent({ type: 'EXPIRATION', app_user_id: 'user-1' });
    expect(r.handled).toBe(true);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith('user-1', expect.objectContaining({
      $set: expect.objectContaining({
        entitlements: expect.objectContaining({ tier: 'free' }),
      }),
    }));
  });

  it('ignores unknown event types and garbage without writing', async () => {
    for (const junk of [null, {}, { type: 'TEST' }, { type: 'INITIAL_PURCHASE' }, { app_user_id: 'u' }, { type: 42, app_user_id: 'u' }]) {
      const r = await applyRevenueCatEvent(junk);
      expect(r.handled).toBe(false);
    }
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });
});

describe('POST /webhooks/revenuecat', () => {
  const EVENT = { type: 'INITIAL_PURCHASE', app_user_id: 'user-1', expiration_at_ms: Date.now() + 86400e3 };

  it('processes an authenticated event', async () => {
    const res = buildRes();
    await revenueCatWebhook(
      { headers: { authorization: 'Bearer rc-secret' }, body: { event: EVENT } },
      res, next,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(User.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('rejects a missing or wrong Authorization header with 401 and no processing', async () => {
    for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'rc-secret' }]) {
      const res = buildRes();
      await revenueCatWebhook({ headers, body: { event: EVENT } }, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('returns 503 when the webhook secret is not configured (fail-closed)', async () => {
    delete process.env.REVENUECAT_WEBHOOK_SECRET;
    const res = buildRes();
    await revenueCatWebhook({ headers: { authorization: 'Bearer rc-secret' }, body: { event: EVENT } }, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('FUZZ: garbage bodies never throw', async () => {
    for (const body of [null, {}, { event: null }, { event: 'string' }, { event: { type: [] } }]) {
      const res = buildRes();
      await revenueCatWebhook({ headers: { authorization: 'Bearer rc-secret' }, body }, res, next);
      expect(res.status).toHaveBeenCalledWith(200);
    }
  });
});
