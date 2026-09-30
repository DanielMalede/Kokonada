'use strict';

// Wave-0 egress containment: the app may only call a VETTED, contractually-bound LLM
// provider (Groq via LLM_API_KEY). The former silent fallback to Google Gemini's free
// tier — training-eligible, no Zero-Data-Retention — is removed. In production we refuse
// to boot without a vetted provider so special-category signals can never reach an
// unvetted endpoint; a runtime LLM failure degrades to the deterministic mood/BPM path.

// The one default model for every Groq call (llmClient and geminiEngine), overridable with
// LLM_MODEL. Groq retires models on a schedule and every caller falls back instead of
// failing when a model is gone, so keep this in step with https://console.groq.com/docs/deprecations —
// tests/llmModel.decommissionGuard.test.js fails if a default names a retired ID it lists.
const DEFAULT_LLM_MODEL = 'openai/gpt-oss-20b';

// Reasoning effort for the gpt-oss family ONLY. Groq documents low | medium | high for it
// (default medium) and rejects "values outside a model's supported set" with a 400
// (https://console.groq.com/docs/api-reference), so an LLM_MODEL override to another family
// must not carry the field. Low keeps these small JSON tasks inside their latency budgets and
// spends fewer tokens of the per-minute quota on reasoning.
// LLM_REASONING_EFFORT is validated, not passed through: one typo on Railway would otherwise
// 400 every gpt-oss call. Anything outside the supported set falls back to low.
const GPT_OSS = /^openai\/gpt-oss-/;
const EFFORTS = new Set(['low', 'medium', 'high']);

function reasoningParams(model) {
  if (!GPT_OSS.test(String(model ?? ''))) return {};
  const v = String(process.env.LLM_REASONING_EFFORT ?? '').trim().toLowerCase();
  return { reasoning_effort: EFFORTS.has(v) ? v : 'low' };
}

function hasVettedProvider() {
  return !!(process.env.LLM_API_KEY || process.env.GROQ_API_KEY);
}

function assertVettedLlmProvider() {
  if (process.env.NODE_ENV === 'production' && !hasVettedProvider()) {
    throw new Error(
      'No vetted LLM provider configured — set LLM_API_KEY (Groq). Refusing to start: the '
      + 'unvetted Google Gemini fallback has been removed (Wave-0 egress containment).',
    );
  }
}

module.exports = { DEFAULT_LLM_MODEL, reasoningParams, hasVettedProvider, assertVettedLlmProvider };
