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

  it('catalogs pre-keyed mbid corpus entries and enqueues embedding with genresByKey', async () => {
    const calls = { catalog: null, embed: null };
    const deps = {
      upsertCatalog: async (entries) => { calls.catalog = entries; },
      enqueueEmbedding: async (keys, genresByKey) => { calls.embed = { keys, genresByKey }; },
    };
    const res = await catalogAndEmbed([
      { recordingKey: 'mbid:abc', title: 'Song', uri: null, genres: ['pop'], artist: 'A' },
      { recordingKey: 'mbid:def', title: 'Other', genres: ['rock'] },
    ], deps);
    expect(res).toEqual({ catalogued: 2, enqueued: 2 });
    expect(calls.catalog.map(e => e.recordingKey)).toEqual(['mbid:abc', 'mbid:def']);
    expect(calls.catalog[0].title).toBe('Song');
    expect(calls.embed.keys).toEqual(['mbid:abc', 'mbid:def']);
    expect(calls.embed.genresByKey).toEqual({ 'mbid:abc': ['pop'], 'mbid:def': ['rock'] });
  });

  it('excludes already-embedded corpus entries from toEmbed but catalogs all', async () => {
    const calls = { catalog: null, embed: null };
    const deps = {
      upsertCatalog: async (entries) => { calls.catalog = entries; },
      enqueueEmbedding: async (keys, genresByKey) => { calls.embed = { keys, genresByKey }; },
      getExistingEmbeddingKeys: async () => new Set(['mbid:abc']),
    };
    const res = await catalogAndEmbed([
      { recordingKey: 'mbid:abc', genres: ['pop'] },
      { recordingKey: 'mbid:def', genres: ['rock'] },
    ], deps);
    expect(res).toEqual({ catalogued: 2, enqueued: 1 });
    expect(calls.catalog).toHaveLength(2);
    expect(calls.embed.keys).toEqual(['mbid:def']);
  });

  it('drops spotify tracks before catalog/embed — mbid survives (Spotify-ToS containment)', async () => {
    const calls = { catalog: null, embed: null };
    const deps = {
      upsertCatalog: async (entries) => { calls.catalog = entries; },
      enqueueEmbedding: async (keys, genresByKey) => { calls.embed = { keys, genresByKey }; },
    };
    const res = await catalogAndEmbed([
      { id: 'sp', provider: 'spotify', uri: 'spotify:track:sp', name: 'S', genres: ['rock'] },
      { recordingKey: 'spotify:pre', uri: 'spotify:track:pre', genres: ['pop'] },
      { recordingKey: 'mbid:abc', genres: ['pop'] },
    ], deps);
    expect(res).toEqual({ catalogued: 1, enqueued: 1 });
    expect(calls.catalog.map(e => e.recordingKey)).toEqual(['mbid:abc']);
    expect(calls.embed.keys).toEqual(['mbid:abc']);
    expect(Object.keys(calls.embed.genresByKey)).toEqual(['mbid:abc']);
  });

  it('embeds ALL corpus entries when the existence lookup throws', async () => {
    const calls = { embed: null };
    const deps = {
      upsertCatalog: async () => {},
      enqueueEmbedding: async (keys) => { calls.embed = keys; },
      getExistingEmbeddingKeys: async () => { throw new Error('lookup down'); },
    };
    const res = await catalogAndEmbed([
      { recordingKey: 'mbid:abc', title: 'Song' },
      { recordingKey: 'mbid:def', title: 'Other' },
    ], deps);
    expect(res).toEqual({ catalogued: 2, enqueued: 2 });
    expect(calls.embed).toEqual(['mbid:abc', 'mbid:def']);
  });

  it('drops a youtube_music-only batch — empty result, no catalog/embed (YouTube-ToS containment)', async () => {
    const deps = { upsertCatalog: jest.fn(), enqueueEmbedding: jest.fn() };
    const res = await catalogAndEmbed([
      { id: 'abc', provider: 'youtube_music', name: 'Song', genres: ['pop'] },
      { recordingKey: 'youtube:pre', genres: ['rock'] },
    ], deps);
    expect(res).toEqual({ catalogued: 0, enqueued: 0 });
    expect(deps.upsertCatalog).not.toHaveBeenCalled();
    expect(deps.enqueueEmbedding).not.toHaveBeenCalled();
  });

  it('a MIXED spotify + youtube_music + mbid batch catalogs ONLY the mbid row (ToS containment)', async () => {
    const calls = { catalog: null, embed: null };
    const deps = {
      upsertCatalog: async (entries) => { calls.catalog = entries; },
      enqueueEmbedding: async (keys, genresByKey) => { calls.embed = { keys, genresByKey }; },
    };
    const res = await catalogAndEmbed([
      { id: 'sp', provider: 'spotify', uri: 'spotify:track:sp', name: 'S', genres: ['rock'] },
      { id: 'yt', provider: 'youtube_music', name: 'Y', genres: ['pop'] },
      { recordingKey: 'youtube:pre', genres: ['indie'] },
      { recordingKey: 'mbid:legit', genres: ['jazz'] },
    ], deps);
    expect(res).toEqual({ catalogued: 1, enqueued: 1 });
    expect(calls.catalog.map(e => e.recordingKey)).toEqual(['mbid:legit']);
    expect(calls.embed.keys).toEqual(['mbid:legit']);
    expect(Object.keys(calls.embed.genresByKey)).toEqual(['mbid:legit']);
  });
});
