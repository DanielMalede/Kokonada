// The never-red check (QA-063, QA-065), with the band as a parameter: the owner rules its numbers
// in DEC-081, so nothing here hard-codes them.
//
// A colour is red when its OKLCh hue lies in the band (circular, both ends inclusive) AND its
// chroma is at or above the band's floor. "At or above" is QA-065's pass rule ("chroma < floor"
// passes); it is the stricter reading of a boundary the sources word differently.
//
// Lightness never decides redness, so the geometry below works in OKLab's a-b plane. There the red
// region is a sector of the hue circle with the disc of radius `chromaFloor` cut out of it: one
// connected region bounded by two rays and an arc. That shape is what makes the segment and
// triangle tests exact instead of sampled.

import { oklabToSrgb, srgbToOklab, type Oklab, type Srgb } from './oklab.ts';

export interface RedBand {
  /** Degrees in [0, 360); the band runs counter-clockwise from here… */
  readonly hueFrom: number;
  /** …to here, wrapping through 0° when hueTo < hueFrom. */
  readonly hueTo: number;
  /** OKLCh chroma at or above which a hue in the band counts as red. */
  readonly chromaFloor: number;
}

/** Below this chroma the hue is powerless (CSS Color 4), so no colour there is red. */
const ACHROMATIC_CHROMA = 0.000004;
const RAD = Math.PI / 180;
// Bound once: global lookups are ten times slower in jest's sandbox (see oklab.ts).
const { abs, atan2, cos, floor, hypot, max, min, round, sin } = Math;
const numberIsFinite = Number.isFinite;
/** A channel this close to a half step can round either way; noise from the round trip is ~1e-10. */
const ROUNDING_TIE = 1e-7;
/** The dither sweep is cut into this many steps before any step is refined. */
const DITHER_STEPS = 8;

type Point = readonly [number, number];

const normalise = (deg: number) => ((deg % 360) + 360) % 360;
const width = (band: RedBand) => normalise(band.hueTo - band.hueFrom);

export function assertRedBand(band: RedBand): void {
  for (const hue of [band.hueFrom, band.hueTo]) {
    if (!(hue >= 0 && hue < 360)) {
      throw new RangeError(`band hues must be in [0, 360), got ${band.hueFrom} to ${band.hueTo}`);
    }
  }
  if (band.hueFrom === band.hueTo) {
    throw new RangeError('a band that starts where it ends is either empty or the whole circle');
  }
  if (!(band.chromaFloor >= 0 && numberIsFinite(band.chromaFloor))) {
    throw new RangeError(`chroma floor must be a finite number >= 0, got ${band.chromaFloor}`);
  }
}

function assertFiniteColour(lab: Oklab): void {
  if (!(numberIsFinite(lab.L) && numberIsFinite(lab.a) && numberIsFinite(lab.b))) {
    throw new RangeError(`colour must be finite, got L ${lab.L}, a ${lab.a}, b ${lab.b}`);
  }
}

/** Inclusive at both ends. A hue that is not a finite number (an achromatic colour) is outside. */
export function hueInBand(hueDeg: number, band: RedBand): boolean {
  if (!numberIsFinite(hueDeg)) {
    return false;
  }
  return normalise(hueDeg - band.hueFrom) <= width(band);
}

function isRedPoint(x: Point, band: RedBand): boolean {
  const chroma = hypot(x[0], x[1]);
  if (chroma <= ACHROMATIC_CHROMA || chroma < band.chromaFloor) {
    return false;
  }
  return hueInBand(atan2(x[1], x[0]) / RAD, band);
}

/** Throws on a colour that is not a number: a broken value must never read as safe. */
export function isRed(lab: Oklab, band: RedBand): boolean {
  assertRedBand(band);
  assertFiniteColour(lab);
  return isRedPoint([lab.a, lab.b], band);
}

const cross = (u: Point, v: Point) => u[0] * v[1] - u[1] * v[0];
const dot = (u: Point, v: Point) => u[0] * v[0] + u[1] * v[1];

/** Does the segment p→q cross the band's edge ray at `hueDeg`, at or beyond the floor? */
function crossesEdgeRay(p: Point, d: Point, hueDeg: number, band: RedBand): boolean {
  const u: Point = [cos(hueDeg * RAD), sin(hueDeg * RAD)];
  const denominator = cross(d, u);
  if (denominator === 0) {
    // Parallel. If it lies on the ray, an endpoint is on it too, and the endpoint test saw it.
    return false;
  }
  const t = -cross(p, u) / denominator;
  if (t < 0 || t > 1) {
    return false;
  }
  const along = dot([p[0] + t * d[0], p[1] + t * d[1]], u);
  return along >= band.chromaFloor && along > ACHROMATIC_CHROMA;
}

