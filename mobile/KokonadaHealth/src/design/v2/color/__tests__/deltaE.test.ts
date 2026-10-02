import { deltaEOK, hueDistance, hueSeparationViolations } from '../deltaE.ts';

// ΔE_OK is CSS Color 4 §20.3: the Euclidean distance in OKLab.
describe('deltaEOK', () => {
  it('is 0 for the same colour', () => {
    expect(deltaEOK({ L: 0.6, a: 0.1, b: -0.05 }, { L: 0.6, a: 0.1, b: -0.05 })).toBe(0);
  });

  it('is the straight-line distance over L, a and b', () => {
    expect(deltaEOK({ L: 0.5, a: 0, b: 0 }, { L: 0.5, a: 0.03, b: 0.04 })).toBeCloseTo(0.05, 15);
    expect(deltaEOK({ L: 0.5, a: 0, b: 0 }, { L: 0.7, a: 0, b: 0 })).toBeCloseTo(0.2, 15);
    expect(deltaEOK({ L: 0.2, a: 0.1, b: 0.1 }, { L: 0.4, a: 0.1, b: 0.1 })).toBeCloseTo(0.2, 15);
  });

  it('does not depend on the order of the colours', () => {
    const x = { L: 0.3, a: -0.08, b: 0.02 };
    const y = { L: 0.9, a: 0.05, b: 0.11 };
    expect(deltaEOK(x, y)).toBe(deltaEOK(y, x));
  });
});

describe('hueDistance (circular, in degrees)', () => {
  it.each([
    [10, 350, 20],
    [0, 180, 180],
    [80, 322, 118],
    [370, 10, 0],
    [-10, 10, 20],
    [90, 90, 0],
  ])('between %p and %p is %p', (a, b, expected) => {
    expect(hueDistance(a, b)).toBeCloseTo(expected, 12);
  });

  it('is NaN when either colour has no hue', () => {
    expect(Number.isNaN(hueDistance(NaN, 10))).toBe(true);
  });
});

// QA-064: the circular OKLCh hue distance between any two emotion hues is at least 70.0°.
describe('hueSeparationViolations (QA-064)', () => {
  it('a 65° pair fails the 70° rule', () => {
    expect(hueSeparationViolations({ joy: 80, calm: 145 }, 70)).toEqual([
      { first: 'joy', second: 'calm', distance: 65 },
    ]);
  });

  // V0 set A, "Orchid": gaps 98, 72, 72 and 118 (v0-spec §4.2).
  it('V0 set A passes', () => {
    expect(hueSeparationViolations({ joy: 80, calm: 178, reflective: 250, intense: 322 }, 70)).toEqual([]);
  });

  // V0 set B, "Violet": its tightest gap is exactly 70°, and the rule's bound is inclusive.
  it('V0 set B passes with a gap of exactly 70°', () => {
    expect(hueSeparationViolations({ joy: 85, calm: 155, reflective: 228, intense: 300 }, 70)).toEqual([]);
  });

  it('checks every pair, including the one across 0°', () => {
    const violations = hueSeparationViolations({ joy: 30, calm: 120, reflective: 210, intense: 340 }, 70);
    expect(violations).toEqual([{ first: 'joy', second: 'intense', distance: 50 }]);
  });

  // An achromatic "hue" cannot be told apart by hue at all, so it fails rather than passing.
  it('a colour with no hue fails', () => {
    const violations = hueSeparationViolations({ joy: 80, calm: NaN }, 70);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ first: 'joy', second: 'calm' });
    expect(Number.isNaN(violations[0].distance)).toBe(true);
  });

  it.each([NaN, -1, 181])('refuses the minimum %p', (minimum) => {
    expect(() => hueSeparationViolations({ joy: 80, calm: 200 }, minimum)).toThrow(RangeError);
  });
});
