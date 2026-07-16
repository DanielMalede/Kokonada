'use strict';

// T3.3: MusicProfile must NOT store plaintext health data. restingHeartRate + hrZones were
// plaintext vitals duplicated from the encrypted MedicalProfile (and never even written) —
// they are removed; readers now source resting HR from the encrypted MedicalProfile.
const MusicProfile = require('../app/models/MusicProfile');

describe('MusicProfile plaintext health-field removal (T3.3)', () => {
  it('no longer defines a plaintext restingHeartRate path', () => {
    expect(MusicProfile.schema.path('restingHeartRate')).toBeUndefined();
  });

  it('no longer defines any hrZones subfields', () => {
    const hrZonePaths = Object.keys(MusicProfile.schema.paths).filter((p) => p.startsWith('hrZones'));
    expect(hrZonePaths).toEqual([]);
  });
});
