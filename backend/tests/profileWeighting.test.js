'use strict';

const { _weightedMergeRanked } = require('../app/services/musicProfileService');

describe('_weightedMergeRanked (YouTube-weighted taste profile)', () => {
  it('lets the richer provider dominate the merged ranking', () => {
    // Spotify: tiny library (weight 10) ranks "jazz" first. YouTube: huge library
    // (weight 500) ranks "electronic" first. YouTube must dominate.
    const spotify = ['jazz', 'classical'];
    const youtube = ['electronic', 'house', 'techno'];
    const merged = _weightedMergeRanked(spotify, 10, youtube, 500, 10);
    expect(merged[0]).toBe('electronic');
    expect(merged.indexOf('electronic')).toBeLessThan(merged.indexOf('jazz'));
  });

  it('boosts a genre both providers share', () => {
    const merged = _weightedMergeRanked(['pop', 'rock'], 100, ['pop', 'edm'], 100, 10);
    expect(merged[0]).toBe('pop'); // appears in both → highest combined score
  });

  it('ignores a provider with an empty library (weight 0)', () => {
    const merged = _weightedMergeRanked([], 0, ['indie', 'folk'], 300, 10);
    expect(merged).toEqual(['indie', 'folk']);
  });

  it('respects the cap', () => {
    const many = Array.from({ length: 30 }, (_, i) => `g${i}`);
    expect(_weightedMergeRanked(many, 100, [], 0, 10)).toHaveLength(10);
  });
});
