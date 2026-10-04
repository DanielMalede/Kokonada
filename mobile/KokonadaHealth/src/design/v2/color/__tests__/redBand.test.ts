import { mixOklab, oklabToOklch, oklchToOklab, srgbToOklab, type Oklab } from '../oklab.ts';
import {
  assertRedBand,
  ditherReachable,
  hueInBand,
  isRed,
  reachableRedPixel,
  segmentTouchesRed,
  triangleTouchesRed,
  type RedBand,
} from '../redBand.ts';

// FIXTURE, pending DEC-081: the owner has not ruled the band, the floor or the routing. These
// tests prove the mechanism, so the band is an explicit parameter here. The numbers are V0's
// band (v0-spec §4.2: "Hue in [350°, 50°] is never used at C > 0.02"), which is also the check
// band the designer proposes in base.neverRed. The token rules run on the token file's own band.
//
// At the floor itself the sources differ: V0 and the designer call red "C > floor", QA-065 passes
// only "chroma < floor". This code applies QA-065's, the stricter, so C exactly at the floor is red.
const V0_BAND: RedBand = { hueFrom: 350, hueTo: 50, chromaFloor: 0.02 };

const lch = (L: number, C: number, h: number): Oklab => oklchToOklab({ L, C, h });

// V0 hue set A ("Orchid", v0-spec §4.2), core values.
const AMBER = lch(0.8, 0.11, 80);
const TEAL = lch(0.8, 0.11, 178);
const DEEP_BLUE = lch(0.68, 0.11, 250);
const ORCHID = lch(0.68, 0.1, 322);

describe('the band is a parameter, and a malformed one is refused', () => {
  it('accepts V0’s band', () => {
    expect(() => assertRedBand(V0_BAND)).not.toThrow();
  });

  it.each([
    [{ hueFrom: NaN, hueTo: 50, chromaFloor: 0.02 }],
    [{ hueFrom: 350, hueTo: Infinity, chromaFloor: 0.02 }],
    [{ hueFrom: 360, hueTo: 50, chromaFloor: 0.02 }],
    [{ hueFrom: -10, hueTo: 50, chromaFloor: 0.02 }],
    [{ hueFrom: 20, hueTo: 20, chromaFloor: 0.02 }],
    [{ hueFrom: 350, hueTo: 50, chromaFloor: -0.001 }],
    [{ hueFrom: 350, hueTo: 50, chromaFloor: NaN }],
  ])('refuses %j', (band) => {
    expect(() => assertRedBand(band)).toThrow(RangeError);
  });
});

describe('hueInBand wraps around 0°', () => {
  it.each([350, 355, 0, 25, 50, 360, -5, 385])('%p° is inside [350°, 50°]', (h) => {
    expect(hueInBand(h, V0_BAND)).toBe(true);
  });

  it.each([349, 51, 80, 180, 322])('%p° is outside [350°, 50°]', (h) => {
    expect(hueInBand(h, V0_BAND)).toBe(false);
  });

  it('a band that does not cross 0° works the same way', () => {
    const band: RedBand = { hueFrom: 10, hueTo: 40, chromaFloor: 0.02 };
    expect([10, 25, 40].map((h) => hueInBand(h, band))).toEqual([true, true, true]);
    expect([9, 41, 200].map((h) => hueInBand(h, band))).toEqual([false, false, false]);
  });

  it('a colour with no hue is never inside', () => {
    expect(hueInBand(NaN, V0_BAND)).toBe(false);
  });
});

describe('isRed: hue in the band and chroma at or above the floor', () => {
  it('sRGB red is red', () => {
    expect(isRed(srgbToOklab([1, 0, 0]), V0_BAND)).toBe(true);
  });

  it('the floor itself is red, and anything below it is neutral (QA-065: passes only below)', () => {
    expect(isRed({ L: 0.6, a: 0.02, b: 0 }, V0_BAND)).toBe(true);
    expect(isRed({ L: 0.6, a: 0.0199, b: 0 }, V0_BAND)).toBe(false);
  });

  it('an achromatic colour is never red, even with a zero floor', () => {
    expect(isRed({ L: 0.5, a: 0, b: 0 }, { ...V0_BAND, chromaFloor: 0 })).toBe(false);
  });

  it('V0 set A’s four hues are clear of the band (QA-063, on the fixture)', () => {
    expect([AMBER, TEAL, DEEP_BLUE, ORCHID].map((c) => isRed(c, V0_BAND))).toEqual([false, false, false, false]);
  });

  // V0 synthesis T4: "an unrouted blend of intense and joy crosses it … set A at about C 0.054,
  // h 25°". The straight midpoint of amber and orchid reproduces it.
  it('the straight amber-to-orchid midpoint is red, at V0’s hue 25° and chroma 0.054', () => {
    const mid = mixOklab(AMBER, ORCHID, 0.5);
    const { C, h } = oklabToOklch(mid);
    expect(h).toBeCloseTo(25.5, 0);
    expect(C).toBeCloseTo(0.054, 3);
    expect(isRed(mid, V0_BAND)).toBe(true);
  });

  it.each([
    [{ L: NaN, a: 0.1, b: 0 }],
    [{ L: 0.5, a: NaN, b: 0 }],
    [{ L: 0.5, a: 0.1, b: Infinity }],
  ])('refuses the broken colour %j rather than calling it safe', (bad) => {
    expect(() => isRed(bad, V0_BAND)).toThrow(RangeError);
  });
});

