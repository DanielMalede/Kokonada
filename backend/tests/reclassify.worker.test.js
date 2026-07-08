'use strict';

jest.mock('../app/repositories/unclassifiedRepo', () => ({
  dueBatch: jest.fn(),
  remove: jest.fn().mockResolvedValue({}),
  reschedule: jest.fn().mockResolvedValue({}),
}));
jest.mock('../app/services/musicClassifier', () => ({ classifyTracks: jest.fn() }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/models/User', () => ({ findById: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/services/musicProfileService', () => ({
  recomputeFootprint: jest.fn(() => ({ topGenres: [], topArtists: [], genreSet: [] })),
}));

const unclassifiedRepo = require('../app/repositories/unclassifiedRepo');
const musicClassifier = require('../app/services/musicClassifier');
const MusicProfile = require('../app/models/MusicProfile');
const { process: reclassify } = require('../app/workers/reclassify.worker');

describe('reclassify.worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ userId: 'u1', library: [] }) });
  });

  it('is a no-op when nothing is due', async () => {
    unclassifiedRepo.dueBatch.mockResolvedValue([]);
    expect(await reclassify({})).toEqual({ promoted: 0, deleted: 0, deferred: 0 });
  });

  it('promotes a music-verdict row into the library and removes the pool row', async () => {
    const row = { _id: 'r1', userId: 'u1', attempts: 0, track: { id: 'v1', provider: 'youtube_music', name: 'Song', artist: 'A', canonicalKey: 'at:a|song' } };
    unclassifiedRepo.dueBatch.mockResolvedValue([row]);
    musicClassifier.classifyTracks.mockResolvedValue({ music: [row.track], nonMusic: [], unclassified: [] });

    const res = await reclassify({});
    expect(res).toEqual({ promoted: 1, deleted: 0, deferred: 0 });
    const setArg = MusicProfile.updateOne.mock.calls[0][1].$set;
    expect(setArg.library.map(t => t.id)).toContain('v1');
    expect(unclassifiedRepo.remove).toHaveBeenCalledWith('r1');
    expect(unclassifiedRepo.reschedule).not.toHaveBeenCalled();
  });

  it('hard-deletes a non-music-verdict pool row and never touches the profile', async () => {
    const row = { _id: 'r2', userId: 'u1', attempts: 0, track: { id: 'j1', provider: 'youtube_music', name: 'vlog' } };
    unclassifiedRepo.dueBatch.mockResolvedValue([row]);
    musicClassifier.classifyTracks.mockResolvedValue({ music: [], nonMusic: [row.track], unclassified: [] });

    const res = await reclassify({});
    expect(res).toEqual({ promoted: 0, deleted: 1, deferred: 0 });
    expect(unclassifiedRepo.remove).toHaveBeenCalledWith('r2');
    expect(MusicProfile.updateOne).not.toHaveBeenCalled();
  });

  it('reschedules a still-unclassified row with backoff, never deleting it (Groq still down)', async () => {
    const row = { _id: 'r3', userId: 'u1', attempts: 1, track: { id: 'x1', provider: 'youtube_music', name: 'weird' } };
    unclassifiedRepo.dueBatch.mockResolvedValue([row]);
    musicClassifier.classifyTracks.mockResolvedValue({ music: [], nonMusic: [], unclassified: [row.track] });

    const res = await reclassify({});
    expect(res).toEqual({ promoted: 0, deleted: 0, deferred: 1 });
    expect(unclassifiedRepo.reschedule).toHaveBeenCalledWith('r3', 2, expect.any(Date));
    expect(unclassifiedRepo.remove).not.toHaveBeenCalled();
  });

  it('registers a reclassify queue + processor', () => {
    const { QUEUES } = require('../app/queues/definitions');
    const { DEFAULT_PROCESSORS } = require('../app/workers');
    expect(QUEUES.RECLASSIFY_UNCLASSIFIED).toBe('reclassify-unclassified');
    expect(typeof DEFAULT_PROCESSORS[QUEUES.RECLASSIFY_UNCLASSIFIED]).toBe('function');
  });
});
