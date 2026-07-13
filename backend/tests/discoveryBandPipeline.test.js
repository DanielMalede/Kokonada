// backend/tests/discoveryBandPipeline.test.js
// M2 (resilience audit) — a GENUINE end-to-end guard, not a self-referential re-check.
// Band-aware discovery survivors, fed as discoveryTracks into the REAL selection pipeline,
// must ALL survive the pipeline's un-relaxable filterBand: proof that discovery and the
// pipeline judge the band on the SAME feature projection (the invariant M1's shared
// featuresOf protects). Runs the REAL discoveryVectorService.find + selectPlaylist and the
// REAL withinBand/filterBand/featuresOf (NONE mocked) so a future divergence between the
// discovery and pipeline projection FAILS here.
'use strict';

process.env.NODE_ENV = 'test';

const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const { buildVector } = require('../app/services/vector/embedding');

// Stateful in-memory fakes with REAL getMany behavior, SHARED by discovery + the pipeline
// (both require the same modules) so a feature seeded once is read identically by each stage.
const mockCatalog = new Map();
const mockFeatures = new Map();
jest.mock('../app/config/redis', () => ({ getRedis: () => null, createConnection: jest.fn() }));
jest.mock('../app/services/ledger/serveLedger', () => ({
  recordServes: jest.fn(),
  hardExcluded: jest.fn().mockResolvedValue(new Set()),
  moodExcluded: jest.fn().mockResolvedValue(new Set()),
  getExposure: jest.fn().mockResolvedValue(new Map()),
}));
jest.mock('../app/repositories/trackCatalogRepo', () => ({
  getMany: jest.fn(async (keys) => new Map(keys.filter(k => mockCatalog.has(k)).map(k => [k, mockCatalog.get(k)]))),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn(async (keys) => new Map(keys.filter(k => mockFeatures.has(k)).map(k => [k, mockFeatures.get(k)]))),
  upsertMany: jest.fn(), missingKeys: jest.fn(),
}));

const svc = require('../app/services/discovery/discoveryVectorService');
const { selectPlaylist } = require('../app/services/selection/pipeline');

// Seed a discovery candidate: an embedding vector, a catalog row, and a REAL AudioFeature doc.
function seedCandidate(fake, rk, ck, vec, genres, feat) {
  fake.store.set(rk, { vector: buildVector(vec, genres), canonicalKey: ck });
  mockCatalog.set(rk, { recordingKey: rk, canonicalKey: ck, uri: `spotify:track:${rk}`, title: rk, artist: 'A', genres });
  mockFeatures.set(rk, { recordingKey: rk, ...feat });
}

describe('band-aware discovery survivors survive the REAL selection pipeline (M2 e2e)', () => {
  let fake;
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8, confidence: 1 };
  beforeEach(() => {
    fake = fakeVectorIndex(); vectorIndex.use(fake);
    mockCatalog.clear(); mockFeatures.clear();
    process.env.DISCOVERY_BAND_AWARE = 'true';
  });
  afterEach(() => { vectorIndex.use(null); delete process.env.DISCOVERY_BAND_AWARE; });

  it('every discovery survivor passes the pipeline filterBand; the out-of-band candidate never appears', async () => {
    // One clearly IN-band (bpm 120) + one clearly OUT-of-band (bpm 200) discovery candidate.
    seedCandidate(fake, 'inband',  'c1', { bpm: 120, energy: 0.5 }, ['rock'], { bpm: 120, energy: 0.5 });
    seedCandidate(fake, 'offband', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], { bpm: 200, energy: 0.5 });

    // 1) REAL band-aware discovery drops the off-band candidate up front.
    const survivors = await svc.find({
      targetFeatures: { bpm: 120, energy: 0.5 }, seedGenres: ['rock'],
      excludeCanonicalKeys: new Set(), targets, k: 5, minCosine: 0, budgetMs: 500,
    });
    const survivorKeys = survivors.map(t => t.recordingKey);
    expect(survivorKeys).toContain('inband');
    expect(survivorKeys).not.toContain('offband'); // discovery already band-filtered it out

    // A FEATURELESS library anchor keeps the pipeline's filterBand non-empty, so a wrongly
    // dropped discovery survivor can NOT be masked by the literal-zero band-widen fallback
    // (which would otherwise re-admit the whole pool and hide the divergence).
    const musicProfile = {
      library: [{ id: 'anchor', provider: 'spotify', name: 'Anchor Song', artist: 'Anchor Artist', genres: ['rock'], affinity: 10, uri: 'spotify:track:anchor' }],
      lastAnalyzed: new Date('2026-07-01'),
    };

    // 2) Feed the survivors into the REAL pipeline with the SAME targets. provider:null so the
    //    ONLY gate that can drop a survivor is the band — isolating the invariant under test.
    const { tracks, telemetry } = await selectPlaylist({
      userId: 'u-m2', musicProfile, moodKey: null, provider: null,
      aiParams: {}, targets, discoveryTracks: survivors, k: 10, crossPlatform: false,
    });
    const outKeys = tracks.map(t => t.recordingKey);

    expect(telemetry.bandWidened).toBe(0);                         // anchor kept the band non-empty
    for (const key of survivorKeys) expect(outKeys).toContain(key); // none dropped by filterBand
    expect(outKeys).toContain('inband');
    expect(outKeys).not.toContain('offband');                       // gone through the whole pipeline
  });
});
