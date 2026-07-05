'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn(),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure: jest.fn().mockResolvedValue(new Map()),
}));
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

const ledger = require('../app/services/ledger/serveLedger');
const featureRepo = require('../app/repositories/audioFeatureRepo');
const { selectPlaylist } = require('../app/services/selection/pipeline');

const lib = (id, { artist = `Artist${id}`, genres = ['pop'], affinity = 5 } = {}) =>
  ({ id, provider: 'spotify', name: `Song ${id}`, artist, genres, affinity, uri: `spotify:track:${id}` });

const PROFILE = {
  library: Array.from({ length: 30 }, (_, i) => lib(`t${i}`, { affinity: 30 - i })),
  lastAnalyzed: new Date('2026-07-01'),
};

const BASE = {
  userId: 'u1',
  musicProfile: PROFILE,
  moodKey: 'uplift',
  provider: 'spotify',
  aiParams: { exclude_genres: [], allow_genres: ['pop'] },
  targets: { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8, valenceTarget: 0.6, confidence: 1 },
  k: 10,
};

beforeEach(() => {
  jest.clearAllMocks();
  ledger.hardExcluded.mockResolvedValue(new Set());
  ledger.moodExcluded.mockResolvedValue(new Set());
  ledger.getExposure.mockResolvedValue(new Map());
  featureRepo.getMany.mockResolvedValue(new Map());
  delete process.env.SELECTION_SHADOW;
});

describe('pipeline.selectPlaylist', () => {
  it('assembles pool → exclusions → features → score → MMR and returns k tracks + telemetry', async () => {
    const { tracks, telemetry } = await selectPlaylist(BASE);

    expect(tracks).toHaveLength(10);
    expect(ledger.hardExcluded).toHaveBeenCalledWith('u1', expect.anything());
    expect(ledger.moodExcluded).toHaveBeenCalledWith('u1', 'uplift', expect.anything());
    expect(featureRepo.getMany).toHaveBeenCalled();
    expect(ledger.getExposure).toHaveBeenCalled();
    expect(telemetry).toEqual(expect.objectContaining({
      poolSize: expect.any(Number),
      afterFilters: expect.any(Number),
      relaxLevel: 0,
      stageMs: expect.objectContaining({ total: expect.any(Number) }),
    }));
  });

  it('attaches stored features to candidates so the scorer can use them', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([
      ['spotify:t0', { bpm: 121, energy: 0.55, valence: 0.62 }],
    ]));

    const { tracks } = await selectPlaylist({ ...BASE, k: 30 });

    expect(tracks[0].id).toBe('t0'); // near-perfect feature match + top affinity leads
  });

  it('reports how many pool tracks resolved features in telemetry', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([
      ['spotify:t0', { bpm: 120, energy: 0.6, valence: 0.5 }],
    ]));
    const { telemetry } = await selectPlaylist(BASE);
    expect(telemetry.featured).toBe(1); // exactly one library track (t0) got features
  });

  it('relaxes the mood window before the global window; the global window drops ONLY as a last resort', async () => {
    const allKeys = PROFILE.library.map(t => `at:artist${t.id}|song ${t.id}`);
    ledger.moodExcluded.mockResolvedValue(new Set(allKeys));

    const relaxed = await selectPlaylist(BASE);
    expect(relaxed.tracks.length).toBeGreaterThan(0);
    expect(relaxed.telemetry.relaxLevel).toBeGreaterThanOrEqual(1);
    expect(relaxed.telemetry.relaxLevel).toBeLessThan(4); // mood relaxes before the last resort

    // Whole pool inside the global serve window: rather than serve EMPTY, the L4 last-resort
    // level drops the global window and serves repeats — a repeat beats a "try again" error.
    ledger.moodExcluded.mockResolvedValue(new Set());
    ledger.hardExcluded.mockResolvedValue(new Set(allKeys));
    const lastResort = await selectPlaylist(BASE);
    expect(lastResort.tracks.length).toBeGreaterThan(0);   // never empty when the pool isn't
    expect(lastResort.telemetry.relaxLevel).toBe(4);       // only the last resort could recover it
  });

  it('never returns an empty playlist when the library is non-empty (never-empty invariant)', async () => {
    // Every candidate served within the global window — the exact heavily-tested-account case.
    const allKeys = PROFILE.library.map(t => `at:artist${t.id}|song ${t.id}`);
    ledger.hardExcluded.mockResolvedValue(new Set(allKeys));

    const { tracks, telemetry } = await selectPlaylist(BASE);
    expect(tracks.length).toBeGreaterThan(0);
    expect(telemetry.relaxLevel).toBe(4);
  });

  it('a total ledger outage degrades to empty exclusion sets and flags the telemetry', async () => {
    ledger.hardExcluded.mockRejectedValue(new Error('redis+mongo down'));
    ledger.moodExcluded.mockRejectedValue(new Error('redis+mongo down'));

    const { tracks, telemetry } = await selectPlaylist(BASE);

    expect(tracks.length).toBeGreaterThan(0);
    expect(telemetry.degraded).toBe(true);
  });

  it('ignoreExclusions lifts specified keys from the windows (fair shadow comparison)', async () => {
    const key = 'at:artistt0|song t0';
    ledger.hardExcluded.mockResolvedValue(new Set([key]));

    const withoutIgnore = await selectPlaylist({ ...BASE, k: 30 });
    expect(withoutIgnore.tracks.find(t => t.canonicalKey === key)).toBeUndefined();

    const withIgnore = await selectPlaylist({ ...BASE, k: 30, ignoreExclusions: new Set([key]) });
    expect(withIgnore.tracks.find(t => t.canonicalKey === key)).toBeDefined();
  });
});

describe('pipeline.selectPlaylist — cross-platform sink (Spotify translates familiar tracks)', () => {
  // A YouTube-built profile: familiar tracks are provider=youtube_music with no spotify: URI.
  const ytProfile = {
    library: Array.from({ length: 20 }, (_, i) => ({
      id: `y${i}`, provider: 'youtube_music', name: `YT ${i}`, artist: `A${i}`,
      genres: ['pop'], affinity: 20 - i, uri: null,
    })),
    lastAnalyzed: new Date('2026-07-01'),
  };

  it('WITHOUT crossPlatform: drops every familiar YouTube track for a Spotify sink (the empty-playlist bug)', async () => {
    const { tracks } = await selectPlaylist({ ...BASE, musicProfile: ytProfile });
    expect(tracks).toHaveLength(0); // the provider gate removes all non-Spotify tracks, even fully relaxed
  });

  it('WITH crossPlatform: keeps familiar YouTube tracks (they get translated to Spotify after selection)', async () => {
    const { tracks } = await selectPlaylist({ ...BASE, musicProfile: ytProfile, crossPlatform: true });
    expect(tracks.length).toBeGreaterThan(0);
    expect(tracks.every(t => t.provider === 'youtube_music')).toBe(true); // survive selection; translated downstream
  });
});

