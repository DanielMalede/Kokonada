'use strict';

// Shadow audit — Phase 6 (THE FLIP), FULL-SYSTEM. Attacks the cutover itself:
// mid-flight flag flips under load, the purge (dangling references), and the
// live latency budget now that v2 is the serving engine.

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');

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
jest.mock('../app/models/MedicalProfile', () => ({ findOne: jest.fn().mockResolvedValue(null) }));

const ServeEvent = require('../app/models/ServeEvent');
const ledger = require('../app/services/ledger/serveLedger');
const orchestrator = require('../app/services/generation/orchestrator');

// Realistic library entries: Phase 1 attaches canonicalKey at profile build, so
// production pools receive pre-keyed tracks (the pool fills only missing keys).
const lib = (id, i) => ({
  id, provider: 'spotify', name: `Song ${id}`, artist: `Artist${id}`,
  genres: ['pop'], affinity: 300 - i, uri: `spotify:track:${id}`,
  canonicalKey: `at:artist${id.toLowerCase()}|song ${id.toLowerCase()}`,
});
const profileFor = (u, n = 300) => ({
  library: Array.from({ length: n }, (_, i) => lib(`${u}-t${i}`, i)),
  lastAnalyzed: new Date('2026-07-01'),
});
const NOW = Date.parse('2026-07-02T12:00:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  ServeEvent.__rows.length = 0;
  delete process.env.SELECTION_V2;
});

describe('ATTACK 1 — cutover sealed (the flag is gone, v2 is unconditional)', () => {
  it('the rollback flag and legacy engine no longer exist', () => {
    expect(orchestrator.isV2).toBeUndefined();
    const mixer = require('../app/services/playlistMixer');
    expect(mixer.mixPlaylist).toBeUndefined();
    expect(Object.keys(mixer).sort()).toEqual(['generateFallbackPlaylist', 'personalizeWhitelist']);
  });

  it('10 interleaved generations (env noise included): zero drops, zero nulls', async () => {
    const results = [];
    for (let i = 0; i < 10; i++) {
      if (i === 3) process.env.SELECTION_V2 = 'false'; // a stale env var must change NOTHING
      if (i === 6) delete process.env.SELECTION_V2;
      results.push(await orchestrator.generateV2({
        userId: `u${i % 3}`, musicProfile: profileFor(`u${i % 3}`, 60),
        moodKey: 'uplift', live: { heartRate: 90 + i, activity: 'walking' }, now: NOW + i * 1000,
      }));
    }

    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(Array.isArray(r.merged)).toBe(true);
      expect(r.merged.length).toBeGreaterThan(0);
    }
  });

  it('concurrent v2 generations for different users do not cross-contaminate exclusions', async () => {
    // u1 already heard their first 20 tracks; u2 heard nothing.
    await ledger.recordServes({
      userId: 'u1',
      entries: Array.from({ length: 20 }, (_, i) => ({ canonicalKey: `at:artistu1-t${i}|song u1-t${i}`, moodKey: 'uplift' })),
    }, NOW - 3600_000);

    const [g1, g2] = await Promise.all([
      orchestrator.generateV2({ userId: 'u1', musicProfile: profileFor('u1', 60), moodKey: 'uplift', now: NOW }),
      orchestrator.generateV2({ userId: 'u2', musicProfile: profileFor('u2', 60), moodKey: 'uplift', now: NOW }),
    ]);

    const g1Keys = new Set(g1.merged.map(t => t.canonicalKey));
    for (let i = 0; i < 20; i++) {
      expect(g1Keys.has(`at:artistu1-t${i}|song u1-t${i}`)).toBe(false); // u1's history blocks u1
    }
    expect(g2.merged.length).toBeGreaterThan(0); // u2 untouched by u1's ledger
  });
});

