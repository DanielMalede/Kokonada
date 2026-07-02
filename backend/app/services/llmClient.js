'use strict';

const axios = require('axios');

// Thin OpenAI-compatible (Groq) client for strict-JSON tasks. Mirrors the
// conventions of geminiEngine._generate (env names, error surfacing) so the
// two can be unified when the critics move to workers (Phase 7).

const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const DEFAULT_TIMEOUT_MS = 8000;

function _key() {
  return process.env.LLM_API_KEY || process.env.GROQ_API_KEY || null;
}

function isConfigured() {
  return Boolean(_key());
}

async function generateJson(prompt, { model = null, timeoutMs = DEFAULT_TIMEOUT_MS, temperature = 0.2 } = {}) {
  const llmKey = _key();
  if (!llmKey) throw new Error('LLM not configured (set LLM_API_KEY or GROQ_API_KEY)');

  const baseUrl = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
  const resolvedModel = model || process.env.LLM_MODEL || DEFAULT_MODEL;
  try {
    const { data } = await axios.post(
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
    );
    return data.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    const apiMsg = err.response?.data?.error?.message || err.message;
    throw new Error(`LLM request failed (${resolvedModel}): ${apiMsg}`);
  }
}

module.exports = { generateJson, isConfigured };
