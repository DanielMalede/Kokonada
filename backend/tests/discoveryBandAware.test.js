// backend/tests/discoveryBandAware.test.js
// Band-aware discovery: candidates must survive the pipeline's un-relaxable biosonic
// band (withinBand) so they are not all dropped downstream (mixedDiscovery=0 in prod).
const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const { buildVector } = require('../app/services/vector/embedding');
const { withinBand } = require('../app/services/selection/biosonicBand');

// In-memory catalog + audio-feature stubs (mock-prefixed so Jest's hoisted factory
// may close over them). getMany is a jest.fn so call-counts (N+1 guard) are assertable.
const mockCatalog = new Map();
const mockFeatures = new Map();
jest.mock('../app/repositories/trackCatalogRepo', () => ({
  getMany: jest.fn(async (keys) => new Map(keys.filter(k => mockCatalog.has(k)).map(k => [k, mockCatalog.get(k)]))),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn(async (keys) => new Map(keys.filter(k => mockFeatures.has(k)).map(k => [k, mockFeatures.get(k)]))),
}));

const svc = require('../app/services/discovery/discoveryVectorService');
const trackCatalogRepo = require('../app/repositories/trackCatalogRepo');
const audioFeatureRepo = require('../app/repositories/audioFeatureRepo');

// Slim feature shape the SELECTION PIPELINE builds from an AudioFeature doc — the band
// post-filter must judge candidates on exactly this shape for cross-stage consistency.
const featuresOf = (doc) => (doc
  ? { bpm: doc.bpm, energy: doc.energy, valence: doc.valence, acousticness: doc.acousticness, danceability: doc.danceability }
  : null);

// Seed a corpus track: an embedding vector (genre+feature space), a catalog row, and
// OPTIONALLY an AudioFeature doc (omit → featureless: no doc in the repo).
function seed(fake, rk, ck, vec, genres, meta = {}, audioDoc) {
  fake.store.set(rk, { vector: buildVector(vec, genres), canonicalKey: ck });
  mockCatalog.set(rk, { recordingKey: rk, canonicalKey: ck, uri: meta.uri ?? `spotify:track:${rk}`, title: meta.title ?? rk, artist: meta.artist ?? 'A', genres });
  if (audioDoc !== undefined) mockFeatures.set(rk, { recordingKey: rk, ...audioDoc });
}

