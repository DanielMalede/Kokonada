'use strict';

const { blindIndex, blindIndexAll } = require('../../utils/encryption');

const HEALTH_SAMPLE_IDENTITY_NAMESPACE = 'kokonada:health-sample:v1';

function healthSampleIdentityInput(userId, source, sampleId) {
  return `${HEALTH_SAMPLE_IDENTITY_NAMESPACE}|${String(userId)}|${source}|${sampleId}`;
}

function healthSampleKey(userId, source, sampleId) {
  return blindIndex(healthSampleIdentityInput(userId, source, sampleId));
}

function healthSampleKeyCandidates(userId, source, sampleId) {
  return blindIndexAll(healthSampleIdentityInput(userId, source, sampleId));
}

module.exports = {
  healthSampleIdentityInput,
  healthSampleKey,
  healthSampleKeyCandidates,
};
