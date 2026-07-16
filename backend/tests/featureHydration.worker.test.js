'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/services/features/featureService', () => ({
  hydrate: jest.fn().mockResolvedValue({ requested: 1, hydrated: 1, api: 1, llm: 0, failed: 0 }),
  enqueueHydration: jest.fn(),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({ llmUpgradeCandidates: jest.fn() }));

const featureService = require('../app/services/features/featureService');
const featureRepo = require('../app/repositories/audioFeatureRepo');
const worker = require('../app/workers/featureHydration.worker');
const { DEFAULT_PROCESSORS } = require('../app/workers');
const { QUEUES } = require('../app/queues/definitions');

describe('featureHydration worker', () => {
  beforeEach(() => jest.clearAllMocks());

  it('processes a job by hydrating its tracks and returns the summary', async () => {
    const tracks = [{ id: 'a', provider: 'spotify' }];

    const out = await worker.process({ data: { tracks } });

    expect(featureService.hydrate).toHaveBeenCalledWith(tracks);
    expect(out.hydrated).toBe(1);
  });

  it('is registered as the default processor for the feature-hydration queue', () => {
    expect(DEFAULT_PROCESSORS[QUEUES.FEATURE_HYDRATION]).toBe(worker.process);
  });

  it('upgrade-llm mode excludes spotify candidates before hydration (Spotify-ToS containment)', async () => {
    featureRepo.llmUpgradeCandidates.mockResolvedValue([
      { spotifyId: 'x', recordingKey: 'spotify:x', canonicalKey: 'c1' },
      { spotifyId: 'y', recordingKey: 'spotify:y', canonicalKey: 'c2' },
    ]);

    await worker.process({ data: { mode: 'upgrade-llm' } });

    const passed = featureService.hydrate.mock.calls[0][0];
    expect(passed.every(t => t.provider !== 'spotify')).toBe(true);
    expect(passed).toEqual([]);
  });
});
