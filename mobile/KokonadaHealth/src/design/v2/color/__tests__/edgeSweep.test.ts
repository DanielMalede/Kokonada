import { pivotComposite } from '../blendSpace.ts';
import { blendCandidates, maxInBandOnPixelBlend, maxInBandOnSrgbBlend } from '../edgeSweep.ts';
import { oklabToSrgb, oklchToOklab, srgbToOklab, type Srgb } from '../oklab.ts';
import { hueInBand, type RedBand } from '../redBand.ts';

// Anti-aliased edges, rim strokes, setting rings, shadow tails and gradients are blends in
// gamma-encoded sRGB between two colours: Skia's path, not OKLab's. DSN-013's margin is real only
// if the in-band maximum along such a blend is exact: solved at the band's edges, not stepped.
// FIXTURES: DEC-081's bands, as base.neverRed holds them.
const DESIGN_BAND: RedBand = { hueFrom: 345, hueTo: 55, chromaFloor: 0.015 };
const CHECK_BAND: RedBand = { hueFrom: 350, hueTo: 50, chromaFloor: 0.02 };

const srgbOf = (L: number, C: number, h: number): Srgb => oklabToSrgb(oklchToOklab({ L, C, h }));
const bytes = (rgb: Srgb) => rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)) as unknown as readonly [number, number, number];

/** Oracle: 100 001 coverages, which knows nothing about crossings or refinement. */
function bruteForce(bg: Srgb, ink: Srgb, band: RedBand): number {
  let best = 0;
  for (let i = 0; i <= 100000; i++) {
    const a = i / 100000;
    const lab = srgbToOklab([bg[0] + a * (ink[0] - bg[0]), bg[1] + a * (ink[1] - bg[1]), bg[2] + a * (ink[2] - bg[2])]);
    const C = Math.hypot(lab.a, lab.b);
    if (C > 0 && hueInBand((Math.atan2(lab.b, lab.a) * 180) / Math.PI, band)) best = Math.max(best, C);
  }
  return best;
}

describe('maxInBandOnSrgbBlend: the exact in-band maximum along a blend', () => {
  // A warm ink against an orchid-lit surface: the blend enters the band at 55°.
  const INK = srgbOf(0.4, 0.03, 62);
  const ORCHID_LIT = srgbOf(0.8, 0.06, 330);

  it('is at least the oracle’s maximum, and no more than its sampling error above it', () => {
    const exact = maxInBandOnSrgbBlend(ORCHID_LIT, INK, DESIGN_BAND);
    const grid = bruteForce(ORCHID_LIT, INK, DESIGN_BAND);
    expect(exact.chroma).toBeGreaterThanOrEqual(grid - 1e-12);
    expect(exact.chroma - grid).toBeLessThan(1e-6);
  });

  it('finds the peak at the band edge, and says where', () => {
    const exact = maxInBandOnSrgbBlend(ORCHID_LIT, INK, DESIGN_BAND);
    expect([345, 55].some((edge) => Math.abs(exact.hue - edge) < 1e-6)).toBe(true);
    expect(exact.coverage).toBeGreaterThan(0);
    expect(exact.coverage).toBeLessThan(1);
  });

  it('stops at maxCoverage, for a shadow that only reaches its alpha', () => {
    // Both ends in the band, chroma rising toward the ink: the peak sits at the cap.
    const bg = srgbOf(0.6, 0.03, 40);
    const ink = srgbOf(0.6, 0.05, 20);
    const full = maxInBandOnSrgbBlend(bg, ink, DESIGN_BAND);
    const capped = maxInBandOnSrgbBlend(bg, ink, DESIGN_BAND, 0.5);
    expect(full.coverage).toBe(1);
    expect(capped.coverage).toBe(0.5);
    expect(capped.chroma).toBeLessThan(full.chroma);
  });

  it('is 0 for a blend that never enters the band', () => {
    expect(maxInBandOnSrgbBlend(srgbOf(0.5, 0.1, 200), srgbOf(0.9, 0.05, 160), DESIGN_BAND)).toEqual({ chroma: 0, hue: NaN, coverage: NaN });
  });
});