function segmentTouchesRegion(p: Point, q: Point, band: RedBand): boolean {
  if (isRedPoint(p, band) || isRedPoint(q, band)) {
    return true;
  }
  // Both ends are outside, so the segment can only meet the region by crossing its boundary:
  // two edge rays and the floor's arc. It cannot go in and out through the arc alone, because a
  // straight line meets a disc in one interval (outside, inside, outside), so going out through
  // the arc and back in through it again is impossible. Every crossing therefore cuts an edge ray.
  const d: Point = [q[0] - p[0], q[1] - p[1]];
  return crossesEdgeRay(p, d, band.hueFrom, band) || crossesEdgeRay(p, d, band.hueTo, band);
}

/** Exact: is any colour on the straight OKLab line from `from` to `to` red? */
export function segmentTouchesRed(from: Oklab, to: Oklab, band: RedBand): boolean {
  assertRedBand(band);
  assertFiniteColour(from);
  assertFiniteColour(to);
  return segmentTouchesRegion([from.a, from.b], [to.a, to.b], band);
}

/**
 * Exact: is any colour in the OKLab triangle red? The red region is connected and unbounded, so
 * if it reaches inside a bounded triangle it must cross one of the triangle's sides.
 */
export function triangleTouchesRed(p: Oklab, q: Oklab, r: Oklab, band: RedBand): boolean {
  assertRedBand(band);
  for (const corner of [p, q, r]) {
    assertFiniteColour(corner);
  }
  const P: Point = [p.a, p.b];
  const Q: Point = [q.a, q.b];
  const R: Point = [r.a, r.b];
  return segmentTouchesRegion(P, Q, band) || segmentTouchesRegion(Q, R, band) || segmentTouchesRegion(R, P, band);
}

/**
 * Every 8-bit sRGB pixel the device can show for `lab` when a static dither δ in
 * [−amplitudeL, +amplitudeL] is added to OKLab L, the result is clamped to the gamut, and each
 * channel is rounded to the nearest of 256 steps (a tie may go either way).
 *
 * The sweep over δ is cut into steps; wherever two neighbouring steps differ by more than one
 * channel step, the interval is halved until they do not, so a pixel that exists only between
 * two channels' rounding points is still found.
 */
export function ditherReachable(lab: Oklab, amplitudeL: number): Srgb[] {
  if (!(amplitudeL >= 0 && numberIsFinite(amplitudeL))) {
    throw new RangeError(`dither amplitude must be a finite number >= 0, got ${amplitudeL}`);
  }
  assertFiniteColour(lab);

  // This runs inside sweeps of tens of thousands of samples, so it reuses its buffers and keys
  // each pixel by a number rather than a string.
  const found = new Map<number, Srgb>();
  const scaled = (delta: number): number[] => {
    const rgb = oklabToSrgb({ L: lab.L + delta, a: lab.a, b: lab.b });
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      out[c] = 255 * min(1, max(0, rgb[c]));
    }
    return out;
  };
  const low = [0, 0, 0];
  const high = [0, 0, 0];
  const record = (channels: readonly number[]) => {
    for (let c = 0; c < 3; c++) {
      const below = floor(channels[c]);
      const tie = abs(channels[c] - below - 0.5) <= ROUNDING_TIE;
      low[c] = tie ? below : round(channels[c]);
      high[c] = tie ? below + 1 : low[c];
    }
    for (let r = low[0]; r <= high[0]; r++) {
      for (let g = low[1]; g <= high[1]; g++) {
        for (let b = low[2]; b <= high[2]; b++) {
          const key = r * 65536 + g * 256 + b;
          if (!found.has(key)) {
            found.set(key, [r / 255, g / 255, b / 255]);
          }
        }
      }
    }
  };
  const refine = (d0: number, u0: readonly number[], d1: number, u1: readonly number[]): void => {
    let channelSteps = 0;
    for (let c = 0; c < 3; c++) {
      channelSteps += abs(round(u1[c]) - round(u0[c]));
    }
    if (channelSteps <= 1 || d1 - d0 <= 1e-12) {
      return;
    }
    const dm = (d0 + d1) / 2;
    const um = scaled(dm);
    record(um);
    refine(d0, u0, dm, um);
    refine(dm, um, d1, u1);
  };

  let d0 = -amplitudeL;
  let u0 = scaled(d0);
  record(u0);
  if (amplitudeL > 0) {
    for (let i = 1; i <= DITHER_STEPS; i++) {
      const d1 = -amplitudeL + (2 * amplitudeL * i) / DITHER_STEPS;
      const u1 = scaled(d1);
      record(u1);
      refine(d0, u0, d1, u1);
      d0 = d1;
      u0 = u1;
    }
  }
  return Array.from(found.values());
}

/** A red pixel among those `ditherReachable` lists, or null when none of them is red. */
export function reachableRedPixel(lab: Oklab, band: RedBand, amplitudeL: number): Srgb | null {
  assertRedBand(band);
  const pixels = ditherReachable(lab, amplitudeL);
  for (let i = 0; i < pixels.length; i++) {
    const shown = srgbToOklab(pixels[i]);
    if (isRedPoint([shown.a, shown.b], band)) {
      return pixels[i];
    }
  }
  return null;
}
