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
const vectorIndex = require('../app/services/vector/vectorIndex');
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
  vectorIndex.getMany.mockResolvedValue(new Map());
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

  it('a feature-fed pool reorders for different biosonic targets (mood/HR differentiation)', async () => {
    // Two library tracks with clearly different tempo/energy; equal affinity so ONLY the
    // biosonic feature-fit can decide the order — this is the "same playlist" regression pin.
    const profile = { library: [
      lib('slow', { affinity: 5 }), lib('fast', { affinity: 5 }),
    ], lastAnalyzed: new Date('2026-07-01') };
    featureRepo.getMany.mockResolvedValue(new Map([
      ['spotify:slow', { bpm: 70,  energy: 0.2, valence: 0.5 }],
      ['spotify:fast', { bpm: 170, energy: 0.9, valence: 0.5 }],
    ]));
    const calm = await selectPlaylist({ ...BASE, musicProfile: profile, k: 1, targets: { bpmCenter: 70,  bpmWidth: 15, energyFloor: 0.1, energyCeiling: 0.3,  valenceTarget: 0.5, confidence: 1 } });
    const peak = await selectPlaylist({ ...BASE, musicProfile: profile, k: 1, targets: { bpmCenter: 170, bpmWidth: 15, energyFloor: 0.7, energyCeiling: 0.95, valenceTarget: 0.5, confidence: 1 } });
    expect(calm.tracks[0].id).toBe('slow');
    expect(peak.tracks[0].id).toBe('fast');
  });

  it('the biosonic band excludes off-mood tracks even when the ladder relaxes to L4', async () => {
    const all = PROFILE.library.map(t => `at:artist${t.id}|song ${t.id}`);
    ledger.hardExcluded.mockResolvedValue(new Set(all)); // saturate → force L4
    featureRepo.getMany.mockResolvedValue(new Map(
      PROFILE.library.map((t, i) => [`spotify:${t.id}`, { bpm: i < 15 ? 70 : 200, energy: i < 15 ? 0.2 : 0.95 }])
    ));
    const calm = await selectPlaylist({ ...BASE, k: 5, targets: { bpmCenter: 70, bpmWidth: 15, energyFloor: 0.1, energyCeiling: 0.3, valenceTarget: 0.5, confidence: 1 } });
    expect(calm.tracks.length).toBeGreaterThan(0);
    expect(calm.tracks.every(t => Number(t.id.slice(1)) < 15)).toBe(true); // only on-band (bpm~70) tracks
    expect(calm.telemetry.relaxLevel).toBe(4);
    expect(calm.telemetry.banded).toBeLessThan(calm.telemetry.poolSize);
  });

  it('widens the band (bandWidened=1) ONLY when no on-mood track exists — never serves empty', async () => {
    featureRepo.getMany.mockResolvedValue(new Map(
      PROFILE.library.map(t => [`spotify:${t.id}`, { bpm: 200, energy: 0.98 }])
    ));
    const calm = await selectPlaylist({ ...BASE, k: 5, targets: { bpmCenter: 60, bpmWidth: 8, energyFloor: 0.05, energyCeiling: 0.15, valenceTarget: 0.5, confidence: 1 } });
    expect(calm.telemetry.bandWidened).toBe(1);
    expect(calm.tracks.length).toBeGreaterThan(0);
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

  it('WITH crossPlatform: a YouTube-style discovery candidate (uri:null) survives selection', async () => {
    // A discovery candidate exactly as discoveryVectorService.find emits it: NO provider field,
    // id = recordingKey, no spotify URI (translated at serve time). It must not be provider-gated
    // out under crossPlatform.
    const disc = {
      id: 'youtube:disc1', recordingKey: 'youtube:disc1', canonicalKey: 'at:discoartist|discovery song',
      title: 'Discovery Song', artist: 'DiscoArtist', genres: ['pop'], uri: null, isDiscovery: true,
    };
    const { tracks } = await selectPlaylist({ ...BASE, musicProfile: ytProfile, crossPlatform: true, discoveryTracks: [disc], k: 50 });
    const found = tracks.find(t => t.isDiscovery);
    expect(found).toBeDefined();
    expect(found).toMatchObject({ title: 'Discovery Song', uri: null });
  });
});

