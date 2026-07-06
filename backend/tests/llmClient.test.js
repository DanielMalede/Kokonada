'use strict';

process.env.NODE_ENV = 'test';

jest.mock('axios');
const axios = require('axios');

const { generateJson, isConfigured } = require('../app/services/llmClient');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LLM_API_KEY = 'test-key';
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
});

describe('llmClient.isConfigured', () => {
  it('reflects presence of an OpenAI-compatible key', () => {
    expect(isConfigured()).toBe(true);
    delete process.env.LLM_API_KEY;
    delete process.env.GROQ_API_KEY;
    expect(isConfigured()).toBe(false);
  });
});

describe('llmClient.generateJson', () => {
  it('posts to chat/completions in json_object mode with the bearer key', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{"ok":1}' } }] } });

    const out = await generateJson('prompt text', { temperature: 0.1 });

    expect(out).toBe('{"ok":1}');
    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.temperature).toBe(0.1);
    expect(body.model).toBe('llama-3.1-8b-instant');
    expect(config.headers.Authorization).toBe('Bearer test-key');
  });

  it('honors per-call model override', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p', { model: 'llama-3.3-70b-versatile' });

    expect(axios.post.mock.calls[0][1].model).toBe('llama-3.3-70b-versatile');
  });

  it('throws a descriptive error when unconfigured', async () => {
    delete process.env.LLM_API_KEY;
    delete process.env.GROQ_API_KEY;

    await expect(generateJson('p')).rejects.toThrow(/not configured/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('surfaces the provider error message, not the opaque axios one', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404, data: { error: { message: 'model decommissioned' } } },
    }));

    await expect(generateJson('p')).rejects.toThrow(/model decommissioned/);
  });

  it('does NOT retry a non-429 error (fails fast on 404)', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('404'), {
      response: { status: 404, data: { error: { message: 'model decommissioned' } } },
    }));

    await expect(generateJson('p')).rejects.toThrow(/decommissioned/);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 rate-limit honoring retry-after, then succeeds', async () => {
    const rateLimited = Object.assign(new Error('429'), {
      response: {
        status: 429,
        headers: { 'retry-after': '0' },
        data: { error: { message: 'Rate limit reached (TPM)' } },
      },
    });
    axios.post
      .mockRejectedValueOnce(rateLimited)
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: '{"ok":1}' } }] } });

    const out = await generateJson('p');

    expect(out).toBe('{"ok":1}');
    expect(axios.post).toHaveBeenCalledTimes(3); // two 429s ridden out, third lands
  });

  it('a persistent 429 past the retry budget surfaces the provider message', async () => {
    const rateLimited = Object.assign(new Error('429'), {
      response: {
        status: 429,
        headers: { 'retry-after': '0' },
        data: { error: { message: 'Rate limit reached (TPM)' } },
      },
    });
    axios.post.mockRejectedValue(rateLimited);

    await expect(generateJson('p', { retries: 2 })).rejects.toThrow(/Rate limit reached/);
    expect(axios.post).toHaveBeenCalledTimes(3); // initial + 2 retries, then gives up
  });
});
