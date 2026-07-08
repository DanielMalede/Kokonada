'use strict';

jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) }));
jest.mock('../app/services/musicClassifier', () => ({ classifyTracks: jest.fn() }));
jest.mock('../app/repositories/unclassifiedRepo', () => ({ addMany: jest.fn().mockResolvedValue(0) }));
jest.mock('../app/services/musicProfileService', () => ({
  recomputeFootprint: jest.fn(() => ({ topGenres: ['g'], topArtists: ['a'], genreSet: ['g'] })),
}));

const MusicProfile = require('../app/models/MusicProfile');
const musicClassifier = require('../app/services/musicClassifier');
const unclassifiedRepo = require('../app/repositories/unclassifiedRepo');
const { purgeNonMusic } = require('../app/services/musicPurge');

function mockProfile(library) {
  MusicProfile.findOne.mockReturnValue({
    lean: () => Promise.resolve(library ? { userId: 'u1', library } : null),
  });
}

describe('purgeNonMusic', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hard-removes non-music, pools unclassified, keeps music + spotify, recomputes footprint', async () => {
    const library = [
      { id: 'sp1', provider: 'spotify', name: 'Song' },
      { id: 'v1', provider: 'youtube_music', name: 'Real Song', artist: 'Artist' },
      { id: 'j1', provider: 'youtube_music', name: 'vlog' },
      { id: 'u1', provider: 'youtube_music', name: 'weird' },
    ];
    mockProfile(library);
    musicClassifier.classifyTracks.mockResolvedValue({
      music: [library[0], library[1]],
      nonMusic: [library[2]],
      unclassified: [library[3]],
    });

    const res = await purgeNonMusic('u1');

    expect(res).toEqual({ scanned: 4, purged: 1, pooled: 1, kept: 2 });
    const setArg = MusicProfile.updateOne.mock.calls[0][1].$set;
    expect(setArg.library.map(t => t.id)).toEqual(['sp1', 'v1']); // survivors only
    expect(setArg.topGenres).toEqual(['g']);                       // from recomputeFootprint
    expect(unclassifiedRepo.addMany).toHaveBeenCalledWith('u1', [library[3]], 'purge');
  });

  it('is a no-op when the profile is missing or the library is empty', async () => {
    mockProfile(null);
    expect(await purgeNonMusic('u1')).toEqual({ scanned: 0, purged: 0, pooled: 0, kept: 0 });
    mockProfile([]);
    expect(await purgeNonMusic('u1')).toEqual({ scanned: 0, purged: 0, pooled: 0, kept: 0 });
    expect(MusicProfile.updateOne).not.toHaveBeenCalled();
  });

  it('does not touch the pool when nothing is unclassified', async () => {
    const library = [{ id: 'v1', provider: 'youtube_music', name: 'Song', artist: 'A' }];
    mockProfile(library);
    musicClassifier.classifyTracks.mockResolvedValue({ music: library, nonMusic: [], unclassified: [] });
    await purgeNonMusic('u1');
    expect(unclassifiedRepo.addMany).not.toHaveBeenCalled();
  });
});
