'use strict';

// Shadow audit — Phase 5, FULL-SYSTEM. Attacks the final track selection:
// impossible targets, blacklist bypass chaos, telemetry/latency coherence,
// and a closed-loop zero-repeat simulation over the REAL ledger.

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/models/ServeEvent', () => {
  const rows = [];
  return {
    __rows: rows,
    insertMany: jest.fn(async (docs) => { docs.forEach(d => rows.push(d)); return docs; }),
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
jest.mock('../app/services/vector/vectorIndex', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn().mockResolvedValue({ upserted: 0 }),
  queryNear: jest.fn().mockResolvedValue([]),
  use: jest.fn(),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn(),
  missingKeys: jest.fn(),
}));

const ServeEvent = require('../app/models/ServeEvent');
const { getRedis } = require('../app/config/redis');
const featureRepo = require('../app/repositories/audioFeatureRepo');
const ledger = require('../app/services/ledger/serveLedger');
const { selectPlaylist } = require('../app/services/selection/pipeline');

const lib = (id, { artist = `Artist${id}`, genres = ['pop'], affinity = 5 } = {}) =>
  ({ id, provider: 'spotify', name: `Song ${id}`, artist, genres, affinity, uri: `spotify:track:${id}` });

const PROFILE = (n = 60) => ({
  library: Array.from({ length: n }, (_, i) => lib(`t${i}`, { affinity: n - i })),
  lastAnalyzed: new Date('2026-07-01'),
});

const NOW = Date.parse('2026-07-02T12:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  getRedis.mockReturnValue(null);
  ServeEvent.__rows.length = 0;
  featureRepo.getMany.mockResolvedValue(new Map());
});

describe('ATTACK 1 — the Impossible Target Test', () => {
  it('contradictory targets (bpm 260 + ceiling 0.2 + heavy acoustic) still fill the playlist via the ladder', async () => {
    // Every track carries features that violate the ceiling → L0 starves.
    featureRepo.getMany.mockResolvedValue(new Map(
      Array.from({ length: 60 }, (_, i) => [`spotify:t${i}`, { bpm: 120 + i, energy: 0.5 + (i % 5) * 0.1, valence: 0.5 }])
    ));

    const { tracks, telemetry } = await selectPlaylist({
      userId: 'u1',
      musicProfile: PROFILE(),
      moodKey: 'calm',
      provider: 'spotify',
      aiParams: { exclude_genres: [] },
      targets: { bpmCenter: 260, bpmWidth: 4, energyFloor: 0, energyCeiling: 0.2, valenceTarget: 0, acousticnessBias: 0.4, confidence: 1 },
      k: 20,
      now: NOW,
    });

    expect(tracks.length).toBe(20);                       // never "no tracks found"
    expect(telemetry.relaxLevel).toBeGreaterThanOrEqual(1); // the ceiling was dropped, recorded honestly
  });

  it('an empty pool returns an empty result — an exception never escapes', async () => {
    const out = await selectPlaylist({
      userId: 'u1',
      musicProfile: { library: [], lastAnalyzed: new Date() },
      moodKey: 'calm',
      targets: { bpmCenter: 260, energyCeiling: 0.1, confidence: 1 },
      k: 20,
      now: NOW,
    });

    expect(out.tracks).toEqual([]);
    expect(out.telemetry.poolSize).toBe(0);
  });

  it('NaN-poisoned targets degrade to neutral scoring, never NaN totals', async () => {
    const { tracks } = await selectPlaylist({
      userId: 'u1',
      musicProfile: PROFILE(10),
      moodKey: 'calm',
      targets: { bpmCenter: NaN, bpmWidth: 'wide', energyCeiling: Infinity, valenceTarget: {}, confidence: NaN },
      k: 5,
      now: NOW,
    });

    expect(tracks).toHaveLength(5);
  });
});

