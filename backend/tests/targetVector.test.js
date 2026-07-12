// backend/tests/targetVector.test.js
const { buildTargetVector } = require('../app/services/discovery/targetVector');
const { DIM, cosine, buildVector } = require('../app/services/vector/embedding');

describe('buildTargetVector', () => {
  it('produces a DIM-length unit vector matching buildVector', () => {
    const v = buildTargetVector({ bpm: 120, energy: 0.4, valence: 0.6 }, ['rock']);
    expect(v).toHaveLength(DIM);
    expect(Math.abs(v.reduce((s, x) => s + x * x, 0) - 1)).toBeLessThan(1e-9);
    expect(cosine(v, buildVector({ bpm: 120, energy: 0.4, valence: 0.6 }, ['rock']))).toBeCloseTo(1, 9);
  });

  it('a track near the target scores higher than one far from it', () => {
    const target = buildTargetVector({ bpm: 90, energy: 0.2, valence: 0.3 }, ['ambient']);
    const near = buildVector({ bpm: 92, energy: 0.25, valence: 0.35 }, ['ambient']);
    const far  = buildVector({ bpm: 175, energy: 0.95, valence: 0.9 }, ['metal']);
    expect(cosine(target, near)).toBeGreaterThan(cosine(target, far));
  });
});
