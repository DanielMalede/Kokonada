'use strict';

// J2 (NF-A, the architect's #verify as a pin) — for an account that never granted health-data consent, a cold
// baseline blob (what computeBaselines returns with no samples: prior-only keys at confidence 0) must not
// change what the serving lane plays. buildTargets returns the same targets with NO cached blob as with the
// cold blob cached. Since J2 the state-recompute job never caches a blob for such an account (its gate
// refuses), but a blob cached before J2 lives for 24 hours, and this pin keeps it inert.
//
// Real: MongoDB (mongodb-memory-server), computeBaselines, cacheBaselines, buildTargets with translate, the
// affect engine and the regulator. Faked: Redis, by a STATEFUL in-memory store (GET/SET/DEL over real keys),
// so the blob buildTargets reads is the one cacheBaselines wrote. Two fresh accounts, the same `now` and the
// same mood, so nothing but the blob differs between the two calls.

process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.REDIS_URL; // the refresh the miss schedules is a no-op: only the blob is compared
delete process.env.WAVE4_AFFECT_DISABLED;

jest.mock('../app/config/redis', () => {
  const store = new Map();
  const fake = {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async set(key, value) { store.set(key, value); return 'OK'; },
    async del(...keys) { return keys.flat().reduce((n, k) => n + (store.delete(k) ? 1 : 0), 0); },
  };
  return { getRedis: () => fake, connectRedis: jest.fn(), createConnection: jest.fn(), __fake: fake };
});

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { __fake: redis } = require('../app/config/redis');
const baselinesService = require('../app/services/biosonic/baselines');
const { buildTargets } = require('../app/services/generation/targetsBuilder');

jest.setTimeout(60000);

const NOW = Date.UTC(2026, 9, 4, 18, 30); // a fixed evening, the same for both calls
let mem;

beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri(), { dbName: 'kokonada_j2_cold_parity' });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});
beforeEach(() => {
  redis.store.clear();
  baselinesService._resetRefreshCooldown();
  for (const level of ['log', 'info', 'warn', 'error']) jest.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('a cold baseline blob does not move what a never-granted account is played', () => {
  it('the cold blob is what computeBaselines returns with no samples (not vacuous)', async () => {
    const cold = await baselinesService.computeBaselines(String(new mongoose.Types.ObjectId()));
    expect(cold).toEqual(expect.objectContaining({ computedAt: expect.any(String) }));
    expect(cold.sampleCount ?? 0).toBe(0);
  });

  it.each([['calm'], ['energize'], [null]])('mood %p: the same targets with no blob as with the cold blob cached', async (moodKey) => {
    const bare = String(new mongoose.Types.ObjectId());
    const cached = String(new mongoose.Types.ObjectId());
    await baselinesService.cacheBaselines(cached, await baselinesService.computeBaselines(cached));
    expect(redis.store.has(`bio:baseline:${cached}`)).toBe(true);
    expect(redis.store.has(`bio:baseline:${bare}`)).toBe(false);

    const withoutBlob = await buildTargets({ userId: bare, moodKey, now: NOW });
    const withColdBlob = await buildTargets({ userId: cached, moodKey, now: NOW });

    expect(withColdBlob).toEqual(withoutBlob);
  });
});
