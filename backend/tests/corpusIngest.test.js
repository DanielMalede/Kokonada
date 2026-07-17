// backend/tests/corpusIngest.test.js
jest.mock('../app/repositories/trackCatalogRepo', () => ({ upsertMany: jest.fn(async () => ({ upserted: 0 })) }));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn(async () => {}) }));
jest.mock('../app/services/vector/vectorIndex', () => ({ getMany: jest.fn(async () => new Map()) }));
jest.mock('../app/services/features/featureService', () => ({ enqueueHydration: jest.fn(async () => ({ queued: true })) }));

const corpusIngest = require('../app/services/discovery/corpusIngest');
const trackCatalogRepo = require('../app/repositories/trackCatalogRepo');
const { enqueue } = require('../app/queues/queue');
const vectorIndex = require('../app/services/vector/vectorIndex');
const featureService = require('../app/services/features/featureService');
const { QUEUES } = require('../app/queues/definitions');

describe('corpusIngest.ingestLibrary', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('catalogs + enqueues an embedding-build job for tracks with a recordingKey', async () => {
    const res = await corpusIngest.ingestLibrary([
      { recordingKey: 'mbid:t1', canonicalKey: 'c1', uri: null, title: 'B', artist: 'A', genres: ['rock'] },
    ]);
    expect(res.catalogued).toBe(1);
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['mbid:t1'], genresByKey: { 'mbid:t1': ['rock'] } });
  });

  it('skips keys already embedded in the corpus — enqueues only the new one', async () => {
    vectorIndex.getMany.mockResolvedValueOnce(new Map([['mbid:t1', [0.1]]]));
    const res = await corpusIngest.ingestLibrary([
      { recordingKey: 'mbid:t1', genres: ['rock'] },
      { recordingKey: 'mbid:t2', genres: ['indie'] },
    ]);
    expect(res).toMatchObject({ catalogued: 2, enqueued: 1 });
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1); // both still catalogued
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['mbid:t2'], genresByKey: { 'mbid:t2': ['indie'] } });
  });

  it('drops spotify AND youtube tracks — only mbid rows reach upsert/embed (third-party-ToS containment)', async () => {
    const res = await corpusIngest.ingestLibrary([
      { id: 'sp', provider: 'spotify', uri: 'spotify:track:sp', title: 'S', genres: ['rock'] },
      { recordingKey: 'spotify:pre', uri: 'spotify:track:pre', genres: ['pop'] },
      { id: 'yt', provider: 'youtube_music', name: 'Y', genres: ['jazz'] },
      { recordingKey: 'mbid:keep', genres: ['ambient'] },
    ]);
    expect(res).toMatchObject({ catalogued: 1, enqueued: 1 });
    const catalogued = trackCatalogRepo.upsertMany.mock.calls[0][0];
    expect(catalogued.map(e => e.recordingKey)).toEqual(['mbid:keep']);
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['mbid:keep'], genresByKey: { 'mbid:keep': ['ambient'] } });
  });

  it('never throws — a repo failure is swallowed', async () => {
    trackCatalogRepo.upsertMany.mockRejectedValueOnce(new Error('db down'));
    await expect(corpusIngest.ingestLibrary([{ recordingKey: 'x' }])).resolves.toMatchObject({ catalogued: 0 });
  });
});

describe('corpusIngest.ingestGlobal', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('catalogs pre-normalized entries WITHOUT re-deriving keys (source flows through) + enqueues embedding', async () => {
    const res = await corpusIngest.ingestGlobal([
      { recordingKey: 'mbid:m1', canonicalKey: 'at:a|b', uri: null, title: 'B', artist: 'A', genres: ['jazz'], source: 'global' },
    ]);
    expect(res).toMatchObject({ catalogued: 1, enqueued: 1 });
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledWith([expect.objectContaining({ recordingKey: 'mbid:m1', source: 'global', uri: null })]);
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['mbid:m1'], genresByKey: { 'mbid:m1': ['jazz'] } });
  });

  it('skips keys already embedded', async () => {
    vectorIndex.getMany.mockResolvedValueOnce(new Map([['mbid:m1', [0.1]]]));
    const res = await corpusIngest.ingestGlobal([
      { recordingKey: 'mbid:m1', source: 'global' },
      { recordingKey: 'mbid:m2', source: 'global', genres: ['rock'] },
    ]);
    expect(res).toMatchObject({ catalogued: 2, enqueued: 1 });
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['mbid:m2'], genresByKey: { 'mbid:m2': ['rock'] } });
  });

  it('never throws — a repo failure is swallowed; empty input no-op', async () => {
    trackCatalogRepo.upsertMany.mockRejectedValueOnce(new Error('db down'));
    await expect(corpusIngest.ingestGlobal([{ recordingKey: 'mbid:x', source: 'global' }])).resolves.toMatchObject({ catalogued: 0 });
    expect(await corpusIngest.ingestGlobal([])).toMatchObject({ catalogued: 0, enqueued: 0 });
  });
});

describe('corpusIngest.backfillLibrary', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('catalogs + enqueues embedding AND ensures AudioFeatures via hydration', async () => {
    const res = await corpusIngest.backfillLibrary([{ recordingKey: 'mbid:t1', genres: ['rock'] }]);
    expect(res.catalogued).toBe(1);
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1);
    expect(featureService.enqueueHydration).toHaveBeenCalledWith([{ recordingKey: 'mbid:t1', genres: ['rock'] }]);
  });

  it('a hydration failure does not break the catalog+embed path', async () => {
    featureService.enqueueHydration.mockRejectedValueOnce(new Error('hydration down'));
    const res = await corpusIngest.backfillLibrary([{ recordingKey: 'x' }]);
    expect(res.catalogued).toBe(1);
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1);
  });
});
