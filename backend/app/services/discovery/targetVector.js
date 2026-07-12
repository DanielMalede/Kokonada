// backend/app/services/discovery/targetVector.js
'use strict';

const { buildVector } = require('../vector/embedding');

// Build the query vector for discovery from the generation's biosonic target, in the SAME
// space as the corpus (buildVector neutral-fills any missing dim). seedGenres carry the
// genre-bag half of the match.
function buildTargetVector(targetFeatures = {}, seedGenres = []) {
  const f = targetFeatures || {};
  return buildVector({
    bpm: f.bpm, energy: f.energy, valence: f.valence,
    acousticness: f.acousticness, danceability: f.danceability, loudness: f.loudness,
  }, Array.isArray(seedGenres) ? seedGenres : []);
}

module.exports = { buildTargetVector };
