'use strict';

process.env.NODE_ENV = 'test';

const {
  checkVectorIndex,
  checkLegacyIndexAbsent,
  checkRedis,
  EXPECTED_DIM,
  LEGACY_PLAYLIST_INDEX,
} = require('../scripts/verifyProdRunbooks');

describe('EXPECTED_DIM is bound to the real buildVector contract', () => {
  it('is 70 (6 feature + 64 genre-bag) and equals embedding.DIM', () => {
    const { DIM } = require('../app/services/vector/embedding');
    expect(EXPECTED_DIM).toBe(70);
    expect(EXPECTED_DIM).toBe(DIM);
  });
});

describe('Runbook 1 — checkVectorIndex (Atlas vector index)', () => {
  const goodIndexes = [{
    name: 'track_embedding_index',
    type: 'vectorSearch',
    status: 'READY',
    latestDefinition: {
      fields: [{ type: 'vector', path: 'vector', numDimensions: 70, similarity: 'cosine' }],
    },
  }];

  it('PASS when the vector index exists on path "vector" with 70 dims / cosine', () => {
    const r = checkVectorIndex(goodIndexes, { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('PASS');
  });

  it('PASS with an empty collection but the index present (false-green guard)', () => {
    // listSearchIndexes returns index metadata regardless of document count, so
    // an EMPTY collection with a present index still PASSes — the check never
    // inspects documents (unlike a queryNear that returns [] in both cases).
    const r = checkVectorIndex(goodIndexes, { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('PASS');
  });

  it('FAIL when no index of that name exists (missing, distinct from empty collection)', () => {
    const r = checkVectorIndex([], { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('FAIL');
    expect(r.message).toMatch(/missing/i);
  });

  it('FAIL when the index exists but numDimensions mismatches the contract', () => {
    const bad = [{
      name: 'track_embedding_index',
      latestDefinition: { fields: [{ type: 'vector', path: 'vector', numDimensions: 64, similarity: 'cosine' }] },
    }];
    const r = checkVectorIndex(bad, { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('FAIL');
    expect(r.message).toMatch(/numDimensions/i);
  });

  it('FAIL when similarity is not cosine', () => {
    const bad = [{
      name: 'track_embedding_index',
      latestDefinition: { fields: [{ type: 'vector', path: 'vector', numDimensions: 70, similarity: 'euclidean' }] },
    }];
    const r = checkVectorIndex(bad, { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('FAIL');
    expect(r.message).toMatch(/similarity/i);
  });

  it('FAIL when the vector path is not "vector"', () => {
    const bad = [{
      name: 'track_embedding_index',
      latestDefinition: { fields: [{ type: 'vector', path: 'embedding', numDimensions: 70, similarity: 'cosine' }] },
    }];
    const r = checkVectorIndex(bad, { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('FAIL');
    expect(r.message).toMatch(/path/i);
  });

  it('SKIPPED when listSearchIndexes is unsupported (null — non-Atlas), never PASS', () => {
    const r = checkVectorIndex(null, { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('SKIPPED');
  });

  it('accepts a legacy `definition` key as well as `latestDefinition`', () => {
    const legacyShape = [{
      name: 'track_embedding_index',
      definition: { fields: [{ type: 'vector', path: 'vector', numDimensions: 70, similarity: 'cosine' }] },
    }];
    const r = checkVectorIndex(legacyShape, { indexName: 'track_embedding_index', expectedDim: 70 });
    expect(r.status).toBe('PASS');
  });

  it('honors a custom index name (ATLAS_VECTOR_INDEX override)', () => {
    const custom = [{
      name: 'my_custom_idx',
      latestDefinition: { fields: [{ type: 'vector', path: 'vector', numDimensions: 70, similarity: 'cosine' }] },
    }];
    const r = checkVectorIndex(custom, { indexName: 'my_custom_idx', expectedDim: 70 });
    expect(r.status).toBe('PASS');
  });
});

describe('Runbook 2 — checkLegacyIndexAbsent (playlistsessions)', () => {
  it('exports the legacy index name it guards against', () => {
    expect(LEGACY_PLAYLIST_INDEX).toBe('userId_1_moodKey_1_createdAt_-1');
  });

  it('PASS when the legacy compound index is absent', () => {
    const indexes = [{ name: '_id_' }, { name: 'userId_1_createdAt_-1' }, { name: 'llmCacheKey_1' }];
    const r = checkLegacyIndexAbsent(indexes);
    expect(r.status).toBe('PASS');
  });

  it('FAIL when the legacy index is still present', () => {
    const indexes = [{ name: '_id_' }, { name: 'userId_1_moodKey_1_createdAt_-1' }];
    const r = checkLegacyIndexAbsent(indexes);
    expect(r.status).toBe('FAIL');
    expect(r.message).toMatch(/userId_1_moodKey_1_createdAt_-1/);
  });
});

describe('Runbook 3 — checkRedis (Redis + queues)', () => {
  it('PASS when the client PINGs successfully and reports the three queue names', async () => {
    const client = { ping: jest.fn().mockResolvedValue('PONG') };
    const r = await checkRedis(client);
    expect(r.status).toBe('PASS');
    expect(r.queues).toEqual(
      expect.arrayContaining(['feature-hydration', 'embedding-build', 'state-vector-recompute'])
    );
  });

  it('FAIL when the client is null (Redis unreachable)', async () => {
    const r = await checkRedis(null);
    expect(r.status).toBe('FAIL');
    expect(r.message).toMatch(/null|unreachable/i);
  });

  it('FAIL when PING throws', async () => {
    const client = { ping: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const r = await checkRedis(client);
    expect(r.status).toBe('FAIL');
  });

  it('FAIL when PING returns an unexpected reply', async () => {
    const client = { ping: jest.fn().mockResolvedValue('WEIRD') };
    const r = await checkRedis(client);
    expect(r.status).toBe('FAIL');
  });
});
