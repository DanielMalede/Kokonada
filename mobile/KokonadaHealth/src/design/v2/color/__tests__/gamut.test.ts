import { DEFAULT_GAMUT_EPSILON, inSrgbGamut } from '../gamut.ts';
import { oklchToOklab, srgbToOklab, type Srgb } from '../oklab.ts';

// Every corner of the sRGB cube, plus a mid grey: the extremes a gamut check must accept.
const CUBE: ReadonlyArray<Srgb> = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  [0.5, 0.5, 0.5],
];

describe('sRGB gamut detection', () => {
  it.each(CUBE)('the sRGB colour [%p, %p, %p] is inside', (r, g, b) => {
    expect(inSrgbGamut(srgbToOklab([r, g, b]))).toBe(true);
  });

  // sRGB red is oklch(0.62796 0.25768 29.234): it sits on the boundary, and the same lightness
  // and hue at higher chroma cannot be shown.
  it('sRGB red is inside, and more chroma at its lightness and hue is outside', () => {
    expect(inSrgbGamut(oklchToOklab({ L: 0.6279553639, C: 0.2576833038, h: 29.2338802796 }))).toBe(true);
    expect(inSrgbGamut(oklchToOklab({ L: 0.6279553639, C: 0.27, h: 29.2338802796 }))).toBe(false);
  });

  it('a vivid out-of-gamut OKLCh is outside', () => {
    expect(inSrgbGamut(oklchToOklab({ L: 0.7, C: 0.4, h: 150 }))).toBe(false);
  });

  it.each([1.01, -0.05])('lightness %p is outside', (L) => {
    expect(inSrgbGamut({ L, a: 0, b: 0 })).toBe(false);
  });

  // The cube in OKLab's inverse shrinks small lightness errors near black: L = -0.01 becomes a
  // channel of about -1.3e-5, inside the tolerance. A token's L range is a schema rule, checked
  // where the tokens are parsed; it is not something the gamut test can stand in for.
  it('a lightness just below 0 reads as black within the tolerance, and outside at zero tolerance', () => {
    expect(inSrgbGamut({ L: -0.01, a: 0, b: 0 })).toBe(true);
    expect(inSrgbGamut({ L: -0.01, a: 0, b: 0 }, { epsilon: 0 })).toBe(false);
  });

  it.each([
    [NaN, 0, 0],
    [0.5, NaN, 0],
    [0.5, 0, Infinity],
  ])('a non-finite component (%p, %p, %p) is outside: a broken value never passes', (L, a, b) => {
    expect(inSrgbGamut({ L, a, b })).toBe(false);
  });
});

describe('the gamut tolerance', () => {
  // color.js (the CSS Color 4 editors' implementation) accepts coordinates within 0.000075 of the
  // range: src/inGamut.js at 1c457dd. A token authored to four decimals in OKLCh can land a few
  // 1e-5 past an sRGB edge through rounding alone, which is not a real excursion.
  it('defaults to color.js’s 0.000075', () => {
    expect(DEFAULT_GAMUT_EPSILON).toBe(0.000075);
  });

  it('accepts a channel 5e-5 past the edge by default, and refuses it at zero tolerance', () => {
    const justOver = srgbToOklab([1.00005, 0.5, 0.5]);
    expect(inSrgbGamut(justOver)).toBe(true);
    expect(inSrgbGamut(justOver, { epsilon: 0 })).toBe(false);
  });

  it('refuses a channel 1e-4 past either edge by default', () => {
    expect(inSrgbGamut(srgbToOklab([1.0001, 0.5, 0.5]))).toBe(false);
    expect(inSrgbGamut(srgbToOklab([0.5, -0.0001, 0.5]))).toBe(false);
  });

  it.each([-1e-6, NaN, Infinity])('refuses the tolerance %p', (epsilon) => {
    expect(() => inSrgbGamut({ L: 0.5, a: 0, b: 0 }, { epsilon })).toThrow(RangeError);
  });
});
