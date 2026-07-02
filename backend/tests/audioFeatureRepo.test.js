'use strict';

process.env.NODE_ENV = 'test';

jest.mock('../app/models/AudioFeature', () => ({ bulkWrite: jest.fn(), find: jest.fn() }));
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));

const AudioFeature = require('../app/models/AudioFeature');
const { getRedis } = require('../app/config/redis');
const repo = require('../app/repositories/audioFeatureRepo');

const doc = (recordingKey, overrides = {}) => ({
  recordingKey, canonicalKey: 'at:artist|song', bpm: 120, energy: 0.5,
  source: 'api', confidence: 1, ...overrides,
});

function fakeRedis() {
  return { mget: jest.fn().mockResolvedValue([]), set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
}

function mockMongoFind(rows = []) {
  AudioFeature.find.mockReturnValue({ lean: () => Promise.resolve(rows) });
}

beforeEach(() => {
  jest.clearAllMocks();
  getRedis.mockReturnValue(null);
  mockMongoFind([]);
  AudioFeature.bulkWrite.mockResolvedValue({});
});

describe('audioFeatureRepo.getMany', () => {
  it('serves pure Redis hits without touching Mongo', async () => {
    const redis = fakeRedis();
    redis.mget.mockResolvedValue([JSON.stringify(doc('spotify:a'))]);
    getRedis.mockReturnValue(redis);

    const out = await repo.getMany(['spotify:a']);

    expect(out.get('spotify:a').bpm).toBe(120);
    expect(AudioFeature.find).not.toHaveBeenCalled();
  });

  it('treats corrupt Redis JSON as a miss and falls through to Mongo', async () => {
    const redis = fakeRedis();
    redis.mget.mockResolvedValue(['{not json']);
    getRedis.mockReturnValue(redis);
    mockMongoFind([doc('spotify:a')]);

    const out = await repo.getMany(['spotify:a']);

    expect(out.get('spotify:a').bpm).toBe(120);
  });

  it('backfills Redis (with a TTL) for Mongo hits', async () => {
    const redis = fakeRedis();
    redis.mget.mockResolvedValue([null]);
    getRedis.mockReturnValue(redis);
    mockMongoFind([doc('spotify:a')]);

    await repo.getMany(['spotify:a']);

    expect(redis.set).toHaveBeenCalledWith('af:spotify:a', expect.any(String), 'EX', expect.any(Number));
  });

  it('works Redis-less (getRedis() null): straight to Mongo', async () => {
    mockMongoFind([doc('spotify:a')]);

    const out = await repo.getMany(['spotify:a']);

    expect(out.get('spotify:a')).toBeDefined();
  });

  it('a Redis outage mid-call degrades to Mongo instead of failing', async () => {
    const redis = fakeRedis();
    redis.mget.mockRejectedValue(new Error('connection reset'));
    getRedis.mockReturnValue(redis);
    mockMongoFind([doc('spotify:a')]);

    const out = await repo.getMany(['spotify:a']);

    expect(out.get('spotify:a')).toBeDefined();
  });
});

describe('audioFeatureRepo.upsertMany — coherence rules', () => {
  it('api docs upsert unconditionally and write through to Redis', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    await repo.upsertMany([doc('spotify:a')]);

    const ops = AudioFeature.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.filter).toEqual({ recordingKey: 'spotify:a' });
    expect(ops[0].updateOne.upsert).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('af:spotify:a', expect.any(String), 'EX', expect.any(Number));
  });

  it('llm docs can never clobber an api record ($ne filter) and invalidate the cache key', async () => {
    const redis = fakeRedis();
    getRedis.mockReturnValue(redis);

    await repo.upsertMany([doc('youtube:v1', { source: 'llm', confidence: 0.6 })]);

    const ops = AudioFeature.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.filter).toEqual({ recordingKey: 'youtube:v1', source: { $ne: 'api' } });
    expect(redis.del).toHaveBeenCalledWith('af:youtube:v1');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('swallows duplicate-key races (E11000 = an api record already won)', async () => {
    AudioFeature.bulkWrite.mockRejectedValue(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000, writeErrors: [{ code: 11000 }] })
    );

    await expect(repo.upsertMany([doc('youtube:v1', { source: 'llm' })])).resolves.toBeDefined();
  });

  it('rethrows real write failures (not E11000)', async () => {
    AudioFeature.bulkWrite.mockRejectedValue(Object.assign(new Error('network'), { code: 6 }));

    await expect(repo.upsertMany([doc('spotify:a')])).rejects.toThrow('network');
  });

  it('bulk operations are unordered so one conflict cannot abort the batch', async () => {
    await repo.upsertMany([doc('spotify:a')]);

    expect(AudioFeature.bulkWrite.mock.calls[0][1]).toEqual(expect.objectContaining({ ordered: false }));
  });
});

describe('audioFeatureRepo.missingKeys', () => {
  it('returns only the keys with no stored features', async () => {
    mockMongoFind([doc('spotify:a')]);

    const missing = await repo.missingKeys(['spotify:a', 'youtube:v1']);

    expect(missing).toEqual(['youtube:v1']);
  });
});