describe('ATTACK 2 — the purge audit (no dangling legacy remains)', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

  it('the handler carries zero references to the burned layers', () => {
    const src = read('app/sockets/biometricHandler.js');
    for (const dead of [
      'recentTrackCooldown', 'recentMoodCooldown', 'isRepeatMood', 'pickSortAxis',
      '_seededInt', 'STRICT_ANTIREPEAT', 'STRICT_REPEAT_WINDOW', 'STRICT_MOOD_BLACKLIST',
      'SORT_AXES', 'STRICT_ROTATION_RATIO', 'COOLDOWN_GENERATIONS', 'COOLDOWN_MAX_IDS',
      // Phase 7 shim deletion:
      'mixPlaylist', 'SELECTION_V2', 'selectionShadow', 'critiqueTrackVibe', 'VIBE_CRITIC', 'runCritic',
    ]) {
      expect(src.includes(dead)).toBe(false);
    }
  });

  it('SHIM DELETION: the legacy engine identifiers are banned from the entire app tree', () => {
    const banned = ['mixPlaylist', 'selectionShadow', 'critiqueTrackVibe', 'SELECTION_V2', '_tierRotated', '_varietyWindow'];
    const scan = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { scan(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const src = fs.readFileSync(full, 'utf8');
        for (const dead of banned) {
          if (src.includes(dead)) {
            throw new Error(`dangling legacy identifier "${dead}" in ${full}`);
          }
        }
      }
    };
    scan(path.join(__dirname, '..', 'app'));
  });

  it('no module anywhere imports the deleted handler exports', () => {
    const scan = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { scan(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const src = fs.readFileSync(full, 'utf8');
        expect(src.includes('isRepeatMood')).toBe(false);
        expect(src.includes('recentMoodCooldown')).toBe(false);
        expect(src.includes('pickSortAxis')).toBe(false);
      }
    };
    scan(path.join(__dirname, '..', 'app'));
  });

  it('the orphaned per-mood PlaylistSession index is gone from the schema', () => {
    jest.isolateModules(() => {
      jest.dontMock('../app/models/PlaylistSession');
      const mongoose = require('mongoose');
      delete mongoose.models.PlaylistSession;
      const PlaylistSession = jest.requireActual('../app/models/PlaylistSession');
      const moodIdx = PlaylistSession.schema.indexes().find(([f]) => f.moodKey === 1);
      expect(moodIdx).toBeUndefined();
    });
  });

  it('the variation seed no longer reaches the LLM engine from the handler', () => {
    const src = read('app/sockets/biometricHandler.js');
    expect(src).not.toMatch(/seed:\s*seed|seed,\s*\n\s*\}\)/);
    expect(src).not.toMatch(/Math\.random\(\) \* 1e6/);
  });
});

describe('ATTACK 3 — final concurrency stress (the budget must hold LIVE)', () => {
  const gen = (u) => orchestrator.generateV2({
    userId: `stress-${u}`,
    musicProfile: profileFor(`stress-${u}`),
    moodKey: ['calm', 'uplift', 'intense'][u % 3],
    live: { heartRate: 70 + u, activity: 'walking' },
    now: NOW,
  });

  it('per-call latency: 5 back-to-back generations each under the 300ms budget', async () => {
    // Sequential = true per-call latency. Concurrent wall-clocks on one thread
    // include OTHER calls' CPU slices (queueing), which the burst test bounds.
    for (let u = 0; u < 5; u++) {
      const run = await gen(u);
      expect(run.merged).toHaveLength(50);
      expect(run.telemetry.stageMs.total).toBeLessThan(300);
    }
  }, 15000);

  it('pathological 20-user burst: zero failures, correct playlists, bounded throughput (queueing, not collapse)', async () => {
    const started = Date.now();
    const runs = await Promise.all(Array.from({ length: 20 }, (_, u) => gen(100 + u)));
    const wall = Date.now() - started;

    for (const run of runs) {
      expect(run.merged).toHaveLength(50);
      expect(run.telemetry.degraded).toBe(false);
    }
    // Single-threaded queueing under a burst: individual wall-clocks include the
    // other 19 calls' CPU slices, so the honest bound is aggregate throughput.
    expect(wall).toBeLessThan(2500); // ≥8 generations/second sustained
  }, 15000);
});
