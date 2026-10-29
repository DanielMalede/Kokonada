// Is an OKLab colour displayable in sRGB?
//
// The test is made on the gamma-encoded channels, as CSS Color 4 and color.js make it. A
// non-finite component fails: NaN compares false with everything, so a broken value can never
// read as inside.

import { oklabToSrgb, type Oklab } from './oklab.ts';

/** color.js's tolerance (src/inGamut.js): rounding noise, not a real excursion. */
export const DEFAULT_GAMUT_EPSILON = 0.000075;

export function inSrgbGamut(lab: Oklab, options: { readonly epsilon?: number } = {}): boolean {
  const epsilon = options.epsilon ?? DEFAULT_GAMUT_EPSILON;
  if (!(epsilon >= 0 && Number.isFinite(epsilon))) {
    throw new RangeError(`gamut tolerance must be a finite number >= 0, got ${epsilon}`);
  }
  return oklabToSrgb(lab).every((channel) => channel >= -epsilon && channel <= 1 + epsilon);
}
