import { mixSafe } from '../mixSafe.ts';
import { mixOklab, oklabToOklch, oklchToOklab, type Oklab } from '../oklab.ts';
import { isRed, type RedBand } from '../redBand.ts';

// Route R2 (designer §1.2): every UI colour transition (a CTA tint change, a bead's colour, a
// uniform tween) goes through mixSafe. If the short arc between the two hues meets the design
// band, the transition passes through the neutral at the lerped lightness; otherwise it is the
// straight OKLab mix. FIXTURE: DEC-081's design band, as base.neverRed holds it.
const DESIGN_BAND: RedBand = { hueFrom: 345, hueTo: 55, chromaFloor: 0.015 };

const lch = (L: number, C: number, h: number): Oklab => oklchToOklab({ L, C, h });
const AMBER = lch(0.8, 0.11, 80);
const TEAL = lch(0.8, 0.11, 178);
const BLUE = lch(0.68, 0.11, 250);
const ORCHID = lch(0.68, 0.1, 322);
const INK = lch(0.24, 0.004, 80);

describe('mixSafe', () => {
  it('is the straight OKLab mix when the short arc stays clear of the band', () => {
    expect(mixSafe(TEAL, BLUE, 0.5, DESIGN_BAND)).toEqual(mixOklab(TEAL, BLUE, 0.5));
  });

  // Amber (80°) to orchid (322°): the short arc runs through 0°, so the mix goes through neutral.
  it('goes through the neutral when the short arc meets the band', () => {
    const mid = mixSafe(AMBER, ORCHID, 0.5, DESIGN_BAND);
    expect(mid.L).toBeCloseTo((AMBER.L + ORCHID.L) / 2, 15);
    expect(mid.a).toBeCloseTo(0, 15);
    expect(mid.b).toBeCloseTo(0, 15);
    const quarter = mixSafe(AMBER, ORCHID, 0.25, DESIGN_BAND);
    expect(quarter.a).toBeCloseTo(AMBER.a * 0.5, 15);
    expect(quarter.b).toBeCloseTo(AMBER.b * 0.5, 15);
    const threeQuarters = mixSafe(AMBER, ORCHID, 0.75, DESIGN_BAND);
    expect(threeQuarters.a).toBeCloseTo(ORCHID.a * 0.5, 15);
    expect(threeQuarters.b).toBeCloseTo(ORCHID.b * 0.5, 15);
  });

  it('starts and ends exactly on its two colours', () => {
    expect(mixSafe(AMBER, ORCHID, 0, DESIGN_BAND)).toEqual(AMBER);
    expect(mixSafe(AMBER, ORCHID, 1, DESIGN_BAND)).toEqual(ORCHID);
  });

  it('with an achromatic end there is no arc, so it is the straight mix', () => {
    const grey = { L: 0.5, a: 0, b: 0 };
    expect(mixSafe(grey, ORCHID, 0.3, DESIGN_BAND)).toEqual(mixOklab(grey, ORCHID, 0.3));
  });

  // Property: between any two of the anchors and a near-neutral ink, in both orders, no frame of
  // the transition is red under the design band.
  it('never shows a red frame between the anchors and the neutral ink', () => {
    const colours = [AMBER, TEAL, BLUE, ORCHID, INK];
    for (const from of colours) {
      for (const to of colours) {
        for (let i = 0; i <= 100; i++) {
          expect(isRed(mixSafe(from, to, i / 100, DESIGN_BAND), DESIGN_BAND)).toBe(false);
        }
      }
    }
  });

  it('bites: the straight amber-to-orchid mix it replaces is red at its middle', () => {
    expect(isRed(mixOklab(AMBER, ORCHID, 0.5), DESIGN_BAND)).toBe(true);
    expect(oklabToOklch(mixOklab(AMBER, ORCHID, 0.5)).C).toBeGreaterThan(0.05);
  });

  it.each([-0.1, 1.1, NaN])('refuses the mix parameter %p', (t) => {
    expect(() => mixSafe(AMBER, ORCHID, t, DESIGN_BAND)).toThrow(RangeError);
  });
});
