'use strict';

// Structural guard (Spotify-ToS containment, ADR-0011 + ADR-0010 Discovery ⊥ Runtime-Resolver):
// the live serve path resolves youtube: discovery tracks to playable spotify: URIs for THIS
// playback, but must NEVER cache that resolution back onto the anonymous cross-user TrackCatalog.
// Persisting a resolved spotify: URI recontaminates the shared corpus — the leak monitor then
// counts it and the purge script deletes the whole row (losing its youtube:/mbid: identity,
// recordingKey and genres). This test fails the instant a future refactor reintroduces that exact
// cache-back write, structurally, without needing to simulate the full generation flow.

const fs = require('fs');

const HANDLER_SRC = fs.readFileSync(require.resolve('../app/sockets/biometricHandler.js'), 'utf8');

describe('biometricHandler — Spotify-resolver cache-back containment structural guard', () => {
  it('never references the discovery uri-cache write path (updateResolvedUris / resolvedDiscoveryUris / resolvedUriCache)', () => {
    expect(HANDLER_SRC).not.toMatch(/updateResolvedUris/);
    expect(HANDLER_SRC).not.toMatch(/resolvedDiscoveryUris/);
    expect(HANDLER_SRC).not.toMatch(/resolvedUriCache/);
  });

  it('still resolves tracks for playback via translateToSpotify (removing the cache-back must not remove the resolver)', () => {
    // A Spotify-connected user must still get a playable spotify: URI at serve time. This pins that
    // the resolver call itself survives — only the cache-back-to-catalog write was removed.
    expect(HANDLER_SRC).toMatch(/translateToSpotify/);
  });
});
