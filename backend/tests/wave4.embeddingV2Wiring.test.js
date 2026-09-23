'use strict';

// W4-014 · B3 · the WIRING half of embedding v2.
//
// The pure core (session 54) proved the GEOMETRY. This file pins the PLUMBING, and the
// plumbing has one failure mode that matters more than all the others put together:
//
//   A HALF-FLIPPED CUTOVER. The query vector and the index it is searched against are two
//   independent choices. If one flips to v2 and the other does not, $vectorSearch is handed a
//   135-dim vector against a 70-dim index (an error the adapter's catch swallows to `[]`, so
//   discovery silently turns OFF) or — far worse, if the dims ever coincided — a coordinate-wise
//   comparison of two unrelated spaces, which returns confident nonsense rather than nothing.
//   Every read-path pin below therefore asserts the PAIR, never one side of it.
//
// The second theme is that v1 must remain byte-identical while both flags are unset: the index
// Daniel serves from today is a 70-dim index on `vector`, and nothing here may touch it.

process.env.NODE_ENV = 'test';

const { DIM, DIM_V2, MODEL_V2, buildVectorV2 } = require('../app/services/vector/embedding');
const { buildTargetVector } = require('../app/services/discovery/targetVector');

const FLAGS = ['EMBEDDING_V2_WRITE', 'EMBEDDING_V2_READ', 'ATLAS_VECTOR_INDEX', 'ATLAS_VECTOR_INDEX_V2'];
const ORIGINAL = {};
beforeAll(() => { for (const f of FLAGS) ORIGINAL[f] = process.env[f]; });
afterAll(() => {
  for (const f of FLAGS) {
    if (ORIGINAL[f] === undefined) delete process.env[f];
    else process.env[f] = ORIGINAL[f];
  }
});
function clearFlags() { for (const f of FLAGS) delete process.env[f]; }

// ===========================================================================
// 1 · envFlag — the ENABLE-flag spelling convention, extracted so the two v2
//     flags and SCORING_V2_SHADOW can never drift apart on what "off" means.
// ===========================================================================
describe('envFlag.enabled — one spelling convention for every ENABLE flag', () => {
  const { enabled } = require('../app/utils/envFlag');

  it('unset, blank and every OFF spelling are false (W4-D05 in reverse: `X=0` must never enable)', () => {
    for (const raw of [undefined, null, '', '   ', '0', 'false', 'FALSE', 'No', 'off', 'OFF']) {
      expect(enabled(raw)).toBe(false);
    }
  });

  it('any other non-empty spelling is true', () => {
    for (const raw of ['true', 'TRUE', '1', 'yes', 'on', 'enabled']) expect(enabled(raw)).toBe(true);
  });

  it('a non-string (a number, an object) is false — an env var is always a string, so anything else is a bug, not an intent', () => {
    for (const raw of [1, true, {}, []]) expect(enabled(raw)).toBe(false);
  });
});

