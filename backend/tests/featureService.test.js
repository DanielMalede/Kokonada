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
const ytLlmHit = (track, features = { bpm: 100 }) => ({
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

// Spotify-ToS containment: ReccoBeats (the measured-feature adapter) supports ONLY
// spotify tracks, and Spotify Content must never enter the AudioFeature store or the
// embedding queue. So hydration now excludes spotify: recordings at the entry choke and
// exercises the LLM-estimation path for the non-spotify (youtube / global mbid) corpus.
describe('featureService.hydrate', () => {
  it('excludes spotify tracks entirely — never fetched, stored, or enqueued (Spotify-ToS containment)', async () => {
    reccoBeats.getFeatures.mockImplementation(async (tracks) => tracks.map(t => apiHit(t)));
    llmEstimator.getFeatures.mockImplementation(async (tracks) => tracks.map(t => ytLlmHit(t)));

    const summary = await hydrate([spTrack('a'), spTrack('b')]);

    expect(reccoBeats.getFeatures).not.toHaveBeenCalled();
    expect(llmEstimator.getFeatures).not.toHaveBeenCalled();
    expect(repo.upsertMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(summary.requested).toBe(0);
  });

  // Invariant guards (replacing the deleted measured-tier coverage): the gate must hold even for a
  // MALFORMED/MISLABELED track that a future producer could emit — provider- and spotifyId-aware,
  // not just recordingKey-scheme. These prove the still-live ReccoBeats measured path can never be
  // reached (and its spotifyId can never be stored) by a surviving Spotify-tagged input.
  it('gate holds under a malformed track: mbid recordingKey but provider spotify (never fetched/stored)', async () => {
    reccoBeats.getFeatures.mockImplementation(async (tracks) => tracks.map(t => apiHit(t)));

    const summary = await hydrate([{ recordingKey: 'mbid:x', provider: 'spotify', id: 'abc' }]);

    expect(reccoBeats.getFeatures).not.toHaveBeenCalled();
    expect(repo.upsertMany).not.toHaveBeenCalled();
    expect(summary.requested).toBe(0);
  });

  it('gate holds under a mislabeled track: youtube recordingKey but a spotifyId (never fetched/stored)', async () => {
    reccoBeats.getFeatures.mockImplementation(async (tracks) => tracks.map(t => apiHit(t)));

    const summary = await hydrate([{ recordingKey: 'youtube:x', spotifyId: 'abc' }]);

    expect(reccoBeats.getFeatures).not.toHaveBeenCalled();
    expect(repo.upsertMany).not.toHaveBeenCalled();
    expect(summary.requested).toBe(0);
  });

  it('hydrates youtube-only tracks via the LLM estimator and stores them', async () => {
    llmEstimator.getFeatures.mockImplementation(async (tracks) => tracks.map(t => ytLlmHit(t)));

    const summary = await hydrate([ytTrack('v1')]);

    const docs = repo.upsertMany.mock.calls[0][0];
    expect(docs.map(d => d.recordingKey)).toEqual(['youtube:v1']);
    expect(summary).toEqual(expect.objectContaining({ hydrated: 1, llm: 1 }));
  });

  it('enqueues embedding enrichment with spotify-free genresByKey (fire-and-forget)', async () => {
    const yt = { id: 'v1', provider: 'youtube_music', name: 'V', artist: 'C', genres: ['lofi'] };
    llmEstimator.getFeatures.mockImplementation(async (tracks) => tracks.map(t => ytLlmHit(t)));

    await hydrate([yt]);

    expect(enqueue).toHaveBeenCalledWith('embedding-build', expect.objectContaining({
      recordingKeys: ['youtube:v1'],
      genresByKey: { 'youtube:v1': ['lofi'] },
    }));
    const [, payload] = enqueue.mock.calls[0];
    expect(Object.keys(payload.genresByKey).some(k => /^spotify:/i.test(k))).toBe(false);
  });

  it('a mixed library hydrates youtube via LLM but excludes spotify (Spotify-ToS containment)', async () => {
    llmEstimator.getFeatures.mockImplementation(async (tracks) => tracks.map(t => ytLlmHit(t)));

    await hydrate([spTrack('a'), ytTrack('v1')]);

    // reccoBeats supports ONLY spotify; with spotify gated out, only youtube reaches the LLM path.
    const llmSent = llmEstimator.getFeatures.mock.calls[0][0];
    expect(llmSent.map(t => t.id)).toEqual(['v1']);
    const docs = repo.upsertMany.mock.calls[0][0];
    expect(docs.map(d => d.recordingKey)).toEqual(['youtube:v1']);
  });

  it('the store never receives a spotify: doc even if an adapter mislabels one (belt before upsertMany)', async () => {
    llmEstimator.getFeatures.mockResolvedValue(
      [{ track: ytTrack('v1'), recordingKey: 'spotify:leak', features: { bpm: 90 }, source: 'llm', confidence: 0.5 }],
    );

    await hydrate([ytTrack('v1')]);

    expect(repo.upsertMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('persists docs carrying identity + provenance and returns an honest summary', async () => {
    const yt = ytTrack('v1');
    const ghost = ytTrack('ghost');
    llmEstimator.getFeatures.mockImplementation(async (tracks) =>
      tracks.map(t => (t.id === 'v1'
        ? ytLlmHit(t)
        : { track: t, recordingKey: `youtube:${t.id}`, features: null, source: 'llm', confidence: null })));

    const summary = await hydrate([yt, ghost]);

    const docs = repo.upsertMany.mock.calls[0][0];
    expect(docs).toHaveLength(1);
    expect(docs[0]).toEqual(expect.objectContaining({
      recordingKey: 'youtube:v1', spotifyId: null, canonicalKey: expect.stringMatching(/^at:/),
      source: 'llm', confidence: 0.5, bpm: 100,
    }));
    expect(summary).toEqual(expect.objectContaining({ requested: 2, hydrated: 1, llm: 1, failed: 1 }));
  });

  it('dedupes by recordingKey and drops keyless tracks', async () => {
    llmEstimator.getFeatures.mockImplementation(async (tracks) => tracks.map(t => ytLlmHit(t)));

    await hydrate([ytTrack('v1'), ytTrack('v1'), { name: 'no id at all' }]);

    expect(llmEstimator.getFeatures.mock.calls[0][0]).toHaveLength(1);
  });

  it('does nothing (no adapters, no writes) when everything is already stored', async () => {
    repo.getMany.mockResolvedValue(new Map([['youtube:v1', { source: 'llm' }]]));

    const summary = await hydrate([ytTrack('v1')]);

    expect(reccoBeats.getFeatures).not.toHaveBeenCalled();
    expect(llmEstimator.getFeatures).not.toHaveBeenCalled();
    expect(repo.upsertMany).not.toHaveBeenCalled();
    expect(summary.hydrated).toBe(0);
  });
});

describe('featureService.enqueueHydration', () => {
  it('short-circuits when nothing is missing', async () => {
    repo.missingKeys.mockResolvedValue([]);

    const result = await enqueueHydration([ytTrack('v1')]);

    expect(result).toEqual({ queued: false, reason: 'all-hydrated' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('enqueues a minimal payload for the missing recordings only', async () => {
    repo.missingKeys.mockResolvedValue(['youtube:v1']);

    const result = await enqueueHydration([ytTrack('v1')]);

    expect(result).toEqual({ queued: true });
    const [queueName, payload] = enqueue.mock.calls[0];
    expect(queueName).toBe('feature-hydration');
    expect(payload.tracks).toHaveLength(1);
    expect(payload.tracks[0]).toEqual(expect.objectContaining({
      id: 'v1', provider: 'youtube_music', title: 'Video v1', canonicalKey: expect.any(String),
    }));
  });

  it('excludes spotify tracks from the enqueued payload (Spotify-ToS containment)', async () => {
    const result = await enqueueHydration([spTrack('a'), ytTrack('v1')]);

    expect(result).toEqual({ queued: true });
    // Only the youtube key is diffed against the store — spotify never reaches missingKeys.
    expect(repo.missingKeys).toHaveBeenCalledWith(['youtube:v1']);
    const [, payload] = enqueue.mock.calls[0];
    expect(payload.tracks.map(t => t.provider)).toEqual(['youtube_music']);
    expect(payload.tracks.some(t => /^spotify:/i.test(t.uri ?? ''))).toBe(false);
  });

  it('a spotify-only batch enqueues nothing (no keyable non-spotify tracks)', async () => {
    const result = await enqueueHydration([spTrack('a'), spTrack('b')]);

    expect(result).toEqual({ queued: false, reason: 'no-keyable-tracks' });
    expect(repo.missingKeys).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('never throws — a repo failure degrades to {queued:false}', async () => {
    repo.missingKeys.mockRejectedValue(new Error('mongo down'));

    await expect(enqueueHydration([ytTrack('v1')])).resolves.toEqual({ queued: false, reason: 'error' });
  });
});
