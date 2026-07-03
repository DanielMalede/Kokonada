'use strict';

// Deterministic v1 track embedding: 6 normalized audio-feature dims + a 64-dim
// hashed genre bag, L2-normalized. Cheap (zero LLM), stable, and good enough
// for MMR similarity; a text-embedding v2 slots in behind the same VectorIndex.

const GENRE_DIMS = 64;
const DIM = 6 + GENRE_DIMS;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const fin = (x, fallback) => (Number.isFinite(Number(x)) ? Number(x) : fallback);

function _fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function buildVector(features, genres = []) {
  const f = features || {};
  const vec = new Array(DIM).fill(0);
  // Missing feature dims sit at the neutral midpoint so featureless tracks
  // still embed (genre bag carries them) without faking extremes.
  vec[0] = clamp01(fin(f.bpm, 130) / 260);
  vec[1] = clamp01(fin(f.energy, 0.5));
  vec[2] = clamp01(fin(f.valence, 0.5));
  vec[3] = clamp01(fin(f.acousticness, 0.5));
  vec[4] = clamp01(fin(f.danceability, 0.5));
  vec[5] = clamp01((fin(f.loudness, -27.5) + 60) / 65);

  for (const genre of genres || []) {
    const g = String(genre).toLowerCase().trim();
    if (!g) continue;
    vec[6 + (_fnv1a(g) % GENRE_DIMS)] += 1;
  }

  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map(x => x / norm);
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // inputs are L2-normalized
}

module.exports = { buildVector, cosine, DIM };
