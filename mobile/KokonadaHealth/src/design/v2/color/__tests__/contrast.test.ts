import { contrastRatio, relativeLuminance } from '../contrast.ts';
import type { Srgb } from '../oklab.ts';

// WCAG 2.2, "relative luminance" and "contrast ratio": luminance is 0.2126 R + 0.7152 G +
// 0.0722 B over linearised sRGB (threshold 0.04045, as WCAG 2.2 corrected it), and the ratio
// is (L1 + 0.05) / (L2 + 0.05) with L1 the lighter.

const WHITE: Srgb = [1, 1, 1];
const BLACK: Srgb = [0, 0, 0];
const grey = (byte: number): Srgb => [byte / 255, byte / 255, byte / 255];

describe('relative luminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 12);
    expect(relativeLuminance(BLACK)).toBe(0);
  });

  it('weights the primaries 0.2126, 0.7152 and 0.0722', () => {
    expect(relativeLuminance([1, 0, 0])).toBeCloseTo(0.2126, 12);
    expect(relativeLuminance([0, 1, 0])).toBeCloseTo(0.7152, 12);
    expect(relativeLuminance([0, 0, 1])).toBeCloseTo(0.0722, 12);
  });
});

describe('contrast ratio', () => {
  it('is 21 for black on white and 1 for a colour on itself', () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 12);
    expect(contrastRatio(grey(128), grey(128))).toBe(1);
  });

  it('does not depend on which colour is the foreground', () => {
    expect(contrastRatio(grey(40), grey(200))).toBe(contrastRatio(grey(200), grey(40)));
  });

  // The pair every accessibility checker publishes for the 4.5:1 boundary: grey 118 (#767676)
  // on white is 4.54:1 and passes, grey 119 (#777777) is 4.48:1 and fails.
  it('grey 118 on white is 4.54:1 and grey 119 is 4.48:1, either side of 4.5', () => {
    const passing = contrastRatio(grey(118), WHITE);
    const failing = contrastRatio(grey(119), WHITE);
    expect(passing).toBeCloseTo(4.54, 2);
    expect(failing).toBeCloseTo(4.48, 2);
    expect(passing).toBeGreaterThanOrEqual(4.5);
    expect(failing).toBeLessThan(4.5);
  });

  // A contrast number for a colour that cannot be displayed is a number about nothing, and an
  // out-of-range channel can push the ratio past 21. Fail loudly instead.
  it.each([
    [[1.01, 0, 0]],
    [[0, -0.01, 0]],
    [[0, 0, NaN]],
    [[Infinity, 0, 0]],
  ])('refuses the channel set %j', (bad) => {
    expect(() => contrastRatio(bad as unknown as Srgb, WHITE)).toThrow(RangeError);
    expect(() => contrastRatio(WHITE, bad as unknown as Srgb)).toThrow(RangeError);
  });
});
