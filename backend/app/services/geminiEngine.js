'use strict';

const crypto           = require('crypto');
const axios            = require('axios');
const { withRetry }    = require('../utils/retry');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getRedis }     = require('../config/redis');
const { captureException } = require('../config/sentry');
const { resolveMoodKey, MOOD_DESCRIPTORS, applyMoodFallback, applyBiometricBands, bandFromHeartRate } = require('./moodDescriptors');

const REQUIRED_FIELDS = [
  'target_bpm', 'target_energy', 'target_valence',
  'target_acousticness', 'seed_artists', 'seed_genres',
];

// Coarse tempo/energy bands the MANUAL mood flow targets — derived by the LLM from the
// user's Mode + optional free-text (the free-text wins). Decoupled from the real-time
// HR/biometric path, which keeps its own BPM logic. The critic keeps only tracks that
// sit in this band; an invalid/missing value is filled deterministically downstream.
const TEMPO_CATEGORIES = ['resting', 'active', 'peak'];

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
async function _generate(prompt, { model: modelOverride = null, timeoutMs = GEMINI_TIMEOUT_MS } = {}) {
  const llmKey = process.env.LLM_API_KEY || process.env.GROQ_API_KEY;
  if (llmKey) {
    const baseUrl = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
    // 8b-instant is Groq's most stable always-on model and is plenty for this
    // small structured-JSON task. Providers rotate larger models, so default to
    // the safe one; override with LLM_MODEL globally, or per-call (the Tempo Critic
    // passes a bigger model whose world-knowledge judges niche tracks' real tempo).
    const model   = modelOverride || process.env.LLM_MODEL || 'llama-3.1-8b-instant';
    // Groq's free tier caps tokens-per-minute (6000 TPM). Under load, generation 429s and —
    // without a retry — the whole playlist silently collapses to the static fallback (the
    // "tracks=10, ignores the activity" symptom). withRetry rides out the 429 honoring
    // Retry-After; 4xx/5xx and timeouts still fail fast to the caller's fallback.
    const maxRetries = (() => { const n = parseInt(process.env.LLM_MAX_RETRIES ?? '', 10); return Number.isFinite(n) && n >= 0 ? n : 3; })();
    try {
      const { data } = await withRetry(() => axios.post(
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
          timeout: timeoutMs,
        },
      ), maxRetries);
      return data.choices?.[0]?.message?.content ?? '';
    } catch (err) {
      // Surface the provider's real reason (e.g. a decommissioned model) instead
      // of axios's opaque "Request failed with status code 404".
      const apiMsg = err.response?.data?.error?.message || err.message;
      console.error('[llm] request failed', { status: err.response?.status, model, error: apiMsg });
      // Report LLM outages/timeouts (previously only console-logged) so a provider going
      // down — which silently degrades every playlist to the static fallback — is visible.
      captureException(err, { scope: 'llm', model, status: err.response?.status, apiMsg });
      throw new Error(`LLM request failed (${model}): ${apiMsg}`);
    }
  }

  const model  = getModel();
  const result = await _withTimeout(timeoutMs, model.generateContent(prompt));
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
  // tempo_category — coarse target band (resting/active/peak) the critic matches against.
  // Optional and LENIENT: an invalid value is dropped (never thrown) so a stray pick can't
  // blank a whole generation — applyMoodFallback then derives one from the mood's energy.
  if (parsed.tempo_category !== undefined && !TEMPO_CATEGORIES.includes(parsed.tempo_category)) {
    delete parsed.tempo_category;
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

// How many hyper-specific sub-genres to surface to the LLM per generation. A small
// rotating window (vs the full footprint) steers Spotify search into a different
// catalog sector each press.
const MICRO_GENRE_COUNT = Number(process.env.MICRO_GENRE_COUNT) || 8;

// Deterministic PRNG from a string seed (xfnv1a hash → mulberry32). Same seed →
// same sequence (reproducible per request); different seeds → different rotation.
function _seededRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function next() {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Micro-genre seed shifting: pick a seeded random subset of the user's HYPER-SPECIFIC
// sub-genres (genreSet, e.g. "indie pop", "post-punk") instead of the broad parent
// genres, so each press drives the Spotify algorithm into entirely separate catalog
// sectors. Falls back to topGenres when there's no granular footprint, and returns
// the whole list unchanged when it's already at/under the window (or no seed) — which
// keeps the broad-genre behaviour for small profiles.
function _microGenreSubset(musicProfile, seed) {
  const granular = (musicProfile.genreSet && musicProfile.genreSet.length)
    ? musicProfile.genreSet
    : (musicProfile.topGenres || []);
  if (seed == null || granular.length <= MICRO_GENRE_COUNT) return granular;
  const rng = _seededRng(String(seed));
  const arr = [...granular];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, MICRO_GENRE_COUNT);
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
 * Builds the contextual prompt for the emotion-driven pipeline.
 * Wave-0 egress containment: NO PII and NO special-category vitals. The prompt carries
 * ONLY anonymised abstract signals — emotion coordinates, the user's selected activity,
 * and closed-vocabulary derived-intent tags. Numeric vitals (HR/HRV/SpO2/sleep/…) never
 * appear here; they steer the audio targets deterministically AFTER the LLM returns
 * (buildEmotionPlaylist → applyBiometricBands).
 */
function _buildEmotionPrompt(musicProfile, emotionTaps, textPrompt, seed = null, { activity = null } = {}) {
  const { tempoBaseline, energy, valence, acousticness } = musicProfile;
  // Micro-genre seed shifting: a rotating subset of hyper-specific sub-genres.
  const allowedGenres = _microGenreSubset(musicProfile, seed).join(', ');

  // Only nudge the LLM to weigh the activity when one is present.
  const contextDirective = activity
    ? ` Also weigh the user's current activity ("${activity}") against the emotion: a winding-down activity (preparing for sleep, meditating) calls for calmer, lower-tempo, more acoustic music, while an energetic activity (gym, running) supports higher tempo and energy — always staying within the user's taste profile.`
    : '';

  return `You are an expert musicologist.

User's musical taste profile (anonymised):
- Top genres (ordered by preference): ${allowedGenres}
- Baseline tempo: ${tempoBaseline ?? 'unknown'} BPM
- Baseline energy: ${energy ?? 'unknown'}
- Baseline valence: ${valence ?? 'unknown'}
- Baseline acousticness: ${acousticness ?? 'unknown'}

Current emotional state — 2D coordinates from an emotion wheel (x = arousal, y = valence, range -1 to 1):
${JSON.stringify(emotionTaps)}
${textPrompt ? `User note: "${textPrompt}"` : ''}
${activity ? `Current activity: ${activity}` : ''}

Analyse the emotional coordinates in the context of the user's taste profile and determine the ideal musical parameters.${contextDirective} Output ONLY a valid JSON object — no explanation, no markdown — with exactly these fields:
{
  "target_bpm": <number, beats per minute>,
  "target_energy": <number 0–1>,
  "target_valence": <number 0–1>,
  "target_acousticness": <number 0–1>,
  "seed_artists": <array of 0–3 artist names chosen ONLY from the user's known favourites — never invent names>,
  "seed_genres": <array of 1–3 genres chosen ONLY from this allowed list: ${allowedGenres}>,
  "mood_keywords": <array of 2–4 short search descriptors capturing the mood (e.g. "calm", "uplifting", "lo-fi", "late night") — these drive the actual track search>,
  "tempo_category": <exactly one of "resting" | "active" | "peak" — the overall tempo/energy band that best fits this session. IMPORTANT: if the user note is present it OVERRIDES the mood when it implies movement (e.g. "going for a run" → "peak" even for a calm mood); otherwise infer it from the emotional coordinates>
}${_strictMoodLine(emotionTaps)}${_variationLine(seed)}`;
}

/**
 * Builds the lightweight prompt for the biometric-driven pipeline.
 * Wave-0 egress containment: the numeric heart rate and resting HR NEVER appear in the
 * prompt — only the COARSE physiological intensity band (derived server-side from HR).
 * The exact target BPM/energy is mapped from the HR deterministically AFTER the LLM
 * returns (adjustBiometricPlaylist → applyBiometricBands).
 */
function _buildBiometricPrompt(musicProfile, biometric, seed = null) {
  const { heartRate, activity } = biometric;
  const band = bandFromHeartRate(heartRate) || 'active';

  return `You are a music curator matching a listener's physiological intensity.

Session context (anonymised — no vitals, no identifiers):
- Physiological intensity band: ${band}
${activity ? `- Current activity: ${activity}` : ''}

Choose musical parameters that match a "${band}" intensity. Output ONLY a valid JSON object — no explanation, no markdown — with exactly these fields:
{
  "target_bpm": <number>,
  "target_energy": <number 0–1>,
  "target_valence": <number 0–1>,
  "target_acousticness": <number 0–1>,
  "seed_artists": [],
  "seed_genres": <array of 1–2 genres matching a "${band}" intensity>,
  "mood_keywords": <array of 2–4 short search descriptors matching this intensity>
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
async function buildEmotionPlaylist({ musicProfile, emotionTaps, textPrompt = null, activity = null, biometricContext = null, fetchTracks, seed = null }) {
  const prompt = _buildEmotionPrompt(musicProfile, emotionTaps, textPrompt, seed, { activity });
  const rawParams = await _callGemini(prompt);
  // Wave-0 two-stage split: the decrypted vitals never crossed the LLM boundary — they
  // map to the audio target bands (BPM/energy/valence/acousticness) DETERMINISTICALLY here,
  // AFTER the LLM has returned, reusing the moodDescriptors band machinery.
  const bandedParams = applyBiometricBands(rawParams, biometricContext);
  // Zero-tolerance enforcement: deterministically override (no custom intent) or
  // merge (custom intent) the LLM picks with the strict mood descriptors so a stray
  // off-vibe genre/keyword can never reach the Spotify search or the mixer. A
  // selected activity counts as custom intent too, so it refines the strict mood
  // list rather than being steamrolled by it.
  const params = applyMoodFallback(bandedParams, emotionTaps, textPrompt || activity, musicProfile);
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
  const rawParams = await _callGemini(prompt);
  // Wave-0 two-stage split: the numeric HR never crossed the LLM boundary — map it to the
  // audio target bands (BPM/energy/valence/acousticness) DETERMINISTICALLY here, after the
  // LLM returns, reusing the moodDescriptors band machinery.
  const params = applyBiometricBands(rawParams, { heartRate: biometric.heartRate });
  // Robustness: an empty genre seed makes Spotify discovery early-return [] — backfill
  // from the user's top genres so the heart-rate branch always has something to search.
  if (!Array.isArray(params.seed_genres) || params.seed_genres.length === 0) {
    params.seed_genres = (musicProfile.topGenres || []).slice(0, 2);
  }
  return { params, tracks: await fetchTracks(params) };
}

// ── LLM genre backfill ─────────────────────────────────────────────────────────
// Spotify increasingly returns EMPTY `genres` arrays for artists, leaving a user's
// genreSet empty so the mood filters can't differentiate. This asks the LLM (Groq)
// for each artist's genres ONCE at profile-build time (background, off the latency-
// sensitive generation path), so generation stays fast AND moods work. Fails open to
// an empty map so a missing/slow LLM never blocks the profile build.
// Cover a WIDE slice of the library so genreSet is rich enough for moods to truly
// diverge (the thin genreSet=4 made every mood feel identical). Batched so a large
// set still resolves within the LLM timeout; batches run in parallel and fail open
// independently.
const MAX_BACKFILL_ARTISTS = Number(process.env.GENRE_BACKFILL_MAX_ARTISTS) || 200;
const BACKFILL_BATCH       = Number(process.env.GENRE_BACKFILL_BATCH) || 40;

async function _inferArtistGenresBatch(names) {
  const prompt = `You are a music genre expert. For each artist below, list 3-6 SPECIFIC sub-genres as short lowercase tags — prefer precise tags ("indie pop", "deep house", "trap metal", "neo-soul", "post-punk") over broad ones ("pop", "rock"). Output ONLY a JSON object whose keys are the EXACT artist names given and whose values are arrays of genre strings — no commentary, no markdown.

Artists:
${names.map((n) => `- ${n}`).join('\n')}`;
  const raw = await _generate(prompt);
  const cleaned = String(raw).replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned);
}

async function inferArtistGenres(artistNames = []) {
  const names = [...new Set((artistNames || []).filter(Boolean))].slice(0, MAX_BACKFILL_ARTISTS);
  if (names.length === 0) return {};

  // The prompt asks for "EXACT artist names" as JSON keys, but the model does not reliably honor
  // that (observed live: Groq consistently lowercases keys regardless of instruction) — a caller
  // doing out[originalCaseName] would silently miss every entry. Map back to the caller's own
  // exact-case input via case-insensitive matching so this function's contract (keyed by the
  // caller's original strings) holds regardless of how the model cases its response.
  const byLower = new Map(names.map(n => [n.toLowerCase().trim(), n]));

  const batches = [];
  for (let i = 0; i < names.length; i += BACKFILL_BATCH) batches.push(names.slice(i, i + BACKFILL_BATCH));

  const out = {};
  const results = await Promise.allSettled(batches.map(_inferArtistGenresBatch));
  for (const r of results) {
    if (r.status !== 'fulfilled' || !r.value) {
      if (r.status === 'rejected') console.warn(`[musicProfile] genre backfill batch failed: ${r.reason?.message}`);
      continue;
    }
    for (const [name, genres] of Object.entries(r.value)) {
      if (Array.isArray(genres)) {
        const clean = genres.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.toLowerCase().trim());
        if (clean.length) {
          const original = byLower.get(String(name).toLowerCase().trim()) ?? name;
          out[original] = [...new Set(clean)];
        }
      }
    }
  }
  return out;
}

module.exports = {
  buildEmotionPlaylist,
  adjustBiometricPlaylist,
  inferArtistGenres,
  // Exported for unit testing
  _parseAndValidate,
  _buildEmotionPrompt,
  _buildBiometricPrompt,
  TEMPO_CATEGORIES,
};