describe('segmentTouchesRed: the exact test for a straight OKLab mix', () => {
  const NEUTRAL = { L: 0.74, a: 0, b: 0 };

  it('the straight amber-to-orchid line touches red', () => {
    expect(segmentTouchesRed(AMBER, ORCHID, V0_BAND)).toBe(true);
  });

  it('routed through a neutral waypoint, neither leg touches red', () => {
    expect(segmentTouchesRed(AMBER, NEUTRAL, V0_BAND)).toBe(false);
    expect(segmentTouchesRed(NEUTRAL, ORCHID, V0_BAND)).toBe(false);
  });

  it('a segment that ends in red touches red', () => {
    expect(segmentTouchesRed(NEUTRAL, srgbToOklab([1, 0, 0]), V0_BAND)).toBe(true);
  });

  it('a chord through the neutral disc, between two hues outside the band, does not touch red', () => {
    expect(segmentTouchesRed(lch(0.6, 0.019, 60), lch(0.6, 0.019, 340), V0_BAND)).toBe(false);
  });

  // The false green that sampling alone allows. The line cuts the band's corner at hue 50° and
  // the floor, 1e-4 inside it, so it is red over a window about 2e-4 long; the 101-sample grid
  // over this 0.3-long segment steps 0.003 and lands either side of the window.
  it('catches a corner crossing that a 0.01 sampling grid misses', () => {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const radial = [Math.cos(rad(50)), Math.sin(rad(50))];
    const clockwise = [Math.sin(rad(50)), -Math.cos(rad(50))];
    const inward = [(radial[0] + clockwise[0]) / Math.SQRT2, (radial[1] + clockwise[1]) / Math.SQRT2];
    const along = [(radial[0] - clockwise[0]) / Math.SQRT2, (radial[1] - clockwise[1]) / Math.SQRT2];
    const corner = [0.02 * radial[0] + 1e-4 * inward[0], 0.02 * radial[1] + 1e-4 * inward[1]];
    const at = (s: number): Oklab => ({ L: 0.6, a: corner[0] + s * along[0], b: corner[1] + s * along[1] });
    const from = at(-0.1515);
    const to = at(0.1485);

    expect(isRed(at(0), V0_BAND)).toBe(true);
    const sampledRed = Array.from({ length: 101 }, (_, k) => isRed(mixOklab(from, to, k / 100), V0_BAND));
    expect(sampledRed.some(Boolean)).toBe(false);
    expect(segmentTouchesRed(from, to, V0_BAND)).toBe(true);
  });
});

describe('triangleTouchesRed: a straight mix composited toward a third colour', () => {
  const NEUTRAL = { L: 0.74, a: 0, b: 0 };

  it('is red when any part of the triangle is, even with every corner clear', () => {
    // Amber, orchid and a neutral: the corners are clear, the amber-orchid side is not.
    expect(triangleTouchesRed(AMBER, ORCHID, NEUTRAL, V0_BAND)).toBe(true);
  });

  it('is clear when the triangle stays on the cool side', () => {
    expect(triangleTouchesRed(TEAL, DEEP_BLUE, NEUTRAL, V0_BAND)).toBe(false);
  });

  it('is red when a corner is red', () => {
    expect(triangleTouchesRed(TEAL, DEEP_BLUE, srgbToOklab([1, 0, 0]), V0_BAND)).toBe(true);
  });
});