// ===========================================================================
// 2 · embeddingSpace — the ONE resolver. Both the query-vector builder and the
//     index/path selector read from here, which is what makes a half-flip
//     structurally impossible rather than merely unlikely.
// ===========================================================================
describe('embeddingSpace — the single source of truth for which space is live', () => {
  const space = require('../app/services/vector/embeddingSpace');

  beforeEach(() => { clearFlags(); space._resetWarnings(); });
  afterEach(() => clearFlags());

  it('v1 describes exactly the index Daniel serves from today: `vector`, 70 dims, `track_embedding_index`', () => {
    const s = space.spaceFor('v1');
    expect(s.version).toBe('v1');
    expect(s.path).toBe('vector');
    expect(s.dimPath).toBe('dim');
    expect(s.modelPath).toBe('model');
    expect(s.dim).toBe(DIM);
    expect(s.dim).toBe(70);
    expect(space.indexNameFor('v1')).toBe('track_embedding_index');
  });

  it('v2 describes the SECOND path on the SAME doc: `vectorV2`, 135 dims, `track_embedding_index_v2` (H13)', () => {
    const s = space.spaceFor('v2');
    expect(s.version).toBe('v2');
    expect(s.path).toBe('vectorV2');
    expect(s.dimPath).toBe('dimV2');
    expect(s.modelPath).toBe('modelV2');
    expect(s.dim).toBe(DIM_V2);
    expect(s.dim).toBe(135); // Atlas numDimensions is immutable per index — this number IS the portal action
    expect(s.model).toBe(MODEL_V2);
    expect(space.indexNameFor('v2')).toBe('track_embedding_index_v2');
  });

  it('an unknown/absent version resolves to v1 — the safe direction is always the space that is actually built', () => {
    for (const v of [undefined, null, '', 'v3', 'V2', 7]) expect(space.spaceFor(v).version).toBe('v1');
  });

  it('each space honours its OWN index-name override, and neither can be renamed by the other', () => {
    process.env.ATLAS_VECTOR_INDEX = 'custom_v1';
    process.env.ATLAS_VECTOR_INDEX_V2 = 'custom_v2';
    expect(space.indexNameFor('v1')).toBe('custom_v1');
    expect(space.indexNameFor('v2')).toBe('custom_v2');
  });

  it('both flags default OFF: writeV2Enabled false, readVersion v1 — v2 is dark until Daniel says otherwise', () => {
    expect(space.writeV2Enabled()).toBe(false);
    expect(space.readVersion()).toBe('v1');
  });

  it('EMBEDDING_V2_WRITE / EMBEDDING_V2_READ use the shared ENABLE spelling, so `=0` does not switch the corpus over', () => {
    process.env.EMBEDDING_V2_WRITE = '0';
    process.env.EMBEDDING_V2_READ = 'off';
    expect(space.writeV2Enabled()).toBe(false);
    expect(space.readVersion()).toBe('v1');
    process.env.EMBEDDING_V2_WRITE = 'true';
    process.env.EMBEDDING_V2_READ = 'true';
    expect(space.writeV2Enabled()).toBe(true);
    expect(space.readVersion()).toBe('v2');
  });

  it('reading v2 while NOT writing it warns ONCE — an index nothing feeds goes stale silently, which is the one misconfiguration that looks like success', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.EMBEDDING_V2_READ = 'true';
    expect(space.readVersion()).toBe('v2'); // it still honours the operator; it does not silently override them
    expect(space.readVersion()).toBe('v2');
    expect(space.readVersion()).toBe('v2');
    expect(warn).toHaveBeenCalledTimes(1); // once per process, the `_warnedVectorSearch` precedent — never per call
    expect(warn.mock.calls[0][0]).toMatch(/EMBEDDING_V2_WRITE/);
    warn.mockRestore();
  });

  it('reading v2 WITH writing v2 on is the supported configuration and stays silent', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.EMBEDDING_V2_READ = 'true';
    process.env.EMBEDDING_V2_WRITE = 'true';
    expect(space.readVersion()).toBe('v2');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ===========================================================================
// 3 · TrackEmbedding — a SECOND path on the SAME document.
//     Not a second collection and not a second row: `recordingKey` stays unique,
//     so the read cutover is an index+path switch and nothing has to be migrated.
// ===========================================================================
describe('TrackEmbedding schema — v2 rides alongside v1 on one doc', () => {
  const TrackEmbedding = require('../app/models/TrackEmbedding');

  it('a v1-only doc is still valid, and its v2 fields are ABSENT rather than empty arrays', () => {
    const doc = new TrackEmbedding({ recordingKey: 'mbid:a', vector: [0.1, 0.2], dim: 2 });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.vectorV2).toBeUndefined(); // `default: []` would make "never built" indistinguishable from "built empty"
    expect(doc.dimV2).toBeUndefined();
    expect(doc.modelV2).toBeUndefined();
  });

  it('a dual-written doc carries both spaces and both descriptors', () => {
    const doc = new TrackEmbedding({
      recordingKey: 'mbid:a', vector: [0.1], dim: 1, model: 'v1-deterministic',
      vectorV2: [0.3, 0.4], dimV2: 2, modelV2: MODEL_V2,
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.vectorV2).toEqual([0.3, 0.4]);
    expect(doc.modelV2).toBe(MODEL_V2);
  });

  it('a v2-ONLY doc is invalid — v2 is additive, it never becomes the only representation a row has', () => {
    const doc = new TrackEmbedding({ recordingKey: 'mbid:a', vectorV2: [0.3], dimV2: 1 });
    const err = doc.validateSync();
    expect(err).toBeDefined();
    // `dim` is what actually rejects it. Note for the record: mongoose gives EVERY array path an
    // implicit `[]` default, so `vector: {required: true}` does NOT reject a missing vector — it
    // sees `[]` and passes. Pre-existing, harmless in practice (the adapter reads
    // `doc.vector.length`, so a caller with no vector throws long before Mongo), and pinned here
    // as the true behaviour rather than the assumed one.
    expect(err.errors.dim).toBeDefined();
    expect(err.errors.vector).toBeUndefined();
  });
});

// ===========================================================================
// 4 · mongoAtlasVectorAdapter — index/path parametrisation.
// ===========================================================================
describe('mongoAtlasVectorAdapter — two spaces, one adapter', () => {
  jest.resetModules();
  jest.doMock('../app/models/TrackEmbedding', () => ({
    bulkWrite: jest.fn().mockResolvedValue({}),
    find: jest.fn(),
    aggregate: jest.fn().mockResolvedValue([]),
  }));
  const TrackEmbedding = require('../app/models/TrackEmbedding');
  const adapter = require('../app/services/vector/mongoAtlasVectorAdapter');

  const rows = (r) => ({ lean: () => Promise.resolve(r) });

  beforeEach(() => {
    clearFlags();
    jest.clearAllMocks();
    TrackEmbedding.aggregate.mockResolvedValue([]);
  });
  afterEach(() => clearFlags());

  it('upsertMany without a v2 vector writes EXACTLY the v1 field set — the dark path is byte-identical', async () => {
    await adapter.upsertMany([{ recordingKey: 'mbid:a', canonicalKey: 'c', vector: [0.1, 0.2] }]);
    const op = TrackEmbedding.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(Object.keys(op.update.$set).sort()).toEqual(['builtAt', 'canonicalKey', 'dim', 'model', 'recordingKey', 'vector']);
    expect(op.update.$set.dim).toBe(2);
    expect(op.update.$unset).toBeUndefined(); // a v1-only write must never ERASE a v2 vector a previous dual-write left
  });

  it('upsertMany with a v2 vector adds the v2 triple and leaves v1 untouched in the same $set', async () => {
    await adapter.upsertMany([{
      recordingKey: 'mbid:a', canonicalKey: 'c', vector: [0.1, 0.2],
      vectorV2: [0.3, 0.4, 0.5], modelV2: MODEL_V2,
    }]);
    const set = TrackEmbedding.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(set.vector).toEqual([0.1, 0.2]);
    expect(set.dim).toBe(2);
    expect(set.vectorV2).toEqual([0.3, 0.4, 0.5]);
    expect(set.dimV2).toBe(3);      // derived from the vector, never trusted from the caller
    expect(set.modelV2).toBe(MODEL_V2);
  });

  it('a null / empty / non-array v2 vector is DROPPED, not stored — `buildVectorV2` returns null for a track with no evidence at all', async () => {
    for (const bad of [null, undefined, [], 'nope', {}]) {
      TrackEmbedding.bulkWrite.mockClear();
      await adapter.upsertMany([{ recordingKey: 'mbid:a', vector: [0.1], vectorV2: bad }]);
      const set = TrackEmbedding.bulkWrite.mock.calls[0][0][0].updateOne.update.$set;
      expect(set.vectorV2).toBeUndefined();
      expect(set.dimV2).toBeUndefined();
    }
  });

  it('getMany defaults to v1 and returns exactly what it returns today', async () => {
    TrackEmbedding.find.mockReturnValue(rows([{ recordingKey: 'mbid:a', vector: [1, 2], vectorV2: [9, 9, 9] }]));
    const out = await adapter.getMany(['mbid:a']);
    expect(out.get('mbid:a')).toEqual([1, 2]);
  });

  it('getMany({version:v2}) returns the v2 vector', async () => {
    TrackEmbedding.find.mockReturnValue(rows([{ recordingKey: 'mbid:a', vector: [1, 2], vectorV2: [9, 9, 9] }]));
    const out = await adapter.getMany(['mbid:a'], { version: 'v2' });
    expect(out.get('mbid:a')).toEqual([9, 9, 9]);
  });

  it('getMany({version:v2}) OMITS a row that has no v2 vector — a half-backfilled corpus degrades to "no embedding", never to a MIXED-SPACE comparison', async () => {
    TrackEmbedding.find.mockReturnValue(rows([
      { recordingKey: 'mbid:a', vector: [1, 2], vectorV2: [9, 9, 9] },
      { recordingKey: 'mbid:b', vector: [3, 4] },                       // never backfilled
      { recordingKey: 'mbid:c', vector: [5, 6], vectorV2: [] },         // present but empty
    ]));
    const out = await adapter.getMany(['mbid:a', 'mbid:b', 'mbid:c'], { version: 'v2' });
    expect([...out.keys()]).toEqual(['mbid:a']);
    // MMR treats a missing embedding as "fall back to feature distance" — correct and honest.
    // Handing it a 70-dim v1 vector to compare against a 135-dim v2 one would be neither.
  });

  it('queryNear defaults to the v1 index and path — the existing runbook contract is unchanged', async () => {
    await adapter.queryNear([0.1, 0.2], { k: 5 });
    const stage = TrackEmbedding.aggregate.mock.calls[0][0][0].$vectorSearch;
    expect(stage.index).toBe('track_embedding_index');
    expect(stage.path).toBe('vector');
  });

  it('queryNear({version:v2}) targets the v2 index AND the v2 path together — the pair, never one of them', async () => {
    await adapter.queryNear([0.1, 0.2], { k: 5, version: 'v2' });
    const stage = TrackEmbedding.aggregate.mock.calls[0][0][0].$vectorSearch;
    expect(stage.index).toBe('track_embedding_index_v2');
    expect(stage.path).toBe('vectorV2');
    expect(stage.limit).toBe(5);
    expect(stage.numCandidates).toBe(50);
  });

  it('the one-shot $vectorSearch warning names the space that actually failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    adapter._resetWarnings();
    TrackEmbedding.aggregate.mockRejectedValue(new Error('index not found'));
    expect(await adapter.queryNear([0.1], { version: 'v2' })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/track_embedding_index_v2/);
    expect(warn.mock.calls[0][0]).toMatch(/vectorV2/);
    expect(warn.mock.calls[0][0]).toMatch(new RegExp(String(DIM_V2)));
    warn.mockRestore();
  });
});

// ===========================================================================
// 5 · fakeVectorIndex — behavioural parity. Every discovery/pipeline suite runs
//     on the fake, so a fake that ignores `version` would green-light a
//     half-flip the real adapter would fail on.
// ===========================================================================
describe('fakeVectorIndex — the fake models both spaces or it is not a fake', () => {
  const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');

  it('stores and reads back each space independently', async () => {
    const fake = fakeVectorIndex();
    await fake.upsertMany([{ recordingKey: 'a', canonicalKey: 'ca', vector: [1, 0], vectorV2: [0, 1] }]);
    expect((await fake.getMany(['a'])).get('a')).toEqual([1, 0]);
    expect((await fake.getMany(['a'], { version: 'v2' })).get('a')).toEqual([0, 1]);
  });

  it('getMany({version:v2}) omits a v1-only row, exactly like the Mongo adapter', async () => {
    const fake = fakeVectorIndex();
    await fake.upsertMany([{ recordingKey: 'a', vector: [1, 0] }]);
    expect([...(await fake.getMany(['a'], { version: 'v2' })).keys()]).toEqual([]);
  });

  it('queryNear({version:v2}) ranks on the v2 vectors and ignores rows that have none', async () => {
    const fake = fakeVectorIndex();
    await fake.upsertMany([
      { recordingKey: 'near', vector: [0, 1], vectorV2: [1, 0] },
      { recordingKey: 'far', vector: [1, 0], vectorV2: [0, 1] },
      { recordingKey: 'v1only', vector: [1, 0] },
    ]);
    const hits = await fake.queryNear([1, 0], { k: 10, version: 'v2' });
    expect(hits.map(h => h.recordingKey)).toEqual(['near', 'far']); // v1only absent, near first
    expect(hits[0].score).toBeCloseTo(1, 10);
  });

  it('the default (v1) path is unchanged — every existing suite that seeds `vector` still works', async () => {
    const fake = fakeVectorIndex();
    await fake.upsertMany([{ recordingKey: 'a', canonicalKey: 'ca', vector: [1, 0] }]);
    const hits = await fake.queryNear([1, 0], { k: 5 });
    expect(hits[0]).toMatchObject({ recordingKey: 'a', canonicalKey: 'ca' });
    expect(hits[0].score).toBeCloseTo(1, 10);
  });
});

// ===========================================================================
// 6 · embedding.worker — the dual write.
// ===========================================================================
describe('embedding.worker — EMBEDDING_V2_WRITE dual-write', () => {
  let worker, featureRepo, vectorIndex, catalogRepo, idfStats;

  beforeEach(() => {
    jest.resetModules();
    clearFlags();
    jest.doMock('../app/repositories/audioFeatureRepo', () => ({ getMany: jest.fn(), setVibeTags: jest.fn() }));
    jest.doMock('../app/repositories/trackCatalogRepo', () => ({ getMany: jest.fn() }));
    jest.doMock('../app/services/vector/vectorIndex', () => ({ upsertMany: jest.fn().mockResolvedValue(undefined) }));
    jest.doMock('../app/services/llmClient', () => ({ isConfigured: jest.fn(() => false), generateJson: jest.fn() }));
    featureRepo = require('../app/repositories/audioFeatureRepo');
    catalogRepo = require('../app/repositories/trackCatalogRepo');
    vectorIndex = require('../app/services/vector/vectorIndex');
    idfStats = require('../app/services/vector/idfStats');
    idfStats.reset();
    worker = require('../app/workers/embedding.worker');
  });
  afterEach(() => {
    idfStats.reset();
    clearFlags();
    // `jest.resetModules()` clears the module REGISTRY but not the doMock REGISTRATIONS, so
    // without this the mocked vectorIndex (which has no `use`) would follow the describes below.
    for (const m of [
      '../app/repositories/audioFeatureRepo', '../app/repositories/trackCatalogRepo',
      '../app/services/vector/vectorIndex', '../app/services/llmClient',
    ]) jest.dontMock(m);
    jest.resetModules();
  });

  const FEAT = { canonicalKey: 'c1', bpm: 120, energy: 0.7, valence: 0.6, acousticness: 0.2, danceability: 0.6, loudness: -7 };

  it('flag OFF: the upserted doc has NO v2 field at all, and the catalog is never read (the dark path costs nothing)', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', FEAT]]));
    await worker.process({ data: { recordingKeys: ['mbid:a'] } });
    const doc = vectorIndex.upsertMany.mock.calls[0][0][0];
    expect(doc.vector).toHaveLength(DIM);
    expect('vectorV2' in doc).toBe(false);
    expect(catalogRepo.getMany).not.toHaveBeenCalled();
  });

  it('flag ON: the doc carries a DIM_V2 v2 vector plus its model tag, and v1 is still the genre-free 70-dim vector', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', FEAT]]));
    catalogRepo.getMany.mockResolvedValue(new Map([['mbid:a', { recordingKey: 'mbid:a', genres: ['house'] }]]));
    idfStats.use({ v: 1, n: 100, df: { house: 10 }, computedAt: 0 });

    await worker.process({ data: { recordingKeys: ['mbid:a'] } });

    const doc = vectorIndex.upsertMany.mock.calls[0][0][0];
    expect(doc.vector).toHaveLength(DIM);
    expect(doc.vectorV2).toHaveLength(DIM_V2);
    expect(doc.modelV2).toBe(MODEL_V2);
    // The genres genuinely reached the genre block: identical to the pure core called directly.
    expect(doc.vectorV2).toEqual(buildVectorV2(FEAT, ['house'], { idf: { v: 1, n: 100, df: { house: 10 } } }));
    // ...and v1 is STILL genre-free (PR #139's dilution fix is not quietly undone by the v2 work).
    const { buildVector } = require('../app/services/vector/embedding');
    expect(doc.vector).toEqual(buildVector(FEAT, []));
  });

  it('flag ON: the catalog is read ONCE for the whole batch, not once per key', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    idfStats.use({ v: 1, n: 10, df: {}, computedAt: 0 });
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', FEAT], ['mbid:b', FEAT]]));
    catalogRepo.getMany.mockResolvedValue(new Map());
    await worker.process({ data: { recordingKeys: ['mbid:a', 'mbid:b'] } });
    expect(catalogRepo.getMany).toHaveBeenCalledTimes(1);
    expect(catalogRepo.getMany.mock.calls[0][0]).toEqual(['mbid:a', 'mbid:b']);
  });

  it('flag ON with a track that has no measurable evidence at all: v2 ABSTAINS (null) and is omitted; v1 still writes', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    idfStats.use({ v: 1, n: 10, df: {}, computedAt: 0 });
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', { canonicalKey: 'c1' }]])); // no features
    catalogRepo.getMany.mockResolvedValue(new Map());                                     // no genres
    await worker.process({ data: { recordingKeys: ['mbid:a'] } });
    const doc = vectorIndex.upsertMany.mock.calls[0][0][0];
    expect(doc.vector).toHaveLength(DIM);  // v1 neutral-fills, as it always has
    expect('vectorV2' in doc).toBe(false); // v2 refuses to invent a direction — and a null must never be stored
  });

  it('flag ON with the IDF corpus unavailable: still dual-writes an AUDIO-ONLY v2 rather than failing the job', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', FEAT]]));
    catalogRepo.getMany.mockResolvedValue(new Map([['mbid:a', { genres: ['house'] }]]));
    jest.spyOn(idfStats, 'peek').mockRejectedValue(new Error('mongo down'));

    const out = await worker.process({ data: { recordingKeys: ['mbid:a'] } });

    expect(out.embedded).toBe(1);
    const doc = vectorIndex.upsertMany.mock.calls[0][0][0];
    expect(doc.vectorV2).toHaveLength(DIM_V2);
    expect(doc.vectorV2).toEqual(buildVectorV2(FEAT, ['house'], { idf: null })); // genre block exactly zero
    warn.mockRestore();
  });

  it('flag ON with the CATALOG unavailable: genres degrade to none, the job still completes', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    idfStats.use({ v: 1, n: 10, df: {}, computedAt: 0 });
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', FEAT]]));
    catalogRepo.getMany.mockRejectedValue(new Error('mongo down'));
    const out = await worker.process({ data: { recordingKeys: ['mbid:a'] } });
    expect(out.embedded).toBe(1);
    expect(vectorIndex.upsertMany.mock.calls[0][0][0].vectorV2).toHaveLength(DIM_V2);
    warn.mockRestore();
  });

  it('flag ON does NOT widen the ToS containment: a spotify:/youtube: key is still never embedded, in either space', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    idfStats.use({ v: 1, n: 10, df: {}, computedAt: 0 });
    featureRepo.getMany.mockResolvedValue(new Map([
      ['spotify:x', FEAT], ['youtube:y', FEAT], ['mbid:z', FEAT],
    ]));
    catalogRepo.getMany.mockResolvedValue(new Map());
    const out = await worker.process({ data: { recordingKeys: ['spotify:x', 'youtube:y', 'mbid:z'] } });
    expect(out.embedded).toBe(1);
    const docs = vectorIndex.upsertMany.mock.calls[0][0];
    expect(docs.map(d => d.recordingKey)).toEqual(['mbid:z']);
    // and the catalog lookup is scoped to the keys that survived the gate, so a restricted key
    // is not even LOOKED UP for genres.
    expect(catalogRepo.getMany.mock.calls[0][0]).toEqual(['mbid:z']);
  });
});

