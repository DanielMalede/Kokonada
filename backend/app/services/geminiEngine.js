'use strict';

const crypto           = require('crypto');
const axios            = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getRedis }     = require('../config/redis');
const { resolveMoodKey, MOOD_DESCRIPTORS, applyMoodFallback } = require('./moodDescriptors');

const REQUIRED_FIELDS = [
  'target_bpm', 'target_energy', 'target_valence',
  'target_acousticness', 'seed_artists', 'seed_genres',
];

const GEMINI_TIMEOUT_MS = 5_000;

function _withTimeout(ms, promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini timeout after ${ms}ms`)), ms);
  });
  // Clear the timer once the race settles so a resolved call never leaves a dangling
  // handle alive for `ms` (leaks the event loop; trips Jest's open-handle warning).
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
    : `\n\nVariation token: ${seed} — deliberately pick a FRESH, different selection of seed_genres, seed_artists and mood_keywords than you would for any other token, while staying within the strict vibe and the user's taste above.`;
}

// Strict-curator directive (zero-tolerance vibe). Resolved from the emotion taps so
// the LLM is nudged to avoid off-vibe genres and lean into the mood's energy. The
// post-LLM applyMoodFallback then ENFORCES this deterministically — the directive is
// only a nudge, the fallback is the guarantee.
function _strictMoodLine(emotionTaps) {
  const key = resolveMoodKey(emotionTaps);
  if (!key) return '';
  const d = MOOD_DESCRIPTORS[key];
  return `\n\nAct as a STRICT CURATOR for a "${key}" session. You MUST AVOID these off-vibe genres entirely — never include them: ${d.exclude_genres.join(', ')}. Lean hard into this energy: ${d.mood_keywords.join(', ')}.`;
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
}${_strictMoodLine(emotionTaps)}${_variationLine(seed)}`;
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
  const rawParams = await _callGemini(prompt);
  // Zero-tolerance enforcement: deterministically override (empty text) or merge
  // (custom text) the LLM picks with the strict mood descriptors so a stray off-vibe
  // genre/keyword can never reach the Spotify search or the mixer.
  const params = applyMoodFallback(rawParams, emotionTaps, textPrompt, musicProfile);
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
  // Robustness: an empty genre seed makes Spotify discovery early-return [] — backfill
  // from the user's top genres so the heart-rate branch always has something to search.
  if (!Array.isArray(params.seed_genres) || params.seed_genres.length === 0) {
    params.seed_genres = (musicProfile.topGenres || []).slice(0, 2);
  }
  return { params, tracks: await fetchTracks(params) };
}

// ── Layer 2: Groq critic re-rank ─────────────────────────────────────────────
// Genre tags can't tell a 70 BPM ballad from a 180 BPM anthem, and Spotify killed
// /audio-features. This pass asks the LLM — which "knows" most songs' actual energy
// from its training — to drop tracks whose tempo/energy don't match the mood. It is
// a POLISH layer, not a guarantee: reconciliation is index-based (no fuzzy title
// matching), and any failure FAILS OPEN (returns the pool unchanged) so a flaky or
// hallucinating model can never blank or corrupt the playlist.

const CRITIC_TIMEOUT_MS = Number(process.env.VIBE_CRITIC_TIMEOUT_MS) || 6_000;
// Bound the prompt so a deep candidate pool can't blow up tokens/latency. Tracks
// beyond the cap pass through unjudged (the pool is normally well under this).
const MAX_CRITIC_TRACKS = Number(process.env.VIBE_CRITIC_MAX_TRACKS) || 120;

function _buildCriticPrompt(tracks, moodKey, moodKeywords) {
  const list = tracks
    .map((t, i) => {
      const artist = (t.artists || []).map((a) => a?.name).filter(Boolean).slice(0, 2).join(', ') || 'Unknown';
      return `${i}. ${artist} – ${t.name || 'Unknown'}`;
    })
    .join('\n');
  const kw = (moodKeywords || []).filter(Boolean).join(', ');

  return `You are a strict expert music critic curating a "${moodKey}" session${kw ? ` (vibe: ${kw})` : ''}.
From the numbered tracklist below, keep ONLY the tracks whose ACTUAL energy and tempo truly match this vibe. Drop anything off-energy — e.g. a slow acoustic ballad in a high-energy set, or an aggressive heavy track in a calm set — judging by your knowledge of each song.

Output ONLY a JSON object (no explanation, no markdown) of the form {"keep":[<indices to keep>]}, using the exact indices from the list.

Tracklist:
${list}`;
}

// Parse the critic's {"keep":[...]} into a clean list of in-range integer indices.
// Throws on anything unusable so the caller fails open.
function _parseKeepIndices(raw, count) {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error('empty critic response');
  const cleaned = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.keep)) throw new Error('critic response missing keep array');
  return [...new Set(parsed.keep)].filter((n) => Number.isInteger(n) && n >= 0 && n < count);
}

/**
 * Re-ranks a candidate pool, keeping only tracks whose energy/tempo match the mood.
 * Fail-open: returns `tracks` unchanged on empty/no-mood input or any LLM failure.
 * @param {{ tracks: object[], moodKey: string|null, moodKeywords?: string[] }} opts
 * @returns {Promise<object[]>}
 */
async function critiqueTrackVibe({ tracks = [], moodKey = null, moodKeywords = [] } = {}) {
  if (!Array.isArray(tracks) || tracks.length === 0) return tracks || [];
  if (!moodKey) return tracks; // no resolvable mood (e.g. HR branch) → nothing to judge

  const head = tracks.slice(0, MAX_CRITIC_TRACKS);
  const tail = tracks.slice(MAX_CRITIC_TRACKS);

  try {
    const raw  = await _withTimeout(CRITIC_TIMEOUT_MS, _generate(_buildCriticPrompt(head, moodKey, moodKeywords)));
    const keep = _parseKeepIndices(raw, head.length);
    // A critic that "keeps nothing" is treated as no signal, not as "blank the set".
    if (keep.length === 0) return tracks;
    return [...keep.map((i) => head[i]), ...tail];
  } catch (err) {
    console.warn(`[vibe-critic] re-rank skipped (${err.message}) — keeping pool unchanged`);
    return tracks;
  }
}

module.exports = {
  buildEmotionPlaylist,
  adjustBiometricPlaylist,
  critiqueTrackVibe,
  // Exported for unit testing
  _parseAndValidate,
  _buildEmotionPrompt,
  _buildBiometricPrompt,
};
