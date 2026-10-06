'use strict';

// J2 (BE-084; Plan B T10, DT-3 T-a) — the daily trim of the state-recompute event log, on a REAL Redis (the
// lane in tests/helpers/realRedis.js; XTRIM MINID needs Redis 6.2 or later).
//
// Entries are written with explicit ids backdated from the server's own TIME, as BullMQ's would have been
// stamped that long ago. Exactness is shown with more old entries than one stream node holds (100): an
// approximate trim (`~`) leaves part of a node behind, an exact one leaves none.

process.env.NODE_ENV = 'test';

const { describeRealRedis, openTestRedis, flushTestDb } = require('./helpers/realRedis');
const { trimStateEvents, STATE_EVENTS_KEY } = require('../app/queues/stateVectorJob');

jest.setTimeout(30000);

const HOUR = 3600 * 1000;

describeRealRedis('J2 T-a: the state-recompute event log loses every entry more than 24 hours old', (url) => {
  let redis;

  beforeAll(async () => {
    redis = await openTestRedis(url);
    process.env.REDIS_URL = url;
  });
  beforeEach(() => flushTestDb(redis));
  afterAll(() => {
    redis?.disconnect();
    delete process.env.REDIS_URL;
  });

  const serverNow = async () => {
    const [s, us] = await redis.time();
    return Number(s) * 1000 + Math.floor(Number(us) / 1000);
  };

  it('entries older than 24 hours by Redis TIME are gone, newer ones stay, and the count is exact', async () => {
    const t = await serverNow();
    for (let i = 0; i < 250; i += 1) await redis.xadd(STATE_EVENTS_KEY, `${t - 30 * HOUR + i}-0`, 'event', 'added', 'jobId', 'sv-old');
    await redis.xadd(STATE_EVENTS_KEY, `${t - 24 * HOUR - 5000}-0`, 'event', 'completed', 'jobId', 'sv-old');
    const young = [`${t - 24 * HOUR + 60_000}-0`, `${t - HOUR}-0`];
    for (const id of young) await redis.xadd(STATE_EVENTS_KEY, id, 'event', 'added', 'jobId', 'sv-young');

    await expect(trimStateEvents()).resolves.toBe(251);

    expect((await redis.xrange(STATE_EVENTS_KEY, '-', '+')).map(([id]) => id)).toEqual(young);
  });

  it('an empty or missing log trims nothing', async () => {
    await expect(trimStateEvents()).resolves.toBe(0);
  });
});