describe('maxInBandOnPixelBlend: every 8-bit pixel a GPU can round the blend to', () => {
  it('lists {floor, ceil}³ of the unrounded blend', () => {
    // From black to (3, 0, 0) at coverage 128 / 255 the red channel is 1.506: 1 or 2.
    expect(blendCandidates([0, 0, 0], [3, 0, 0], 128)).toEqual([
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  // From black to (2, 0, 0), up to coverage 191 / 255 the red channel peaks at 1.498: rounding to
  // nearest never passes 1, but rounding up reaches (2, 0, 0), C 0.022, which is red.
  it('finds a pixel only the other rounding reaches', () => {
    const nearest = Math.max(...Array.from({ length: 191 }, (_, i) => Math.round((2 * (i + 1)) / 255)));
    expect(nearest).toBe(1);
    const found = maxInBandOnPixelBlend([0, 0, 0], [2, 0, 0], CHECK_BAND, 191);
    expect(found.pixel).toEqual([2, 0, 0]);
    expect(found.chroma).toBeGreaterThanOrEqual(CHECK_BAND.chromaFloor);
  });

  it('a black–white blend shows only greys', () => {
    expect(maxInBandOnPixelBlend([0, 0, 0], [255, 255, 255], CHECK_BAND).chroma).toBe(0);
  });

  it('stops at maxCoverage255: up to 42 / 255 the red channel stays under 1, so (1, 0, 0) is the most', () => {
    const found = maxInBandOnPixelBlend([0, 0, 0], [3, 0, 0], CHECK_BAND, 42);
    expect(found.pixel).toEqual([1, 0, 0]);
    expect(found.chroma).toBeLessThan(CHECK_BAND.chromaFloor);
  });

  // It starts at the first partial coverage. From (200, 40, 40) toward (0, 255, 255) every channel
  // moves more than half a level per 1/255, so only at a = 1 can the GPU still round to the
  // background's own channels; from 2/255 on, every pixel the blend can round to is less red. The
  // oracle below enumerates {floor, ceil}³ itself, with oklab.ts, to prove that of the fixture.
  it('starts at 1 / 255: a blend whose reddest pixel only the first coverage reaches', () => {
    const bg = [200, 40, 40] as const;
    const ink = [0, 255, 255] as const;
    const inBandChroma = (p: readonly number[]) => {
      const lab = srgbToOklab([p[0] / 255, p[1] / 255, p[2] / 255]);
      const hue = (((Math.atan2(lab.b, lab.a) * 180) / Math.PI) % 360 + 360) % 360;
      return hueInBand(hue, CHECK_BAND) ? Math.hypot(lab.a, lab.b) : 0;
    };
    const reddestAt = (a: number) => {
      const levels = [0, 1, 2].map((c) => {
        const v = ((255 - a) * bg[c] + a * ink[c]) / 255;
        return [...new Set([Math.floor(v), Math.ceil(v)])];
      });
      let best = 0;
      for (const r of levels[0]) for (const g of levels[1]) for (const b of levels[2]) best = Math.max(best, inBandChroma([r, g, b]));
      return best;
    };
    const first = reddestAt(1);
    const later = Math.max(...Array.from({ length: 253 }, (_, i) => reddestAt(i + 2)));
    expect(later).toBeLessThan(first);

    const found = maxInBandOnPixelBlend(bg, ink, CHECK_BAND);
    expect(found.coverage).toBe(1 / 255);
    expect(found.chroma).toBeCloseTo(first, 12);
  });
});

// Resilience HIGH-1's bite: a retired direction's old light ink, oklch(0.24 0.018 60), as the rim words' edge
// over the ring lit by an orchid halo (deep tier, chroma scale 0.85, k at the light halo peak 0.25,
// pivot 0.20). The design band flags it; the edge-ink remedy, C 0.004 at 80°, clears it.
describe('the bite on real values', () => {
  const ring = oklchToOklab({ L: 0.975, C: 0.008, h: 80 });
  const halo = oklchToOklab({ L: 0.48, C: 0.1 * 0.85, h: 322 });
  const lit = oklabToSrgb(pivotComposite(halo, ring, 0.25, 0.2));

  it('the old light ink over an orchid ring halo is flagged by the design band', () => {
    expect(maxInBandOnSrgbBlend(lit, srgbOf(0.24, 0.018, 60), DESIGN_BAND).chroma).toBeGreaterThanOrEqual(DESIGN_BAND.chromaFloor);
  });

  it('the edge-ink remedy clears it with the margin to spare', () => {
    expect(maxInBandOnSrgbBlend(lit, srgbOf(0.24, 0.004, 80), DESIGN_BAND).chroma).toBeLessThanOrEqual(DESIGN_BAND.chromaFloor - 0.0005);
    expect(maxInBandOnPixelBlend(bytes(lit), bytes(srgbOf(0.24, 0.004, 80)), CHECK_BAND).chroma).toBeLessThanOrEqual(
      CHECK_BAND.chromaFloor - 0.0005,
    );
  });
});
