'use strict';

// The generation cache (Redis, 24 h) is keyed on the prompt. Keyed on the prompt ALONE, a model
// switch (a deploy, or LLM_MODEL flipped on Railway) keeps serving the previous model's params for
// a day, and a result produced by a model later found broken outlives the fix. The model is part
// of the key; the prompt still enters it only as md5(prompt), as docs/privacy-declarations.md states.

process.env.NODE_ENV = 'test';
process.env.LLM_API_KEY = 'test-llm-key';
delete process.env.GROQ_API_KEY;

jest.mock('axios');
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(), createConnection: jest.fn() }));

const crypto = require('crypto');
const axios = require('axios');
const { getRedis } = require('../app/config/redis');
const { buildEmotionPlaylist } = require('../app/services/geminiEngine');

const MUSIC_PROFILE = {
  topGenres: ['electronic', 'indie'], tempoBaseline: 120,
  energy: 0.7, valence: 0.6, acousticness: 0.2, restingHeartRate: 65,
};
const VALID = {
  target_bpm: 120, target_energy: 0.8, target_valence: 0.7,
  target_acousticness: 0.1, seed_artists: [], seed_genres: ['electronic'],
};
const emotionTaps = [{ x: 0.5, y: 0.5 }];

// Stateful in-memory Redis with the two commands the cache uses, real semantics: get → string|null,
// setex stores (TTL recorded, not simulated — nothing here outlives a test).
function memoryRedis() {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (k) => (store.has(k) ? store.get(k).value : null)),
    setex: jest.fn(async (k, ttl, value) => { store.set(k, { ttl, value }); return 'OK'; }),
  };
}

const generate = () => buildEmotionPlaylist({
  musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'same-prompt',
});

let redis;
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.LLM_MODEL;
  redis = memoryRedis();
  getRedis.mockReturnValue(redis);
  axios.post.mockResolvedValue({ status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(VALID) } }] } });
});
afterAll(() => { delete process.env.LLM_MODEL; });

describe('generation cache key', () => {
  it('(fake sanity) the same prompt on the same model is served from the cache', async () => {
    await generate();
    await generate();

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(redis.store.size).toBe(1);
  });

  it('a model switch misses the cache: the new model is asked, not the old result replayed', async () => {
    await generate();
    process.env.LLM_MODEL = 'openai/gpt-oss-120b';
    await generate();

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[1][1].model).toBe('openai/gpt-oss-120b');
    expect(redis.store.size).toBe(2);
  });

  it('the key is gemini:<model>:md5(prompt) — the prompt enters only as its md5', async () => {
    await generate();

    const prompt = axios.post.mock.calls[0][1].messages[0].content;
    const md5 = crypto.createHash('md5').update(prompt).digest('hex');
    expect([...redis.store.keys()]).toEqual([`gemini:openai/gpt-oss-20b:${md5}`]);
    expect(redis.setex).toHaveBeenCalledWith(`gemini:openai/gpt-oss-20b:${md5}`, 86_400, expect.any(String));
  });
});
