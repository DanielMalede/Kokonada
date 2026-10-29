import { oklabToSrgb, type Oklab } from '../../color/oklab.ts';
import { BASE, DIRECTIONS, type Face } from '../../tokens/tokens.generated.ts';
import { blueNoiseValue } from '../blueNoise.ts';
import {
  NODE,
  NODE_SLOTS,
  edgeMix,
  faceGroundAt,
  fieldOklab,
  inertNode,
  inertShadow,
  pixelTerms,
  ringEdgeCoverage,
  smoothstep,
  type FieldFrame,
  type FieldNodeFrame,
  type PlateShadow,
} from '../fieldLaw.ts';

// Law round 2, item 4 (designer §4, UI-114): the ring's inner edge, anti-aliased over one field-canvas
// pixel. α = clamp((d − ringInner)·radiusPx + ½, 0, 1), radiusPx the canvas's own (uGeom.z), so the
// ramp is one render pixel wide, centred on ringInner. The inputs are blended in OKLab, never the
// outputs: ground = mix(the face ground at d_f, the ring ground, α), d_f = min(d, ringInner), so ρ ≤ 1
// and P ≤ P_max hold inside the band; extent = mix(mask.face, mask.ring, α)·quiet, which is
// (1 − α)·mask.face·quiet since mask.ring is 0; grain = mix(inside, ground, α); the halos are unchanged.
// Every oracle here is written by hand from that text, and every criterion has a planted control that
// must fail it: the binary region it replaces, the wrong widths, an output blend, d in place of d_f.

