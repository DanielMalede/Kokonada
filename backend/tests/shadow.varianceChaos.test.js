'use strict';

// Shadow audit — Phase 3, unrestricted. Stateful in-memory Redis/Mongo fakes
// (real ZSET semantics) so these are behavioral simulations of the actual
// ledger, not stub theater.

process.env.NODE_ENV = 'test';

jest.mock('../app/models/ServeEvent', () => {
  const rows = [];
  return {
    __rows: rows,
    insertMany: jest.fn(async (docs) => {
      // Mirror mongoose validation: canonicalKey is required.
      const invalid = docs.filter(d => !d.canonicalKey);
      docs.filter(d => d.canonicalKey).forEach(d => rows.push(d));
      if (invalid.length) throw new Error(`ServeEvent validation failed: canonicalKey required (${invalid.length} docs)`);
      return docs;
    }),
    find: jest.fn((query = {}) => ({
      lean: async () => rows.filter(r =>
        (!query.userId || String(r.userId) === String(query.userId)) &&
        (!query.moodKey || r.moodKey === query.moodKey) &&
        (!query.canonicalKey || query.canonicalKey.$in.includes(r.canonicalKey)) &&
        (!query.servedAt || new Date(r.servedAt).getTime() >= new Date(query.servedAt.$gte).getTime())
      ),
    })),
  };
});
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));

const ServeEvent = require('../app/models/ServeEvent');
const { getRedis } = require('../app/config/redis');
const ledger = require('../app/services/ledger/serveLedger');
const { exposurePenalty } = require('../app/services/ledger/exposureScore');

const NOW = Date.parse('2026-07-02T12:00:00Z');
const SEC = 1000;
const HOUR = 3600 * SEC;
const DAY = 24 * HOUR;

function statefulRedis() {
  const zsets = new Map();
  const z = (key) => { if (!zsets.has(key)) zsets.set(key, new Map()); return zsets.get(key); };
  return {
    zsets,
    zadd: jest.fn(async (key, score, member) => { z(key).set(member, Number(score)); return 1; }),
    zremrangebyscore: jest.fn(async (key, min, max) => {
      const set = zsets.get(key); if (!set) return 0;
      let removed = 0;
      for (const [member, score] of [...set]) {
        const geMin = min === '-inf' || score >= Number(min);
        const leMax = max === '+inf' || score <= Number(max);
        if (geMin && leMax) { set.delete(member); removed++; }
      }
      return removed;
    }),
    zrangebyscore: jest.fn(async (key, min, max) => {
      const set = zsets.get(key); if (!set) return [];
      return [...set]
        .filter(([, score]) => (min === '-inf' || score >= Number(min)) && (max === '+inf' || score <= Number(max)))
        .map(([member]) => member);
    }),
    exists: jest.fn(async (key) => (zsets.has(key) ? 1 : 0)),
    expire: jest.fn(async () => 1),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ServeEvent.__rows.length = 0;
  getRedis.mockReturnValue(null);
});

describe('ATTACK 1 — chaotic mood switching (5 moods in 60 seconds)', () => {
  it('zero repeated tracks slip through across rapid cross-mood generations', async () => {
    const redis = statefulRedis();
    getRedis.mockReturnValue(redis);
    const moods = ['focus', 'energize', 'calm', 'uplift', 'intense'];
    const pool = Array.from({ length: 400 }, (_, i) => `at:artist${i}|song${i}`);
    const everServed = new Set();

    for (let g = 0; g < 5; g++) {
      const t = NOW + g * 12 * SEC; // one generation every 12s
      const excluded = await ledger.hardExcluded('u1', t);
      const picks = pool.filter(k => !excluded.has(k)).slice(0, 50);

      for (const key of picks) {
        expect(everServed.has(key)).toBe(false); // the core variance guarantee
      }
      await ledger.recordServes(
        { userId: 'u1', entries: picks.map(k => ({ canonicalKey: k, moodKey: moods[g] })) },
        t
      );
      picks.forEach(k => everServed.add(k));
    }

    expect(everServed.size).toBe(250); // 5 × 50, all unique
  });

  it('near-simultaneous timestamps (same millisecond) still exclude correctly', async () => {
    const redis = statefulRedis();
    getRedis.mockReturnValue(redis);

    await ledger.recordServes({ userId: 'u1', entries: [{ canonicalKey: 'at:a|x', moodKey: 'focus' }] }, NOW);
    const excluded = await ledger.hardExcluded('u1', NOW); // zero elapsed time

    expect(excluded.has('at:a|x')).toBe(true);
  });
});

