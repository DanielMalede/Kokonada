// Anti-aliased pairs for the never-red sweep (QA-065, DSN-013, DSN-019).
//
// Wherever two colours meet at an edge (a glyph, a rim stroke, a setting ring, a shadow tail, a
// gradient), Skia blends them in gamma-encoded sRGB: (1 − a)·bg + a·ink for coverage a. That path
// is not OKLab's straight line, so it is swept here directly, in the two forms the bands need:
//   • float, against the design band: the exact largest in-band chroma for a in [0, maxCoverage].
//     The band's edges are solved by bisection and in-band peaks are refined, so the answer does
//     not depend on a coverage step (a step of 1/255 can hide 0.0004 of chroma, most of the margin).
//   • 8-bit, against the check band: for each coverage a/255, every pixel in {floor, ceil}³ of the
//     unrounded blend, because GPU blend rounding can go either way on each channel.
//
// Sweep-only: Math is bound once and conversions go through sweepConvert. Never a worklet.

import type { Srgb } from './oklab.ts';
import { assertRedBand, hueInBand, type RedBand } from './redBand.ts';
import { sweepSrgbToOklab } from './sweepConvert.ts';

export interface BlendMax {
  /** The largest in-band chroma; 0 when the blend never enters the band. */
  readonly chroma: number;
  /** Its hue in degrees; NaN when the blend never enters the band. */
  readonly hue: number;
  /** The coverage where it peaks, 0..1; NaN when the blend never enters the band. */
  readonly coverage: number;
}

export type Bytes = readonly [number, number, number];

const { atan2, ceil, floor, hypot } = Math;
const RAD = Math.PI / 180;
const ACHROMATIC_CHROMA = 0.000004;
/** The blend is cut into this many steps before its band crossings and peaks are solved. */
const STEPS = 64;
const GOLDEN = (Math.sqrt(5) - 1) / 2;

interface Sample {
  readonly chroma: number;
  readonly hue: number;
  readonly inBand: boolean;
}

function assertChannels(rgb: readonly number[], what: string): void {
  if (!(rgb.length === 3 && rgb.every((c) => Number.isFinite(c)))) {
    throw new RangeError(`${what} must be three finite channels, got [${rgb.join(', ')}]`);
  }
}

export function maxInBandOnSrgbBlend(bg: Srgb, ink: Srgb, band: RedBand, maxCoverage = 1): BlendMax {
  assertRedBand(band);
  assertChannels(bg, 'the background');
  assertChannels(ink, 'the ink');
  if (!(maxCoverage > 0 && maxCoverage <= 1)) {
    throw new RangeError(`max coverage must be in (0, 1], got ${maxCoverage}`);
  }
  const sample = (a: number): Sample => {
    const lab = sweepSrgbToOklab([bg[0] + a * (ink[0] - bg[0]), bg[1] + a * (ink[1] - bg[1]), bg[2] + a * (ink[2] - bg[2])]);
    const chroma = hypot(lab.a, lab.b);
    const hue = (((atan2(lab.b, lab.a) / RAD) % 360) + 360) % 360;
    return { chroma, hue, inBand: chroma > ACHROMATIC_CHROMA && hueInBand(hue, band) };
  };
  let best: BlendMax = { chroma: 0, hue: NaN, coverage: NaN };
  const consider = (a: number, s: Sample) => {
    if (s.inBand && s.chroma > best.chroma) {
      best = { chroma: s.chroma, hue: s.hue, coverage: a };
    }
  };

  const as: number[] = [];
  const samples: Sample[] = [];
  for (let i = 0; i <= STEPS; i++) {
    as.push((maxCoverage * i) / STEPS);
    samples.push(sample(as[i]));
    consider(as[i], samples[i]);
  }
  for (let i = 0; i < STEPS; i++) {
    // A band edge between two steps: bisect to it and take the in-band side.
    if (samples[i].inBand !== samples[i + 1].inBand) {
      let lo = as[i];
      let hi = as[i + 1];
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (sample(mid).inBand === samples[i].inBand) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      const edge = samples[i].inBand ? lo : hi;
      consider(edge, sample(edge));
    }
    // An in-band peak between its neighbours: refine it by golden-section search.
    if (i > 0 && samples[i].inBand && samples[i].chroma >= samples[i - 1].chroma && samples[i].chroma >= samples[i + 1].chroma) {
      let lo = as[i - 1];
      let hi = as[i + 1];
      const value = (a: number) => {
        const s = sample(a);
        return s.inBand ? s.chroma : -Infinity;
      };
      for (let k = 0; k < 60; k++) {
        const left = hi - GOLDEN * (hi - lo);
        const right = lo + GOLDEN * (hi - lo);
        if (value(left) < value(right)) {
          lo = left;
        } else {
          hi = right;
        }
      }
      const peak = (lo + hi) / 2;
      consider(peak, sample(peak));
    }
  }
  return best;
}