const lab = (c: { oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const FACES: Face[] = ['dark', 'light'];
const abyss = DIRECTIONS.abyss;
const rDp = BASE.plate.maxDiameter / 2;

/** Abyss's tokens on a plate of R px, its centre off the pixel grid; no warp, shimmer, grain or dither unless asked. */
function frame(face: Face, overrides: Partial<FieldFrame> = {}): FieldFrame {
  const c = abyss.color[face];
  const R = overrides.radiusPx ?? 40;
  return {
    centrePx: [50.3, 49.6],
    radiusPx: R,
    ringInner: 1 - BASE.plate.labelBand.min / rDp,
    moatOuter: 1 + abyss.field.mask.moat / rDp,
    moatFeather: abyss.field.mask.moatFeather / rDp,
    beadRadius: abyss.bead.diameter / 2 / rDp,
    haloRadius: BASE.field.halo.diameter / 2 / rDp,
    mask: abyss.field.mask,
    grounds: { outside: lab(c.ground), face: lab(c.plate.face), ring: lab(c.plate.ring) },
    vignette: abyss.plate.face.vignette[face],
    centreLift: abyss.plate.face.centreLift[face],
    kField: abyss.field.K[face] * abyss.field.presence.none,
    kMax: Math.max(abyss.field.cap[face], face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight),
    haloPeak: face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight,
    kp: abyss.field.pivot,
    warp: { amount: 0, orbit: 0, cos: 1, sin: 0, octaves: 3 },
    shimmer: { cos: 1, sin: 0 },
    lambda: BASE.field.graph.lambda,
    lobeCore: BASE.field.lobe.core,
    tripleFade: BASE.field.graph.tripleFade,
    restIntenseWaypoint: false,
    grain: { inside: 0, ground: 0 },
    dither: 0,
    quiet: { rects: [], grow: 0, feather: 0 },
    shadows: [inertShadow(), inertShadow()],
    nodes: Array.from({ length: NODE_SLOTS }, inertNode),
    ...overrides,
  };
}

/** A rest lobe at the plate centre wide enough to light the whole edge (no bead, so no halo). */
const restLobe = (face: Face, fade = 1): FieldNodeFrame => {
  const R0 = lab(abyss.color[face].field.restGlow);
  return { id: NODE.R0, fade, centre: [0, 0], radius: 1.2, field: R0, halo: R0, bead: null };
};
const withNodes = (nodes: FieldNodeFrame[]) => [...nodes, ...Array.from({ length: NODE_SLOTS - nodes.length }, inertNode)];

// ------------------------------------------------------------------ the oracles, by hand

/** α by hand: clamp((d − ringInner)·radiusPx + ½, 0, 1). */
const alphaOf = (f: FieldFrame, d: number) => Math.min(1, Math.max(0, (d - f.ringInner) * f.radiusPx + 0.5));
const at = (f: FieldFrame, x: number, y: number) => {
  const qx = (x - f.centrePx[0]) / f.radiusPx;
  const qy = -(y - f.centrePx[1]) / f.radiusPx;
  // The law's own expression for d, so an exact comparison compares like with like.
  return { qx, qy, d: Math.sqrt(qx * qx + qy * qy) };
};
/** The face's ground at a distance, vignette and centre lift on L only, ρ = d / ringInner (no shadow). */
const faceGround = (f: FieldFrame, d: number): Oklab => {
  const rho2 = (d / f.ringInner) ** 2;
  const g = f.grounds.face;
  return { L: g.L * (1 + f.vignette * rho2) + f.centreLift * (1 - rho2), a: g.a, b: g.b };
};
const mixLab = (x: Oklab, y: Oklab, t: number): Oklab => ({ L: (1 - t) * x.L + t * y.L, a: (1 - t) * x.a + t * y.a, b: (1 - t) * x.b + t * y.b });
const distance = (x: Oklab, y: Oklab) => Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);

type PixelFn = (f: FieldFrame, x: number, y: number) => Oklab;

/** Samples along a ray at angle θ, from d0 to d1, every `step` canvas px: pixel centres need not sit on the grid. */
function ray(f: FieldFrame, theta: number, d0: number, d1: number, step: number): Array<{ d: number; x: number; y: number }> {
  const out: Array<{ d: number; x: number; y: number }> = [];
  for (let d = d0; d <= d1 + 1e-12; d += step / f.radiusPx) {
    out.push({ d, x: f.centrePx[0] + d * f.radiusPx * Math.cos(theta), y: f.centrePx[1] - d * f.radiusPx * Math.sin(theta) });
  }
  return out;
}
const ANGLES = [0.3, 1.9, 3.7, 5.2];

/**
 * The ramp, measured on the ground alone: along each ray, the samples whose colour is neither the face's
 * ground at that distance nor the ring's. Their span in canvas px and its centre's offset from ringInner.
 */
function rampOf(f: FieldFrame, pixel: PixelFn, theta: number): { width: number; offset: number; between: number } {
  const step = 1 / 256;
  const samples = ray(f, theta, f.ringInner - 2 / f.radiusPx, f.ringInner + 2 / f.radiusPx, step);
  const inside = samples.filter((s) => {
    const p = pixel(f, s.x, s.y);
    return distance(p, faceGround(f, s.d)) > 1e-12 && distance(p, f.grounds.ring) > 1e-12;
  });
  if (inside.length === 0) return { width: 0, offset: NaN, between: 0 };
  const first = inside[0].d;
  const last = inside[inside.length - 1].d;
  return { width: (last - first) * f.radiusPx + step, offset: ((first + last) / 2 - f.ringInner) * f.radiusPx, between: inside.length };
}

/** The largest change between neighbouring samples 1/16 canvas px apart across the edge, over |ring − face edge|. */
function largestStep(f: FieldFrame, pixel: PixelFn, theta: number): number {
  const samples = ray(f, theta, f.ringInner - 2 / f.radiusPx, f.ringInner + 2 / f.radiusPx, 1 / 16);
  let worst = 0;
  for (let i = 1; i < samples.length; i++) {
    worst = Math.max(worst, distance(pixel(f, samples[i].x, samples[i].y), pixel(f, samples[i - 1].x, samples[i - 1].y)));
  }
  return worst / distance(faceGround(f, f.ringInner), f.grounds.ring);
}

// The planted controls: the hard edge the law had before (UI-114), and the ramp at the wrong widths.
const regionPixel = (alpha: (f: FieldFrame, d: number) => number): PixelFn => (f, x, y) => {
  const { d } = at(f, x, y);
  const a = alpha(f, d);
  return mixLab(faceGround(f, Math.min(d, f.ringInner)), f.grounds.ring, a);
};
const HARD_EDGE: PixelFn = regionPixel((f, d) => (d < f.ringInner ? 0 : 1));
const HALF_WIDTH: PixelFn = regionPixel((f, d) => Math.min(1, Math.max(0, (d - f.ringInner) * f.radiusPx * 2 + 0.5)));
const DOUBLE_WIDTH: PixelFn = regionPixel((f, d) => Math.min(1, Math.max(0, ((d - f.ringInner) * f.radiusPx) / 2 + 0.5)));
const LAW: PixelFn = (f, x, y) => fieldOklab(f, x, y);

describe('UI-114: the ring’s inner edge, continuous at one canvas pixel', () => {
  describe.each(FACES)('abyss %s face, the ground alone', (face) => {
    it.each([40, 147, 223])('at R %s px: the ramp spans exactly one canvas pixel, centred on ringInner, along every ray', (R) => {
      const f = frame(face, { radiusPx: R });
      for (const theta of ANGLES) {
        const ramp = rampOf(f, LAW, theta);
        expect(ramp.width).toBeCloseTo(1, 2);
        expect(Math.abs(ramp.offset)).toBeLessThan(1 / 256);
        expect(ramp.between).toBeGreaterThan(200);
      }
    });

    it('at 1/16 canvas px, no step is more than 1/10 of the face-to-ring difference', () => {
      const f = frame(face);
      for (const theta of ANGLES) expect(largestStep(f, LAW, theta)).toBeLessThan(0.1);
    });

    it('away from the band the pixel is the face’s ground, or the ring’s, exactly', () => {
      const f = frame(face);
      for (const theta of ANGLES) {
        for (const s of ray(f, theta, 0, 1, 1 / 4)) {
          const { d } = at(f, s.x, s.y);
          const a = alphaOf(f, d);
          if (a === 0) expect(LAW(f, s.x, s.y)).toEqual(faceGround(f, d));
          if (a === 1) expect(LAW(f, s.x, s.y)).toEqual(f.grounds.ring);
        }
      }
    });

    it('bites: the hard edge has no ramp and steps the whole difference; half and double widths miss one pixel', () => {
      const f = frame(face);
      expect(rampOf(f, HARD_EDGE, ANGLES[0]).width).toBe(0);
      expect(largestStep(f, HARD_EDGE, ANGLES[0])).toBeGreaterThan(0.99);
      expect(rampOf(f, HALF_WIDTH, ANGLES[0]).width).toBeCloseTo(0.5, 2);
      expect(largestStep(f, HALF_WIDTH, ANGLES[0])).toBeGreaterThan(0.1);
      expect(rampOf(f, DOUBLE_WIDTH, ANGLES[0]).width).toBeCloseTo(2, 2);
    });
  });
});

// ------------------------------------------------------------------ inputs in OKLab, not outputs

/**
 * Route R4 (kp 0) by hand over one ground, extent and grain amplitude, where one rest lobe covers the
 * edge (no halo, so H = 0, and the selected colour is the lobe's own wherever the extent lets it in).
 */
const composite = (f: FieldFrame, x: number, y: number, G: Oklab, extent: number, grain: number): Oklab => {
  const { qx, qy } = at(f, x, y);
  const node = f.nodes[0];
  const r2 = node.radius * node.radius;
  const rho = r2 / (qx * qx + qy * qy + f.lobeCore * r2);
  const k = Math.min(Math.max(f.kField * smoothstep(0.55, 1.6, node.fade * rho) * extent, 0), f.kMax);
  const col = extent > 0 ? node.field : G;
  return {
    L: G.L + (col.L - G.L) * k + grain * blueNoiseValue('grain', Math.floor(x), Math.floor(y)),
    a: k * col.a + (1 - k) * G.a,
    b: k * col.b + (1 - k) * G.b,
  };
};
/** The face's inputs and the ring's at a pixel: ground (the face's at d_f), extent and grain amplitude. */
const sides = (f: FieldFrame, x: number, y: number) => {
  const { d } = at(f, x, y);
  return {
    a: alphaOf(f, d),
    face: { G: faceGround(f, Math.min(d, f.ringInner)), extent: f.mask.face, grain: f.grain.inside },
    ring: { G: f.grounds.ring, extent: f.mask.ring, grain: f.grain.ground },
  };
};
/** The ruled pixel: the inputs mixed at α, then composited once. */
const inputBlend: PixelFn = (f, x, y) => {
  const { a, face, ring } = sides(f, x, y);
  return composite(f, x, y, mixLab(face.G, ring.G, a), (1 - a) * face.extent + a * ring.extent, (1 - a) * face.grain + a * ring.grain);
};
/** Planted: the whole face pixel and the whole ring pixel, each composited, then mixed at α in OKLab. */
const outputBlend: PixelFn = (f, x, y) => {
  const { a, face, ring } = sides(f, x, y);
  return mixLab(composite(f, x, y, face.G, face.extent, face.grain), composite(f, x, y, ring.G, ring.extent, ring.grain), a);
};
/** Planted: the same two pixels mixed at α in sRGB, as a canvas composites two draws (returned as sRGB). */
const srgbBlend = (f: FieldFrame, x: number, y: number): number[] => {
  const { a, face, ring } = sides(f, x, y);
  const p = oklabToSrgb(composite(f, x, y, face.G, face.extent, face.grain));
  const q = oklabToSrgb(composite(f, x, y, ring.G, ring.extent, ring.grain));
  return p.map((v, i) => (1 - a) * v + a * q[i]);
};
const asArray = (fn: PixelFn) => (f: FieldFrame, x: number, y: number) => {
  const p = fn(f, x, y);
  return [p.L, p.a, p.b];
};

/** Band pixels (pixel centres with 0 < α < 1) where a pixel is not the ruled input blend, compared in OKLab or in sRGB. */
function notInputBlended(f: FieldFrame, pixel: (f: FieldFrame, x: number, y: number) => number[], space: 'oklab' | 'srgb'): { band: number; off: number } {
  let band = 0;
  let off = 0;
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      const a = alphaOf(f, at(f, x + 0.5, y + 0.5).d);
      if (!(a > 0 && a < 1)) continue;
      band++;
      const ruled = inputBlend(f, x + 0.5, y + 0.5);
      const expected = space === 'srgb' ? oklabToSrgb(ruled) : [ruled.L, ruled.a, ruled.b];
      const got = pixel(f, x + 0.5, y + 0.5);
      if (Math.max(...expected.map((v, i) => Math.abs(v - got[i]))) > 1e-9) off++;
    }
  }
  return { band, off };
}

