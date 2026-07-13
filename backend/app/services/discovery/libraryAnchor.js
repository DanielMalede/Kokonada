'use strict';

// Pure, in-memory nearest-LIBRARY-anchor derivation for the discovery mix-receipt.
// No repo/DB/vector-index imports — it operates ONLY on already-embedded, user-scoped
// track objects handed in by the caller. The anchor answers "Because you love <artist>":
// the library track most similar (pre-L2-normalized embedding cosine) to a discovery pick.
//
// COMPLIANCE (Policy §II): an anchor may be claimed ONLY when the GENUINE nearest library
// neighbour is NON-Spotify-sourced (provider === 'youtube_music'). A Spotify-provider
// nearest track yields NO anchor — the client degrades to a neutral pill. We never
// substitute a farther track to dodge the gate. This is the legal basis for the feature.

const { cosine } = require('../vector/embedding');

const DEFAULT_MIN_COSINE = 0.6;

function _floor(opts) {
  const v = Number(opts && opts.minCosine);
  return Number.isFinite(v) ? v : DEFAULT_MIN_COSINE;
}

function _nameable(candidate) {
  return typeof candidate?.artist === 'string' && candidate.artist.trim().length > 0;
}

// The nearest qualifying library anchor for one discovery track, or null. Never throws.
function nearestLibraryAnchor(discoveryTrack, libraryCandidates, opts = {}) {
  const emb = discoveryTrack && discoveryTrack.embedding;
  if (!Array.isArray(emb) || emb.length === 0) return null;

  const minCosine = _floor(opts);
  const candidates = Array.isArray(libraryCandidates) ? libraryCandidates : [];

  // Score every embedding-compatible candidate once (ALL providers), rank by cosine desc.
  // The global nearest — regardless of provider — decides the compliance gate.
  const ranked = [];
  for (const c of candidates) {
    const cEmb = c && c.embedding;
    if (!Array.isArray(cEmb) || cEmb.length !== emb.length) continue;
    ranked.push({ candidate: c, score: cosine(emb, cEmb) });
  }
  if (ranked.length === 0) return null;
  ranked.sort((a, b) => b.score - a.score);

  // Floor: the genuine nearest must clear the bar (== floor passes; NaN fails).
  const nearest = ranked[0];
  if (!(nearest.score >= minCosine)) return null;

  // COMPLIANCE gate: the genuine nearest neighbour must be non-Spotify-sourced.
  // A Spotify nearest → no claim (never fall through to a farther youtube_music track).
  if (nearest.candidate.provider !== 'youtube_music') return null;

  // Nearest-nameable fallback: the nearest is youtube_music but may lack an artist
  // (a data gap, not a legal one) — fall through to the next above-floor youtube_music
  // candidate that IS nameable; if none, omit.
  for (const { candidate, score } of ranked) {
    if (score < minCosine) break;                            // ranked desc — nothing below is above-floor
    if (candidate.provider !== 'youtube_music') continue;    // never name a Spotify track
    if (!_nameable(candidate)) continue;
    const title = (candidate.name != null ? candidate.name : candidate.title) ?? null;
    return { anchor: { title, artist: candidate.artist }, score };
  }
  return null;
}

// Mutate each qualifying discovery pick with pick.anchor = { title, artist }. Any failure
// on any pick degrades that pick to no-anchor — the whole call is never allowed to throw.
function attachLibraryAnchors(selectedDiscovery, libraryCandidates, opts = {}) {
  const picks = Array.isArray(selectedDiscovery) ? selectedDiscovery : [];
  for (const pick of picks) {
    try {
      const result = nearestLibraryAnchor(pick, libraryCandidates, opts);
      if (result && _nameable(result.anchor)) {
        pick.anchor = { title: result.anchor.title, artist: result.anchor.artist };
      }
    } catch { /* degrade to no-anchor */ }
  }
  return picks;
}

module.exports = { nearestLibraryAnchor, attachLibraryAnchors };
