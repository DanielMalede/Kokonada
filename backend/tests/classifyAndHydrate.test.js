'use strict';

jest.mock('../app/models/User', () => ({ findById: jest.fn().mockResolvedValue(null) }));
jest.mock('../app/models/MusicProfile', () => ({ findOne: jest.fn() }));
jest.mock('../app/services/musicPurge', () => ({ purgeNonMusic: jest.fn() }));
jest.mock('../app/services/features/featureService', () => ({ hydrate: jest.fn() }));

const MusicProfile = require('../app/models/MusicProfile');
const musicPurge = require('../app/services/musicPurge');
const featureService = require('../app/services/features/featureService');
const { runForUser } = require('../app/scripts/classifyAndHydrate');

describe('classifyAndHydrate.runForUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('purges non-music, then hydrates the surviving library, and reports counts', async () => {
    musicPurge.purgeNonMusic.mockResolvedValue({ purged: 3, pooled: 2, kept: 10 });
    MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ library: [{ id: 'a' }, { id: 'b' }] }) });
    featureService.hydrate.mockResolvedValue({ targeted: 2, hydrated: 2 });

    const res = await runForUser('u1');

    expect(musicPurge.purgeNonMusic).toHaveBeenCalledWith('u1', expect.objectContaining({ useLLM: true }));
    expect(featureService.hydrate).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]); // the SURVIVORS
    expect(res).toEqual({ purged: 3, pooled: 2, hydrated: 2, missing: 0 });
  });

  it('reports missing = targeted - hydrated when a pass is incomplete', async () => {
    musicPurge.purgeNonMusic.mockResolvedValue({ purged: 0, pooled: 0, kept: 5 });
    MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ library: [] }) });
    featureService.hydrate.mockResolvedValue({ targeted: 5, hydrated: 3 });

    const res = await runForUser('u1');
    expect(res).toEqual({ purged: 0, pooled: 0, hydrated: 3, missing: 2 });
  });
});
