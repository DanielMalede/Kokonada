'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/models/ServeEvent', () => ({
  insertMany: jest.fn().mockResolvedValue([]),
  find: jest.fn(),
}));
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));

const ServeEvent = require('../app/models/ServeEvent');
const { getRedis } = require('../app/config/redis');
const ledger = require('../app/services/ledger/serveLedger');

const NOW = Date.parse('2026-07-02T12:00:00Z');
const HOUR = 3_600_000;

function fakeRedis() {
  return {
    zadd: jest.fn().mockResolvedValue(1),
    zremrangebyscore: jest.fn().mockResolvedValue(0),
    zrangebyscore: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(1),
  };
}

function mockMongoFind(rows = []) {
  ServeEvent.find.mockReturnValue({ lean: () => Promise.resolve(rows) });
}

const entry = (canonicalKey, moodKey = 'focus') => ({
  canonicalKey, moodKey, bioState: { tempoBand: 'active', activity: 'walking' },
});

beforeEach(() => {
  jest.clearAllMocks();
  getRedis.mockReturnValue(null);
  mockMongoFind([]);
});

describe('serveLedger.recordServes', () => {
  it('persists durable ServeEvents with server-assigned timestamps', async () => {
    await ledger.recordServes({ userId: 'u1', sessionId: 'req-9', entries: [entry('at:a|s1'), entry('at:a|s2')] }, NOW);

    const [docs, opts] = ServeEvent.insertMany.mock.calls[0];
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual(expect.objectContaining({
      userId: 'u1', canonicalKey: 'at:a|s1', moodKey: 'focus',
      bioState: { tempoBand: 'active', activity: 'walking' },
      servedAt: new Date(NOW),
    }));
    expect(opts).toEqual(expect.objectContaining({ ordered: false }));
  });

  it('writes both hot windows (global + per-mood), prunes, and refreshes TTLs', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    await ledger.recordServes({ userId: 'u1', entries: [entry('at:a|s1', 'focus')] }, NOW);

    expect(redis.zadd).toHaveBeenCalledWith('ledger:u1:served', expect.anything(), 'at:a|s1');
    expect(redis.zadd).toHaveBeenCalledWith('ledger:u1:mood:focus', expect.anything(), 'at:a|s1');
    expect(redis.zremrangebyscore).toHaveBeenCalledWith('ledger:u1:served', '-inf', expect.any(Number));
    expect(redis.expire).toHaveBeenCalledWith('ledger:u1:served', expect.any(Number));
    expect(redis.expire).toHaveBeenCalledWith('ledger:u1:mood:focus', expect.any(Number));
  });

  it('a Redis outage never loses the durable write', async () => {
    const redis = fakeRedis();
    redis.zadd.mockRejectedValue(new Error('redis down'));
    getRedis.mockReturnValue(redis);

    await expect(ledger.recordServes({ userId: 'u1', entries: [entry('at:a|s1')] }, NOW)).resolves.toBeDefined();
    expect(ServeEvent.insertMany).toHaveBeenCalled();
  });
});

describe('serveLedger.hardExcluded (24h global window)', () => {
  it('reads the hot window from Redis when the key exists', async () => {
    const redis = fakeRedis();
    redis.zrangebyscore.mockResolvedValue(['at:a|s1', 'at:a|s2']);
    getRedis.mockReturnValue(redis);

    const excluded = await ledger.hardExcluded('u1', NOW);

    expect(excluded).toEqual(new Set(['at:a|s1', 'at:a|s2']));
    expect(redis.zrangebyscore).toHaveBeenCalledWith('ledger:u1:served', NOW - 24 * HOUR, '+inf');
    expect(ServeEvent.find).not.toHaveBeenCalled();
  });

  it('lazily rebuilds the hot window from Mongo when the key is missing', async () => {
    const redis = fakeRedis();
    redis.exists.mockResolvedValue(0);
    redis.zrangebyscore.mockResolvedValue(['at:a|s1']);
    getRedis.mockReturnValue(redis);
    mockMongoFind([{ canonicalKey: 'at:a|s1', servedAt: new Date(NOW - HOUR) }]);

    const excluded = await ledger.hardExcluded('u1', NOW);

    expect(ServeEvent.find).toHaveBeenCalled();
    expect(redis.zadd).toHaveBeenCalled(); // repopulated
    expect(excluded.has('at:a|s1')).toBe(true);
  });

  it('degrades to Mongo when Redis is unavailable', async () => {
    mockMongoFind([{ canonicalKey: 'at:a|s1', servedAt: new Date(NOW - 2 * HOUR) }]);

    const excluded = await ledger.hardExcluded('u1', NOW);

    expect(excluded.has('at:a|s1')).toBe(true);
  });
});

describe('serveLedger.moodExcluded (72h per-mood window)', () => {
  it('queries the mood-scoped hot window with the longer horizon', async () => {
    const redis = fakeRedis();
    redis.zrangebyscore.mockResolvedValue(['at:a|s1']);
    getRedis.mockReturnValue(redis);

    const excluded = await ledger.moodExcluded('u1', 'bio:peak:running', NOW);

    expect(redis.zrangebyscore).toHaveBeenCalledWith('ledger:u1:mood:bio:peak:running', NOW - 72 * HOUR, '+inf');
    expect(excluded.has('at:a|s1')).toBe(true);
  });
});

describe('serveLedger.getExposure', () => {
  it('groups durable history by canonicalKey for the decay scorer', async () => {
    mockMongoFind([
      { canonicalKey: 'at:a|s1', moodKey: 'focus',  servedAt: new Date(NOW - HOUR) },
      { canonicalKey: 'at:a|s1', moodKey: 'uplift', servedAt: new Date(NOW - 5 * HOUR) },
      { canonicalKey: 'at:a|s2', moodKey: 'calm',   servedAt: new Date(NOW - 2 * HOUR) },
    ]);

    const exposure = await ledger.getExposure('u1', ['at:a|s1', 'at:a|s2'], NOW);

    expect(exposure.get('at:a|s1')).toHaveLength(2);
    expect(exposure.get('at:a|s2')).toHaveLength(1);
    expect(exposure.get('at:a|s1')[0]).toEqual(expect.objectContaining({ moodKey: 'focus' }));
  });
});