describe('UI-114: the band blends the inputs in OKLab (ground, extent, grain), not the outputs', () => {
  it.each(FACES)('abyss %s face: every band pixel under a lit lobe is the composite of the mixed inputs', (face) => {
    const f = frame(face, { nodes: withNodes([restLobe(face)]), grain: { inside: 0.03, ground: 0.004 } });
    const { band, off } = notInputBlended(f, asArray(LAW), 'oklab');
    expect(band).toBeGreaterThan(150);
    expect(off).toBe(0);
  });

  it.each(FACES)('bites: abyss %s face, an output blend (OKLab or sRGB) fails the check', (face) => {
    const f = frame(face, { nodes: withNodes([restLobe(face)]), grain: { inside: 0.03, ground: 0.004 } });
    expect(notInputBlended(f, asArray(outputBlend), 'oklab').off).toBeGreaterThan(100);
    expect(notInputBlended(f, srgbBlend, 'srgb').off).toBeGreaterThan(100);
    // The ruled oracle passes its own check, so the bite is the blend, not the harness.
    expect(notInputBlended(f, asArray(inputBlend), 'oklab').off).toBe(0);
  });
});

// ------------------------------------------------------------------ the invariants inside the band

/** The face side of a band pixel's ground, recovered from the law: (G − α·ring)/(1 − α), on L. */
const faceSideL = (f: FieldFrame, x: number, y: number) => {
  const a = alphaOf(f, at(f, x, y).d);
  return (pixelTerms(f, x, y).ground.L - a * f.grounds.ring.L) / (1 - a);
};
function bandPixels(f: FieldFrame): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      const a = alphaOf(f, at(f, x + 0.5, y + 0.5).d);
      // (G − α·ring)/(1 − α) loses digits as α → 1: the last millionth of the band is left out.
      if (a > 0 && a < 1 - 1e-6) out.push([x + 0.5, y + 0.5]);
    }
  }
  return out;
}
const INNER: PlateShadow = { offset: -0.05, blur: 0.1, strength: 0.3, mode: -1 };

