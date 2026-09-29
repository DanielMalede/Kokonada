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
    expect(config.headers.Authorization).toBe('Bearer test-key');
  });

  // The previous default was shut down by Groq on 2026-08-16; the replacement is the one Groq's
  // deprecations page recommends for it (see tests/llmModel.decommissionGuard.test.js).
  it('defaults to openai/gpt-oss-20b when neither a per-call model nor LLM_MODEL is set', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p');

    expect(axios.post.mock.calls[0][1].model).toBe('openai/gpt-oss-20b');
  });

  it('LLM_MODEL overrides the default', async () => {
    process.env.LLM_MODEL = 'openai/gpt-oss-120b';
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p');

    expect(axios.post.mock.calls[0][1].model).toBe('openai/gpt-oss-120b');
  });

  it('honors per-call model override', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p', { model: 'openai/gpt-oss-120b' });

    expect(axios.post.mock.calls[0][1].model).toBe('openai/gpt-oss-120b');
  });

  // Request shape, pinned to what Groq documents for the gpt-oss models (checked 2026-09-29):
  //  - https://console.groq.com/docs/reasoning: "With openai/gpt-oss-20b and openai/gpt-oss-120b,
  //    the reasoning_format parameter is not supported."
  //  - https://console.groq.com/docs/openai: logprobs, logit_bias, top_logprobs and messages[].name
  //    "will result in a 400 error"; temperature should be "> 0 and <= 2".
  //  - https://console.groq.com/docs/structured-outputs#json-object-mode: json_object is supported
  //    by "All models". Any new body field must be re-checked against these pages first.
  it('sends only the fields checked against the Groq docs, and none the gpt-oss models reject', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p', { temperature: 0.3 });

    const body = axios.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'response_format', 'temperature']);
    expect(body.messages).toEqual([{ role: 'user', content: 'p' }]);
    expect(body.temperature).toBeGreaterThan(0);
    expect(body.temperature).toBeLessThanOrEqual(2);
  });

  // gpt-oss returns its chain of thought in message.reasoning by default and the final answer in
  // message.content (https://console.groq.com/docs/reasoning, "GPT-OSS Models": "By default, these
  // models will include reasoning content in the reasoning field of the assistant response").
  it('returns the final content, never the reasoning field a gpt-oss response carries', async () => {
    axios.post.mockResolvedValue({
      data: {
        choices: [{
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            content: '{"ok":1}',
            reasoning: 'We need a JSON object with key ok. Output {"ok":0}? No, ok is 1.',
          },
        }],
      },
    });

    await expect(generateJson('p')).resolves.toBe('{"ok":1}');
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
