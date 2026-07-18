'use strict';

const orchestrator = require('./orchestrator');
const { generateFallbackPlaylist } = require('../playlistMixer');
const { resolveMoodKey, buildMoodParams } = require('../moodDescriptors');

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic emotion-fallback playlist (§5 Fork 4B).
//
// When normal generation fails or yields an EMPTY PLAYABLE set, the backend must ALWAYS
// return a playlist built ONLY from the user's personal listening history, honoring the
// tap-derived emotion — never random, never the global CC0/discovery corpus.
//
// This module is the pure core: it owns the ladder + the library-only guarantee. ALL
// provider/token I/O stays in the caller via the injected `resolveToPlayable(rawTracks, meta)`
// port (the handler's translateToSpotify + toClientTracks) — so the module never mints a
// URI itself and stays unit-testable against the REAL selection pipeline.
//
// The gap it closes: the selection pipeline's L4 last-resort replays band-filtered familiar
// tracks, but it lives INSIDE generateV2 and cannot see the downstream provider/translate
// layer — so it can report "success" while every returned track is dropped post-resolution.
// This ladder re-runs selection with progressively wider parameters and checks the
// CLIENT-PLAYABLE (post-translation) count each tier, closing that blind spot.
//
// Bounded 3-tier progressive widening — each tier still personal + deterministic:
//   T0 on-vibe   — emotion band + genre allow/exclude + featureFit (the strict match)
//   T1 band drop — zero-confidence targets widen the band; genre allow/exclude + featureFit kept
//   T2 affinity  — top-affinity library (== generateFallbackPlaylist), band-free & pipeline-free
// Stops at the FIRST tier whose resolveToPlayable yields ≥1 playable track. Every tier's
// output ⊆ musicProfile.library (discoveryTracks:[], zero isDiscovery). Zero personal history →
// empty result + reason (the caller routes that to its existing warming/soft-error semantics);
// this never falls back to the global corpus.
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_K = () => parseInt(process.env.PLAYLIST_SIZE || '50', 10);

// A delivered tier → the playlist-shaped object the serve side-effects need (session history +
// serve ledger for anti-repetition). `served` is the ACTUALLY-PLAYABLE set the port returned
// (post-translate / post-client-contract) — NOT the pre-resolve candidates — so anti-repetition
// records EXACTLY what was served, never a track dropped at resolution. Always library-only: discovery is [].
function _built(served, targets) {
  return { familiar: served, discovery: [], merged: served, targets: targets ?? null };
}

async function buildDeterministicFallback({
  userId,
  musicProfile = {},
  taps = [],
  moodKey = null,
  provider = null,
  targets = null,
  crossPlatform = false,
  live = {},
  now = Date.now(),
  resolveToPlayable,
} = {}) {
  const library = Array.isArray(musicProfile.library) ? musicProfile.library : [];
  // Fork 3: zero personal history → NEVER the global corpus. Return empty + reason so the
  // caller keeps its existing semantics (warming profile → building; present-but-empty → soft error).
  if (library.length === 0) {
    return { tracks: [], built: _built([], null), fallbackTier: null, featured: 0, params: {}, reason: 'empty_library' };
  }
  if (typeof resolveToPlayable !== 'function') {
    throw new Error('buildDeterministicFallback requires a resolveToPlayable port');
  }

  const key = moodKey ?? resolveMoodKey(taps);
  // Genre allow/exclude honors the emotion EVEN when AudioFeature coverage is 0 (intense drops
  // acoustic/classical; calm drops metal/edm). Null for the heart/no-mood path → no genre gate.
  const moodParams = buildMoodParams(taps, musicProfile) || {};

  // Resolve the on-vibe targets ONCE so the band-drop tier can reuse the feature centers with a
  // zeroed confidence (widest band tolerance) — keeping featureFit ordering while widening.
  let t0 = targets;
  if (t0 == null) {
    try { t0 = await orchestrator.buildTargets({ userId, live, moodKey: key, now }); }
    catch { t0 = {}; }
  }
  const t1 = { ...(t0 || {}), confidence: 0 };

  // Tiers 0 + 1 both run the FULL selection pipeline (band → score → MMR) over the library only.
  const selectionTiers = [
    { tier: 0, targets: t0 },
    { tier: 1, targets: t1 },
  ];

  for (const { tier, targets: tierTargets } of selectionTiers) {
    try {
      const out = await orchestrator.generateV2({
        userId, musicProfile, moodKey: key, provider,
        aiParams: moodParams,
        discoveryTracks: [],           // library-only: no corpus, no discovery
        live,
        targets: tierTargets,
        now,
        crossPlatform,
      });
      const merged = (out?.merged || []).filter((t) => t && !t.isDiscovery);
      if (!merged.length) continue;
      const featured = out?.telemetry?.featured ?? 0;
      const playable = await resolveToPlayable(merged, { tier, featured });
      if (playable && playable.length) {
        return { tracks: playable, built: _built(playable, out.targets), fallbackTier: tier, featured, params: moodParams, reason: null };
      }
    } catch {
      // A pipeline OR resolution (translate / client-contract) throw on this tier degrades to the
      // next tier / the pure affinity terminal — never an unhandled rejection that voids generation.
    }
  }

  // T2 — last resort: pure top-affinity personal library. Band-free, ledger-free, and free of the
  // selection pipeline entirely, so it still delivers even if generateV2 threw on T0 + T1. Wrapped so
  // a throw in the affinity builder OR the port degrades to the honest empty below, never a rejection.
  try {
    const affinityRaw = (generateFallbackPlaylist(musicProfile, provider, FALLBACK_K()) || [])
      .filter((t) => t && !t.isDiscovery);
    if (affinityRaw.length) {
      const playable = await resolveToPlayable(affinityRaw, { tier: 2, featured: 0 });
      if (playable && playable.length) {
        return { tracks: playable, built: _built(playable, t0), fallbackTier: 2, featured: 0, params: moodParams, reason: null };
      }
    }
  } catch { /* fall through to the honest empty result below */ }

  // History exists but nothing was client-playable (e.g. a cross-provider library the sink cannot
  // resolve, or a tier/affinity/port throw). Honest empty + reason — the caller surfaces its error copy.
  return { tracks: [], built: _built([], t0), fallbackTier: 2, featured: 0, params: moodParams, reason: 'no_playable' };
}

module.exports = { buildDeterministicFallback };
