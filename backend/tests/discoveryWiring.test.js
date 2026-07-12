// backend/tests/discoveryWiring.test.js
// (mock-prefixed so Jest's hoisted mock factory may reference it.)
const mockFind = jest.fn(async () => [{ id: 'x', uri: 'spotify:track:x', title: 'D', artist: 'A', genres: ['rock'], canonicalKey: 'cx', isDiscovery: true }]);
jest.mock('../app/services/discovery/discoveryVectorService', () => ({ find: (...a) => mockFind(...a) }));
const { vectorDiscoveryFetch, extractTargetFeatures } = require('../app/services/discovery/discoveryFetch');

describe('discoveryFetch', () => {
  beforeEach(() => mockFind.mockClear());

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
    expect(arg.seedGenres).toEqual(['rock']);
  });
});