describe('ATTACK 2 — filter bypass chaos (the blacklist must be impenetrable)', () => {
  it('a forged canonicalKey on a candidate cannot dodge the ledger — keys are recomputed at the pool', async () => {
    // 'Song t0' was served; attacker crafts the same song with a fake key.
    await ledger.recordServes({ userId: 'u1', entries: [{ canonicalKey: 'at:artistt0|song t0', moodKey: 'calm' }] }, NOW - 3600_000);

    const { tracks } = await selectPlaylist({
      userId: 'u1',
      musicProfile: { library: [], lastAnalyzed: new Date() },
      moodKey: 'calm',
      discoveryTracks: [{ ...lib('t0'), canonicalKey: 'at:totally|forged' }],
      targets: {},
      k: 10,
      now: NOW,
    });

    expect(tracks.find(t => t.id === 't0')).toBeUndefined();
  });

  it('a blacklisted song smuggled in from ANOTHER provider is still caught (cross-provider identity)', async () => {
    await ledger.recordServes({ userId: 'u1', entries: [{ canonicalKey: 'at:artistt0|song t0', moodKey: 'calm' }] }, NOW - 3600_000);

    const { tracks } = await selectPlaylist({
      userId: 'u1',
      musicProfile: { library: [], lastAnalyzed: new Date() },
      moodKey: 'calm',
      discoveryTracks: [{ id: 'ytXYZ', provider: 'youtube_music', title: 'Artistt0 - Song t0 (Official Video)', artist: 'Artistt0VEVO' }],
      provider: null,
      targets: {},
      k: 10,
      now: NOW,
    });

    expect(tracks.find(t => t.id === 'ytXYZ')).toBeUndefined();
  });

  it('a tampered Redis pool cache cannot smuggle forged keys past the ledger', async () => {
    // Poisoned cache: the partition claims a forged canonicalKey for a served song.
    getRedis.mockReturnValue({
      get: jest.fn().mockResolvedValue(JSON.stringify({
        builtFrom: new Date('2026-07-01').getTime(),
        tracks: [{ ...lib('t0'), canonicalKey: 'at:forged|key' }],
      })),
      set: jest.fn().mockResolvedValue('OK'),
      exists: jest.fn().mockResolvedValue(0),
      zadd: jest.fn(), zremrangebyscore: jest.fn(), zrangebyscore: jest.fn().mockResolvedValue([]), expire: jest.fn(),
    });
    await ledger.recordServes({ userId: 'u1', entries: [{ canonicalKey: 'at:artistt0|song t0', moodKey: 'calm' }] }, NOW - 3600_000);

    const { tracks } = await selectPlaylist({
      userId: 'u1',
      musicProfile: { library: [], lastAnalyzed: new Date('2026-07-01') },
      moodKey: 'calm',
      targets: {},
      k: 10,
      now: NOW,
    });

    expect(tracks.find(t => t.id === 't0')).toBeUndefined();
  });

  it('holds the global window through every legal relaxation, replaying the library ONLY as a last resort', async () => {
    const profile = PROFILE(10);
    await ledger.recordServes({
      userId: 'u1',
      entries: profile.library.map(t => ({ canonicalKey: `at:artist${t.id}|song ${t.id}`, moodKey: 'calm' })),
    }, NOW - 3600_000);

    const { tracks, telemetry } = await selectPlaylist({
      userId: 'u1', musicProfile: profile, moodKey: 'calm', targets: {}, k: 10, now: NOW,
    });

    // L0–L3 refuse repeats (the window never yields to input manipulation); the L4 last
    // resort replays the listener's OWN library rather than serve an empty playlist.
    expect(tracks.length).toBeGreaterThan(0);
    expect(telemetry.relaxLevel).toBe(4);
  });
});

describe('ATTACK 3 — telemetry & latency coherence + closed loop', () => {
  it('the full pipeline over a 500-track pool stays fast (<300ms, zero LLM)', async () => {
    const started = Date.now();
    const { tracks, telemetry } = await selectPlaylist({
      userId: 'u1', musicProfile: PROFILE(500), moodKey: 'uplift', targets: {}, k: 50, now: NOW,
    });

    expect(tracks).toHaveLength(50);
    expect(Date.now() - started).toBeLessThan(300);
    expect(telemetry.stageMs.total).toBeGreaterThanOrEqual(0);
    for (const stage of ['pool', 'context', 'filters', 'score', 'mmr']) {
      expect(telemetry.stageMs.total).toBeGreaterThanOrEqual(telemetry.stageMs[stage] ?? 0);
    }
  });

  it('CLOSED LOOP: three consecutive v2 generations through the real ledger repeat nothing', async () => {
    const profile = PROFILE(200);
    const everServed = new Set();

    for (let g = 0; g < 3; g++) {
      const now = NOW + g * 60_000;
      const { tracks } = await selectPlaylist({
        userId: 'u1', musicProfile: profile, moodKey: ['calm', 'uplift', 'intense'][g], targets: {}, k: 40, now,
      });

      for (const track of tracks) {
        expect(everServed.has(track.canonicalKey)).toBe(false);
        everServed.add(track.canonicalKey);
      }
      await ledger.recordServes({
        userId: 'u1',
        entries: tracks.map(t => ({ canonicalKey: t.canonicalKey, moodKey: ['calm', 'uplift', 'intense'][g] })),
      }, now);
    }

    expect(everServed.size).toBe(120); // 3 × 40, all unique — the engine polices itself
  });
});
