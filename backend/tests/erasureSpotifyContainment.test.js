'use strict';

// Structural guard (Spotify-ToS containment, ADR-0011): per-user GDPR erasure must NEVER
// reach into the global cross-user caches (TrackCatalog / TrackEmbedding / AudioFeature).
// Spotify Content in those caches is eliminated GLOBALLY by the one-time purge script
// (scripts/purgeSpotifyCorpus.js), not per departing user — so a `deleteMany` for one user
// can never evict rows shared by everyone else. This test fails if a future change imports
// a global-cache model into the erasure cascade.

const fs = require('fs');

const ERASURE_SRC = fs.readFileSync(require.resolve('../app/services/privacy/erasure.js'), 'utf8');

describe('erasure — Spotify-ToS containment structural guard', () => {
  it('does not require (import) any global cross-user cache model into the per-user cascade', () => {
    expect(ERASURE_SRC).not.toMatch(/require\(\s*['"][^'"]*models\/(TrackCatalog|TrackEmbedding|AudioFeature)['"]\s*\)/);
  });

  it('documents that Spotify rows are globally eliminated via the one-time purge script', () => {
    expect(ERASURE_SRC).toMatch(/purgeSpotifyCorpus/);
  });
});
