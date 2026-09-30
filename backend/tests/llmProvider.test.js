'use strict';

// Wave-0 egress containment: the app may only call a VETTED, contractually-bound LLM
// provider (Groq via LLM_API_KEY). The former silent fallback to Google Gemini's free
// tier (training-eligible, no ZDR) is removed. In production the server must refuse to
// boot without a vetted provider so special-category signals can never reach an unvetted
// endpoint.

const { assertVettedLlmProvider, hasVettedProvider, reasoningParams } = require('../app/config/llmProvider');

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of Object.keys(overrides)) { saved[k] = process.env[k]; }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); }
  finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

describe('assertVettedLlmProvider (boot gate)', () => {
  it('THROWS in production when no vetted provider is configured', () => {
    withEnv({ NODE_ENV: 'production', LLM_API_KEY: undefined, GROQ_API_KEY: undefined }, () => {
      expect(() => assertVettedLlmProvider()).toThrow(/vetted LLM provider/i);
    });
  });

  it('does NOT throw in production when LLM_API_KEY (Groq) is set', () => {
    withEnv({ NODE_ENV: 'production', LLM_API_KEY: 'groq-key', GROQ_API_KEY: undefined }, () => {
      expect(() => assertVettedLlmProvider()).not.toThrow();
    });
  });

  it('does NOT throw in production when GROQ_API_KEY is set', () => {
    withEnv({ NODE_ENV: 'production', LLM_API_KEY: undefined, GROQ_API_KEY: 'groq-key' }, () => {
      expect(() => assertVettedLlmProvider()).not.toThrow();
    });
  });

  it('does NOT throw outside production even without a provider (dev/test degrade to deterministic)', () => {
    withEnv({ NODE_ENV: 'test', LLM_API_KEY: undefined, GROQ_API_KEY: undefined }, () => {
      expect(() => assertVettedLlmProvider()).not.toThrow();
    });
  });
});

describe('hasVettedProvider', () => {
  it('is true only when a vetted key is present', () => {
    withEnv({ LLM_API_KEY: undefined, GROQ_API_KEY: undefined }, () => {
      expect(hasVettedProvider()).toBe(false);
    });
    withEnv({ LLM_API_KEY: 'x', GROQ_API_KEY: undefined }, () => {
      expect(hasVettedProvider()).toBe(true);
    });
  });
});

// A bad LLM_REASONING_EFFORT must not reach Groq: "Values outside a model's supported set are rejected
// with a 400" (https://console.groq.com/docs/api-reference), so one typo on Railway would fail EVERY
// gpt-oss call. gpt-oss accepts low | medium | high; anything else falls back to low.
describe('reasoningParams', () => {
  const GPT_OSS = 'openai/gpt-oss-20b';

  it.each([
    ['max', 'low'],
    ['', 'low'],
    ['x', 'low'],
    [' LOW ', 'low'],
    ['high', 'high'],
    ['Medium', 'medium'],
    [undefined, 'low'],
  ])('LLM_REASONING_EFFORT=%p gives %p for a gpt-oss model', (value, expected) => {
    withEnv({ LLM_REASONING_EFFORT: value }, () => {
      expect(reasoningParams(GPT_OSS)).toEqual({ reasoning_effort: expected });
    });
  });

  it('gives no field at all for a non-gpt-oss model, whatever the env says', () => {
    withEnv({ LLM_REASONING_EFFORT: 'high' }, () => {
      expect(reasoningParams('qwen/qwen3.8-27b')).toEqual({});
      expect(reasoningParams(undefined)).toEqual({});
    });
  });
});
