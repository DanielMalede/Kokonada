'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/models/TrackEmbedding', () => ({ bulkWrite: jest.fn().mockResolvedValue({}), find: jest.fn(), aggregate: jest.fn() }));
jest.mock('../app/repositories/audioFeatureRepo', () => ({
  getMany: jest.fn().mockResolvedValue(new Map()),
  upsertMany: jest.fn(),
  missingKeys: jest.fn(),
  setVibeTags: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../app/services/llmClient', () => ({
  generateJson: jest.fn(),
  isConfigured: jest.fn().mockReturnValue(false),
}));

const TrackEmbedding = require('../app/models/TrackEmbedding');
const featureRepo = require('../app/repositories/audioFeatureRepo');
const llmClient = require('../app/services/llmClient');
const { buildVector, cosine } = require('../app/services/vector/embedding');
const vectorIndex = require('../app/services/vector/vectorIndex');
const { fakeVectorIndex } = require('../app/services/vector/fakeVectorIndex');
const worker = require('../app/workers/embedding.worker');
const { DEFAULT_PROCESSORS } = require('../app/workers');
const { QUEUES } = require('../app/queues/definitions');

const FEATURES = { bpm: 120, energy: 0.7, valence: 0.6, acousticness: 0.2, danceability: 0.7, loudness: -7 };

beforeEach(() => {
  jest.clearAllMocks();
  vectorIndex.use(null); // default mongo adapter
  featureRepo.getMany.mockResolvedValue(new Map());
  llmClient.isConfigured.mockReturnValue(false);
  TrackEmbedding.find.mockReturnValue({ lean: () => Promise.resolve([]) });
});

describe('embedding.buildVector (deterministic v1)', () => {
  it('is L2-normalized, fixed-dim, and deterministic', () => {
    const a = buildVector(FEATURES, ['pop', 'dance']);
    const b = buildVector(FEATURES, ['pop', 'dance']);

    expect(a).toHaveLength(70);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('similar tracks are closer than dissimilar ones', () => {
    const base   = buildVector(FEATURES, ['pop']);
    const near   = buildVector({ ...FEATURES, bpm: 124 }, ['pop']);
    const far    = buildVector({ bpm: 60, energy: 0.1, valence: 0.2, acousticness: 0.95, danceability: 0.2, loudness: -20 }, ['ambient']);

    expect(cosine(base, near)).toBeGreaterThan(cosine(base, far));
  });

  it('survives null features (genre-only vector) and empty genres', () => {
    expect(buildVector(null, ['pop'])).toHaveLength(70);
    expect(buildVector(FEATURES, [])).toHaveLength(70);
    expect(buildVector(null, []).every(Number.isFinite)).toBe(true);
  });
});

describe('vectorIndex port (mongo adapter default, injectable fake)', () => {
  it('upsertMany bulk-writes per-recording embeddings', async () => {
    await vectorIndex.upsertMany([{ recordingKey: 'spotify:a', canonicalKey: 'at:x|y', vector: buildVector(FEATURES, ['pop']) }]);

    const ops = TrackEmbedding.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.filter).toEqual({ recordingKey: 'spotify:a' });
    expect(ops[0].updateOne.upsert).toBe(true);
  });

  it('getMany returns a Map of Float arrays', async () => {
    TrackEmbedding.find.mockReturnValue({ lean: () => Promise.resolve([{ recordingKey: 'spotify:a', vector: [0.1, 0.2] }]) });

    const out = await vectorIndex.getMany(['spotify:a']);

    expect(out.get('spotify:a')).toEqual([0.1, 0.2]);
  });

  it('the injectable fake behaves identically for tests/local dev (write→read parity)', async () => {
    const fake = fakeVectorIndex();
    vectorIndex.use(fake);
    const vec = buildVector(FEATURES, ['pop']);

    await vectorIndex.upsertMany([{ recordingKey: 'spotify:a', vector: vec }]);
    const out = await vectorIndex.getMany(['spotify:a']);

    expect(out.get('spotify:a')).toEqual(vec);
    expect(TrackEmbedding.bulkWrite).not.toHaveBeenCalled();
  });

  it('queryNear degrades to [] when $vectorSearch is unavailable (non-Atlas envs)', async () => {
    TrackEmbedding.aggregate.mockRejectedValue(new Error('$vectorSearch is not allowed'));

    await expect(vectorIndex.queryNear([0.1, 0.2], { k: 5 })).resolves.toEqual([]);
  });
});

describe('embedding.worker — build + vibe enrichment', () => {
  it('builds vectors from stored features and upserts them to the index', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([
      ['mbid:a', { ...FEATURES, recordingKey: 'mbid:a', canonicalKey: 'at:x|a' }],
    ]));
    const fake = fakeVectorIndex();
    vectorIndex.use(fake);

    const out = await worker.process({ data: { recordingKeys: ['mbid:a'], genresByKey: { 'mbid:a': ['pop'] } } });

    expect(out.embedded).toBe(1);
    expect((await vectorIndex.getMany(['mbid:a'])).get('mbid:a')).toHaveLength(70);
  });

  it('vibe enrichment is optional: no LLM → vectors still built, tags skipped', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', { ...FEATURES }]]));
    vectorIndex.use(fakeVectorIndex());

    const out = await worker.process({ data: { recordingKeys: ['mbid:a'] } });

    expect(out.embedded).toBe(1);
    expect(out.tagged).toBe(0);
    expect(featureRepo.setVibeTags).not.toHaveBeenCalled();
  });

  it('sanitizes LLM vibe tags (strings only, capped count and length)', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', { ...FEATURES, title: 'Song' }]]));
    vectorIndex.use(fakeVectorIndex());
    llmClient.isConfigured.mockReturnValue(true);
    llmClient.generateJson.mockResolvedValue(JSON.stringify({
      tags: [{ i: 0, vibeTags: ['warm', 42, 'x'.repeat(200), 'driving', 'dark', 'hazy', 'extra-sixth', { evil: 1 }] }],
    }));

    await worker.process({ data: { recordingKeys: ['mbid:a'] } });

    const [key, tags] = featureRepo.setVibeTags.mock.calls[0];
    expect(key).toBe('mbid:a');
    expect(tags.length).toBeLessThanOrEqual(5);
    expect(tags.every(t => typeof t === 'string' && t.length <= 24)).toBe(true);
  });

  it('is registered for the embedding-build queue', () => {
    expect(DEFAULT_PROCESSORS[QUEUES.EMBEDDING_BUILD]).toBe(worker.process);
  });

  it('DILUTION FIX: the stored vector is genre-free (dims 6-69 all zero) even when genresByKey/vibeTags carry real genres', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([
      ['mbid:genrefull', { ...FEATURES, recordingKey: 'mbid:genrefull', vibeTags: ['warm', 'driving'] }],
    ]));
    const fake = fakeVectorIndex();
    vectorIndex.use(fake);

    await worker.process({ data: {
      recordingKeys: ['mbid:genrefull'],
      genresByKey: { 'mbid:genrefull': ['pop', 'rock', 'jazz', 'metal', 'folk', 'soul'] },
    } });

    const stored = (await vectorIndex.getMany(['mbid:genrefull'])).get('mbid:genrefull');
    expect(stored.slice(6)).toEqual(new Array(64).fill(0)); // genre-bag dims never populated
    // matches a feature-only build exactly — no dilution of the feature dims' relative magnitude.
    expect(stored).toEqual(buildVector(FEATURES, []));
  });

  it('DILUTION FIX: two tracks with identical features but different genre richness produce the IDENTICAL stored vector', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([
      ['a', { ...FEATURES, recordingKey: 'a' }],
      ['b', { ...FEATURES, recordingKey: 'b', vibeTags: ['many', 'genre', 'tags', 'here'] }],
    ]));
    const fake = fakeVectorIndex();
    vectorIndex.use(fake);

    await worker.process({ data: {
      recordingKeys: ['a', 'b'],
      genresByKey: { b: ['pop', 'rock', 'jazz', 'metal', 'folk', 'soul', 'punk'] },
    } });

    const map = await vectorIndex.getMany(['a', 'b']);
    expect(map.get('a')).toEqual(map.get('b'));
  });
});

