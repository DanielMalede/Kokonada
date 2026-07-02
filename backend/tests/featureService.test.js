'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/services/features/reccoBeatsAdapter', () => ({
  supports: jest.fn((t) => t.provider === 'spotify' || String(t.uri ?? '').startsWith('spotify:')),
  getFeatures: jest.fn().mockResolvedValue([]),
}));
jest.mock('../app/services/features/llmEstimatorAdapter', () => ({
  supports: jest.fn(() => true),
  getFeatures: jest.fn().mockResolvedValue([]),
}));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn(),
  upsertMany: jest.fn().mockResolvedValue({ upserted: 0 }),
  missingKeys: jest.fn().mockResolvedValue([]),
}));
jest.mock('../app/queues/queue', () => ({
  enqueue: jest.fn().mockResolvedValue({ queued: true }),
  scheduleRepeatable: jest.fn(),
}));

const reccoBeats   = require('../app/services/features/reccoBeatsAdapter');
const llmEstimator = require('../app/services/features/llmEstimatorAdapter');
const repo         = require('../app/repositories/audioFeatureRepo');
const { enqueue }  = require('../app/queues/queue');

const { hydrate, enqueueHydration } = require('../app/services/features/featureService');

const spTrack = (id) => ({ id, provider: 'spotify', name: `Song ${id}`, artist: 'Artist', genres: ['pop'] });
const ytTrack = (id) => ({ id, provider: 'youtube_music', name: `Video ${id}`, artist: 'Channel', genres: [] });

const apiHit = (track, features = { bpm: 120, energy: 0.5 }) => ({
  track, recordingKey: `spotify:${track.id}`, features, source: 'api', confidence: 1,
});
const llmHit = (track, features = { bpm: 100 }) => ({
  track, recordingKey: `youtube:${track.id}`, features, source: 'llm', confidence: 0.5,
});

beforeEach(() => {
  jest.clearAllMocks();
  repo.getMany.mockResolvedValue(new Map());                 // default: nothing stored yet
  repo.missingKeys.mockImplementation(async (keys) => keys); // enqueueHydration's diff
  repo.upsertMany.mockResolvedValue({ upserted: 0 });
  reccoBeats.getFeatures.mockResolvedValue([]);
  llmEstimator.getFeatures.mockResolvedValue([]);
  enqueue.mockResolvedValue({ queued: true });
});

