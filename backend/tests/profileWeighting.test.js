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

  it('has NO list-length bias — a short list #1 outranks a long list #2 at equal weight', () => {
    // 'x' is the only item of a 1-item list; 'y2' is #2 of a 3-item list. Per-list position
    // normalization must keep 'x' (a list #1) above 'y2' (a list #2). The old length-biased
    // math scored 'x' = 1*w below 'y2' = 2*w — this guards that regression.
    const merged = _weightedMergeRanked(['x'], 100, ['y1', 'y2', 'y3'], 100, 10);
    expect(merged.indexOf('x')).toBeLessThan(merged.indexOf('y2'));
  });

  it('treats each list #1 as an equal contribution at equal weights', () => {
    const merged = _weightedMergeRanked(['x'], 100, ['y1', 'y2', 'y3'], 100, 10);
    expect(merged.slice(0, 2).sort()).toEqual(['x', 'y1']); // both list-#1s sit on top
  });

  it('does not break on empty lists or non-positive weights (no NaN/throw)', () => {
    expect(_weightedMergeRanked([], 0, [], 0, 10)).toEqual([]);
    expect(_weightedMergeRanked(['a'], -5, ['b'], 3, 10)).toEqual(['b']); // negative weight ignored
  });
});