describe('UI-114: the invariants hold inside the band, on d_f = min(d, ringInner)', () => {
  it('abyss dark (vignette −0.18): the face side never darkens past ρ = 1; with d in place of d_f it would', () => {
    const f = frame('dark');
    const floor = faceGround(f, f.ringInner).L;
    const band = bandPixels(f);
    expect(band.length).toBeGreaterThan(150);
    const below = band.filter(([x, y]) => faceSideL(f, x, y) < floor - 1e-9);
    expect(below).toEqual([]);
    // The planted control: the face ground at d itself, past ringInner, is below the floor on the ring side.
    const planted = band.filter(([x, y]) => faceGround(f, at(f, x, y).d).L < floor - 1e-6);
    expect(planted.length).toBeGreaterThan(50);
  });

  it.each(FACES)('abyss %s face, an inner shadow: P ≤ P_max = smoothstep(−b, b, |o|) in the band, reached at its top; at q in place of q_f it is not', (face) => {
    const f = frame(face, { shadows: [INNER, inertShadow()] });
    const pMax = smoothstep(-INNER.blur, INNER.blur, Math.abs(INNER.offset));
    const P = (x: number, y: number) => {
      const { d } = at(f, x, y);
      return (1 - faceSideL(f, x, y) / faceGround(f, Math.min(d, f.ringInner)).L) / INNER.strength;
    };
    const band = bandPixels(f);
    const ps = band.map(([x, y]) => P(x, y));
    expect(Math.max(...ps)).toBeLessThanOrEqual(pMax + 1e-9);
    expect(Math.max(...ps)).toBeGreaterThan(pMax - 0.05);
    // The planted control: the shadow read at q itself, past ringInner, passes P_max.
    const atQ = band.map(([x, y]) => {
      const { qx, qy } = at(f, x, y);
      return smoothstep(-INNER.blur, INNER.blur, Math.hypot(qx, qy - INNER.offset) - f.ringInner);
    });
    expect(Math.max(...atQ)).toBeGreaterThan(pMax + 0.01);
  });

  it.each(FACES)('abyss %s face: the field weight is (1 − α)·mask.face·k there, 0 at α = 1; a binary extent fails', (face) => {
    const f = frame(face, { nodes: withNodes([restLobe(face)]) });
    let checked = 0;
    let binaryOff = 0;
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const { qx, qy, d } = at(f, x + 0.5, y + 0.5);
        if (d > 1) continue;
        const a = alphaOf(f, d);
        const node = f.nodes[0];
        const r2 = node.radius * node.radius;
        const m = smoothstep(0.55, 1.6, r2 / (qx * qx + qy * qy + f.lobeCore * r2));
        const expected = f.kField * m * ((1 - a) * f.mask.face);
        expect(pixelTerms(f, x + 0.5, y + 0.5).kField).toBeCloseTo(expected, 14);
        if (a === 1) expect(pixelTerms(f, x + 0.5, y + 0.5).kField).toBe(0);
        if (a > 0 && a < 1) {
          checked++;
          const binary = f.kField * m * (d < f.ringInner ? f.mask.face : f.mask.ring);
          if (Math.abs(binary - expected) > 1e-6) binaryOff++;
        }
      }
    }
    expect(checked).toBeGreaterThan(150);
    expect(binaryOff).toBeGreaterThan(0.95 * checked);
  });
});

