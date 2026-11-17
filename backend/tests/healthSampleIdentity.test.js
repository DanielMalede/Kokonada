'use strict';

const crypto = require('crypto');

const CURRENT_KEY = 'b'.repeat(64);
const PREVIOUS_KEY = 'a'.repeat(64);
const USER_ID = '507f1f77bcf86cd799439011';
const SAMPLE_ID = '8f14e45f-ea5e-4f7b-9d8b-55d5cf3f2a10';

function expectedHmac(keyHex, value) {
  return crypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(value).digest('hex');
}

describe('HealthSample identity', () => {
  const originalCurrent = process.env.ENCRYPTION_KEY;
  const originalPrevious = process.env.ENCRYPTION_KEY_PREVIOUS;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = CURRENT_KEY;
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    jest.resetModules();
  });

  afterAll(() => {
    if (originalCurrent === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalCurrent;
    if (originalPrevious === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
    else process.env.ENCRYPTION_KEY_PREVIOUS = originalPrevious;
  });

  it('serializes a purpose-namespaced, user- and source-scoped identity', () => {
    const { healthSampleIdentityInput } = require('../app/services/wearable/healthSampleIdentity');

    expect(healthSampleIdentityInput(USER_ID, 'apple_health', SAMPLE_ID))
      .toBe(`kokonada:health-sample:v1|${USER_ID}|apple_health|${SAMPLE_ID}`);
  });

  it('returns the same opaque key for a retry and different keys across identity boundaries', () => {
    const { healthSampleKey } = require('../app/services/wearable/healthSampleIdentity');

    const first = healthSampleKey(USER_ID, 'apple_health', SAMPLE_ID);
    expect(healthSampleKey(USER_ID, 'apple_health', SAMPLE_ID)).toBe(first);
    expect(healthSampleKey('507f191e810c19729de860ea', 'apple_health', SAMPLE_ID)).not.toBe(first);
    expect(healthSampleKey(USER_ID, 'health_connect', SAMPLE_ID)).not.toBe(first);
    expect(healthSampleKey(USER_ID, 'apple_health', '45c48cce-2e2d-4c58-b7a7-7d5077e087b1')).not.toBe(first);
    expect(first).not.toContain(USER_ID);
    expect(first).not.toContain(SAMPLE_ID);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns current and previous lookup keys during rotation, current first', () => {
    process.env.ENCRYPTION_KEY_PREVIOUS = PREVIOUS_KEY;
    const {
      healthSampleIdentityInput,
      healthSampleKey,
      healthSampleKeyCandidates,
    } = require('../app/services/wearable/healthSampleIdentity');
    const input = healthSampleIdentityInput(USER_ID, 'apple_health', SAMPLE_ID);

    expect(healthSampleKeyCandidates(USER_ID, 'apple_health', SAMPLE_ID)).toEqual([
      expectedHmac(CURRENT_KEY, input),
      expectedHmac(PREVIOUS_KEY, input),
    ]);
    expect(healthSampleKey(USER_ID, 'apple_health', SAMPLE_ID))
      .toBe(expectedHmac(CURRENT_KEY, input));
  });
});
