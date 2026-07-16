'use strict';

const featureService = require('../services/features/featureService');
const featureRepo = require('../repositories/audioFeatureRepo');
const { isSpotifyKey } = require('../utils/spotifyContent');

// BullMQ processor for the feature-hydration queue.
//  - default: hydrate job.data.tracks (payload from enqueueHydration)
//  - mode 'upgrade-llm': re-hydration scan — stored LLM estimates that later
//    gained a Spotify id are refetched from the measured API and upgraded.
async function processJob(job) {
  if (job?.data?.mode === 'upgrade-llm') {
    const candidates = await featureRepo.llmUpgradeCandidates(job?.data?.limit ?? 200);
    // Spotify-ToS containment: upgrade-llm re-hydrates spotifyId candidates from the measured
    // API — an independent re-population vector into the (now spotify-free) feature store.
    // Gate them out here so no Spotify Content is refetched/stored; hydrate() would also drop
    // them, but stopping at the source avoids a pointless upgrade cycle.
    const tracks = candidates
      .filter(doc => !isSpotifyKey(doc.recordingKey ?? (doc.spotifyId ? `spotify:${doc.spotifyId}` : '')))
      .map(doc => ({
        id: doc.spotifyId,
        provider: 'spotify',
        isrc: doc.isrc ?? null,
        canonicalKey: doc.canonicalKey ?? null,
      }));
    return featureService.hydrate(tracks);
  }
  return featureService.hydrate(job?.data?.tracks ?? []);
}

module.exports = { process: processJob };
