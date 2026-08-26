// backend/app/services/discovery/targetVector.js
'use strict';

const { buildVector, buildVectorV2 } = require('../vector/embedding');

// Build the query vector for discovery from the generation's biosonic target, in the SAME
// space as the corpus (buildVector neutral-fills any missing dim). seedGenres carry the
// genre-bag half of the match.
//
// W4-014 · the `version` argument is what keeps "the space the query is in" and "the space the
// index is in" a single decision. It is never read from env here — `discoveryVectorService`
// resolves it ONCE via `embeddingSpace.readVersion()` and passes the same value to this builder
// and to `queryNear`, so the two cannot drift apart mid-call (or across a flag flip that lands
// between two module reads).
//
// v2 returns null for a target with no evidence at all (no measurable feature, no weighted
// genre). That is a real state — an empty `targetFeatures` — and the caller must treat it as
// "do not search", never as "search with zeros": a zero vector has no direction, so its cosine
// against everything is 0 and $vectorSearch would rank the corpus arbitrarily.
function buildTargetVector(targetFeatures = {}, seedGenres = [], { version, idf = null } = {}) {
  const f = targetFeatures || {};
  const features = {
    bpm: f.bpm, energy: f.energy, valence: f.valence,
    acousticness: f.acousticness, danceability: f.danceability, loudness: f.loudness,
  };
  const genres = Array.isArray(seedGenres) ? seedGenres : [];
  return version === 'v2'
    ? buildVectorV2(features, genres, { idf })
    : buildVector(features, genres);
}

module.exports = { buildTargetVector };