// ===========================================================================
// 7 · the read cutover — the pair, asserted as a pair.
// ===========================================================================
describe('discovery read cutover — the query vector and the index can never disagree', () => {
  let svc, vectorIndex, idfStats;
  let seen;

  beforeEach(() => {
    jest.resetModules();
    clearFlags();
    jest.doMock('../app/repositories/trackCatalogRepo', () => ({ getMany: jest.fn(async () => new Map()) }));
    jest.doMock('../app/repositories/audioFeatureRepo', () => ({ getMany: jest.fn(async () => new Map()) }));
    vectorIndex = require('../app/services/vector/vectorIndex');
    idfStats = require('../app/services/vector/idfStats');
    idfStats.reset();
    seen = [];
    vectorIndex.use({
      upsertMany: async () => ({ upserted: 0 }),
      getMany: async () => new Map(),
      queryNear: async (vector, opts) => { seen.push({ vector, opts }); return []; },
    });
    svc = require('../app/services/discovery/discoveryVectorService');
  });
  afterEach(() => { vectorIndex.use(null); idfStats.reset(); clearFlags(); jest.resetModules(); });

  const TARGET = { bpm: 120, energy: 0.6, valence: 0.5, acousticness: 0.3, danceability: 0.6, loudness: -8 };

  it('flags off: a 70-dim query against the v1 space (unchanged behaviour)', async () => {
    await svc.find({ targetFeatures: TARGET, seedGenres: [], k: 5, budgetMs: 500 });
    expect(seen).toHaveLength(1);
    expect(seen[0].vector).toHaveLength(DIM);
    expect(seen[0].opts.version).toBe('v1');
  });

  it('EMBEDDING_V2_READ on: a 135-dim query against the v2 space — both sides move, in one call', async () => {
    process.env.EMBEDDING_V2_READ = 'true';
    process.env.EMBEDDING_V2_WRITE = 'true'; // supported configuration; keeps the stale-index warning quiet
    idfStats.use({ v: 1, n: 100, df: { house: 10 }, computedAt: 0 });

    await svc.find({ targetFeatures: TARGET, seedGenres: ['house'], k: 5, budgetMs: 500 });

    expect(seen).toHaveLength(1);
    expect(seen[0].vector).toHaveLength(DIM_V2);
    expect(seen[0].opts.version).toBe('v2');
    // The query vector is the REAL v2 builder over the same inputs — not a re-derivation that
    // could drift from what the worker stored.
    expect(seen[0].vector).toEqual(buildVectorV2(TARGET, ['house'], { idf: { v: 1, n: 100, df: { house: 10 } } }));
  });

  // The measured consequence of the v2 geometry AT THE READ BOUNDARY. Pinned here rather than
  // discovered in production, because it is invisible until the cutover and it is the same
  // mechanism that caused the PR #135 discovery starvation, wearing a different hat.
  //
  // A v2 vector's genre block is 0.6 of a unit vector when the track is tagged and EXACTLY ZERO
  // when it is not. So the query and the candidate must AGREE about whether genre evidence
  // exists: a feature-only query scores a tagged candidate at 0.8x an otherwise-identical
  // untagged one, and a genre-seeded query does exactly the reverse. 0.8 is not an estimate -
  // it is the composition weight, and the numbers below are measured, not asserted from theory.
  //
  // Neither direction is a bug, and neither is fixable by a weight: it is what cosine length
  // normalisation MEANS when a document carries a field the query does not. What matters is that
  // the corpus is ~98% genre-less, so `DISCOVERY_FEATURE_ONLY_TARGET` (the seeding mode) and
  // `DISCOVERY_MIN_COSINE` (the floor) stop being independent settings at the moment
  // EMBEDDING_V2_READ flips - they must be tuned together, in the same sweep. Recorded as a hard
  // prerequisite of the cutover in ADR-0014 and H13, alongside the floor retune.
  it('v2 makes annotation MATCH worth exactly 0.8 in either direction - the cutover prerequisite, measured', () => {
    const idf = { v: 1, n: 100, df: { house: 10 }, computedAt: 0 };
    const untagged = buildVectorV2(TARGET, [], { idf });
    const tagged = buildVectorV2(TARGET, ['house'], { idf });
    const { cosine } = require('../app/services/vector/embedding');

    const featureOnlyQuery = buildTargetVector(TARGET, [], { version: 'v2', idf });
    expect(cosine(featureOnlyQuery, untagged)).toBeCloseTo(1.0, 10);
    expect(cosine(featureOnlyQuery, tagged)).toBeCloseTo(0.8, 10); // the annotated slice is handicapped

    const genreSeededQuery = buildTargetVector(TARGET, ['house'], { version: 'v2', idf });
    expect(cosine(genreSeededQuery, tagged)).toBeCloseTo(1.0, 10);
    expect(cosine(genreSeededQuery, untagged)).toBeCloseTo(0.8, 10); // ...and ~98% of the corpus is
  });

  it('a v2 query with NO usable target still abstains safely: discovery returns [] rather than searching with a null vector', async () => {
    process.env.EMBEDDING_V2_READ = 'true';
    process.env.EMBEDDING_V2_WRITE = 'true';
    const out = await svc.find({ targetFeatures: {}, seedGenres: [], k: 5, budgetMs: 500 });
    expect(out).toEqual([]);
    expect(seen).toHaveLength(0); // never hand $vectorSearch a null/short vector
  });
});

