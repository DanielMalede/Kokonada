'use strict';

const featureService = require('../services/features/featureService');

// BullMQ processor for the feature-hydration queue: job.data.tracks is the
// minimal payload built by featureService.enqueueHydration.
async function process(job) {
  return featureService.hydrate(job?.data?.tracks ?? []);
}

module.exports = { process };
