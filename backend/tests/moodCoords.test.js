'use strict';

process.env.NODE_ENV = 'test';

const { moodCoords, syntheticBioMoodKey, MOODS } = require('../app/services/moodDescriptors');

describe('moodCoords', () => {
  it('derives preset coords from the MOODS valence/arousal table (0-1 space)', () => {
    const intense = MOODS.find(m => m.key === 'intense');
    expect(moodCoords('intense')).toEqual({
      energy:  (intense.y + 1) / 2,
      valence: (intense.x + 1) / 2,
    });
  });

  it('parses synthetic bio keys: tempo band → energy, neutral valence', () => {
    expect(moodCoords('bio:resting:resting').energy).toBeLessThan(0.35);
    expect(moodCoords('bio:peak:running').energy).toBeGreaterThan(0.8);
    expect(moodCoords('bio:active:walking').valence).toBe(0.5);
  });

  it('falls back to neutral center for unknown keys', () => {
    expect(moodCoords('no-such-mood')).toEqual({ energy: 0.5, valence: 0.5 });
    expect(moodCoords(null)).toEqual({ energy: 0.5, valence: 0.5 });
  });
});

describe('syntheticBioMoodKey', () => {
  it('bands heart rate into resting/active/peak with the activity attached', () => {
    expect(syntheticBioMoodKey(65, 'resting')).toBe('bio:resting:resting');
    expect(syntheticBioMoodKey(105, 'walking')).toBe('bio:active:walking');
    expect(syntheticBioMoodKey(150, 'running')).toBe('bio:peak:running');
  });

  it('is deterministic for the same physiological state (blacklist must not fragment)', () => {
    expect(syntheticBioMoodKey(112, 'cycling')).toBe(syntheticBioMoodKey(112, 'cycling'));
  });

  it('normalizes missing activity to "unknown"', () => {
    expect(syntheticBioMoodKey(105, null)).toBe('bio:active:unknown');
  });

  it('returns null without a usable heart rate (callers degrade to legacy behavior)', () => {
    expect(syntheticBioMoodKey(null, 'running')).toBeNull();
    expect(syntheticBioMoodKey(NaN, 'running')).toBeNull();
  });
});