// ===========================================================================
// 8 · the MMR read path moves with discovery, or the cutover is only half done.
// ===========================================================================
describe('selection pipeline — MMR embeddings are read from the ACTIVE space', () => {
  let selectPlaylist, vectorIndex, seen;

  beforeEach(() => {
    jest.resetModules();
    clearFlags();
    jest.doMock('../app/config/redis', () => ({ getRedis: () => null, createConnection: jest.fn() }));
    jest.doMock('../app/services/ledger/serveLedger', () => ({
      recordServes: jest.fn(),
      hardExcluded: jest.fn().mockResolvedValue(new Set()),
      moodExcluded: jest.fn().mockResolvedValue(new Set()),
      getExposure: jest.fn().mockResolvedValue(new Map()),
    }));
    jest.doMock('../app/repositories/audioFeatureRepo', () => ({
      getMany: jest.fn(async () => new Map()), upsertMany: jest.fn(), missingKeys: jest.fn(),
    }));
    jest.doMock('../app/repositories/trackCatalogRepo', () => ({ getMany: jest.fn(async () => new Map()) }));
    vectorIndex = require('../app/services/vector/vectorIndex');
    seen = [];
    vectorIndex.use({
      upsertMany: async () => ({ upserted: 0 }),
      getMany: async (keys, opts) => { seen.push({ keys, opts }); return new Map(); },
      queryNear: async () => [],
    });
    ({ selectPlaylist } = require('../app/services/selection/pipeline'));
  });
  afterEach(() => { vectorIndex.use(null); clearFlags(); jest.resetModules(); });

  const PROFILE = {
    library: [{ id: 't1', provider: 'spotify', name: 'S', artist: 'A', genres: ['rock'], affinity: 10, uri: 'spotify:track:t1' }],
    lastAnalyzed: new Date('2026-07-01'),
  };

  it('flags off: MMR reads the v1 space', async () => {
    await selectPlaylist({ userId: 'u1', musicProfile: PROFILE, targets: {}, k: 3 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].opts?.version).toBe('v1');
  });

  it('EMBEDDING_V2_READ on: MMR reads the v2 space, so discovery and MMR are never in different spaces at once', async () => {
    process.env.EMBEDDING_V2_READ = 'true';
    process.env.EMBEDDING_V2_WRITE = 'true';
    await selectPlaylist({ userId: 'u1', musicProfile: PROFILE, targets: {}, k: 3 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0].opts?.version).toBe('v2');
  });
});

