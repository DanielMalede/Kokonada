'use strict';

const crypto           = require('crypto');
const axios            = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getRedis }     = require('../config/redis');

const REQUIRED_FIELDS = [
  'target_bpm', 'target_energy', 'target_valence',
  'target_acousticness', 'seed_artists', 'seed_genres',
];

const GEMINI_TIMEOUT_MS = 5_000;

function _withTimeout(ms, promise) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms)
  );
  return Promise.race([promise, timer]);
}

function getModel() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  // gemini-1.5-flash was retired by Google (v1beta generateContent now 404s it).
  // gemini-2.0-flash is the current fast/cheap GA model — ideal for this small,
  // latency-sensitive JSON task (see GEMINI_TIMEOUT_MS). Override via GEMINI_MODEL.
  return genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
}

// Provider-agnostic generation. If an OpenAI-compatible key is set (LLM_API_KEY,
// e.g. a free Groq key — no credit card needed), call that endpoint; otherwise
// fall back to the Gemini SDK. This lets the app run on a free provider when a
// Google account has no Gemini quota (free_tier limit: 0). Returns the raw text.
async function _generate(prompt) {
  const llmKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  if (llmKey) {
    const baseUrl = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
    // 8b-instant is Groq's most stable always-on model and is plenty for this
    // small structured-JSON task. Providers rotate larger models, so default to
    // the safe one; override with LLM_MODEL for a bigger model.
    const model   = process.env.LLM_MODEL   || 'llama-3.1-8b-instant';
    try {
      const { data } = await axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          // The prompts already demand strict JSON; json_object mode guarantees it.
          response_format: { type: 'json_object' },
        },
        {
          headers: { Authorization: `Bearer ${llmKey}`, 'Content-Type': 'application/json' },
          timeout: GEMINI_TIMEOUT_MS,
        },
      );
      return data.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      // Surface the provider's real reason (e.g. a decommissioned model) instead
      // of axios's opaque "Request failed with status code 404".
      const apiMsg = err.response?.data?.error?.message || err.message;
      console.error('[llm] request failed', { status: err.response?.status, model, error: apiMsg });
      throw new Error(`LLM request failed (${model}): ${apiMsg}`);
    }
  }

  const model  = getModel();
  const result = await _withTimeout(GEMINI_TIMEOUT_MS, model.generateContent(prompt));
  return result.response.text();
}

// ── Response validation ────────────────────────────────────────────────────────

/**
 * Parses and strictly validates the raw string returned by Gemini.
 * Throws a descriptive error on any schema violation so the caller can
 * fall back gracefully rather than propagating corrupt data downstream.
 * @param {string} raw
 * @returns {{ target_bpm, target_energy, target_valence, target_acousticness, seed_artists, seed_genres }}
 */
function _parseAndValidate(raw) {
  // Empty / non-string responses (model returned nothing, a safety block, or a
  // timeout surfaced an undefined body) must fail loudly so the caller falls
  // back — never let them crash on `raw.slice` inside the catch below.
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error('Gemini returned an empty response');
  }

  let parsed;
  try {
    // Strip markdown code fences Gemini sometimes wraps responses in
    const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Gemini returned invalid JSON: ${raw.slice(0, 120)}`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (parsed[field] === undefined || parsed[field] === null) {
      throw new Error(`Gemini response missing required field: ${field}`);
    }
  }

  const inRange = (v) => typeof v === 'number' && v >= 0 && v <= 1;

  // `typeof NaN === 'number'`, so an unconstrained check would let NaN / Infinity
  // / absurd tempos (negative, 9999) through into the recommendations call.
  if (typeof parsed.target_bpm !== 'number' || !Number.isFinite(parsed.target_bpm)
      || parsed.target_bpm < 30 || parsed.target_bpm > 250) {
    throw new Error('target_bpm must be a finite number between 30 and 250');
  }
  if (!inRange(parsed.target_energy)) {
    throw new Error('target_energy must be a number between 0 and 1');
  }
  if (!inRange(parsed.target_valence)) {
    throw new Error('target_valence must be a number between 0 and 1');
  }
  if (!inRange(parsed.target_acousticness)) {
    throw new Error('target_acousticness must be a number between 0 and 1');
  }
  if (!Array.isArray(parsed.seed_artists)) {
    throw new Error('seed_artists must be an array');
  }
  if (!Array.isArray(parsed.seed_genres)) {
    throw new Error('seed_genres must be an array');
  }
  // mood_keywords is the post-audio-features mood signal (e.g. ["calm","lo-fi"]).
  // Optional for back-compat — only validated when the model returns it, and never
  // injected as a default so callers that expect the bare param set stay unaffected.
  if (parsed.mood_keywords !== undefined && !Array.isArray(parsed.mood_keywords)) {
    throw new Error('mood_keywords must be an array');
  }

  return parsed;
}

// Variation directive appended to a prompt so repeated generations with identical
// inputs produce a *different* playlist. The seed also changes the md5 cache key,
// so the 24h cache no longer pins one playlist to one emotional state.
function _variationLine(seed) {
  return seed == null
    ? ''
    : `\n\nVariation token: ${seed} — pick a fresh, different selection of artists/genres than you would for other tokens, while staying within the user's taste above.`;
}

// ── Prompt builders ────────────────────────────────────────────────────────────

/**
 * Builds the deep contextual prompt for the emotion-driven pipeline.
 * No PII is included — only anonymised taste signals and emotion coordinates.
 */
