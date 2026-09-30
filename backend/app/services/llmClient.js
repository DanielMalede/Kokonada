'use strict';

const { DEFAULT_LLM_MODEL } = require('../config/llmProvider');
const { chatJson, failureMessage, LlmTruncatedError } = require('./llmCall');

// Thin OpenAI-compatible (Groq) client for strict-JSON tasks. The request, the
// 429 retry, the per-call log line and the truncation check are shared with
// geminiEngine._generate through llmCall.chatJson.

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

  const resolvedModel = model || process.env.LLM_MODEL || DEFAULT_LLM_MODEL;
  const maxRetries = Number.isFinite(retries) ? retries : DEFAULT_MAX_RETRIES();
  try {
    return await chatJson({ via: 'llmClient', key: llmKey, model: resolvedModel, prompt, temperature, timeoutMs, maxRetries });
  } catch (err) {
    if (err instanceof LlmTruncatedError) throw err; // typed: callers can tell truncation from failure
    throw new Error(failureMessage(resolvedModel, err)); // status + code, never provider text
  }
}

module.exports = { generateJson, isConfigured, LlmTruncatedError };
