'use strict';
process.env.NODE_ENV = 'test';
const { tolerance, withinBand, filterBand } = require('../app/services/selection/biosonicBand');

describe('biosonicBand.tolerance (logistic τ(c))', () => {
  it('saturates tight at full confidence, midpoint 2.0 at c0, wide near zero', () => {
    expect(tolerance(1.0)).toBeCloseTo(1.036, 2);
    expect(tolerance(0.6)).toBeCloseTo(2.0, 5);
    expect(tolerance(0.3)).toBeCloseTo(2.905, 2);
    expect(tolerance(0)).toBeCloseTo(2.995, 2);
  });
  it('is monotonically decreasing in confidence', () => {
    expect(tolerance(0.4)).toBeGreaterThan(tolerance(0.8));
  });
  it('clamps non-finite / out-of-range confidence', () => {
    expect(tolerance(NaN)).toBeCloseTo(tolerance(0), 5);
    expect(tolerance(5)).toBeCloseTo(tolerance(1), 5);
  });
});

describe('biosonicBand.withinBand', () => {
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8, confidence: 1 };
  it('passes a featureless track (cannot judge — scored with unknown penalty)', () => {
    expect(withinBand({ features: null }, targets)).toBe(true);
  });
  it('keeps an on-band track and drops an off-tempo one at high confidence', () => {
    expect(withinBand({ features: { bpm: 122, energy: 0.5 } }, targets)).toBe(true);
    expect(withinBand({ features: { bpm: 190, energy: 0.5 } }, targets)).toBe(false);
  });
  it('drops an over-energy track and keeps one inside the energy band', () => {
    expect(withinBand({ features: { bpm: 120, energy: 0.95 } }, targets)).toBe(false);
    expect(withinBand({ features: { bpm: 120, energy: 0.6 } }, targets)).toBe(true);
  });
  it('low confidence widens the band so a borderline track is admitted', () => {
    const lowConf = { ...targets, confidence: 0.3 };
    expect(withinBand({ features: { bpm: 165, energy: 0.5 } }, targets)).toBe(false);
    expect(withinBand({ features: { bpm: 165, energy: 0.5 } }, lowConf)).toBe(true);
  });
});

describe('biosonicBand.filterBand', () => {
  it('filters a list to on-band tracks, keeping featureless ones', () => {
    const targets = { bpmCenter: 70, bpmWidth: 15, energyFloor: 0.1, energyCeiling: 0.3, confidence: 1 };
    const tracks = [
      { id: 'slow', features: { bpm: 70, energy: 0.2 } },
      { id: 'fast', features: { bpm: 170, energy: 0.9 } },
      { id: 'nofeat', features: null },
    ];
    expect(filterBand(tracks, targets).map(t => t.id)).toEqual(['slow', 'nofeat']);
  });
});