// ===========================================================================
// 9 · backfill — resumable by construction, and it reuses the ONE build path.
// ===========================================================================
describe('backfillEmbeddingV2 — re-enqueues through the worker rather than building a second time', () => {
  const { runBackfillV2, _cursorFilter } = require('../app/scripts/backfillEmbeddingV2');
  const { QUEUES } = require('../app/queues/definitions');

  beforeEach(() => clearFlags());
  afterEach(() => clearFlags());

  const cursorOf = (keys) => async () => (async function* () {
    for (const k of keys) yield { recordingKey: k };
  })();

  it('the cursor filter selects rows that have NO v2 vector — a killed run resumes where it stopped, with no bookkeeping', () => {
    expect(_cursorFilter()).toEqual({ vectorV2: { $exists: false } });
  });

  it('batches keys and enqueues them onto EMBEDDING_BUILD, flushing the final partial batch', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    const enqueueFn = jest.fn().mockResolvedValue({ queued: true });
    const out = await runBackfillV2({
      cursorFactory: cursorOf(['mbid:a', 'mbid:b', 'mbid:c']),
      batchSize: 2, throttleMs: 0, enqueueFn, sleep: async () => {},
    });
    expect(out).toEqual({ scanned: 3, enqueued: 3, batches: 2 });
    expect(enqueueFn.mock.calls.map(c => c[1].recordingKeys)).toEqual([['mbid:a', 'mbid:b'], ['mbid:c']]);
    expect(enqueueFn.mock.calls[0][0]).toBe(QUEUES.EMBEDDING_BUILD);
  });

  it('a failed batch is logged and the run continues — a bulk migration must not die on one enqueue', async () => {
    process.env.EMBEDDING_V2_WRITE = 'true';
    const err = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const enqueueFn = jest.fn()
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValue({ queued: true });
    const out = await runBackfillV2({
      cursorFactory: cursorOf(['a', 'b']), batchSize: 1, throttleMs: 0, enqueueFn, sleep: async () => {},
    });
    expect(out.scanned).toBe(2);
    expect(out.enqueued).toBe(1);
    err.mockRestore();
  });

  it('refuses to start when EMBEDDING_V2_WRITE is off — enqueueing a corpus-wide re-embed that writes no v2 vector is pure waste', async () => {
    clearFlags();
    await expect(runBackfillV2({
      cursorFactory: cursorOf(['a']), enqueueFn: jest.fn(), sleep: async () => {}, requireWriteFlag: true,
    })).rejects.toThrow(/EMBEDDING_V2_WRITE/);
  });

  it('rows without a recordingKey are skipped rather than enqueued as undefined', async () => {
    const enqueueFn = jest.fn().mockResolvedValue({ queued: true });
    const cursor = async () => (async function* () { yield {}; yield { recordingKey: 'a' }; })();
    process.env.EMBEDDING_V2_WRITE = 'true';
    const out = await runBackfillV2({ cursorFactory: cursor, batchSize: 10, throttleMs: 0, enqueueFn, sleep: async () => {} });
    expect(out.scanned).toBe(1);
    expect(enqueueFn.mock.calls[0][1].recordingKeys).toEqual(['a']);
  });
});

