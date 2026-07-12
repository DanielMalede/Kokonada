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
      { recordingKey: 'spotify:t1', canonicalKey: 'c1', uri: 'spotify:track:t1', title: 'B', artist: 'A', genres: ['rock'] },
    ]);
    expect(res.catalogued).toBe(1);
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['spotify:t1'], genresByKey: { 'spotify:t1': ['rock'] } });
  });

  it('skips keys already embedded in the corpus — enqueues only the new one', async () => {
    vectorIndex.getMany.mockResolvedValueOnce(new Map([['spotify:t1', [0.1]]]));
    const res = await corpusIngest.ingestLibrary([
      { recordingKey: 'spotify:t1', genres: ['rock'] },
      { recordingKey: 'spotify:t2', genres: ['indie'] },
    ]);
    expect(res).toMatchObject({ catalogued: 2, enqueued: 1 });
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1); // both still catalogued
    expect(enqueue).toHaveBeenCalledWith(QUEUES.EMBEDDING_BUILD, { recordingKeys: ['spotify:t2'], genresByKey: { 'spotify:t2': ['indie'] } });
  });

  it('never throws — a repo failure is swallowed', async () => {
    trackCatalogRepo.upsertMany.mockRejectedValueOnce(new Error('db down'));
    await expect(corpusIngest.ingestLibrary([{ recordingKey: 'x' }])).resolves.toMatchObject({ catalogued: 0 });
  });
});

describe('corpusIngest.backfillLibrary', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('catalogs + enqueues embedding AND ensures AudioFeatures via hydration', async () => {
    const res = await corpusIngest.backfillLibrary([{ recordingKey: 'spotify:t1', genres: ['rock'] }]);
    expect(res.catalogued).toBe(1);
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1);
    expect(featureService.enqueueHydration).toHaveBeenCalledWith([{ recordingKey: 'spotify:t1', genres: ['rock'] }]);
  });

  it('a hydration failure does not break the catalog+embed path', async () => {
    featureService.enqueueHydration.mockRejectedValueOnce(new Error('hydration down'));
    const res = await corpusIngest.backfillLibrary([{ recordingKey: 'x' }]);
    expect(res.catalogued).toBe(1);
    expect(trackCatalogRepo.upsertMany).toHaveBeenCalledTimes(1);
  });
});
