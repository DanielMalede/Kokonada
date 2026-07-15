// backend/tests/discoveryWiring.test.js
// (mock-prefixed so Jest's hoisted mock factory may reference it.)
const mockFind = jest.fn(async () => [{ id: 'x', uri: 'spotify:track:x', title: 'D', artist: 'A', genres: ['rock'], canonicalKey: 'cx', isDiscovery: true }]);
jest.mock('../app/services/discovery/discoveryVectorService', () => ({ find: (...a) => mockFind(...a) }));
const { vectorDiscoveryFetch, extractTargetFeatures } = require('../app/services/discovery/discoveryFetch');

describe('discoveryFetch', () => {
  beforeEach(() => mockFind.mockClear());
  afterEach(() => { delete process.env.DISCOVERY_FEATURE_ONLY_TARGET; });

  it('extracts sonic targets from aiParams (bpm center + energy midpoint + valence)', () => {
    expect(extractTargetFeatures({ target_bpm: 120, energy: [0.2, 0.5], valence: 0.6 }))
      .toMatchObject({ bpm: 120, energy: 0.35, valence: 0.6 });
  });

  it('excludes the user library by canonicalKey and returns the service candidates', async () => {
    const out = await vectorDiscoveryFetch({
      musicProfile: { library: [{ canonicalKey: 'owned1' }] },
      aiParams: { target_bpm: 120, energy: [0.2, 0.5], valence: 0.6, seed_genres: ['rock'] },
      blacklistCanonicalKeys: ['bl1'],
    });
    expect(out[0].isDiscovery).toBe(true);
    const arg = mockFind.mock.calls[0][0];
    expect([...arg.excludeCanonicalKeys]).toEqual(expect.arrayContaining(['owned1', 'bl1']));
  });

  it('DEFAULT: builds a FEATURE-ONLY discovery target — drops seed_genres so the query stays in the same (genre-less) subspace as the corpus', async () => {
    await vectorDiscoveryFetch({ musicProfile: {}, aiParams: { target_bpm: 120, seed_genres: ['rock', 'pop'] } });
    expect(mockFind.mock.calls[0][0].seedGenres).toEqual([]);
  });

  it('DISCOVERY_FEATURE_ONLY_TARGET=false restores genre-seeded targets (legacy / future genre-rich corpus)', async () => {
    process.env.DISCOVERY_FEATURE_ONLY_TARGET = 'false';
    await vectorDiscoveryFetch({ musicProfile: {}, aiParams: { target_bpm: 120, seed_genres: ['rock', 'pop'] } });
    expect(mockFind.mock.calls[0][0].seedGenres).toEqual(['rock', 'pop']);
  });

  it('forwards the biosonic targets to the service so it can post-filter by the band', async () => {
    const targets = { bpmCenter: 150, bpmWidth: 12, energyFloor: 0.4, energyCeiling: 0.8, valenceTarget: 0.55, acousticnessBias: 0.2, confidence: 0.85 };
    await vectorDiscoveryFetch({ musicProfile: {}, aiParams: { seed_genres: ['rock'] }, targets });
    expect(mockFind.mock.calls[0][0].targets).toBe(targets);
  });

  it('when targets are present, biases the query features toward the band center (recall aid)', async () => {
    const targets = { bpmCenter: 150, bpmWidth: 12, energyFloor: 0.4, energyCeiling: 0.8, valenceTarget: 0.55, acousticnessBias: 0.2, confidence: 0.85 };
    // aiParams say bpm 90 / energy midpoint 0.15 — the band re-centres the QUERY to its own centre.
    await vectorDiscoveryFetch({ musicProfile: {}, aiParams: { target_bpm: 90, energy: [0.1, 0.2], seed_genres: ['rock'] }, targets });
    const tf = mockFind.mock.calls[0][0].targetFeatures;
    expect(tf).toMatchObject({ bpm: 150, valence: 0.55, acousticness: 0.2 });
    expect(tf.energy).toBeCloseTo(0.6, 10); // (energyFloor + energyCeiling) / 2
  });

  it('with NO targets the query features are the untouched extractTargetFeatures output', async () => {
    await vectorDiscoveryFetch({ musicProfile: {}, aiParams: { target_bpm: 90, energy: [0.1, 0.2], valence: 0.3 } });
    expect(mockFind.mock.calls[0][0].targets).toBeNull();
    expect(mockFind.mock.calls[0][0].targetFeatures).toMatchObject({ bpm: 90, energy: 0.15000000000000002, valence: 0.3 });
  });

  it('DORMANCY GUARD: never passes queryGenres to find() — the genre-relevance seam stays dormant until an explicit future activation', async () => {
    await vectorDiscoveryFetch({ musicProfile: {}, aiParams: { target_bpm: 120, seed_genres: ['rock', 'pop'] } });
    expect(mockFind.mock.calls[0][0].queryGenres).toBeUndefined();
  });
});
