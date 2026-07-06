'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');

// Thin OpenAI-compatible (Groq) client for strict-JSON tasks. Mirrors the
// conventions of geminiEngine._generate (env names, error surfacing) so the
// two can be unified when the critics move to workers (Phase 7).

const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_TIMEOUT_MS = 8000;
// Groq's free tier caps tokens-per-minute (e.g. 6000 TPM). A burst of batch
// requests saturates the bucket and every subsequent call 429s. withRetry
// honors the server's Retry-After so rate-limited calls back off and land
// instead of being dropped — the featureless-library hydration failure.
const DEFAULT_MAX_RETRIES = () => {
  const n = parseInt(process.env.LLM_MAX_RETRIES ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 3;
};

function _key() {
  return process.env.LLM_API_KEY || process.env.GROQ_API_KEY || null;
}

function isConfigured() {
  return Boolean(_key());
}

async function generateJson(prompt, { model = null, timeoutMs = DEFAULT_TIMEOUT_MS, temperature = 0.2, retries = null } = {}) {
  const llmKey = _key();
  if (!llmKey) throw new Error('LLM not configured (set LLM_API_KEY or GROQ_API_KEY)');

  const baseUrl = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
  const resolvedModel = model || process.env.LLM_MODEL || DEFAULT_MODEL;
  const maxRetries = Number.isFinite(retries) ? retries : DEFAULT_MAX_RETRIES();
  try {
    // withRetry retries ONLY 429s (honoring Retry-After); 4xx/5xx and timeouts
    // still surface immediately through the catch below.
    const { data } = await withRetry(() => axios.post(
      `${baseUrl}/chat/completions`,
      {
        model: resolvedModel,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        response_format: { type: 'json_object' },
      },
      {
        headers: { Authorization: `Bearer ${llmKey}`, 'Content-Type': 'application/json' },
        timeout: timeoutMs,
      },
    ), maxRetries);
    return data.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    const apiMsg = err.response?.data?.error?.message || err.message;
    throw new Error(`LLM request failed (${resolvedModel}): ${apiMsg}`);
  }
}

module.exports = { generateJson, isConfigured };
