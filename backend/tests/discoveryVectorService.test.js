// backend/tests/discoveryVectorService.test.js
const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const { buildVector } = require('../app/services/vector/embedding');

// In-memory catalog stub matching trackCatalogRepo.getMany's contract.
// (mock-prefixed so Jest's hoisted mock factory may reference it.)
const mockCatalog = new Map();
jest.mock('../app/repositories/trackCatalogRepo', () => ({
  getMany: async (keys) => new Map(keys.filter(k => mockCatalog.has(k)).map(k => [k, mockCatalog.get(k)])),
}));
const svc = require('../app/services/discovery/discoveryVectorService');
const trackCatalogRepo = require('../app/repositories/trackCatalogRepo');

function seed(fake, recordingKey, canonicalKey, features, genres, meta) {
  fake.store.set(recordingKey, { vector: buildVector(features, genres), canonicalKey });
  mockCatalog.set(recordingKey, { recordingKey, canonicalKey, uri: meta.uri, title: meta.title, artist: meta.artist, genres });
}

describe('DiscoveryVectorService.find', () => {
  let fake;
  beforeEach(() => { fake = fakeVectorIndex(); vectorIndex.use(fake); mockCatalog.clear(); });
  afterEach(() => vectorIndex.use(null));

  it('returns nearest, hydrated, non-familiar candidates', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90, energy: 0.2, valence: 0.3 }, ['ambient'], { uri: 'spotify:track:1', title: 'Near', artist: 'A' });
    seed(fake, 'r2', 'c2', { bpm: 175, energy: 0.95, valence: 0.9 }, ['metal'], { uri: 'spotify:track:2', title: 'Far', artist: 'B' });
    const out = await svc.find({ targetFeatures: { bpm: 92, energy: 0.25, valence: 0.35 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out[0]).toMatchObject({ uri: 'spotify:track:1', title: 'Near', isDiscovery: true });
    expect(out.map(t => t.canonicalKey)).not.toContain(undefined);
  });

  it('excludes tracks already in the user library (by canonicalKey)', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90, energy: 0.2 }, ['ambient'], { uri: 'spotify:track:1', title: 'Owned', artist: 'A' });
    const out = await svc.find({ targetFeatures: { bpm: 90, energy: 0.2 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(['c1']), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]);
  });

  it('drops hits below the min-cosine threshold', async () => {
    seed(fake, 'r2', 'c2', { bpm: 175, energy: 0.95, valence: 0.9 }, ['metal'], { uri: 'spotify:track:2', title: 'Far', artist: 'B' });
    const out = await svc.find({ targetFeatures: { bpm: 90, energy: 0.1, valence: 0.1 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0.99, budgetMs: 500 });
    expect(out).toEqual([]);
  });

  it('drops a truly-unplayable hit (no uri AND no title/artist to translate)', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90 }, ['ambient'], { uri: null, title: null, artist: null });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]);
  });

  it('keeps a translatable no-URI candidate (YouTube-style: title+artist, uri null)', async () => {
    seed(fake, 'youtube:abc', 'c1', { bpm: 90, energy: 0.2, valence: 0.3 }, ['ambient'], { uri: null, title: 'YT Song', artist: 'A' });
    const out = await svc.find({ targetFeatures: { bpm: 92, energy: 0.25, valence: 0.35 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'YT Song', isDiscovery: true });
    expect(out[0].uri).toBeNull(); // not yet resolved — translation happens downstream at serve time
  });

  it('drops a half-translatable no-URI candidate (title without artist, or artist without title)', async () => {
    seed(fake, 'youtube:t1', 'c1', { bpm: 90 }, ['ambient'], { uri: null, title: 'Title only', artist: null });
    seed(fake, 'youtube:t2', 'c2', { bpm: 90 }, ['ambient'], { uri: null, title: null, artist: 'Artist only' });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]); // neither is translatable (needs BOTH title and artist), and neither has a uri
  });

  it('never throws — a queryNear failure yields []', async () => {
    vectorIndex.use({ queryNear: async () => { throw new Error('atlas down'); } });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, seedGenres: [], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]);
  });

  it('never throws — a null opts argument yields []', async () => {
    await expect(svc.find(null)).resolves.toEqual([]);
  });

  it('never throws — a hydration (getMany) rejection yields []', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90, energy: 0.2 }, ['ambient'], { uri: 'spotify:track:1', title: 'Near', artist: 'A' });
    const spy = jest.spyOn(trackCatalogRepo, 'getMany').mockRejectedValueOnce(new Error('mongo down'));
    const out = await svc.find({ targetFeatures: { bpm: 90, energy: 0.2 }, seedGenres: ['ambient'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toEqual([]);
    spy.mockRestore();
  });
});