// ------------------------------------------------------------------ the law's own pieces

describe('UI-114: the coverage and the mix are defined once in the law', () => {
  it('ringEdgeCoverage is clamp((d − ringInner)·radiusPx + ½, 0, 1), exactly 0 and 1 off the band', () => {
    const f = frame('dark', { radiusPx: 147 });
    for (let i = -400; i <= 400; i++) {
      const d = f.ringInner + i / (100 * f.radiusPx);
      expect(ringEdgeCoverage(d, f)).toBe(alphaOf(f, d));
    }
    expect(ringEdgeCoverage(f.ringInner - 0.5 / f.radiusPx - 1e-9, f)).toBe(0);
    expect(ringEdgeCoverage(f.ringInner + 0.5 / f.radiusPx + 1e-9, f)).toBe(1);
    expect(ringEdgeCoverage(0, f)).toBe(0);
    expect(ringEdgeCoverage(1, f)).toBe(1);
  });

  it('edgeMix is (1 − α)·face + α·ring: the face bit for bit at α = 0, the ring at α = 1', () => {
    for (const [x, y] of [[0.123, 0.19], [0.97, 0.995], [-0.0125, -0.014]]) {
      expect(edgeMix(x, y, 0)).toBe(x);
      expect(edgeMix(x, y, 1)).toBe(y);
      expect(edgeMix(x, y, 0.25)).toBe(0.75 * x + 0.25 * y);
    }
  });

  it.each(FACES)('abyss %s face: faceGroundAt is the face ground at d_f, shaded by the inner shadows at q_f', (face) => {
    const f = frame(face, { shadows: [INNER, inertShadow()] });
    for (const [qx, qy] of [[0, 0.5], [0.3, -0.4], [0, f.ringInner + 0.01], [0.7, 0.7], [-0.2, -0.95]]) {
      const d = Math.hypot(qx, qy);
      const df = Math.min(d, f.ringInner);
      const s = df / (d || 1);
      const P = smoothstep(-INNER.blur, INNER.blur, Math.hypot(qx * s, qy * s - INNER.offset) - f.ringInner);
      const g = faceGround(f, df);
      const got = faceGroundAt(f, qx, qy);
      expect(got.L).toBeCloseTo(g.L * (1 - INNER.strength * P), 14);
      expect([got.a, got.b]).toEqual([g.a, g.b]);
    }
  });
});
