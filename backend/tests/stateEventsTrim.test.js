'use strict';

// J2 (BE-084; Plan B T10, DT-3 T-a) — the daily trim of the state-recompute event log: every entry more than
// 24 hours old goes, measured by the REDIS SERVER's clock.
//
// A stream entry's id is `<ms>-<seq>`, stamped by the Redis server's own clock. So the cut is taken from
// Redis `TIME`, not the app's `Date.now()`: a skew between the two would move the bound. The trim is exact
// (`XTRIM … MINID <cut>`, no `~`), unlike the count bound BullMQ applies (`MAXLEN ~`).
//
// Faked: the Redis connection, by a STATEFUL stream store with Redis's semantics for the four commands the
// trim sends (TIME, XTRIM MINID exact, and the XADD/XRANGE the test itself uses), whose server clock is set
// three hours AHEAD of the app's, so a trim cut by the app's clock fails here. The same trim on a real
// Redis is stateEventsTrim.redis.test.js.

process.env.NODE_ENV = 'test';

const HOUR = 3600 * 1000;
const SKEW = 3 * HOUR; // the Redis server's clock runs this far ahead of the app's

jest.mock('../app/config/redis', () => {
  const streams = new Map();
  const state = { opened: 0, closed: 0, unreachable: false, commands: [] };
  const parse = (id) => { const [ms, seq = '0'] = String(id).split('-'); return [BigInt(ms), BigInt(seq)]; };
  const less = (a, b) => { const [am, as] = parse(a); const [bm, bs] = parse(b); return am < bm || (am === bm && as < bs); };
  const createConnection = jest.fn(() => {
    state.opened += 1;
    return {
      on: () => {},
      async connect() { if (state.unreachable) throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), { name: 'Error' }); },
      async time() {
        state.commands.push('time');
        const now = Date.now() + state.skew;
        return [String(Math.floor(now / 1000)), String((now % 1000) * 1000)];
      },
      async xtrim(key, strategy, threshold) {
        state.commands.push(['xtrim', key, strategy, String(threshold)]);
        if (strategy !== 'MINID') throw new Error('only MINID is modelled');
        const entries = streams.get(key) || [];
        const kept = entries.filter(([id]) => !less(id, threshold));
        streams.set(key, kept);
        return entries.length - kept.length;
      },
      disconnect() { state.closed += 1; },
    };
  });
  const xadd = (key, id) => {
    const entries = streams.get(key) || [];
    entries.push([id, ['event', 'added']]);
    entries.sort(([a], [b]) => (less(a, b) ? -1 : 1));
    streams.set(key, entries);
  };
  return { createConnection, getRedis: () => null, connectRedis: jest.fn(), __state: state, __streams: streams, __xadd: xadd };
});

const { __state: state, __streams: streams, __xadd: xadd, createConnection } = require('../app/config/redis');
const {
  trimStateEvents, STATE_EVENTS_KEY, STATE_EVENTS_MAX_AGE_MS,
} = require('../app/queues/stateVectorJob');

const KEY = 'bull:state-vector-recompute:events';
const serverNow = () => Date.now() + SKEW;
const ids = () => (streams.get(KEY) || []).map(([id]) => id);

beforeEach(() => {
  streams.clear();
  Object.assign(state, { opened: 0, closed: 0, unreachable: false, commands: [], skew: SKEW });
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
});
afterAll(() => { delete process.env.REDIS_URL; });

describe('the bound', () => {
  it('is the state-recompute log, and 24 hours', () => {
    expect(STATE_EVENTS_KEY).toBe(KEY);
    expect(STATE_EVENTS_MAX_AGE_MS).toBe(24 * HOUR);
  });
});

describe('trimStateEvents', () => {
  it('removes every entry more than 24 hours old by the server\'s clock, keeps the rest, and says how many went', async () => {
    const t = serverNow();
    const old = [`${t - 40 * HOUR}-0`, `${t - 25 * HOUR}-3`, `${t - 24 * HOUR - 5000}-0`];
    const young = [`${t - 24 * HOUR + 5000}-0`, `${t - HOUR}-1`, `${t}-0`];
    for (const id of [...old, ...young]) xadd(KEY, id);

    await expect(trimStateEvents()).resolves.toBe(3);

    expect(ids()).toEqual(young);
  });

  // By the app's clock these entries are 22 hours old and would stay; by the server's they are 25.
  it('cuts by Redis TIME, not the app\'s clock', async () => {
    const byServer25h = `${serverNow() - 25 * HOUR}-0`;
    xadd(KEY, byServer25h);

    await trimStateEvents();

    expect(ids()).toEqual([]);
    expect(state.commands[0]).toBe('time');
  });

  it('is exact: XTRIM MINID with no ~, on the state-recompute log only', async () => {
    await trimStateEvents();

    const trims = state.commands.filter((c) => Array.isArray(c));
    expect(trims).toHaveLength(1);
    expect(trims[0].slice(0, 3)).toEqual(['xtrim', KEY, 'MINID']);
    expect(trims[0]).not.toContain('~');
  });

  it('opens one connection that does not retry, and closes it', async () => {
    await trimStateEvents();

    expect(state.opened).toBe(1);
    expect(state.closed).toBe(1);
    expect(createConnection.mock.calls[0][0]).toEqual(expect.objectContaining({ retryStrategy: expect.any(Function), enableOfflineQueue: false }));
    expect(createConnection.mock.calls[0][0].retryStrategy()).toBeNull();
  });

  it('with no REDIS_URL nothing can have been queued: 0, and no connection is opened', async () => {
    delete process.env.REDIS_URL;

    await expect(trimStateEvents()).resolves.toBe(0);
    expect(state.opened).toBe(0);
  });

  it('a Redis that cannot be reached rejects (the daily job counts a failed step), and the connection is closed', async () => {
    state.unreachable = true;

    await expect(trimStateEvents()).rejects.toThrow();
    expect(state.closed).toBe(1);
  });
});
