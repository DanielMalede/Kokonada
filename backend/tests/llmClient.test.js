'use strict';

process.env.NODE_ENV = 'test';

jest.mock('axios');
const axios = require('axios');

const { generateJson, isConfigured, LlmTruncatedError } = require('../app/services/llmClient');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.LLM_API_KEY = 'test-key';
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
  delete process.env.LLM_REASONING_EFFORT;
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
  //    by "All models".
  //  - https://console.groq.com/docs/api-reference, reasoning_effort: "openai/gpt-oss-20b and
  //    openai/gpt-oss-120b support 'low', 'medium', or 'high'. 'medium' is the default value. Values
  //    outside a model's supported set are rejected with a 400."
  // Any new body field must be re-checked against these pages first.
  it('sends only the fields checked against the Groq docs, and none the gpt-oss models reject', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p', { temperature: 0.3 });

    const body = axios.post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'reasoning_effort', 'response_format', 'temperature']);
    expect(body.messages).toEqual([{ role: 'user', content: 'p' }]);
    expect(body.temperature).toBeGreaterThan(0);
    expect(body.temperature).toBeLessThanOrEqual(2);
  });

  it('a gpt-oss model gets reasoning_effort "low" (the documented default is medium)', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p');
    process.env.LLM_MODEL = 'openai/gpt-oss-120b';
    await generateJson('p');

    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe('low');
    expect(axios.post.mock.calls[1][1].reasoning_effort).toBe('low');
  });

  it('a non-gpt-oss model gets no reasoning_effort at all, because Groq 400s on unsupported values', async () => {
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p', { model: 'qwen/qwen3.8-27b' });

    const body = axios.post.mock.calls[0][1];
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'response_format', 'temperature']);
  });

  it('LLM_REASONING_EFFORT overrides the effort for gpt-oss models', async () => {
    process.env.LLM_REASONING_EFFORT = 'medium';
    axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

    await generateJson('p');

    expect(axios.post.mock.calls[0][1].reasoning_effort).toBe('medium');
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

  // The tempting "fix" for an empty answer is to fall back to message.reasoning. That field is the
  // model's scratchpad: it can hold a well-formed JSON draft the model then rejected.
  it('returns "" when content is empty, even if reasoning holds valid JSON', async () => {
    axios.post.mockResolvedValue({
      data: {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '', reasoning: '{"ok":1}' } }],
      },
    });

    await expect(generateJson('p')).resolves.toBe('');
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

// One `[llm]` line per call, success or failure: the only signal that tells a dead model, a
// rate-limit storm or a reasoning budget blow-out apart in production logs. It must never carry
// the prompt, the response content, headers or the key.
describe('llmClient call log line', () => {
  const PROMPT = 'CANARY-PROMPT tempo=92bpm energy=0.31 please answer in JSON';
  const CONTENT = '{"canary":"CANARY-CONTENT"}';
  let spies;

  beforeEach(() => {
    spies = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
  });
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  const llmLines = () => spies
    .flatMap((s) => s.mock.calls)
    .filter((args) => typeof args[0] === 'string' && args[0].startsWith('[llm]'))
    .map((args) => args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));

  const expectNoLeak = (lines) => {
    const all = lines.join('\n');
    for (const secret of ['CANARY-PROMPT', PROMPT, 'CANARY-CONTENT', 'test-key', 'Bearer', 'Authorization']) {
      expect(all).not.toContain(secret);
    }
  };

  it('logs model, status, finish reason, token usage and wall time on success, and nothing else', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        choices: [{ finish_reason: 'stop', message: { content: CONTENT, reasoning: 'CANARY-CONTENT thinking' } }],
        usage: { prompt_tokens: 412, completion_tokens: 96, completion_tokens_details: { reasoning_tokens: 58 } },
      },
    });

    await generateJson(PROMPT);

    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[llm\] via=llmClient model=openai\/gpt-oss-20b status=200 finish=stop prompt_tokens=412 completion_tokens=96 reasoning_tokens=58 ms=\d+$/,
    );
    expectNoLeak(lines);
  });

  it('omits reasoning_tokens when the response does not report them', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { choices: [{ finish_reason: 'stop', message: { content: CONTENT } }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    });

    await generateJson(PROMPT);

    const [line] = llmLines();
    expect(line).toMatch(/ prompt_tokens=10 completion_tokens=5 ms=\d+$/);
    expect(line).not.toContain('reasoning_tokens');
  });

  it('logs one line on an HTTP failure with the status and the provider error code, never the message text', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed with status code 404'), {
      config: { headers: { Authorization: 'Bearer test-key' }, data: JSON.stringify({ messages: [{ content: PROMPT }] }) },
      response: { status: 404, data: { error: { message: `model not found; you sent: ${PROMPT}`, code: 'model_not_found' } } },
    }));

    await expect(generateJson(PROMPT)).rejects.toThrow(/LLM request failed/);

    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[llm\] via=llmClient model=openai\/gpt-oss-20b status=404 finish=- prompt_tokens=- completion_tokens=- ms=\d+ error=model_not_found$/,
    );
    expectNoLeak(lines);
  });

  it('logs a timeout (no HTTP status) with the transport error code', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' }));

    await expect(generateJson(PROMPT)).rejects.toThrow(/timeout/);

    const [line] = llmLines();
    expect(line).toMatch(/ status=- .* error=ECONNABORTED$/);
  });

  it('writes ONE line per call even when 429s are retried first', async () => {
    const rateLimited = Object.assign(new Error('429'), {
      response: { status: 429, headers: { 'retry-after': '0' }, data: { error: { message: 'Rate limit', code: 'rate_limit_exceeded' } } },
    });
    axios.post
      .mockRejectedValueOnce(rateLimited)
      .mockResolvedValueOnce({ status: 200, data: { choices: [{ finish_reason: 'stop', message: { content: CONTENT } }] } });

    await generateJson(PROMPT);

    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(' status=200 ');
  });

  // Truncated output used to reach JSON.parse as a cut-off string and fail with a parse error that
  // named neither the cause nor the model. finish_reason 'length' is now a typed error.
  it('throws LlmTruncatedError with the model and token counts when finish_reason is "length"', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        choices: [{ finish_reason: 'length', message: { content: '{"captions":[{"i":0,"cap' } }],
        usage: { prompt_tokens: 300, completion_tokens: 1024, completion_tokens_details: { reasoning_tokens: 990 } },
      },
    });

    const err = await generateJson(PROMPT).catch((e) => e);

    expect(err).toBeInstanceOf(LlmTruncatedError);
    expect(err).toMatchObject({
      name: 'LlmTruncatedError',
      model: 'openai/gpt-oss-20b',
      promptTokens: 300,
      completionTokens: 1024,
      reasoningTokens: 990,
    });
    expect(err.message).toMatch(/truncated.*openai\/gpt-oss-20b/);
    const lines = llmLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(' finish=length ');
    expectNoLeak(lines);
  });
});
