'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Mood descriptors — the backend half of the strict, zero-tolerance vibe matcher.
//
// The frontend sends only raw emotion taps ({x, y}[]) over the `emotion_update`
// socket event (see frontend/src/lib/moods.ts). To keep that socket contract
// unchanged, the backend RE-DERIVES which mood preset was pressed from the nearest
// tap coordinate, then injects an extreme, mood-specific set of allow/exclude
// genres + search keywords. This is what makes every mode act as a STRICT SONIC
// FILTER rather than a soft bias: a ballad never survives an INTENSE generation,
// because `intense.exclude_genres` hard-drops acoustic/ballad genres downstream.
//
// IMPORTANT: MOODS must stay in sync with frontend/src/lib/moods.ts. x = valence
// (-1 unpleasant … +1 pleasant), y = arousal (-1 calm … +1 energetic).
//
// Audio-feature caveat: Spotify killed /audio-features, so tracks carry no per-track
// energy/tempo. The filter is therefore enforced at the GENRE + KEYWORD level — it
// reliably excludes whole off-vibe genres, but cannot judge a single track's energy.
// ─────────────────────────────────────────────────────────────────────────────

const MOODS = [
  { key: 'focus',    x: 0.35, y: 0.25 },
  { key: 'energize', x: 0.6,  y: 0.85 },
  { key: 'calm',     x: 0.45, y: -0.55 },
  { key: 'unwind',   x: 0.2,  y: -0.35 },
  { key: 'uplift',   x: 0.8,  y: 0.4 },
  { key: 'intense',  x: 0.1,  y: 0.95 },
];

