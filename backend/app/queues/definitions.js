'use strict';

const QUEUES = Object.freeze({
  FEATURE_HYDRATION: 'feature-hydration',
  EMBEDDING_BUILD: 'embedding-build',
  STATE_VECTOR_RECOMPUTE: 'state-vector-recompute',
  // Precompiles a live-biometric playlist buffer on a confirmed HR band transition,
  // so flipping to Live mode plays instantly (Part 3 shadow-worker buffer).
  BIOMETRIC_BUFFER: 'biometric-buffer',
  // Periodically drains the unclassified-track pool (Groq-outage safety floor): re-evaluates
  // due rows and promotes music into the profile or hard-deletes non-music.
  RECLASSIFY_UNCLASSIFIED: 'reclassify-unclassified',
});

const QUEUE_NAMES = new Set(Object.values(QUEUES));

module.exports = { QUEUES, QUEUE_NAMES };
