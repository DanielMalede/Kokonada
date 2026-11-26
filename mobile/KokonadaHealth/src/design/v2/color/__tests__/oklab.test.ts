import {
  linearToSrgb,
  mixOklab,
  oklabToOklch,
  oklabToSrgb,
  oklchToOklab,
  srgbToLinear,
  srgbToOklab,
  xyzToOklab,
  type Oklab,
  type Srgb,
} from '../oklab.ts';

// Reference vectors come from published sources, never from this module's own output.
//
// color.js is the reference implementation maintained by the CSS Color 4 editors. Its OKLab set
// was checked against Ottosson's published linear-sRGB-to-OKLab code, and its own tolerance is
// 1e-4. Source: github.com/color-js/color.js, test/conversions.js at ae276da (2026-06-19).
const COLORJS_OKLAB: ReadonlyArray<readonly [string, Srgb, readonly [number, number, number]]> = [
  ['white', [1, 1, 1], [1.0, 0.0, 0.0]],
  ['red', [1, 0, 0], [0.627955, 0.224863, 0.125846]],
  ['lime', [0, 1, 0], [0.86644, -0.233888, 0.179498]],
  ['blue', [0, 0, 1], [0.452014, -0.032457, -0.311528]],
  ['cyan', [0, 1, 1], [0.905399, -0.149444, -0.039398]],
  ['magenta', [1, 0, 1], [0.701674, 0.274566, -0.169156]],
  ['yellow', [1, 1, 0], [0.967983, -0.071369, 0.19857]],
  ['black', [0, 0, 0], [0.0, 0.0, 0.0]],
];

const COLORJS_OKLCH: ReadonlyArray<readonly [string, Srgb, readonly [number, number, number]]> = [
  ['red', [1, 0, 0], [0.6279553639214311, 0.2576833038053608, 29.23388027962784]],
  ['lime', [0, 1, 0], [0.8664396175234368, 0.2948272245426958, 142.4953450414439]],
  ['blue', [0, 0, 1], [0.45201371817442365, 0.3132143886344849, 264.0520226163699]],
];

// Ottosson, "A perceptual color space for image processing" (2020, matrices updated 2021-01-25):
// "Table of example XYZ and Oklab pairs … rounded to three decimals". Three published decimals
// can only be matched to half a unit in the last place, so this table is held at 5e-4.
const OTTOSSON_XYZ: ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number]]> = [
  [[0.95, 1.0, 1.089], [1.0, 0.0, 0.0]],
  [[1.0, 0.0, 0.0], [0.45, 1.236, -0.019]],
  [[0.0, 1.0, 0.0], [0.922, -0.671, 0.263]],
  [[0.0, 0.0, 1.0], [0.153, -1.415, -0.449]],
];

// CSS Color 4 §9.2 and §9.3 give the same five colours in both notations. a and b are published
// to four decimals, so the hue they imply is good to about 0.03 degrees.
const CSS_LAB_LCH: ReadonlyArray<readonly [readonly [number, number, number], readonly [number, number, number]]> = [
  [[0.40101, 0.1147, 0.0453], [0.40101, 0.12332, 21.555]],
  [[0.59686, 0.1009, 0.1192], [0.59686, 0.15619, 49.7694]],
  [[0.65125, -0.032, 0.1274], [0.65125, 0.13138, 104.097]],
  [[0.66016, -0.1084, 0.1114], [0.66016, 0.15546, 134.231]],
  [[0.72322, -0.0465, -0.115], [0.72322, 0.12403, 247.996]],
];

const REFERENCE_TOLERANCE = 1e-4;
const HALF_UNIT_AT_3_DECIMALS = 5e-4;
const HUE_TOLERANCE_DEG = 0.05;

const lab = (L: number, a: number, b: number): Oklab => ({ L, a, b });

