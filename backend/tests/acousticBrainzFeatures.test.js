// backend/tests/acousticBrainzFeatures.test.js
'use strict';

const { mapRecord } = require('../app/services/features/acousticBrainzFeatures');

// A realistic merged AcousticBrainz record (low-level rhythm/loudness + high-level mood models),
// keyed by MusicBrainz recording id. Field shapes match AcousticBrainz's JSON dumps.
function fixture(overrides = {}) {
  return {
    metadata: { tags: {
      musicbrainz_recordingid: ['b1a9c0e9-1111-2222-3333-444455556666'],
      artist: ['Bonobo'],
      title: ['Kerala'],
      ...(overrides.tags || {}),
    } },
    rhythm:   { bpm: 120, ...(overrides.rhythm || {}) },
    lowlevel: { average_loudness: 0.8, ...(overrides.lowlevel || {}) },
    highlevel: {
      danceability:   { all: { danceable: 0.75, not_danceable: 0.25 } },
      mood_happy:     { all: { happy: 0.6, not_happy: 0.4 } },
      mood_sad:       { all: { sad: 0.2, not_sad: 0.8 } },
      mood_aggressive:{ all: { aggressive: 0.3, not_aggressive: 0.7 } },
      mood_party:     { all: { party: 0.5, not_party: 0.5 } },
      mood_relaxed:   { all: { relaxed: 0.4, not_relaxed: 0.6 } },
      mood_acoustic:  { all: { acoustic: 0.65, not_acoustic: 0.35 } },
      ...(overrides.highlevel || {}),
    },
  };
}

describe('acousticBrainzFeatures.mapRecord', () => {
  it('extracts canonical identity (mbid:<MBID>, artist, title) from record metadata', () => {
    const out = mapRecord(fixture());
    expect(out.mbid).toBe('b1a9c0e9-1111-2222-3333-444455556666');
    expect(out.recordingKey).toBe('mbid:b1a9c0e9-1111-2222-3333-444455556666');
    expect(out.artist).toBe('Bonobo');
    expect(out.title).toBe('Kerala');
  });

  it('maps bpm and danceability directly', () => {
    const f = mapRecord(fixture()).features;
    expect(f.bpm).toBe(120);
    expect(f.danceability).toBeCloseTo(0.75, 5); // highlevel danceable probability
  });

  it('re-maps AcousticBrainz relative loudness (0..1) into the dB space buildVector normalizes', () => {
    // buildVector normalizes loudness as (loudness+60)/65; we output loudness so that normalization
    // reproduces average_loudness (0.8) → loudness = 0.8*65 - 60 = -8.
    const f = mapRecord(fixture()).features;
    expect(f.loudness).toBeCloseTo(0.8 * 65 - 60, 5);
  });

  it('derives valence from mood_happy/mood_sad, acousticness from mood_acoustic, energy from mood blend (all 0..1)', () => {
    const f = mapRecord(fixture()).features;
    expect(f.valence).toBeCloseTo((0.6 + (1 - 0.2)) / 2, 5);              // (happy + (1-sad))/2
    expect(f.acousticness).toBeCloseTo(0.65, 5);                          // mood_acoustic
    expect(f.energy).toBeCloseTo((0.3 + 0.5 + (1 - 0.4)) / 3, 5);         // (aggressive + party + (1-relaxed))/3
    for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
  });

  it('returns null for a record with no MusicBrainz recording id (cannot be canonically keyed)', () => {
    expect(mapRecord(fixture({ tags: { musicbrainz_recordingid: [] } }))).toBeNull();
    expect(mapRecord({})).toBeNull();
    expect(mapRecord(null)).toBeNull();
  });

  it('omits (does not fabricate) a dim whose source fields are absent — buildVector neutral-fills it', () => {
    const out = mapRecord(fixture({ rhythm: { bpm: undefined }, highlevel: { mood_acoustic: undefined } }));
    expect(out.features).not.toHaveProperty('bpm');        // no rhythm.bpm → omitted, not 0
    expect(out.features).not.toHaveProperty('acousticness');
    expect(out.features.danceability).toBeCloseTo(0.75, 5); // present dims still map
  });
});
