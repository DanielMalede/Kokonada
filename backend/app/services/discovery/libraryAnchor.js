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
  // A cosine floor MUST be a positive finite value. An empty-string env (Number("")===0),
  // a zero, or a negative would otherwise collapse the gate to "any non-negative cosine
  // qualifies" (or always-pass) — so anything non-positive falls back to the default.
  const v = Number(opts && opts.minCosine);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_COSINE;
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

  // SINGLE O(n) pass (no full sort): find the genuine global argmax across ALL providers and,
  // in the same pass, remember the best above-floor nameable youtube_music candidate for the
  // fallback. A candidate whose cosine is NON-finite is SKIPPED — a stored embedding carrying
  // Infinity/NaN would otherwise score non-finite, sort to the top of a naive rank, clear the
  // floor, pass the gate and get NAMED over a genuinely-nearer real track (the legal-gate leak).
  let nearest = null;       // { candidate, score } — genuine global argmax (any provider)
  let bestNameable = null;  // { candidate, score } — best above-floor nameable youtube_music
  for (const c of candidates) {
    const cEmb = c && c.embedding;
    // L3 (accepted): a dimension mismatch is a cross-embedding-VERSION pair — skip it. During a
    // future v1→v2 embedding rollout the gate is decided over the same-version subset only;
    // revisit this at any embedding-version migration.
    if (!Array.isArray(cEmb) || cEmb.length !== emb.length) continue;

    const score = cosine(emb, cEmb);
    if (!Number.isFinite(score)) continue; // M1: Inf/NaN can neither win the argmax nor scramble it

    // L2 (accepted): an exact-cosine tie is order-dependent (strict `>` keeps the first-seen
    // argmax). SAFE because the gate below never NAMES a non-youtube_music track — a tie only
    // shifts which track DECIDES the gate, never lets a Spotify track be surfaced as the anchor.
    if (nearest === null || score > nearest.score) nearest = { candidate: c, score };

    if (score >= minCosine && c.provider === 'youtube_music' && _nameable(c)
        && (bestNameable === null || score > bestNameable.score)) {
      bestNameable = { candidate: c, score };
    }
  }
  if (nearest === null) return null;

  // Floor: the genuine nearest must clear the bar (== floor passes; sub-floor fails).
  if (!(nearest.score >= minCosine)) return null;

  // COMPLIANCE gate: the genuine nearest neighbour must be non-Spotify-sourced. A Spotify
  // nearest → no claim (never fall through to a farther youtube_music track).
  if (nearest.candidate.provider !== 'youtube_music') return null;

  // Nearest-nameable fallback: the nearest is youtube_music but may itself lack an artist
  // (a data gap, not a legal one) — surface the highest-scored above-floor nameable
  // youtube_music candidate collected above; if none, omit.
  if (bestNameable === null) return null;
  const cand = bestNameable.candidate;
  const title = (cand.name != null ? cand.name : cand.title) ?? null;
  return { anchor: { title, artist: cand.artist }, score: bestNameable.score };
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
