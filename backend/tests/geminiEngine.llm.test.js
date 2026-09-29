'use strict';

// Exercises the OpenAI-compatible provider path (e.g. Groq) used when LLM_API_KEY
// is set instead of a Gemini key. Env is isolated per test file by Jest.
process.env.NODE_ENV   = 'test';
process.env.LLM_API_KEY = 'test-llm-key';
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;

jest.mock('axios');
const axios = require('axios');

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

describe('OpenAI-compatible LLM provider (e.g. Groq)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs to the configured base URL with a Bearer key and parses choices[0].message.content', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(VALID) } }] } });
    const fetchTracks = jest.fn().mockResolvedValue([{ id: 'x', uri: 'spotify:track:7ouMYWpwJ422jRcDASZB7P' }]);

    const result = await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks });

    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/chat/completions'),
      expect.objectContaining({ messages: [{ role: 'user', content: expect.any(String) }] }),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-llm-key' }) }),
    );
    // Params are mood-normalized (strict vibe enforced) but the LLM's audio targets survive.
    expect(result.params.target_bpm).toBe(120);
    expect(result.params.exclude_genres.length).toBeGreaterThan(0);
    expect(fetchTracks).toHaveBeenCalledWith(result.params);
  });

  it('throws (so the caller can fall back) when the provider returns invalid JSON', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: 'sorry, here is a playlist' } }] } });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn() }),
    ).rejects.toThrow('invalid JSON');
  });

  it('throws on an empty completion (e.g. provider rate-limit body)', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '' } }] } });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn() }),
    ).rejects.toThrow('empty response');
  });

  it('threads a variety seed into the prompt so repeated presses differ', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: JSON.stringify(VALID) } }] } });
    const fetchTracks = jest.fn().mockResolvedValue([]);

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks, seed: 'press-1' });
    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks, seed: 'press-2' });

    const content1 = axios.post.mock.calls[0][1].messages[0].content;
    const content2 = axios.post.mock.calls[1][1].messages[0].content;
    expect(content1).toContain('press-1');
    expect(content1).not.toEqual(content2); // different seed → different prompt → different cache key
  });

  it('surfaces the provider error message on a model 404 (not axios\'s opaque text)', async () => {
    axios.post.mockRejectedValue({
      response: { status: 404, data: { error: { message: 'The model `foo` does not exist or you do not have access to it.' } } },
    });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn() }),
    ).rejects.toThrow('does not exist');
  });

  it('retries a 429 rate-limit (honoring retry-after) instead of collapsing to the static fallback', async () => {
    const rateLimited = Object.assign(new Error('429'), {
      response: { status: 429, headers: { 'retry-after': '0' }, data: { error: { message: 'Rate limit reached (TPM)' } } },
    });
    axios.post
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: JSON.stringify(VALID) } }] } });
    const fetchTracks = jest.fn().mockResolvedValue([]);

    const result = await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks, seed: 'rate-limit-retry' });

    expect(axios.post).toHaveBeenCalledTimes(2);   // the 429 was ridden out, not thrown to the fallback
    expect(result.params.target_bpm).toBe(120);
  });

  it('a non-429 error still fails fast (surfaces to the caller\'s fallback, no retry storm)', async () => {
    axios.post.mockRejectedValue({ response: { status: 400, data: { error: { message: 'bad request' } } } });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn(), seed: 'no-retry' }),
    ).rejects.toThrow('bad request');
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