// The field's dither is static blue noise of ±1/255 added to OKLab L before sRGB (designer,
// V1_DIRECTIONS_DESIGNER §1.4 and R5; base token field.dither.amplitude). The device then rounds
// each channel to 8 bits. ditherReachable lists every 8-bit pixel that pipeline can show for a
// colour, with a rounding tie allowed to go either way.
describe('ditherReachable: every 8-bit pixel the field’s L dither can show', () => {
  const toBytes = (pixels: ReadonlyArray<readonly number[]>) =>
    pixels.map((p) => p.map((c) => Math.round(c * 255)).join(',')).sort();

  it('with no dither, the colour is its nearest 8-bit step', () => {
    expect(toBytes(ditherReachable(srgbToOklab([128 / 255, 0, 1]), 0))).toEqual(['128,0,255']);
  });

  it('a rounding tie can go either way, so both steps are reachable', () => {
    expect(toBytes(ditherReachable(srgbToOklab([127.5 / 255, 0, 0]), 0))).toEqual(['127,0,0', '128,0,0']);
  });

  // Dither on L moves all three channels together. Where a grey sits exactly on a rounding tie,
  // float noise of ~1e-13 between its channels lets them round apart by one step, on a GPU as
  // here, so those pixels are listed too. What must hold is the designer's R5: near-neutrals
  // quantised to 8 bits stay at C ≤ 0.005.
  it('a grey stays near-neutral: channels at most one step apart, chroma at most 0.005 (R5)', () => {
    const pixels = ditherReachable({ L: 0.6, a: 0, b: 0 }, 1 / 255);
    expect(toBytes(pixels)).toEqual(expect.arrayContaining(['127,127,127', '128,128,128', '129,129,129']));
    for (const pixel of pixels) {
      const bytes = pixel.map((c) => Math.round(c * 255));
      expect(Math.max(...bytes) - Math.min(...bytes)).toBeLessThanOrEqual(1);
      expect(oklabToOklch(srgbToOklab(pixel)).C).toBeLessThanOrEqual(0.005);
    }
  });

  it('black stays black: the dither is too small to lift any channel off 0', () => {
    expect(toBytes(ditherReachable({ L: 0, a: 0, b: 0 }, 1 / 255))).toEqual(['0,0,0']);
  });

  it('a colour outside the gamut is clamped first, as the display would', () => {
    expect(toBytes(ditherReachable(srgbToOklab([1.2, -0.1, 0.6]), 0))).toEqual(['255,0,153']);
  });

  // An oracle that is not the enumeration: sweep the dither in 20,001 steps and round each.
  // 0.044 is the widest amplitude the token sweeps use: the ±1/255 dither plus Linen's 0.040 grain.
  it.each([1 / 255, 0.044])('finds every pixel a 20,001-step sweep of an amplitude of %p finds', (amplitude) => {
    const colours = [lch(0.6, 0.0192, 25), AMBER, ORCHID, lch(0.21, 0.012, 70), lch(0.925, 0.016, 72), lch(0.45, 0.15, 150), lch(0.3, 0.12, 300)];
    for (const colour of colours) {
      const swept = new Set<string>();
      for (let i = 0; i <= 20000; i++) {
        const delta = -amplitude + 2 * amplitude * (i / 20000);
        for (const pixel of toBytes(ditherReachable({ ...colour, L: colour.L + delta }, 0))) swept.add(pixel);
      }
      const enumerated = new Set(toBytes(ditherReachable(colour, amplitude)));
      for (const pixel of swept) expect(enumerated).toContain(pixel);
    }
  });

  it.each([-1e-6, NaN, Infinity])('refuses the amplitude %p', (amplitude) => {
    expect(() => ditherReachable({ L: 0.5, a: 0, b: 0 }, amplitude)).toThrow(RangeError);
  });

  it('refuses a colour that is not a number', () => {
    expect(() => ditherReachable({ L: NaN, a: 0, b: 0 }, 1 / 255)).toThrow(RangeError);
  });
});

describe('reachableRedPixel: the dither margin', () => {
  // Hue 25°, chroma 0.0192: just under the 0.02 floor. Its float colour and its nearest 8-bit
  // pixel are both neutral; one dither step on L reaches (139, 123, 121), which is C 0.02004.
  const NEAR_FLOOR = lch(0.6, 0.0192, 25);
  const WELL_BELOW = lch(0.6, 0.005, 25);

  it('a near-floor sample passes as a float and when quantised, and fails with the dither', () => {
    expect(isRed(NEAR_FLOOR, V0_BAND)).toBe(false);
    expect(reachableRedPixel(NEAR_FLOOR, V0_BAND, 0)).toBeNull();
    const pixel = reachableRedPixel(NEAR_FLOOR, V0_BAND, 1 / 255);
    expect(pixel).not.toBeNull();
    expect(isRed(srgbToOklab(pixel!), V0_BAND)).toBe(true);
  });

  it('a sample well below the floor stays neutral under the same dither', () => {
    expect(reachableRedPixel(WELL_BELOW, V0_BAND, 1 / 255)).toBeNull();
  });
});