/** Every pixel in {floor, ceil}³ of ((255 − a)·bg + a·ink) / 255, as 8-bit channel triples. */
export function blendCandidates(bg: Bytes, ink: Bytes, a: number): Array<[number, number, number]> {
  const options = [0, 1, 2].map((c) => {
    const v = ((255 - a) * bg[c] + a * ink[c]) / 255;
    return floor(v) === ceil(v) ? [floor(v)] : [floor(v), ceil(v)];
  });
  const out: Array<[number, number, number]> = [];
  for (const r of options[0]) {
    for (const g of options[1]) {
      for (const b of options[2]) {
        out.push([r, g, b]);
      }
    }
  }
  return out;
}

/** Per band, each 8-bit pixel's in-band chroma, or −1 when it is not in the band. */
const PIXEL_CACHE = new Map<string, Map<number, number>>();

function inBandChromaOf(pixel: number, band: RedBand, cache: Map<number, number>): number {
  let chroma = cache.get(pixel);
  if (chroma === undefined) {
    const lab = sweepSrgbToOklab([floor(pixel / 65536) / 255, (floor(pixel / 256) % 256) / 255, (pixel % 256) / 255]);
    const C = hypot(lab.a, lab.b);
    chroma = C > ACHROMATIC_CHROMA && hueInBand(atan2(lab.b, lab.a) / RAD, band) ? C : -1;
    cache.set(pixel, chroma);
  }
  return chroma;
}

export function maxInBandOnPixelBlend(
  bg: Bytes,
  ink: Bytes,
  band: RedBand,
  maxCoverage255 = 254,
): BlendMax & { readonly pixel: Bytes } {
  assertRedBand(band);
  for (const [rgb, what] of [[bg, 'the background'], [ink, 'the ink']] as const) {
    if (!(rgb.length === 3 && rgb.every((c) => Number.isInteger(c) && c >= 0 && c <= 255))) {
      throw new RangeError(`${what} must be three 8-bit channels, got [${rgb.join(', ')}]`);
    }
  }
  if (!(Number.isInteger(maxCoverage255) && maxCoverage255 >= 1 && maxCoverage255 <= 254)) {
    throw new RangeError(`max coverage must be a whole number in 1..254, got ${maxCoverage255}`);
  }
  const key = `${band.hueFrom}/${band.hueTo}`;
  let cache = PIXEL_CACHE.get(key);
  if (!cache) {
    cache = new Map();
    PIXEL_CACHE.set(key, cache);
  }
  let bestChroma = 0;
  let bestPixel: Bytes = bg;
  let bestCoverage = NaN;
  for (let a = 1; a <= maxCoverage255; a++) {
    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const v = ((255 - a) * bg[c] + a * ink[c]) / 255;
      lo[c] = floor(v);
      hi[c] = ceil(v);
    }
    for (let r = lo[0]; r <= hi[0]; r++) {
      for (let g = lo[1]; g <= hi[1]; g++) {
        for (let b = lo[2]; b <= hi[2]; b++) {
          const chroma = inBandChromaOf(r * 65536 + g * 256 + b, band, cache);
          if (chroma > bestChroma) {
            bestChroma = chroma;
            bestPixel = [r, g, b];
            bestCoverage = a / 255;
          }
        }
      }
    }
  }
  if (bestChroma === 0) {
    return { chroma: 0, hue: NaN, coverage: NaN, pixel: bestPixel };
  }
  const lab = sweepSrgbToOklab([bestPixel[0] / 255, bestPixel[1] / 255, bestPixel[2] / 255]);
  return { chroma: bestChroma, hue: (((atan2(lab.b, lab.a) / RAD) % 360) + 360) % 360, coverage: bestCoverage, pixel: bestPixel };
}
