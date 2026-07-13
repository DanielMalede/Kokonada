'use strict';

const { buildTargets } = require('./targetsBuilder');
const { selectPlaylist } = require('../selection/pipeline');

// THE serving path (Phase 7 sealed the flip — the legacy mixer and its rollback
// flag are gone): full biosonic inputs → translate() targets → the selection
// pipeline. The biosonic-targets builder lives in targetsBuilder (model I/O) so the
// SAME band can be computed once and shared by discovery + the pipeline.

const PLAYLIST_SIZE = () => parseInt(process.env.PLAYLIST_SIZE || '50', 10);

async function generateV2({
  userId,
  musicProfile = {},
  moodKey = null,
  provider = null,
  aiParams = {},
  discoveryTracks = [],
  live = {},
  targets = null,
  k = PLAYLIST_SIZE(),
  now = Date.now(),
  crossPlatform = false,
}) {
  // Use a precomputed band verbatim when the caller supplies one (band-aware
  // discovery threads the SAME object so discovery and the pipeline never drift);
  // otherwise compute it here (mood-fallback + legacy callers).
  const resolvedTargets = targets != null ? targets : await buildTargets({ userId, live, moodKey, now });
  const { tracks, telemetry } = await selectPlaylist({
    userId, musicProfile, moodKey, provider, aiParams, targets: resolvedTargets, discoveryTracks, k, now, crossPlatform,
  });

  return {
    familiar:  tracks.filter(t => !t.isDiscovery),
    discovery: tracks.filter(t => t.isDiscovery),
    merged:    tracks,
    telemetry,
    targets: resolvedTargets,
  };
}

module.exports = { generateV2, buildTargets };