const BASE = { targetFeatures: { bpm: 120, energy: 0.5 }, seedGenres: ['rock'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 };

describe('DiscoveryVectorService.find — band-aware (DISCOVERY_BAND_AWARE on)', () => {
  let fake;
  beforeEach(() => {
    fake = fakeVectorIndex(); vectorIndex.use(fake);
    mockCatalog.clear(); mockFeatures.clear();
    trackCatalogRepo.getMany.mockClear(); audioFeatureRepo.getMany.mockClear();
    process.env.DISCOVERY_BAND_AWARE = 'true';
  });
  afterEach(() => { vectorIndex.use(null); delete process.env.DISCOVERY_BAND_AWARE; delete process.env.DISCOVERY_BAND_OVERFETCH; });

  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8, confidence: 1 };

  it('returns ONLY in-band candidates; an off-tempo track is dropped by the band', async () => {
    seed(fake, 'inband', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], { title: 'On' }, { bpm: 122, energy: 0.5 });
    seed(fake, 'offband', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], { title: 'Off' }, { bpm: 190, energy: 0.5 });

    const out = await svc.find({ ...BASE, targets });
    expect(out.map(t => t.recordingKey)).toEqual(['inband']);
  });

  it('activity-driven high-intensity: the ENERGY floor + acousticness ceiling filter (NOT bpm)', async () => {
    // BPM 160 is inside the WIDE activity window (162 ± 40) for every candidate — so any
    // drop here is driven by energy/texture, proving the FULL withinBand predicate runs.
    const high = { bpmCenter: 162, bpmWidth: 8, energyFloor: 0.4, energyCeiling: 0.9, confidence: 0.85, activityDriven: true, activityIntensity: 'high' };
    seed(fake, 'ok',       'c1', { bpm: 160, energy: 0.7 }, ['rock'], {}, { bpm: 160, energy: 0.7, acousticness: 0.1 });
    seed(fake, 'acoustic', 'c2', { bpm: 160, energy: 0.7 }, ['rock'], {}, { bpm: 160, energy: 0.7, acousticness: 0.85 }); // ceiling
    seed(fake, 'lowE',     'c3', { bpm: 160, energy: 0.7 }, ['rock'], {}, { bpm: 160, energy: 0.2, acousticness: 0.1 });  // energy floor

    const out = await svc.find({ ...BASE, targets: high });
    expect(out.map(t => t.recordingKey)).toEqual(['ok']);
  });

  it('consistency invariant: every returned candidate satisfies withinBand for the SAME targets', async () => {
    seed(fake, 'a', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 118, energy: 0.4 });
    seed(fake, 'b', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 125, energy: 0.7 });
    seed(fake, 'c', 'c3', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 200, energy: 0.95 }); // off-band

    const out = await svc.find({ ...BASE, targets });
    expect(out.length).toBeGreaterThan(0);
    for (const t of out) {
      expect(withinBand({ features: featuresOf(mockFeatures.get(t.recordingKey)) }, targets)).toBe(true);
    }
  });

  it('a featureless candidate (no AudioFeature doc) PASSES — consistent with withinBand', async () => {
    seed(fake, 'nofeat', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], { title: 'Unknown' }); // no audio doc
    const out = await svc.find({ ...BASE, targets });
    expect(out.map(t => t.recordingKey)).toEqual(['nofeat']);
  });

  it('starvation: a narrow band with ZERO in-band candidates returns [] (no throw, never widened)', async () => {
    seed(fake, 'off1', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 40,  energy: 0.5 });
    seed(fake, 'off2', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 220, energy: 0.5 });
    const narrow = { bpmCenter: 120, bpmWidth: 6, energyFloor: 0.45, energyCeiling: 0.55, confidence: 1 };
    await expect(svc.find({ ...BASE, targets: narrow })).resolves.toEqual([]);
  });

  it('starvation floor: with ≥1 in-band candidate present it is never dropped to zero', async () => {
    seed(fake, 'in',  'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 120, energy: 0.5 });
    seed(fake, 'out', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 220, energy: 0.5 });
    const out = await svc.find({ ...BASE, targets });
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.map(t => t.recordingKey)).toContain('in');
  });

  it('enhancement contract: an audioFeatureRepo.getMany rejection yields [] (never breaks generation)', async () => {
    seed(fake, 'inband', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 120, energy: 0.5 });
    audioFeatureRepo.getMany.mockRejectedValueOnce(new Error('mongo down'));
    await expect(svc.find({ ...BASE, targets })).resolves.toEqual([]);
  });

  it('no N+1: audioFeatureRepo.getMany once, trackCatalogRepo.getMany once (survivors only)', async () => {
    seed(fake, 'in',  'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 120, energy: 0.5 });
    seed(fake, 'out', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 220, energy: 0.5 });
    await svc.find({ ...BASE, targets });
    expect(audioFeatureRepo.getMany).toHaveBeenCalledTimes(1);
    expect(trackCatalogRepo.getMany).toHaveBeenCalledTimes(1);
    // Catalog hydration is SURVIVORS only — the off-band track is never a catalog read.
    expect(trackCatalogRepo.getMany.mock.calls[0][0]).toEqual(['in']);
  });

  it('over-fetch recall: an in-band track ranked below a naive-k cut still surfaces', async () => {
    // Five off-band tracks are inserted first (they tie/rank at/above the in-band one);
    // with k=2 a naive top-k cut could exclude the in-band track. The band over-fetch
    // pulls far beyond k, so after the band drops the off-band mass the in-band survives.
    for (let i = 0; i < 5; i++) seed(fake, `off${i}`, `co${i}`, { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 220, energy: 0.5 });
    seed(fake, 'deep', 'cd', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 120, energy: 0.5 });
    const out = await svc.find({ ...BASE, targets, k: 2 });
    expect(out.map(t => t.recordingKey)).toEqual(['deep']);
  });

  it('emits a [discovery] metric line carrying banded=<survivors>', async () => {
    seed(fake, 'in',  'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 120, energy: 0.5 });
    seed(fake, 'out', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 220, energy: 0.5 });
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await svc.find({ ...BASE, targets });
    const line = spy.mock.calls.flat().map(String).find(l => l.includes('[discovery]'));
    expect(line).toBeDefined();
    expect(line).toContain('banded=1');
    spy.mockRestore();
  });
});

describe('DiscoveryVectorService.find — guards (byte-identical to today when not band-aware)', () => {
  let fake;
  beforeEach(() => {
    fake = fakeVectorIndex(); vectorIndex.use(fake);
    mockCatalog.clear(); mockFeatures.clear();
    trackCatalogRepo.getMany.mockClear(); audioFeatureRepo.getMany.mockClear();
    delete process.env.DISCOVERY_BAND_AWARE;
  });
  afterEach(() => { vectorIndex.use(null); delete process.env.DISCOVERY_BAND_AWARE; });

  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8, confidence: 1 };

  it('flag OFF + targets present: no band filter, getMany(features) NEVER called, off-band track still returned', async () => {
    seed(fake, 'inband', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 122, energy: 0.5 });
    seed(fake, 'offband', 'c2', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 190, energy: 0.5 });
    const out = await svc.find({ ...BASE, targets });
    expect(audioFeatureRepo.getMany).not.toHaveBeenCalled();
    expect(out.map(t => t.recordingKey).sort()).toEqual(['inband', 'offband']);
  });

  it('flag ON but NO usable band (null targets): getMany(features) NEVER called', async () => {
    process.env.DISCOVERY_BAND_AWARE = 'true';
    seed(fake, 'r1', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 122, energy: 0.5 });
    const out = await svc.find({ ...BASE, targets: null });
    expect(audioFeatureRepo.getMany).not.toHaveBeenCalled();
    expect(out.map(t => t.recordingKey)).toEqual(['r1']);
  });

  it('flag ON but band has no gate-able fields ({}): getMany(features) NEVER called', async () => {
    process.env.DISCOVERY_BAND_AWARE = 'true';
    seed(fake, 'r1', 'c1', { bpm: 120, energy: 0.5 }, ['rock'], {}, { bpm: 122, energy: 0.5 });
    await svc.find({ ...BASE, targets: {} });
    expect(audioFeatureRepo.getMany).not.toHaveBeenCalled();
  });
});
