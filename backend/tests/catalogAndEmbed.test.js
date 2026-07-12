// backend/tests/catalogAndEmbed.test.js
const { catalogAndEmbed } = require('../app/services/discovery/catalogAndEmbed');

describe('catalogAndEmbed', () => {
  it('upserts catalog metadata and enqueues embedding with genresByKey', async () => {
    const calls = { catalog: null, embed: null };
    const deps = {
      upsertCatalog: async (entries) => { calls.catalog = entries; },
      enqueueEmbedding: async (keys, genresByKey) => { calls.embed = { keys, genresByKey }; },
    };
    const res = await catalogAndEmbed([
      { recordingKey: 'r1', canonicalKey: 'c1', uri: 'u1', title: 'T', artist: 'A', genres: ['rock'] },
      { recordingKey: '', title: 'skip me' },
    ], deps);
    expect(res).toEqual({ catalogued: 1, enqueued: 1 });
    expect(calls.catalog).toHaveLength(1);
    expect(calls.embed.keys).toEqual(['r1']);
    expect(calls.embed.genresByKey).toEqual({ r1: ['rock'] });
  });

  it('no valid tracks is a no-op', async () => {
    const deps = { upsertCatalog: jest.fn(), enqueueEmbedding: jest.fn() };
    const res = await catalogAndEmbed([{ title: 'no key' }], deps);
    expect(res).toEqual({ catalogued: 0, enqueued: 0 });
    expect(deps.upsertCatalog).not.toHaveBeenCalled();
    expect(deps.enqueueEmbedding).not.toHaveBeenCalled();
  });

  it('skips already-embedded keys — upserts all, enqueues only the new ones', async () => {
    const calls = { catalog: null, embed: null };
    const deps = {
      upsertCatalog: async (entries) => { calls.catalog = entries; },
      enqueueEmbedding: async (keys, genresByKey) => { calls.embed = { keys, genresByKey }; },
      getExistingEmbeddingKeys: async () => new Set(['r1']),
    };
    const res = await catalogAndEmbed([
      { recordingKey: 'r1', genres: ['rock'] },
      { recordingKey: 'r2', genres: ['indie'] },
    ], deps);
    expect(res).toEqual({ catalogued: 2, enqueued: 1 });
    expect(calls.catalog).toHaveLength(2);
    expect(calls.embed.keys).toEqual(['r2']);
    expect(calls.embed.genresByKey).toEqual({ r2: ['indie'] });
  });

  it('falls back to embedding ALL when the existence lookup fails (never drop an embed)', async () => {
    const calls = { embed: null };
    const deps = {
      upsertCatalog: async () => {},
      enqueueEmbedding: async (keys) => { calls.embed = keys; },
      getExistingEmbeddingKeys: async () => { throw new Error('lookup down'); },
    };
    const res = await catalogAndEmbed([{ recordingKey: 'r1' }, { recordingKey: 'r2' }], deps);
    expect(res).toEqual({ catalogued: 2, enqueued: 2 });
    expect(calls.embed).toEqual(['r1', 'r2']);
  });
});
