'use strict';

// J1 (BE-074, DT-8 T-b) — the real-Redis lane's own guards, and its smoke test.
//
// BullMQ does its work in Lua scripts that run INSIDE Redis, so no fake in this repo can show what a
// queue option really does. The lane runs against a real server, and every suite on it empties its
// database between tests — so the helper must make it impossible to aim that at anything but a
// disposable database on this machine. The URL checks run on every `npm test`; the smoke test runs
// only when REDIS_TEST_URL is set.

process.env.NODE_ENV = 'test';

const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const {
  TEST_DB, realRedisUrl, describeRealRedis, openTestRedis, flushTestDb, assertDisposable,
} = require('./helpers/realRedis');

describe('realRedisUrl — only a loopback host and database 15', () => {
  it('is null when REDIS_TEST_URL is not set (the lane is skipped, not failed)', () => {
    expect(realRedisUrl({})).toBeNull();
    expect(realRedisUrl({ REDIS_TEST_URL: '' })).toBeNull();
  });

  it.each([
    'redis://127.0.0.1:6390/15',
    'redis://localhost:6379/15',
    'redis://:secret@127.0.0.1:6390/15',
    'redis://[::1]:6390/15',
  ])('accepts %s', (url) => {
    expect(realRedisUrl({ REDIS_TEST_URL: url })).toBe(url);
  });

  it.each([
    ['another host', 'redis://redis.railway.internal:6379/15'],
    ['a public host', 'redis://203.0.113.7:6379/15'],
    ['a host that only starts like localhost', 'redis://localhost.example.com:6379/15'],
    ['database 0', 'redis://127.0.0.1:6390/0'],
    ['no database', 'redis://127.0.0.1:6390'],
    ['database 15 hidden in a query', 'redis://127.0.0.1:6390/0?db=15'],
    ['a query of any kind', 'redis://127.0.0.1:6390/15?db=0'],
    ['TLS', 'rediss://127.0.0.1:6390/15'],
    ['not a URL', 'not a url'],
  ])('refuses %s', (_why, url) => {
    expect(() => realRedisUrl({ REDIS_TEST_URL: url })).toThrow(/REDIS_TEST_URL/);
  });

  it('pins database 15', () => {
    expect(TEST_DB).toBe(15);
  });
});

describe('assertDisposable — checked again on the live client, before any flush', () => {
  it('refuses a client on another database or host', () => {
    expect(() => assertDisposable({ options: { host: '127.0.0.1', db: 0 } })).toThrow(/database 15/);
    expect(() => assertDisposable({ options: { host: '10.0.0.5', db: 15 } })).toThrow(/this machine/);
    expect(() => assertDisposable({ options: { host: 'localhost', db: 15 } })).not.toThrow();
  });
});

// J1 round 1 (resilience F9): a full-suite paste can look green with every lane suite skipped. The
// evidence run sets REQUIRE_REAL_REDIS=1, and then a lane that would skip fails instead.
describe('describeRealRedis — an evidence run fails rather than skips', () => {
  const saved = { url: process.env.REDIS_TEST_URL, required: process.env.REQUIRE_REAL_REDIS };
  afterEach(() => {
    if (saved.url === undefined) delete process.env.REDIS_TEST_URL; else process.env.REDIS_TEST_URL = saved.url;
    if (saved.required === undefined) delete process.env.REQUIRE_REAL_REDIS; else process.env.REQUIRE_REAL_REDIS = saved.required;
  });

  it('throws when REQUIRE_REAL_REDIS=1 and REDIS_TEST_URL is not set', () => {
    delete process.env.REDIS_TEST_URL;
    process.env.REQUIRE_REAL_REDIS = '1';
    expect(() => describeRealRedis('an evidence run', () => {})).toThrow('REQUIRE_REAL_REDIS=1 but REDIS_TEST_URL is not set');
  });
});

describeRealRedis('the real Redis lane (smoke)', (url) => {
  let redis;
  beforeAll(async () => { redis = await openTestRedis(url); });
  beforeEach(() => flushTestDb(redis));
  afterAll(() => redis?.disconnect());

  it('a job added through real BullMQ is stored as bull:<queue>:<id> in database 15', async () => {
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    const queue = new Queue('j1-smoke', { connection });
    try {
      const job = await queue.add('j1-smoke', { n: 1 });

      expect(await redis.exists(`bull:j1-smoke:${job.id}`)).toBe(1);
      expect(await redis.lrange('bull:j1-smoke:wait', 0, -1)).toEqual([job.id]);
    } finally {
      await queue.close();
      connection.disconnect();
    }
  });

  it('the flush between tests leaves database 15 empty', async () => {
    expect(await redis.dbsize()).toBe(0);
  });
});
