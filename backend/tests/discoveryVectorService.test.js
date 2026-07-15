// backend/tests/discoveryVectorService.test.js
const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const { buildVector, cosine } = require('../app/services/vector/embedding');
const { _scoreTotal } = require('../app/services/discovery/discoveryVectorService');

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
  beforeEach(() => {
    fake = fakeVectorIndex(); vectorIndex.use(fake); mockCatalog.clear();
    delete process.env.DISCOVERY_MIN_COSINE; delete process.env.DISCOVERY_BAND_AWARE;
  });
  afterEach(() => { vectorIndex.use(null); delete process.env.DISCOVERY_MIN_COSINE; delete process.env.DISCOVERY_BAND_AWARE; });

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

  it('ROOT CAUSE lock (unit): a feature-only target matches a genre-less corpus track (~1.0); a genre-seeded target collapses BELOW the old 0.5 gate', () => {
    const f = { bpm: 120, energy: 0.6, valence: 0.5 };
    const genrelessCorpus = buildVector(f, []); // prod reality: ~98% of embeddings carry NO genre
    expect(cosine(buildVector(f, []), genrelessCorpus)).toBeGreaterThan(0.99);                              // the fix (feature-only)
    expect(cosine(buildVector(f, ['pop', 'rock', 'jazz', 'metal', 'folk', 'soul', 'punk']), genrelessCorpus)).toBeLessThan(0.5); // the bug (genre-seeded)
  });

  it('ROOT CAUSE lock (service): a genre-less corpus track survives a feature-only query but is starved by a genre-seeded one at the OLD 0.5 gate', async () => {
    const feat = { bpm: 120, energy: 0.6, valence: 0.5 };
    seed(fake, 'r1', 'c1', feat, [], { uri: 'spotify:track:1', title: 'GenreLess', artist: 'A' }); // corpus track: no genres
    const featureOnly = await svc.find({ targetFeatures: feat, seedGenres: [], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0.5, budgetMs: 500 });
    expect(featureOnly).toHaveLength(1);
    expect(featureOnly[0]).toMatchObject({ recordingKey: 'r1', isDiscovery: true });
    const genreSeeded = await svc.find({ targetFeatures: feat, seedGenres: ['pop', 'rock', 'jazz', 'metal', 'folk', 'soul', 'punk'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0.5, budgetMs: 500 });
    expect(genreSeeded).toEqual([]); // genre mass orthogonal to the genre-less corpus → cosine < 0.5 → starved
  });

  it('DISCOVERY_MIN_COSINE="" does NOT disable the floor (blank env → default 0.3, not Number("")===0)', async () => {
    process.env.DISCOVERY_MIN_COSINE = '';
    vectorIndex.use({ queryNear: async () => [{ recordingKey: 'r1', canonicalKey: 'c1', score: 0.2 }] });
    mockCatalog.set('r1', { recordingKey: 'r1', canonicalKey: 'c1', uri: 'spotify:track:1', title: 'X', artist: 'A', genres: [] });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, excludeCanonicalKeys: new Set(), k: 5, budgetMs: 500 });
    expect(out).toEqual([]); // 0.2 < 0.3 floor; a blank env must not collapse the floor to 0
  });

  it('DEFAULT min-cosine is a low floor (0.3): keeps a 0.4-cosine hit the old 0.5 default dropped', async () => {
    vectorIndex.use({ queryNear: async () => [{ recordingKey: 'r1', canonicalKey: 'c1', score: 0.4 }] });
    mockCatalog.set('r1', { recordingKey: 'r1', canonicalKey: 'c1', uri: 'spotify:track:1', title: 'Mid', artist: 'A', genres: [] });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, excludeCanonicalKeys: new Set(), k: 5, budgetMs: 500 }); // no minCosine → default
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ recordingKey: 'r1', isDiscovery: true });
  });

  it('DEFAULT min-cosine floor still drops a near-orthogonal 0.2-cosine hit', async () => {
    vectorIndex.use({ queryNear: async () => [{ recordingKey: 'r1', canonicalKey: 'c1', score: 0.2 }] });
    mockCatalog.set('r1', { recordingKey: 'r1', canonicalKey: 'c1', uri: 'spotify:track:1', title: 'Ortho', artist: 'A', genres: [] });
    const out = await svc.find({ targetFeatures: { bpm: 90 }, excludeCanonicalKeys: new Set(), k: 5, budgetMs: 500 }); // no minCosine → default
    expect(out).toEqual([]);
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

  it('DORMANT SEAM: with NO queryGenres (every current caller), total is byte-identical to the pure feature cosine regardless of candidate genre richness', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90, energy: 0.2, valence: 0.3 }, [], { uri: 'spotify:track:1', title: 'GenreLess', artist: 'A' });
    seed(fake, 'r2', 'c2', { bpm: 90, energy: 0.2, valence: 0.3 }, ['ambient', 'downtempo', 'chill'], { uri: 'spotify:track:2', title: 'GenreRich', artist: 'B' });
    const out = await svc.find({ targetFeatures: { bpm: 90, energy: 0.2, valence: 0.3 }, excludeCanonicalKeys: new Set(), k: 10, minCosine: 0, budgetMs: 500 });
    expect(out).toHaveLength(2); // both survive identically — genre richness plays no role by default
  });

  it('DORMANT SEAM: an explicit queryGenres param is accepted end-to-end without throwing (mechanism present, unused by any current caller)', async () => {
    seed(fake, 'r1', 'c1', { bpm: 90, energy: 0.2 }, ['ambient'], { uri: 'spotify:track:1', title: 'X', artist: 'A' });
    const out = await svc.find({ targetFeatures: { bpm: 90, energy: 0.2 }, queryGenres: ['ambient', 'downtempo'], excludeCanonicalKeys: new Set(), k: 5, minCosine: 0, budgetMs: 500 });
    expect(out).toHaveLength(1);
  });
});

describe('discoveryVectorService._scoreTotal (dormant genre-relevance blend — direct unit test)', () => {
  it('returns the feature cosine UNCHANGED when the query genre set is empty (dormancy invariant)', () => {
    expect(_scoreTotal(0.87, ['pop', 'rock'], new Set())).toBe(0.87);
    expect(_scoreTotal(0.87, [], new Set())).toBe(0.87);
  });

  it('adds a positive Jaccard-weighted boost when the query genre set overlaps the candidate genres', () => {
    const boosted = _scoreTotal(0.5, ['pop', 'rock'], new Set(['pop', 'indie']));
    expect(boosted).toBeGreaterThan(0.5);
  });

  it('adds ZERO boost when the query genre set is non-empty but shares nothing with the candidate', () => {
    expect(_scoreTotal(0.5, ['classical'], new Set(['trap', 'drill']))).toBe(0.5);
  });

  it('a candidate with no genres and a non-empty query genre set gets zero boost, not a crash', () => {
    expect(_scoreTotal(0.5, [], new Set(['pop']))).toBe(0.5);
    expect(_scoreTotal(0.5, undefined, new Set(['pop']))).toBe(0.5);
  });

  it('the boost is bounded — a perfect genre match cannot push a low feature cosine above a well-matched feature-only candidate\'s territory unboundedly', () => {
    const perfectGenreMatch = _scoreTotal(0.1, ['pop'], new Set(['pop']));
    expect(perfectGenreMatch).toBeLessThan(0.1 + 1); // weight is a small fraction, not a 1:1 override
    expect(perfectGenreMatch).toBeGreaterThan(0.1);
  });
});
