'use strict';

process.env.NODE_ENV = 'test';

// SHADOW-QA pin (Squad-1 runbook #1). The production runbook creates an Atlas
// Vector Search index named `track_embedding_index` on `trackembeddings.vector`
// with numDimensions:70, similarity:"cosine". If the adapter's $vectorSearch
// stage ever drifts from those exact values (rename, path change, dim change),
// $vectorSearch errors, the adapter's catch swallows it to [], and MMR silently
// degrades with NO error surfaced. These assertions fail loudly on that drift so
// the runbook and the code can never diverge unnoticed.

jest.mock('../app/models/TrackEmbedding', () => ({
  bulkWrite: jest.fn().mockResolvedValue({}),
  find: jest.fn(),
  aggregate: jest.fn().mockResolvedValue([]),
}));

const TrackEmbedding = require('../app/models/TrackEmbedding');
const adapter = require('../app/services/vector/mongoAtlasVectorAdapter');
const { buildVector, DIM } = require('../app/services/vector/embedding');

const FEATURES = { bpm: 120, energy: 0.7, valence: 0.6, acousticness: 0.2, danceability: 0.7, loudness: -7 };

const ORIGINAL_ATLAS_INDEX = process.env.ATLAS_VECTOR_INDEX;

beforeEach(() => {
  jest.clearAllMocks();
  TrackEmbedding.aggregate.mockResolvedValue([]);
  delete process.env.ATLAS_VECTOR_INDEX;
});

afterAll(() => {
  if (ORIGINAL_ATLAS_INDEX === undefined) delete process.env.ATLAS_VECTOR_INDEX;
  else process.env.ATLAS_VECTOR_INDEX = ORIGINAL_ATLAS_INDEX;
});

describe('vectorSearch runbook contract (adapter ↔ Atlas index spec)', () => {
  it('queryNear targets the runbook index name `track_embedding_index` on path `vector`', async () => {
    await adapter.queryNear([0.1, 0.2, 0.3], { k: 25 });

    expect(TrackEmbedding.aggregate).toHaveBeenCalledTimes(1);
    const pipeline = TrackEmbedding.aggregate.mock.calls[0][0];
    const stage = pipeline[0].$vectorSearch;

    // Runbook name + path MUST match, or the operator's Atlas index is orphaned.
    expect(stage.index).toBe('track_embedding_index');
    expect(stage.path).toBe('vector');
    expect(stage.limit).toBe(25);
    expect(stage.numCandidates).toBe(250); // k * 10
    expect(stage.queryVector).toEqual([0.1, 0.2, 0.3]);

    // Score must come from the cosine-compatible vectorSearchScore meta.
    const project = pipeline[1].$project;
    expect(project.score).toEqual({ $meta: 'vectorSearchScore' });
  });

  it('honors ATLAS_VECTOR_INDEX override at call time', async () => {
    process.env.ATLAS_VECTOR_INDEX = 'custom_index_name';
    await adapter.queryNear([0.1, 0.2], { k: 5 });
    expect(TrackEmbedding.aggregate.mock.calls[0][0][0].$vectorSearch.index).toBe('custom_index_name');
  });

  it('stored vector is EXACTLY 70 dims — matches runbook numDimensions:70', () => {
    expect(DIM).toBe(70);
    expect(buildVector(FEATURES, ['pop', 'dance'])).toHaveLength(70);
    expect(buildVector(null, [])).toHaveLength(70);
  });

  it('embedding is L2-normalized — validates runbook similarity:"cosine"', () => {
    const v = buildVector(FEATURES, ['pop', 'house', 'techno']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
  });
});