// ===========================================================================
// 10 · verifyProdRunbooks — Runbook 4, the v2 index.
// ===========================================================================
describe('verifyProdRunbooks — the v2 index arm (Runbook 4)', () => {
  const { checkVectorIndexV2, EXPECTED_DIM_V2, DEFAULT_VECTOR_INDEX_V2 } = require('../scripts/verifyProdRunbooks');

  const good = [{
    name: 'track_embedding_index_v2',
    latestDefinition: { fields: [{ type: 'vector', path: 'vectorV2', numDimensions: 135, similarity: 'cosine' }] },
  }];

  beforeEach(() => clearFlags());
  afterEach(() => clearFlags());

  it('EXPECTED_DIM_V2 is bound to the real buildVectorV2 contract, not to a copied number', () => {
    expect(EXPECTED_DIM_V2).toBe(DIM_V2);
    expect(EXPECTED_DIM_V2).toBe(135);
    expect(DEFAULT_VECTOR_INDEX_V2).toBe('track_embedding_index_v2');
    expect(buildVectorV2({ bpm: 120, energy: 0.5 }, [])).toHaveLength(EXPECTED_DIM_V2);
  });

  it('PASSes on the index H13 tells Daniel to build', () => {
    expect(checkVectorIndexV2(good).status).toBe('PASS');
  });

  it('a MISSING v2 index is SKIPPED while the read flag is off — v2 is dark by design, and a red check for a deliberately-absent index trains the operator to ignore the verifier', () => {
    const r = checkVectorIndexV2([]);
    expect(r.status).toBe('SKIPPED');
    expect(r.message).toMatch(/EMBEDDING_V2_READ/);
  });

  it('the SAME missing index is a FAIL once EMBEDDING_V2_READ is on — then it is discovery silently serving nothing', () => {
    process.env.EMBEDDING_V2_READ = 'true';
    expect(checkVectorIndexV2([]).status).toBe('FAIL');
  });

  it('a WRONG v2 index is a FAIL even while dark — it exists, so it is a mistake, not an absence', () => {
    const wrongDim = [{ name: 'track_embedding_index_v2', latestDefinition: { fields: [{ type: 'vector', path: 'vectorV2', numDimensions: 70, similarity: 'cosine' }] } }];
    const wrongPath = [{ name: 'track_embedding_index_v2', latestDefinition: { fields: [{ type: 'vector', path: 'vector', numDimensions: 135, similarity: 'cosine' }] } }];
    expect(checkVectorIndexV2(wrongDim).status).toBe('FAIL');
    expect(checkVectorIndexV2(wrongDim).message).toMatch(/numDimensions/);
    expect(checkVectorIndexV2(wrongPath).status).toBe('FAIL');
    expect(checkVectorIndexV2(wrongPath).message).toMatch(/path/);
  });

  it('a non-Atlas deployment (listSearchIndexes unsupported → null) is SKIPPED, never a false PASS', () => {
    expect(checkVectorIndexV2(null).status).toBe('SKIPPED');
  });

  it('honours ATLAS_VECTOR_INDEX_V2 so a renamed index is still verified', () => {
    process.env.ATLAS_VECTOR_INDEX_V2 = 'my_v2';
    const renamed = [{ name: 'my_v2', latestDefinition: { fields: [{ type: 'vector', path: 'vectorV2', numDimensions: 135, similarity: 'cosine' }] } }];
    expect(checkVectorIndexV2(renamed).status).toBe('PASS');
  });
});