function _buildEmotionPrompt(musicProfile, emotionTaps, textPrompt, seed = null) {
  const { topGenres, tempoBaseline, energy, valence, acousticness } = musicProfile;
  const allowedGenres = topGenres.join(', ');

  return `You are an expert musicologist and biometrics analyst.

User's musical taste profile (anonymised):
- Top genres (ordered by preference): ${allowedGenres}
- Baseline tempo: ${tempoBaseline ?? 'unknown'} BPM
- Baseline energy: ${energy ?? 'unknown'}
- Baseline valence: ${valence ?? 'unknown'}
- Baseline acousticness: ${acousticness ?? 'unknown'}

Current emotional state — 2D coordinates from an emotion wheel (x = arousal, y = valence, range -1 to 1):
${JSON.stringify(emotionTaps)}
${textPrompt ? `User note: "${textPrompt}"` : ''}

Analyse the emotional coordinates in the context of the user's taste profile and determine the ideal musical parameters. Output ONLY a valid JSON object — no explanation, no markdown — with exactly these fields:
{
  "target_bpm": <number, beats per minute>,
  "target_energy": <number 0–1>,
  "target_valence": <number 0–1>,
  "target_acousticness": <number 0–1>,
  "seed_artists": <array of 0–3 artist names chosen ONLY from the user's known favourites — never invent names>,
  "seed_genres": <array of 1–3 genres chosen ONLY from this allowed list: ${allowedGenres}>,
  "mood_keywords": <array of 2–4 short search descriptors capturing the mood (e.g. "calm", "uplifting", "lo-fi", "late night") — these drive the actual track search>
}${_variationLine(seed)}`;
}

/**
 * Builds the lightweight prompt for the biometric-driven pipeline.
 * Focuses on BPM and energy adjustment without a full mood overhaul.
 */
function _buildBiometricPrompt(musicProfile, biometric, seed = null) {
  const { topGenres, tempoBaseline, restingHeartRate } = musicProfile;
  const { heartRate, activity } = biometric;
  const allowedGenres = topGenres.join(', ');

  return `You are a biometrics analyst optimising music parameters to match a user's physiological state.

User's musical profile (anonymised):
- Top genres: ${allowedGenres}
- Baseline tempo: ${tempoBaseline ?? 'unknown'} BPM
- Resting heart rate: ${restingHeartRate ?? 'unknown'} bpm

Current biometrics:
- Heart rate: ${heartRate} bpm
- Activity: ${activity}

Adjust tempo and energy to match the physiological state while preserving the user's genre preferences. Output ONLY a valid JSON object — no explanation, no markdown — with exactly these fields:
{
  "target_bpm": <number>,
  "target_energy": <number 0–1>,
  "target_valence": <number 0–1>,
  "target_acousticness": <number 0–1>,
  "seed_artists": [],
  "seed_genres": <array of 1–2 genres chosen ONLY from: ${allowedGenres}>,
  "mood_keywords": <array of 2–4 short search descriptors matching the energy of this physiological state>
}${_variationLine(seed)}`;
}

// ── Gemini call ────────────────────────────────────────────────────────────────

// DATA EGRESS NOTE (audit F16): prompts are sent to Google Gemini, a third-party
// sub-processor — document it in the privacy policy / DPA. Prompts are anonymised
// (no name/email/userId; only taste signals, emotion coords, HR, and the user's
// free-text note). The Redis cache key is md5(prompt) and the cached VALUE is only
// the derived AI params (target_bpm, etc.) — raw biometrics are never stored in the
// cache, and the md5 key is not reversible to the heart rate.
async function _callGemini(prompt) {
  const redis = getRedis();
  let cacheKey = null;

  if (redis) {
    cacheKey = `gemini:${crypto.createHash('md5').update(prompt).digest('hex')}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* cache miss — proceed to API */ }
  }

  const parsed = _parseAndValidate(await _generate(prompt));

  if (redis && cacheKey) {
    redis.setex(cacheKey, 86_400, JSON.stringify(parsed)).catch(() => {});
  }

  return parsed;
}

// ── Public pipelines ───────────────────────────────────────────────────────────

/**
 * Emotion pipeline — deep contextual reasoning.
 * Intended for manual triggers (Emotion Circle, skip loop).
 *
 * @param {{ musicProfile, emotionTaps, textPrompt?, fetchTracks }} opts
 * @returns {Promise<{ params, tracks }>}
 */
async function buildEmotionPlaylist({ musicProfile, emotionTaps, textPrompt = null, fetchTracks, seed = null }) {
  const prompt = _buildEmotionPrompt(musicProfile, emotionTaps, textPrompt, seed);
  const params = await _callGemini(prompt);
  return { params, tracks: await fetchTracks(params) };
}

/**
 * Biometric pipeline — lightweight BPM / energy adjustment.
 * Intended for automatic triggers after the 60 s sustained HR change.
 *
 * @param {{ musicProfile, biometric, fetchTracks }} opts
 * @returns {Promise<{ params, tracks }>}
 */
async function adjustBiometricPlaylist({ musicProfile, biometric, fetchTracks, seed = null }) {
  const prompt = _buildBiometricPrompt(musicProfile, biometric, seed);
  const params = await _callGemini(prompt);
  return { params, tracks: await fetchTracks(params) };
}

module.exports = {
  buildEmotionPlaylist,
  adjustBiometricPlaylist,
  // Exported for unit testing
  _parseAndValidate,
  _buildEmotionPrompt,
  _buildBiometricPrompt,
};
