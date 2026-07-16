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
  // Periodically ingests a bounded batch of CC0 AcousticBrainz records into the provider-agnostic
  // global discovery corpus (flag-gated OFF by default — see GLOBAL_SEED_INGEST_ENABLED).
  GLOBAL_SEED_INGEST: 'global-seed-ingest',
  // Periodically redacts the encrypted sensitive fields (contextPrompt, biometric HR snapshot)
  // on aged PlaylistSessions, keeping the non-sensitive history feed (T3.1 bounded retention).
  SESSION_TRIM: 'session-trim',
  // Enforces the YouTube 30-day data-retention ToS: refreshes connected users' library rows,
  // purges disconnected/stale youtube_music rows (Spotify + mbid corpus untouched). (T3.5)
  YOUTUBE_RETENTION: 'youtube-retention',
});

const QUEUE_NAMES = new Set(Object.values(QUEUES));

module.exports = { QUEUES, QUEUE_NAMES };
