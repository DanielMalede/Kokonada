// backend/tests/discoveryIntegration.test.js
const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const { buildVector } = require('../app/services/vector/embedding');

const mockCatalog = new Map();
jest.mock('../app/repositories/trackCatalogRepo', () => ({ getMany: async (keys) => new Map(keys.filter(k => mockCatalog.has(k)).map(k => [k, mockCatalog.get(k)])) }));
const { vectorDiscoveryFetch } = require('../app/services/discovery/discoveryFetch');

describe('discovery integration (fake index)', () => {
  let fake;
  beforeEach(() => { fake = fakeVectorIndex(); vectorIndex.use(fake); mockCatalog.clear(); });
  afterEach(() => vectorIndex.use(null));

  it('end-to-end: aiParams → vector match → hydrated, non-familiar, isDiscovery candidates', async () => {
    fake.store.set('r1', { vector: buildVector({ bpm: 100, energy: 0.4, valence: 0.5 }, ['indie']), canonicalKey: 'new1' });
    mockCatalog.set('r1', { recordingKey: 'r1', canonicalKey: 'new1', uri: 'spotify:track:r1', title: 'Fresh', artist: 'New', genres: ['indie'] });
    fake.store.set('r2', { vector: buildVector({ bpm: 100, energy: 0.4, valence: 0.5 }, ['indie']), canonicalKey: 'owned' });
    mockCatalog.set('r2', { recordingKey: 'r2', canonicalKey: 'owned', uri: 'spotify:track:r2', title: 'Have it', artist: 'Known', genres: ['indie'] });

    const out = await vectorDiscoveryFetch({
      musicProfile: { library: [{ canonicalKey: 'owned' }] },
      aiParams: { target_bpm: 100, energy: [0.3, 0.5], valence: 0.5, seed_genres: ['indie'] },
      blacklistCanonicalKeys: [],
    });
    expect(out.map(t => t.canonicalKey)).toEqual(['new1']);
    expect(out[0]).toMatchObject({ uri: 'spotify:track:r1', isDiscovery: true });
  });
});
