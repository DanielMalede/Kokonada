'use strict';

const axios = require('axios');
const { withRetry } = require('../utils/retry');
const { reasoningParams } = require('../config/llmProvider');

// The one Groq chat-completions round trip both LLM clients make (llmClient.generateJson and
// geminiEngine._generate): the documented request body, the 429 retry, ONE log line per call and
// the truncation check. It lives outside llmClient so tests that factory-mock llmClient still get
// a working generation path.

// finish_reason 'length' means the model hit its token limit mid-answer. For gpt-oss the
// reasoning tokens count against that limit, so a long think can leave a cut-off JSON body that
// used to surface only as an anonymous parse failure downstream.
class LlmTruncatedError extends Error {
  constructor({ model, promptTokens = null, completionTokens = null, reasoningTokens = null }) {
    const counts = [
      `prompt_tokens=${promptTokens ?? '-'}`,
      `completion_tokens=${completionTokens ?? '-'}`,
      ...(reasoningTokens != null ? [`reasoning_tokens=${reasoningTokens}`] : []),
    ].join(' ');
    super(`LLM output truncated (${model}): finish_reason=length ${counts}`);
    this.name = 'LlmTruncatedError';
    this.model = model;
    this.promptTokens = promptTokens;
    this.completionTokens = completionTokens;
    this.reasoningTokens = reasoningTokens;
  }
}

// Every logged field is an identifier or a number. Free text (a provider error message, which can
// echo input) is never logged; an identifier that fails this shape is replaced, not trimmed.
const IDENT = /^[A-Za-z0-9_.:/-]{1,128}$/;
const ident = (v) => (typeof v === 'string' && IDENT.test(v) ? v : null);
const count = (v) => (Number.isFinite(v) ? String(v) : null);

// `[llm] via=… model=… status=… finish=… prompt_tokens=… completion_tokens=… [reasoning_tokens=…] ms=… [error=…]`
// NEVER the prompt, the response content, headers or the key.
function _logLine({ via, model, status, finish, usage, ms, error }) {
  const reasoning = count(usage?.completion_tokens_details?.reasoning_tokens);
  return [
    '[llm]',
    `via=${via}`,
    `model=${ident(model) ?? 'unknown'}`,
    `status=${count(status) ?? '-'}`,
    `finish=${ident(finish) ?? '-'}`,
    `prompt_tokens=${count(usage?.prompt_tokens) ?? '-'}`,
    `completion_tokens=${count(usage?.completion_tokens) ?? '-'}`,
    ...(reasoning != null ? [`reasoning_tokens=${reasoning}`] : []),
    `ms=${ms}`,
    ...(error != null ? [`error=${error}`] : []),
  ].join(' ');
}

function _errorCode(err) {
  const e = err?.response?.data?.error;
  return ident(e?.code) ?? ident(e?.type) ?? ident(err?.code) ?? ident(err?.name) ?? 'error';
}

// The message both clients throw for a failed call: the HTTP status and the same sanitized code
// the log line carries — NEVER the provider's error text, which can quote input back. This
// message reaches the logs, Sentry and, when the deterministic fallback also comes up empty, the
// client (biometricHandler → emptyPlaylistError).
function failureMessage(model, err) {
  return `LLM request failed (${ident(model) ?? 'unknown'}): status=${count(err?.response?.status) ?? '-'} code=${_errorCode(err)}`;
}

/**
 * POST one chat completion in JSON-object mode and return the final `message.content`
 * (never `message.reasoning`). Rejects with the raw transport error on failure (callers wrap
 * it) and with LlmTruncatedError on finish_reason 'length'.
 */
async function chatJson({ via, key, model, prompt, temperature, timeoutMs, maxRetries }) {
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
  const started = Date.now();
  let res;
  try {
    // withRetry retries ONLY 429s (honoring Retry-After); 4xx/5xx and timeouts surface at once.
    res = await withRetry(() => axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        response_format: { type: 'json_object' },
        ...reasoningParams(model),
      },
      {
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        timeout: timeoutMs,
      },
    ), maxRetries);
  } catch (err) {
    console.warn(_logLine({ via, model, status: err?.response?.status, ms: Date.now() - started, error: _errorCode(err) }));
    throw err;
  }

  const choice = res?.data?.choices?.[0];
  const usage = res?.data?.usage;
  const finish = choice?.finish_reason;
  const line = _logLine({ via, model, status: res?.status, finish, usage, ms: Date.now() - started });
  if (finish === 'length') {
    console.warn(line);
    throw new LlmTruncatedError({
      model,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? null,
    });
  }
  console.info(line);
  return choice?.message?.content ?? '';
}

module.exports = { chatJson, failureMessage, LlmTruncatedError };
