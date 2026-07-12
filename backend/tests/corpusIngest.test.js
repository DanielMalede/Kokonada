// backend/tests/corpusIngest.test.js
jest.mock('../app/repositories/trackCatalogRepo', () => ({ upsertMany: jest.fn(async () => ({ upserted: 0 })) }));
jest.mock('../app/queues/queue', () => ({ enqueue: jest.fn(async () => {}) }));

const corpusIngest = require('../app/services/discovery/corpusIngest');
const trackCatalogRepo = require('../app/repositories/trackCatalogRepo');
const { enqueue } = require('../app/queues/queue');
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

  it('never throws — a repo failure is swallowed', async () => {
    trackCatalogRepo.upsertMany.mockRejectedValueOnce(new Error('db down'));
    await expect(corpusIngest.ingestLibrary([{ recordingKey: 'x' }])).resolves.toMatchObject({ catalogued: 0 });
  });
});
