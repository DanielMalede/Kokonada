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
    featureService.hydrate.mockResolvedValue({ targeted: 2, hydrated: 2, upgraded: 0, api: 0, llm: 2 });

    const res = await runForUser('u1');

    expect(musicPurge.purgeNonMusic).toHaveBeenCalledWith('u1', expect.objectContaining({ useLLM: true }));
    expect(featureService.hydrate).toHaveBeenCalledWith([{ id: 'a' }, { id: 'b' }]); // the SURVIVORS
    expect(res).toEqual({ purged: 3, pooled: 2, hydrated: 2, missing: 0, onLLMEstimate: 0 });
  });

  it('missing counts only truly-featureless tracks (targeted - upgraded - llm)', async () => {
    musicPurge.purgeNonMusic.mockResolvedValue({ purged: 0, pooled: 0, kept: 5 });
    MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ library: [] }) });
    featureService.hydrate.mockResolvedValue({ targeted: 5, hydrated: 3, upgraded: 0, api: 0, llm: 3 });

    const res = await runForUser('u1');
    expect(res).toEqual({ purged: 0, pooled: 0, hydrated: 3, missing: 2, onLLMEstimate: 0 });
  });

  it('upgrade-only targets (ReccoBeats catalog gap) are NOT missing — they stay on LLM features', async () => {
    // The real prod shape: every target is an already-LLM-estimated upgrade candidate that
    // ReccoBeats cannot measure, so hydrated=0 but nothing is truly featureless.
    musicPurge.purgeNonMusic.mockResolvedValue({ purged: 556, pooled: 0, kept: 3719 });
    MusicProfile.findOne.mockReturnValue({ lean: () => Promise.resolve({ library: [] }) });
    featureService.hydrate.mockResolvedValue({ targeted: 539, hydrated: 0, upgraded: 539, api: 0, llm: 0 });

    const res = await runForUser('u1');
    expect(res).toEqual({ purged: 556, pooled: 0, hydrated: 0, missing: 0, onLLMEstimate: 539 });
  });
});