// The model the generation path resolves, and the request it sends. The previous fallback was shut
// down by Groq on 2026-08-16 (see tests/llmModel.decommissionGuard.test.js), so every generation
// silently degraded to the deterministic path. Pinned against Groq's docs as checked 2026-09-29:
// https://console.groq.com/docs/reasoning and https://console.groq.com/docs/openai.
describe('generation model and request shape', () => {
  const ok = () => ({ data: { choices: [{ message: { content: JSON.stringify(VALID) } }] } });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LLM_MODEL;
    delete process.env.LLM_REASONING_EFFORT;
  });
  afterAll(() => {
    delete process.env.LLM_MODEL;
    delete process.env.LLM_REASONING_EFFORT;
  });

  it('defaults to openai/gpt-oss-20b when LLM_MODEL is not set', async () => {
    axios.post.mockResolvedValue(ok());

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'default-model' });

    expect(axios.post.mock.calls[0][1].model).toBe('openai/gpt-oss-20b');
  });

  it('LLM_MODEL overrides the default', async () => {
    process.env.LLM_MODEL = 'openai/gpt-oss-120b';
    axios.post.mockResolvedValue(ok());

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'env-model' });

    expect(axios.post.mock.calls[0][1].model).toBe('openai/gpt-oss-120b');
  });

  it('sends only the documented fields: no reasoning_format (unsupported on gpt-oss) and nothing Groq 400s on', async () => {
    axios.post.mockResolvedValue(ok());

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'shape' });

    const body = axios.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'reasoning_effort', 'response_format', 'temperature']);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBeGreaterThan(0);
    expect(body.temperature).toBeLessThanOrEqual(2);
  });

  // reasoning_effort: gpt-oss accepts low | medium | high (default medium); "Values outside a
  // model's supported set are rejected with a 400" (https://console.groq.com/docs/api-reference).
  it('a gpt-oss model gets reasoning_effort "low"', async () => {
    axios.post.mockResolvedValue(ok());

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'effort-low' });

    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe('low');
  });

  it('a non-gpt-oss model gets no reasoning_effort at all', async () => {
    process.env.LLM_MODEL = 'qwen/qwen3.8-27b';
    axios.post.mockResolvedValue(ok());

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'effort-none' });

    const body = axios.post.mock.calls[0][1];
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('LLM_REASONING_EFFORT overrides the effort for gpt-oss models', async () => {
    process.env.LLM_REASONING_EFFORT = 'high';
    axios.post.mockResolvedValue(ok());

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'effort-env' });

    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe('high');
  });

  it('parses the final content of a gpt-oss response, ignoring its reasoning field', async () => {
    axios.post.mockResolvedValue({
      data: {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: JSON.stringify(VALID),
            reasoning: 'Calm, positive coordinates. Maybe target_bpm 90? The user leans electronic, so 120.',
          },
        }],
      },
    });

    const result = await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: 'reasoning-field' });

    expect(result.params.target_bpm).toBe(120);
  });

  it('empty content fails as empty (caller falls back) even when reasoning holds valid params JSON', async () => {
    axios.post.mockResolvedValue({
      data: {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '', reasoning: JSON.stringify(VALID) } }],
      },
    });

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn(), seed: 'empty-content' }),
    ).rejects.toThrow('empty response');
  });
});

// One `[llm]` line per generation call, success or failure, carrying no prompt, no content, no key.
describe('generation call log line and truncation', () => {
  const SEED = 'CANARY-SEED-7f3a'; // lands in the prompt as the variation token
  let spies;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LLM_MODEL;
    spies = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  const llmLines = () => spies
    .flatMap((s) => s.mock.calls)
    .filter((args) => typeof args[0] === 'string' && args[0].startsWith('[llm]'))
    .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

  const expectNoLeak = (lines, prompt) => {
    const all = lines.join('\n');
    for (const secret of [prompt, SEED, 'expert musicologist', 'target_bpm', 'test-llm-key', 'Bearer', 'Authorization']) {
      expect(all).not.toContain(secret);
    }
  };

  it('logs model, status, finish reason, token usage and wall time on success', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(VALID) } }],
        usage: { prompt_tokens: 640, completion_tokens: 120, completion_tokens_details: { reasoning_tokens: 44 } },
      },
    });

    await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn().mockResolvedValue([]), seed: `${SEED}-ok` });

    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[llm\] via=geminiEngine model=openai\/gpt-oss-20b status=200 finish=stop prompt_tokens=640 completion_tokens=120 reasoning_tokens=44 ms=\d+$/,
    );
    expectNoLeak(lines, axios.post.mock.calls[0][1].messages[0].content);
  });

  it('logs one line on failure with the status and error code, and nothing from the prompt', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed with status code 404'), {
      config: { headers: { Authorization: 'Bearer test-llm-key' } },
      response: { status: 404, data: { error: { message: 'The model does not exist', code: 'model_not_found' } } },
    }));

    await expect(
      buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn(), seed: `${SEED}-404` }),
    ).rejects.toThrow('does not exist');

    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[llm\] via=geminiEngine model=openai\/gpt-oss-20b status=404 finish=- prompt_tokens=- completion_tokens=- ms=\d+ error=model_not_found$/,
    );
    expectNoLeak(lines, axios.post.mock.calls[0][1].messages[0].content);
  });

  it('a truncated completion rejects with LlmTruncatedError instead of a JSON parse failure', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        choices: [{ finish_reason: 'length', message: { content: '{"target_bpm": 120, "target_ene' } }],
        usage: { prompt_tokens: 640, completion_tokens: 1024 },
      },
    });

    const err = await buildEmotionPlaylist({ musicProfile: MUSIC_PROFILE, emotionTaps, fetchTracks: jest.fn(), seed: `${SEED}-len` })
      .catch((e) => e);

    expect(err).toMatchObject({ name: 'LlmTruncatedError', model: 'openai/gpt-oss-20b', promptTokens: 640, completionTokens: 1024 });
    expect(err.message).not.toMatch(/invalid JSON/);
    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(' finish=length ');
  });
});

// ── Layer 2: Groq critic re-rank (vibe energy filter) ─────────────────────────