function expectWithin(actual: number, expected: number, tolerance: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

/** Every channel value on a 0, 0.25 … 1 grid: 125 colours, primaries and greys included. */
function srgbGrid(): Srgb[] {
  const steps = [0, 0.25, 0.5, 0.75, 1];
  const out: Srgb[] = [];
  for (const r of steps) for (const g of steps) for (const b of steps) out.push([r, g, b]);
  return out;
}

describe('sRGB to OKLab, against published reference vectors', () => {
  it.each(COLORJS_OKLAB)('%s matches color.js within 1e-4', (_name, srgb, [L, a, b]) => {
    const out = srgbToOklab(srgb);
    expectWithin(out.L, L, REFERENCE_TOLERANCE);
    expectWithin(out.a, a, REFERENCE_TOLERANCE);
    expectWithin(out.b, b, REFERENCE_TOLERANCE);
  });

  it.each(COLORJS_OKLCH)('%s in OKLCh matches color.js within 1e-4', (_name, srgb, [L, C, h]) => {
    const out = oklabToOklch(srgbToOklab(srgb));
    expectWithin(out.L, L, REFERENCE_TOLERANCE);
    expectWithin(out.C, C, REFERENCE_TOLERANCE);
    expectWithin(out.h, h, REFERENCE_TOLERANCE);
  });

  it('sRGB yellow is oklch(0.968 0.211 109.8), as CSS Color 4 §9.1 prints it', () => {
    const out = oklabToOklch(srgbToOklab([1, 1, 0]));
    expectWithin(out.L, 0.968, HALF_UNIT_AT_3_DECIMALS);
    expectWithin(out.C, 0.211, HALF_UNIT_AT_3_DECIMALS);
    expectWithin(out.h, 109.8, HUE_TOLERANCE_DEG);
  });

  it.each(OTTOSSON_XYZ)('XYZ %j matches Ottosson’s table to its three published decimals', (xyz, [L, a, b]) => {
    const out = xyzToOklab(xyz);
    expectWithin(out.L, L, HALF_UNIT_AT_3_DECIMALS);
    expectWithin(out.a, a, HALF_UNIT_AT_3_DECIMALS);
    expectWithin(out.b, b, HALF_UNIT_AT_3_DECIMALS);
  });
});

describe('OKLab and OKLCh are the same colour in two notations', () => {
  it.each(CSS_LAB_LCH)('CSS Color 4 pair %j to OKLCh', ([L, a, b], [L2, C, h]) => {
    const out = oklabToOklch(lab(L, a, b));
    expect(out.L).toBe(L2);
    expectWithin(out.C, C, REFERENCE_TOLERANCE);
    expectWithin(out.h, h, HUE_TOLERANCE_DEG);
  });

  it.each(CSS_LAB_LCH)('CSS Color 4 pair %j back to OKLab', ([L, a, b], [L2, C, h]) => {
    const out = oklchToOklab({ L: L2, C, h });
    expect(out.L).toBe(L);
    expectWithin(out.a, a, REFERENCE_TOLERANCE);
    expectWithin(out.b, b, REFERENCE_TOLERANCE);
  });

  // CSS Color 4: an achromatic colour's hue is powerless. A hue invented here would put white
  // somewhere on the hue circle, where a hue rule could then misjudge it.
  it('white has no hue: the hue is NaN, not 0', () => {
    const out = oklabToOklch(srgbToOklab([1, 1, 1]));
    expect(out.C).toBeLessThan(4e-6);
    expect(Number.isNaN(out.h)).toBe(true);
  });

  it('a powerless (NaN) hue converts as 0, as CSS Color 4 treats a missing component', () => {
    expect(oklchToOklab({ L: 0.5, C: 0, h: NaN })).toEqual({ L: 0.5, a: 0, b: 0 });
  });

  it('hue is reported in [0, 360)', () => {
    const negativeA = oklabToOklch(lab(0.5, 0.05, -0.05));
    expectWithin(negativeA.h, 315, 1e-9);
  });
});

describe('round trips', () => {
  it.each(srgbGrid())('sRGB [%p, %p, %p] survives OKLab and back within 1e-9', (r, g, b) => {
    const back = oklabToSrgb(srgbToOklab([r, g, b]));
    expectWithin(back[0], r, 1e-9);
    expectWithin(back[1], g, 1e-9);
    expectWithin(back[2], b, 1e-9);
  });

  it('a chromatic OKLCh survives OKLab and back', () => {
    const start = { L: 0.68, C: 0.1, h: 322 };
    const back = oklabToOklch(oklchToOklab(start));
    expectWithin(back.L, start.L, 1e-12);
    expectWithin(back.C, start.C, 1e-12);
    expectWithin(back.h, start.h, 1e-9);
  });
});

describe('the sRGB transfer function (CSS Color 4, extended)', () => {
  it('is linear below 0.04045 and the 2.4 power above it', () => {
    expect(srgbToLinear(0.04045)).toBeCloseTo(0.04045 / 12.92, 15);
    expect(srgbToLinear(0.5)).toBeCloseTo(Math.pow((0.5 + 0.055) / 1.055, 2.4), 15);
    expect(srgbToLinear(1)).toBeCloseTo(1, 15);
    expect(srgbToLinear(0)).toBe(0);
  });

  it('mirrors negative values instead of returning NaN', () => {
    expect(srgbToLinear(-0.5)).toBeCloseTo(-srgbToLinear(0.5), 15);
    expect(linearToSrgb(-0.2)).toBeCloseTo(-linearToSrgb(0.2), 15);
  });

  it('linearToSrgb inverts srgbToLinear away from the knee', () => {
    for (const v of [0, 0.001, 0.2, 0.5, 0.999, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 12);
    }
  });

  // The standard's two thresholds do not meet: 0.04045 / 12.92 = 0.00313080495…, just above the
  // decode threshold 0.0031308, so the knee comes back through the power branch, 3e-8 low. That
  // is the published constants, not this code; the pin keeps anyone from "fixing" one of them.
  it('at the knee the inverse is good to 3e-8, because the published thresholds do not meet', () => {
    const back = linearToSrgb(srgbToLinear(0.04045));
    expect(Math.abs(back - 0.04045)).toBeGreaterThan(1e-9);
    expect(Math.abs(back - 0.04045)).toBeLessThan(5e-8);
  });
});

describe('mixing in OKLab', () => {
  const from = lab(0.8, 0.02, 0.1);
  const to = lab(0.6, 0.08, -0.06);

  it('is a straight line: the ends are the inputs and the middle is the midpoint', () => {
    expect(mixOklab(from, to, 0)).toEqual(from);
    expect(mixOklab(from, to, 1)).toEqual(to);
    const mid = mixOklab(from, to, 0.5);
    expectWithin(mid.L, 0.7, 1e-15);
    expectWithin(mid.a, 0.05, 1e-15);
    expectWithin(mid.b, 0.02, 1e-15);
  });

  it.each([-0.01, 1.01, NaN, Infinity])('refuses the mix parameter %p', (t) => {
    expect(() => mixOklab(from, to, t)).toThrow(RangeError);
  });
});