describe('featureService.hydrate', () => {
  it('skips recordings already measured in the store', async () => {
    repo.getMany.mockResolvedValue(new Map([['spotify:a', { source: 'api', bpm: 120 }]]));
    reccoBeats.getFeatures.mockImplementation(async (tracks) => tracks.map(t => apiHit(t)));

    await hydrate([spTrack('a'), spTrack('b')]);

    const sent = reccoBeats.getFeatures.mock.calls[0][0];
    expect(sent).toHaveLength(1);
    expect(sent[0].id).toBe('b');
  });

  it('UPGRADES a stored LLM estimate once the track has a Spotify id (api overwrites llm)', async () => {
    repo.getMany.mockResolvedValue(new Map([['spotify:a', { source: 'llm', confidence: 0.5 }]]));
    reccoBeats.getFeatures.mockImplementation(async (tracks) => tracks.map(t => apiHit(t)));

    const summary = await hydrate([spTrack('a')]);

    expect(summary.upgraded).toBe(1);
    expect(reccoBeats.getFeatures.mock.calls[0][0][0].id).toBe('a');
    expect(llmEstimator.getFeatures).not.toHaveBeenCalled(); // upgrades never re-enter the LLM path
    expect(repo.upsertMany.mock.calls[0][0][0]).toEqual(expect.objectContaining({ source: 'api', confidence: 1 }));
  });

  it('stored API measurements are never re-fetched or downgraded', async () => {
    repo.getMany.mockResolvedValue(new Map([['spotify:a', { source: 'api' }]]));

    const summary = await hydrate([spTrack('a')]);

    expect(reccoBeats.getFeatures).not.toHaveBeenCalled();
    expect(summary.upgraded).toBe(0);
  });

  it('enqueues embedding enrichment for freshly hydrated recordings (fire-and-forget)', async () => {
    reccoBeats.getFeatures.mockImplementation(async (tracks) => tracks.map(t => apiHit(t)));

    await hydrate([spTrack('a')]);

    expect(enqueue).toHaveBeenCalledWith('embedding-build', expect.objectContaining({
      recordingKeys: ['spotify:a'],
      genresByKey: expect.objectContaining({ 'spotify:a': ['pop'] }),
    }));
  });

  it('api-fed recordings never reach the LLM; api misses do', async () => {
    const sp = spTrack('a');
    const yt = ytTrack('v1');
    reccoBeats.getFeatures.mockResolvedValue([apiHit(sp)]);
    llmEstimator.getFeatures.mockImplementation(async (tracks) => tracks.map(t => llmHit(t)));

    await hydrate([sp, yt]);

    const llmSent = llmEstimator.getFeatures.mock.calls[0][0];
    expect(llmSent.map(t => t.id)).toEqual(['v1']);
  });

  it('persists docs carrying identity + provenance and returns an honest summary', async () => {
    const sp = spTrack('a');
    const yt = ytTrack('v1');
    const ghost = ytTrack('ghost');
    reccoBeats.getFeatures.mockResolvedValue([apiHit(sp)]);
    llmEstimator.getFeatures.mockImplementation(async (tracks) =>
      tracks.map(t => (t.id === 'v1' ? llmHit(t) : { track: t, recordingKey: `youtube:${t.id}`, features: null, source: 'llm', confidence: null })));

    const summary = await hydrate([sp, yt, ghost]);

    const docs = repo.upsertMany.mock.calls[0][0];
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual(expect.objectContaining({
      recordingKey: 'spotify:a', spotifyId: 'a', canonicalKey: expect.stringMatching(/^at:/),
      source: 'api', confidence: 1, bpm: 120,
    }));
    expect(docs[1]).toEqual(expect.objectContaining({ recordingKey: 'youtube:v1', source: 'llm', confidence: 0.5 }));
    expect(summary).toEqual(expect.objectContaining({ requested: 3, hydrated: 2, api: 1, llm: 1, failed: 1 }));
  });

  it('dedupes by recordingKey and drops keyless tracks', async () => {
    reccoBeats.getFeatures.mockImplementation(async (tracks) => tracks.map(t => apiHit(t)));

    await hydrate([spTrack('a'), spTrack('a'), { name: 'no id at all' }]);

    expect(reccoBeats.getFeatures.mock.calls[0][0]).toHaveLength(1);
  });

  it('does nothing (no adapters, no writes) when everything is already stored', async () => {
    repo.getMany.mockResolvedValue(new Map([['spotify:a', { source: 'api' }]]));

    const summary = await hydrate([spTrack('a')]);

    expect(reccoBeats.getFeatures).not.toHaveBeenCalled();
    expect(llmEstimator.getFeatures).not.toHaveBeenCalled();
    expect(repo.upsertMany).not.toHaveBeenCalled();
    expect(summary.hydrated).toBe(0);
  });
});

describe('shadow audit — outage degradation', () => {
  it('a ReccoBeats outage never lets LLM guesses replace measurable Spotify features', async () => {
    const sp = spTrack('a');
    // API supports the track but the batch failed → features:null
    reccoBeats.getFeatures.mockResolvedValue([
      { track: sp, recordingKey: 'spotify:a', features: null, source: 'api', confidence: null },
    ]);
    llmEstimator.getFeatures.mockImplementation(async (tracks) => tracks.map(t => llmHit(t)));

    const summary = await hydrate([sp]);

    // The Spotify track stays MISSING (retried next hydration) instead of being
    // permanently degraded to an LLM estimate the repo would then protect.
    expect(llmEstimator.getFeatures).not.toHaveBeenCalled();
    expect(repo.upsertMany).not.toHaveBeenCalled();
    expect(summary.failed).toBe(1);
  });
});

describe('featureService.enqueueHydration', () => {
  it('short-circuits when nothing is missing', async () => {
    repo.missingKeys.mockResolvedValue([]);

    const result = await enqueueHydration([spTrack('a')]);

    expect(result).toEqual({ queued: false, reason: 'all-hydrated' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a minimal payload for the missing recordings only', async () => {
    repo.missingKeys.mockResolvedValue(['youtube:v1']);

    const result = await enqueueHydration([spTrack('a'), ytTrack('v1')]);

    expect(result).toEqual({ queued: true });
    const [queueName, payload] = enqueue.mock.calls[0];
    expect(queueName).toBe('feature-hydration');
    expect(payload.tracks).toHaveLength(1);
    expect(payload.tracks[0]).toEqual(expect.objectContaining({
      id: 'v1', provider: 'youtube_music', title: 'Video v1', canonicalKey: expect.any(String),
    }));
  });

  it('never throws — a repo failure degrades to {queued:false}', async () => {
    repo.missingKeys.mockRejectedValue(new Error('mongo down'));

    await expect(enqueueHydration([spTrack('a')])).resolves.toEqual({ queued: false, reason: 'error' });
  });
});
