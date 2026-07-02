'use strict';

const featureService = require('../services/features/featureService');
const featureRepo = require('../repositories/audioFeatureRepo');

// BullMQ processor for the feature-hydration queue.
//  - default: hydrate job.data.tracks (payload from enqueueHydration)
//  - mode 'upgrade-llm': re-hydration scan — stored LLM estimates that later
//    gained a Spotify id are refetched from the measured API and upgraded.
async function processJob(job) {
  if (job?.data?.mode === 'upgrade-llm') {
    const candidates = await featureRepo.llmUpgradeCandidates(job?.data?.limit ?? 200);
    const tracks = candidates.map(doc => ({
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
