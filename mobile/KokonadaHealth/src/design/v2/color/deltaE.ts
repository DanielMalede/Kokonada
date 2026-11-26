// Colour differences: ΔE_OK (CSS Color 4 §20.3) and the circular hue distance behind QA-064.

import type { Oklab } from './oklab.ts';

/** Euclidean distance in OKLab. */
export function deltaEOK(first: Oklab, second: Oklab): number {
  const dL = first.L - second.L;
  const da = first.a - second.a;
  const db = first.b - second.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** The shorter way round the hue circle, in degrees: 0..180. NaN when either hue is NaN. */
export function hueDistance(first: number, second: number): number {
  const d = (((first - second) % 360) + 360) % 360;
  return Math.min(d, 360 - d);
}

export interface HueSeparationViolation {
  readonly first: string;
  readonly second: string;
  /** NaN when one of the two has no hue: an achromatic colour cannot be told apart by hue. */
  readonly distance: number;
}

/**
 * Every pair of named hues closer than `minimumDeg`. The bound is inclusive: a pair exactly
 * `minimumDeg` apart passes. A NaN hue fails against everything, because `NaN >= x` is false.
 */
export function hueSeparationViolations(
  hues: Readonly<Record<string, number>>,
  minimumDeg: number,
): HueSeparationViolation[] {
  if (!(minimumDeg >= 0 && minimumDeg <= 180)) {
    throw new RangeError(`minimum hue separation must be in [0, 180] degrees, got ${minimumDeg}`);
  }
  const names = Object.keys(hues);
  const violations: HueSeparationViolation[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const distance = hueDistance(hues[names[i]], hues[names[j]]);
      if (!(distance >= minimumDeg)) {
        violations.push({ first: names[i], second: names[j], distance });
      }
    }
  }
  return violations;
}
