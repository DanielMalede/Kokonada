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

module.exports = { DEFAULT_LLM_MODEL, hasVettedProvider, assertVettedLlmProvider };
