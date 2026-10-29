// WCAG 2.2 relative luminance and contrast ratio.
//
// Inputs are displayable sRGB only. A channel outside 0..1 (or not a number) throws: it would
// otherwise produce a ratio for a colour no screen shows, and could even exceed 21.

import { srgbToLinear, type Srgb } from './oklab.ts';

function assertDisplayable(rgb: Srgb): void {
  for (const channel of rgb) {
    if (!(channel >= 0 && channel <= 1)) {
      throw new RangeError(`contrast needs sRGB channels in [0, 1], got [${rgb.join(', ')}]`);
    }
  }
}

export function relativeLuminance(rgb: Srgb): number {
  assertDisplayable(rgb);
  return 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);
}

/** (lighter + 0.05) / (darker + 0.05); the order of the arguments does not matter. */
export function contrastRatio(first: Srgb, second: Srgb): number {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