// Each mood is deliberately EXTREME and specific so the genre filter bites hard.
//   allow_genres     — strict on-vibe allow-list (also seeds the Spotify search)
//   exclude_genres   — off-vibe genres hard-excluded from familiar + discovery
//   mood_keywords    — extreme free-text descriptors that drive the Spotify search
//   playlist_queries — vibe-playlist search terms for Layer-1 sourcing: pull tracks
//                      from curated playlists (e.g. "beast mode") whose human/algorithmic
//                      curation already encodes energy+tempo, independent of genre tag.
//                      The candidate pool is later STRICT-personalized to the user's taste.
//   energy_floor     — coarse 0–1 energy target (LLM hint + no-AI fallback math)
//   valence_hint     — coarse 0–1 valence target (same)
const MOOD_DESCRIPTORS = {
  focus: {
    allow_genres:   ['instrumental', 'ambient', 'classical', 'lo-fi', 'post-rock', 'minimal techno'],
    exclude_genres: ['hardcore', 'metalcore', 'trap', 'reggaeton', 'pop punk', 'screamo'],
    mood_keywords:  ['focus', 'concentration', 'instrumental', 'steady'],
    playlist_queries: ['deep focus', 'instrumental study', 'concentration', 'focus flow'],
    energy_floor:   0.35,
    valence_hint:   0.55,
  },
  energize: {
    allow_genres:   ['dance', 'electronic', 'house', 'pop', 'electropop', 'nu-disco'],
    exclude_genres: ['ambient', 'sleep', 'slowcore', 'drone', 'lullaby', 'dark ambient'],
    mood_keywords:  ['upbeat', 'driving', 'energetic', 'momentum'],
    playlist_queries: ['energy booster', 'power workout', 'upbeat hits', 'cardio'],
    energy_floor:   0.8,
    valence_hint:   0.75,
  },
  calm: {
    allow_genres:   ['ambient', 'acoustic', 'classical', 'lo-fi', 'chillout', 'piano'],
    exclude_genres: ['metal', 'hardcore', 'drum and bass', 'edm', 'trap', 'punk', 'dubstep'],
    mood_keywords:  ['calm', 'relaxing', 'mellow', 'soothing'],
    playlist_queries: ['peaceful piano', 'calm vibes', 'relaxing', 'ambient chill'],
    energy_floor:   0.1,
    valence_hint:   0.6,
  },
  unwind: {
    allow_genres:   ['acoustic', 'lo-fi', 'soul', 'chillout', 'singer-songwriter', 'downtempo'],
    exclude_genres: ['metal', 'hardcore', 'drum and bass', 'edm', 'big room', 'speedcore'],
    mood_keywords:  ['soft', 'wind-down', 'low-key', 'relaxed'],
    playlist_queries: ['wind down', 'chill evening', 'acoustic chill', 'late night vibes'],
    energy_floor:   0.2,
    valence_hint:   0.5,
  },
  uplift: {
    allow_genres:   ['pop', 'indie pop', 'soul', 'funk', 'disco', 'gospel'],
    exclude_genres: ['doom metal', 'black metal', 'sludge', 'dark ambient', 'industrial', 'death metal'],
    mood_keywords:  ['bright', 'hopeful', 'uplifting', 'feel-good'],
    playlist_queries: ['feel good', 'happy hits', 'good vibes', 'mood booster'],
    energy_floor:   0.6,
    valence_hint:   0.9,
  },
  intense: {
    allow_genres:   ['metal', 'hardcore', 'drum and bass', 'punk', 'hard rock', 'dubstep', 'trap metal'],
    exclude_genres: ['ambient', 'acoustic', 'classical', 'lo-fi', 'singer-songwriter', 'soft rock', 'easy listening'],
    mood_keywords:  ['aggressive', 'high-energy', 'full-throttle', 'heavy', 'adrenaline'],
    playlist_queries: ['beast mode', 'adrenaline workout', 'metal workout', '180 bpm running'],
    energy_floor:   0.9,
    valence_hint:   0.5,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────────

function _uniqLower(arr) {
  return [...new Set((arr || []).map((s) => String(s).toLowerCase().trim()).filter(Boolean))];
}

// Coarse tempo/energy bands for the manual mood flow. Kept in sync with the LLM's
// tempo_category enum (geminiEngine TEMPO_CATEGORIES). Used to derive a deterministic
// fallback band from a mood's energy_floor when the LLM didn't return a valid one.
const TEMPO_CATEGORIES = ['resting', 'active', 'peak'];
function _categoryFromEnergy(energy) {
  if (!Number.isFinite(energy) || energy <= 0.34) return 'resting';
  if (energy <= 0.66) return 'active';
  return 'peak';
}

/**
 * Re-derive the pressed mood from raw taps using nearest-neighbour on the LAST tap
 * (mirrors frontend `moodForTap` / `selectedMoodKey`). Returns null when there is
 * no usable mood — e.g. the heart-rate branch, which sends no taps.
 */
function resolveMoodKey(taps) {
  if (!Array.isArray(taps) || taps.length === 0) return null;
  const tap = taps[taps.length - 1];
  if (!tap || !Number.isFinite(tap.x) || !Number.isFinite(tap.y)) return null;

  let bestKey = null;
  let bestDist = Infinity;
  for (const m of MOODS) {
    const d = (m.x - tap.x) ** 2 + (m.y - tap.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestKey = m.key;
    }
  }
  return bestKey;
}

// Coarse, deterministic mapping from a mood's energy_floor → audio targets. Used
// as an LLM hint and as the maths behind the no-AI deterministic fallback.
function _descriptorTargets(desc) {
  const energy = desc.energy_floor;
  return {
    target_bpm:          Math.round(70 + energy * 90),     // ~70–160 bpm
    target_energy:       energy,
    target_valence:      desc.valence_hint,
    target_acousticness: Math.max(0, Math.min(1, 1 - energy)),
  };
}

/**
 * Rigid normaliser applied AFTER the LLM call. Enforces the strict vibe so a stray
 * off-vibe LLM pick is overridden, not trusted:
 *   - no mood (HR branch / empty taps) → params returned untouched
 *   - empty custom text → OVERRIDE seed_genres + mood_keywords with the mood's
 *     strict descriptors (on-taste allow genres preferred, else the allow-list)
 *   - custom text present → MERGE the mood vibe into the LLM picks so the free text
 *     is still constrained by the strict mood
 * Always attaches `exclude_genres` for the mixer's hard filter. Never mutates input.
 */
function applyMoodFallback(params, taps, textPrompt, musicProfile = {}) {
  const key = resolveMoodKey(taps);
  if (!key) return params;

  const desc = MOOD_DESCRIPTORS[key];
  const allow = _uniqLower(desc.allow_genres);
  const topGenres = _uniqLower(musicProfile.topGenres);
  const onTaste = allow.filter((g) => topGenres.includes(g));
  const hasText = typeof textPrompt === 'string' && textPrompt.trim().length > 0;

  const out = { ...params };
  // Tempo band: trust the LLM's pick (it factored the free-text override) when valid,
  // else derive deterministically from the mood's energy_floor. Drives the Tempo Critic.
  out.tempo_category = TEMPO_CATEGORIES.includes(params.tempo_category)
    ? params.tempo_category
    : _categoryFromEnergy(desc.energy_floor);
  out.exclude_genres = _uniqLower([...(params.exclude_genres || []), ...desc.exclude_genres]);
  // The FULL on-vibe allow-list (seed_genres is capped at 3); the mixer uses this to
  // judge which familiar library tracks are strictly eligible for an on-vibe mood.
  out.allow_genres = allow;
  // Layer-1 sourcing seed: the vibe-playlist search terms for this mood. Present only
  // when a mood is resolved (the HR branch returns early above), so the discovery
  // fetcher knows to source from curated playlists instead of plain genre search.
  out.playlist_queries = _uniqLower(desc.playlist_queries);

  if (!hasText) {
    out.seed_genres   = (onTaste.length ? onTaste : allow).slice(0, 3);
    out.mood_keywords = _uniqLower(desc.mood_keywords).slice(0, 4);
  } else {
    out.seed_genres   = _uniqLower([...(params.seed_genres || []), ...(onTaste.length ? onTaste : allow)]).slice(0, 3);
    out.mood_keywords = _uniqLower([...(params.mood_keywords || []), ...desc.mood_keywords]).slice(0, 4);
  }

  // A strict mood must never collapse to an empty genre seed (Spotify discovery
  // early-returns [] on no genres), so guarantee at least the allow-list.
  if (out.seed_genres.length === 0) out.seed_genres = allow.slice(0, 3);
  return out;
}

/**
 * Build a COMPLETE, schema-valid aiParams object purely from the mood — no LLM.
 * Used when the LLM is unavailable (timeout / 429) so a mood generation stays
 * strictly on-vibe instead of falling back to off-vibe top-affinity tracks.
 * Returns null when there is no resolvable mood (caller keeps its own fallback).
 */
function buildMoodParams(taps, musicProfile = {}) {
  const key = resolveMoodKey(taps);
  if (!key) return null;

  const base = {
    ..._descriptorTargets(MOOD_DESCRIPTORS[key]),
    seed_artists:  [],
    seed_genres:   [],
    mood_keywords: [],
  };
  return applyMoodFallback(base, taps, '', musicProfile);
}

module.exports = {
  MOODS,
  MOOD_DESCRIPTORS,
  TEMPO_CATEGORIES,
  resolveMoodKey,
  applyMoodFallback,
  buildMoodParams,
};