describe('ATTACK 2 — Redis memory bloat over simulated months', () => {
  it('the hot window stays bounded across 90 days of heavy listening (13,500 unique serves)', async () => {
    const redis = statefulRedis();
    getRedis.mockReturnValue(redis);
    let uid = 0;

    for (let day = 0; day < 90; day++) {
      for (let gen = 0; gen < 3; gen++) {
        const t = NOW + day * DAY + gen * 4 * HOUR;
        const entries = Array.from({ length: 50 }, () => ({
          canonicalKey: `at:artist${uid}|song${uid++}`,
          moodKey: ['focus', 'energize', 'calm'][gen],
        }));
        await ledger.recordServes({ userId: 'u1', entries }, t);
      }
    }

    // 8-day hot window × 3 gens/day × 50 tracks = 1200 members max.
    const cardinality = redis.zsets.get('ledger:u1:served').size;
    expect(cardinality).toBeLessThanOrEqual(1200);
    expect(cardinality).toBeGreaterThan(0);
  });
});

describe('ATTACK 3 — clock drift & offline sync', () => {
  it('client-supplied entry timestamps are IGNORED — the server clock owns the ledger', async () => {
    const redis = statefulRedis();
    getRedis.mockReturnValue(redis);

    await ledger.recordServes({
      userId: 'u1',
      entries: [{ canonicalKey: 'at:a|x', moodKey: 'focus', servedAt: new Date('3000-01-01') }],
    }, NOW);

    expect(ServeEvent.__rows[0].servedAt).toEqual(new Date(NOW));         // durable: server time
    expect(redis.zsets.get('ledger:u1:served').get('at:a|x')).toBe(NOW); // hot: server time
  });

  it('a future-dated serve (drifted sync) cannot explode the decay penalty', () => {
    const sane = exposurePenalty({
      serves: [{ moodKey: 'focus', servedAt: new Date(NOW - HOUR) }],
      targetMoodKey: 'focus', now: NOW,
    });
    const drifted = exposurePenalty({
      serves: [{ moodKey: 'focus', servedAt: new Date(NOW + 365 * DAY) }], // clock a year ahead
      targetMoodKey: 'focus', now: NOW,
    });

    expect(Number.isFinite(drifted)).toBe(true);
    expect(drifted).toBeLessThanOrEqual(sane * 1.05); // at most "just served", never amplified
  });

  it('a corrupt servedAt cannot poison the whole score with NaN', () => {
    const penalty = exposurePenalty({
      serves: [
        { moodKey: 'focus', servedAt: 'not-a-date' },
        { moodKey: 'focus', servedAt: new Date(NOW - HOUR) },
      ],
      targetMoodKey: 'focus', now: NOW,
    });

    expect(Number.isFinite(penalty)).toBe(true);
    expect(penalty).toBeGreaterThan(0); // the valid serve still counts
  });
});

describe('ATTACK 4 — holistic integration boundaries', () => {
  it('entries without a canonicalKey are skipped — never null ZSET members or rejected batches', async () => {
    const redis = statefulRedis();
    getRedis.mockReturnValue(redis);

    const result = await ledger.recordServes({
      userId: 'u1',
      entries: [
        { canonicalKey: null, moodKey: 'focus' },
        { canonicalKey: 'at:a|good', moodKey: 'focus' },
        { moodKey: 'focus' }, // no key at all
      ],
    }, NOW);

    expect(result.recorded).toBe(1);
    expect(ServeEvent.__rows).toHaveLength(1);
    expect(redis.zsets.get('ledger:u1:served').has('null')).toBe(false);
    expect(redis.zsets.get('ledger:u1:served').has('at:a|good')).toBe(true);
  });

  it('song-level ledger keys and recording-level feature keys coexist on the same track (F3 boundary)', () => {
    const { canonicalKey } = require('../app/services/identity/trackIdentity');
    const { recordingKeyOf } = require('../app/services/features/featureProvider');

    const studio = { provider: 'spotify', id: 'studio1', name: 'Song', artist: 'Artist' };
    const live   = { provider: 'spotify', id: 'live1', name: 'Song (Live)', artist: 'Artist' };

    // Ledger: the live rendition IS a repeat of the song → same canonicalKey.
    expect(canonicalKey(studio)).toBe(canonicalKey(live));
    // Feature store: they sound different → distinct recordingKeys.
    expect(recordingKeyOf(studio)).not.toBe(recordingKeyOf(live));
  });

  it('mood-window queries stay isolated per mood under interleaved writes', async () => {
    const redis = statefulRedis();
    getRedis.mockReturnValue(redis);

    await ledger.recordServes({ userId: 'u1', entries: [{ canonicalKey: 'at:a|f', moodKey: 'focus' }] }, NOW);
    await ledger.recordServes({ userId: 'u1', entries: [{ canonicalKey: 'at:a|b', moodKey: 'bio:peak:running' }] }, NOW + SEC);

    const focus = await ledger.moodExcluded('u1', 'focus', NOW + 2 * SEC);
    const bio   = await ledger.moodExcluded('u1', 'bio:peak:running', NOW + 2 * SEC);

    expect(focus.has('at:a|f')).toBe(true);
    expect(focus.has('at:a|b')).toBe(false);
    expect(bio.has('at:a|b')).toBe(true);
  });
});
