'use strict';

process.env.NODE_ENV = 'test';

const AudioFeature = require('../app/models/AudioFeature');

describe('AudioFeature schema', () => {
  const path = (name) => AudioFeature.schema.path(name);

  it('keys on recordingKey (required, unique) — per-recording, never song-level (audit F3)', () => {
    expect(path('recordingKey').isRequired).toBe(true);
    expect(path('recordingKey').options.unique).toBe(true);
  });

  it('canonicalKey is a non-unique song-level grouping index', () => {
    expect(path('canonicalKey').options.unique).toBeUndefined();
    expect(path('canonicalKey').options.index).toBe(true);
  });

  it('source is restricted to api|llm|acousticbrainz and confidence to [0,1]', () => {
    expect(path('source').enumValues).toEqual(['api', 'llm', 'acousticbrainz']);
    expect(path('confidence').options.min).toBe(0);
    expect(path('confidence').options.max).toBe(1);
  });

  it('carries the six audio features + vibeTags + fetchedAt', () => {
    for (const f of ['bpm', 'energy', 'valence', 'acousticness', 'danceability', 'loudness']) {
      expect(path(f)).toBeDefined();
    }
    expect(path('vibeTags')).toBeDefined();
    expect(path('fetchedAt')).toBeDefined();
  });

  it('has a sparse spotifyId index for API-side lookups', () => {
    const idx = AudioFeature.schema.indexes().find(([fields]) => fields.spotifyId === 1);
    expect(idx).toBeDefined();
    expect(idx[1].sparse).toBe(true);
  });
});
