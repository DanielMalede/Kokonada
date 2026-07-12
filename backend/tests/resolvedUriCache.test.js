// backend/tests/resolvedUriCache.test.js
'use strict';

const { resolvedDiscoveryUris } = require('../app/services/discovery/resolvedUriCache');

describe('resolvedDiscoveryUris', () => {
  it('includes a discovery track translated from youtube to a spotify: URI', () => {
    const out = resolvedDiscoveryUris([
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:abc', uri: 'spotify:track:123' },
    ]);
    expect(out).toEqual([{ recordingKey: 'yt:abc', uri: 'spotify:track:123' }]);
  });

  it('excludes a familiar (non-discovery) track', () => {
    const out = resolvedDiscoveryUris([
      { translatedFrom: 'youtube', recordingKey: 'yt:fam', uri: 'spotify:track:fam' },
    ]);
    expect(out).toEqual([]);
  });

  it('excludes an already-spotify passthrough (no translatedFrom flag)', () => {
    const out = resolvedDiscoveryUris([
      { isDiscovery: true, recordingKey: 'spotify:t9', uri: 'spotify:track:9' },
    ]);
    expect(out).toEqual([]);
  });

  it('excludes a discovery track whose resolved uri is not spotify:', () => {
    const out = resolvedDiscoveryUris([
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:x', uri: 'youtube:vid:x' },
    ]);
    expect(out).toEqual([]);
  });

  it('excludes a discovery track missing recordingKey', () => {
    const out = resolvedDiscoveryUris([
      { isDiscovery: true, translatedFrom: 'youtube', uri: 'spotify:track:nokey' },
    ]);
    expect(out).toEqual([]);
  });

  it('dedupes a repeated recordingKey within a batch (first wins)', () => {
    const out = resolvedDiscoveryUris([
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:dup', uri: 'spotify:track:first' },
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:dup', uri: 'spotify:track:second' },
    ]);
    expect(out).toEqual([{ recordingKey: 'yt:dup', uri: 'spotify:track:first' }]);
  });

  it('returns [] for empty / null / undefined input', () => {
    expect(resolvedDiscoveryUris([])).toEqual([]);
    expect(resolvedDiscoveryUris(null)).toEqual([]);
    expect(resolvedDiscoveryUris(undefined)).toEqual([]);
  });

  it('preserves input order and drops the interleaved non-qualifying tracks', () => {
    const out = resolvedDiscoveryUris([
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:1', uri: 'spotify:track:1' },
      { isDiscovery: false, recordingKey: 'x', uri: 'spotify:track:x' },
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:2', uri: 'spotify:track:2' },
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:3', uri: 'spotify:track:3' },
    ]);
    expect(out).toEqual([
      { recordingKey: 'yt:1', uri: 'spotify:track:1' },
      { recordingKey: 'yt:2', uri: 'spotify:track:2' },
      { recordingKey: 'yt:3', uri: 'spotify:track:3' },
    ]);
  });

  it('carries NO user-identifying fields onto the cached pair (anonymous catalog)', () => {
    const out = resolvedDiscoveryUris([
      { isDiscovery: true, translatedFrom: 'youtube', recordingKey: 'yt:a', uri: 'spotify:track:a', userId: 'u1', name: 'Song' },
    ]);
    expect(out).toEqual([{ recordingKey: 'yt:a', uri: 'spotify:track:a' }]);
    expect(Object.keys(out[0]).sort()).toEqual(['recordingKey', 'uri']);
  });
});
