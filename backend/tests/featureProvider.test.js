'use strict';

process.env.NODE_ENV = 'test';

const { clampFeatures, recordingKeyOf, FEATURE_RANGES } = require('../app/services/features/featureProvider');

describe('clampFeatures — the poisoning defense', () => {
  it('clamps out-of-range numerics into the legal window', () => {
    const out = clampFeatures({ bpm: 400, energy: 1.7, valence: -0.3, loudness: -999 });
    expect(out.bpm).toBe(FEATURE_RANGES.bpm[1]);
    expect(out.energy).toBe(1);
    expect(out.valence).toBe(0);
    expect(out.loudness).toBe(FEATURE_RANGES.loudness[0]);
  });

  it('coerces numeric strings and nulls non-numeric junk', () => {
    const out = clampFeatures({ bpm: '128', energy: 'fast', valence: NaN, acousticness: Infinity });
    expect(out.bpm).toBe(128);
    expect(out.energy).toBeNull();
    expect(out.valence).toBeNull();
    expect(out.acousticness).toBeNull();
  });

  it('drops unknown fields entirely (no prompt-injected extras reach the store)', () => {
    const out = clampFeatures({ bpm: 120, $where: 'evil', source: 'api', confidence: 99 });
    expect(out).toEqual(expect.objectContaining({ bpm: 120 }));
    expect(out.$where).toBeUndefined();
    expect(out.source).toBeUndefined();
    expect(out.confidence).toBeUndefined();
  });

  it('returns null when nothing usable survives', () => {
    expect(clampFeatures({ bpm: 'x', energy: null })).toBeNull();
    expect(clampFeatures({})).toBeNull();
    expect(clampFeatures(null)).toBeNull();
  });
});

describe('recordingKeyOf — per-recording identity (audit F3 boundary)', () => {
  it('uses spotify:<id> for spotify-provider tracks', () => {
    expect(recordingKeyOf({ provider: 'spotify', id: 'abc' })).toBe('spotify:abc');
  });

  it('extracts the id from a spotify uri when provider is absent', () => {
    expect(recordingKeyOf({ uri: 'spotify:track:xyz9' })).toBe('spotify:xyz9');
  });

  it('uses youtube:<videoId> for youtube-shaped tracks', () => {
    expect(recordingKeyOf({ provider: 'youtube_music', id: 'vid42' })).toBe('youtube:vid42');
  });

  it('returns null when there is no id at all', () => {
    expect(recordingKeyOf({ title: 'Song' })).toBeNull();
    expect(recordingKeyOf(null)).toBeNull();
  });

  it('live and studio Spotify recordings never share a recordingKey', () => {
    expect(recordingKeyOf({ provider: 'spotify', id: 'studio1' }))
      .not.toBe(recordingKeyOf({ provider: 'spotify', id: 'live1' }));
  });
});