describe('shadow audit — vector & critic chaos', () => {
  it('a ruthless critic (LLM rejects every call) cannot loop or block: vectors stored, tags skipped, NO re-enqueue', async () => {
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', { ...FEATURES }]]));
    vectorIndex.use(fakeVectorIndex());
    llmClient.isConfigured.mockReturnValue(true);
    llmClient.generateJson.mockRejectedValue(new Error('Groq rejects everything'));

    const out = await worker.process({ data: { recordingKeys: ['mbid:a'] } });

    expect(out).toEqual({ embedded: 1, tagged: 0 }); // one pass, done — no retry loop exists
    expect((await vectorIndex.getMany(['mbid:a'])).get('mbid:a')).toBeDefined();
  });

  it('freshly written vectors are immediately readable (no stale window between hydrate and select)', async () => {
    const fake = fakeVectorIndex();
    vectorIndex.use(fake);
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:hot', { ...FEATURES }]]));

    await worker.process({ data: { recordingKeys: ['mbid:hot'] } });
    const read = await vectorIndex.getMany(['mbid:hot']); // same tick, no delay

    expect(read.get('mbid:hot')).toHaveLength(70);
  });

  it('a total vector-index write outage never breaks enrichment consumers (adapter contract)', async () => {
    vectorIndex.use({
      upsertMany: jest.fn().mockRejectedValue(new Error('index down')),
      getMany: jest.fn().mockResolvedValue(new Map()),
      queryNear: jest.fn().mockResolvedValue([]),
    });
    featureRepo.getMany.mockResolvedValue(new Map([['mbid:a', { ...FEATURES }]]));

    await expect(worker.process({ data: { recordingKeys: ['mbid:a'] } })).rejects.toThrow('index down');
    // BullMQ marks the job failed (removeOnFail) — serving reads via pipeline are
    // independently guarded by getMany().catch(() => new Map()).
  });
});
