import { oklabToSrgb, type Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { blueNoiseValue } from '../blueNoise.ts';
import { buildFieldFrame, type FieldState } from '../fieldFrame.ts';
import {
  NODE,
  NODE_SLOTS,
  edgeMixOklab,
  faceGroundAt,
  fieldOklab,
  inertNode,
  inertShadow,
  outerEdgeCoverage,
  outsideGroundAt,
  pixelTerms,
  regionOf,
  ringBandsApart,
  ringEdgeCoverage,
  shadowFactor,
  smoothstep,
  type FieldFrame,
  type FieldNodeFrame,
  type PlateShadow,
} from '../fieldLaw.ts';
import { staticsFor } from '../statics.ts';

// Law round 2, D6-1 (the designer's ruling at UI-151, superseding §4's "the outer edge stays covered by the
// rim stroke"): the field anti-aliases its outer edge itself, as it does the inner edge.
//   β = clamp((d − 1)·radiusPx + ½, 0, 1), radiusPx = uGeom.z (no new uniform);
//   d_o = max(d, 1): below d = 1, q_o = q·(1/d), otherwise q_o = q;
//   ground = mix_OKLab(G_in, the outside ground with its outer shadows read at q_o, β), G_in the inner edge's
//     result (mix_OKLab(face(d_f, q_f), ring, α));
//   extent = ((1 − β)·[(1 − α)·mask.face + α·mask.ring] + β·0)·quiet (the moat's extent is 0);
//   grain = mix(G_grain_in, ground grain, β): the identity, the ring side being ground grain already;
//   the halos are unchanged.
// Precondition: (1 − ringInner)·radiusPx ≥ 1 for every token set at renderScale 0.5 and 0.33 and every
// density, so the inner and outer one-pixel bands never overlap. Every oracle is written by hand from that
// text, and the three planted mutants of acceptance (c) must fail: β ≡ step(d − 1), β mixed in sRGB, q_o
// not pulled to the rim.

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
    quiet: { rects: [], presence: [], grow: 0, feather: 0 },
    shadows: [inertShadow(), inertShadow()],
    nodes: Array.from({ length: NODE_SLOTS }, inertNode),
    ...overrides,
  };
}

/** A rest lobe at the plate centre wide enough to reach the rim (no bead, so no halo). */
const restLobe = (face: Face): FieldNodeFrame => {
  const R0 = lab(abyss.color[face].field.restGlow);
  return { id: NODE.R0, fade: 1, centre: [0, 0], radius: 1.4, field: R0, halo: R0, bead: null };
};
const withNodes = (nodes: FieldNodeFrame[]) => [...nodes, ...Array.from({ length: NODE_SLOTS - nodes.length }, inertNode)];

// ------------------------------------------------------------------ the oracles, by hand

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** β by hand: clamp((d − 1)·radiusPx + ½, 0, 1). */
const betaOf = (f: FieldFrame, d: number) => clamp01((d - 1) * f.radiusPx + 0.5);
/** α by hand: clamp((d − ringInner)·radiusPx + ½, 0, 1). */
const alphaOf = (f: FieldFrame, d: number) => clamp01((d - f.ringInner) * f.radiusPx + 0.5);
const at = (f: FieldFrame, x: number, y: number) => {
  const qx = (x - f.centrePx[0]) / f.radiusPx;
  const qy = -(y - f.centrePx[1]) / f.radiusPx;
  return { qx, qy, d: Math.sqrt(qx * qx + qy * qy) };
};
const mixLab = (x: Oklab, y: Oklab, t: number): Oklab => ({ L: (1 - t) * x.L + t * y.L, a: (1 - t) * x.a + t * y.a, b: (1 - t) * x.b + t * y.b });
const distance = (x: Oklab, y: Oklab) => Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);

/** The outer shadows' factor at a point by hand: 1 − Σ strength·smoothstep(−blur, blur, 1 − |p − o|), mode 1 only. */
const outerFactor = (f: FieldFrame, px: number, py: number) => {
  let sum = 0;
  for (const s of f.shadows) if (s.mode > 0) sum += s.strength * smoothstep(-s.blur, s.blur, 1 - Math.hypot(px, py - s.offset));
  return 1 - sum;
};
/** The outside side by hand: the outside ground, its L under the outer shadows read at q_o (q pulled out to the rim below d = 1). */
const outsideSide = (f: FieldFrame, qx: number, qy: number): Oklab => {
  const d = Math.hypot(qx, qy);
  const s = d < 1 ? 1 / d : 1;
  const g = f.grounds.outside;
  return { L: g.L * outerFactor(f, qx * s, qy * s), a: g.a, b: g.b };
};

type PixelFn = (f: FieldFrame, x: number, y: number) => Oklab;
const LAW: PixelFn = (f, x, y) => fieldOklab(f, x, y);
/** The ground alone, as pixelTerms gives it. */
const GROUND: PixelFn = (f, x, y) => pixelTerms(f, x, y).ground;

/** Samples along a ray at angle θ, from d0 to d1, every `step` canvas px. */
function ray(f: FieldFrame, theta: number, d0: number, d1: number, step: number): Array<{ d: number; x: number; y: number }> {
  const out: Array<{ d: number; x: number; y: number }> = [];
  for (let d = d0; d <= d1 + 1e-12; d += step / f.radiusPx) {
    out.push({ d, x: f.centrePx[0] + d * f.radiusPx * Math.cos(theta), y: f.centrePx[1] - d * f.radiusPx * Math.sin(theta) });
  }
  return out;
}
const ANGLES = [0.3, 1.9, 3.7, 5.2];

/** The outer ramp on a pixel function: the samples that are neither the ring's ground nor the outside's, their span in canvas px and its centre's offset from d = 1. */
function outerRampOf(f: FieldFrame, pixel: PixelFn, theta: number): { width: number; offset: number; between: number } {
  const step = 1 / 256;
  const samples = ray(f, theta, 1 - 2 / f.radiusPx, 1 + 2 / f.radiusPx, step);
  const inside = samples.filter((s) => {
    const p = pixel(f, s.x, s.y);
    return distance(p, f.grounds.ring) > 1e-12 && distance(p, f.grounds.outside) > 1e-12;
  });
  if (inside.length === 0) return { width: 0, offset: NaN, between: 0 };
  const first = inside[0].d;
  const last = inside[inside.length - 1].d;
  return { width: (last - first) * f.radiusPx + step, offset: ((first + last) / 2 - 1) * f.radiusPx, between: inside.length };
}

/** The largest change between neighbouring samples 1/16 canvas px apart across the rim, over |outside − ring|. */
function largestOuterStep(f: FieldFrame, pixel: PixelFn, theta: number): number {
  const samples = ray(f, theta, 1 - 2 / f.radiusPx, 1 + 2 / f.radiusPx, 1 / 16);
  let worst = 0;
  for (let i = 1; i < samples.length; i++) worst = Math.max(worst, distance(pixel(f, samples[i].x, samples[i].y), pixel(f, samples[i - 1].x, samples[i - 1].y)));
  return worst / distance(f.grounds.outside, f.grounds.ring);
}

/** Planted (c): β ≡ step(d − 1), the hard rim the law had before D6-1. */
const STEP_BETA: PixelFn = (f, x, y) => {
  const { d } = at(f, x, y);
  return d < 1 ? f.grounds.ring : f.grounds.outside;
};

describe('D6-1 (UI-151): β, the outer edge’s coverage, over one canvas pixel centred on the rim', () => {
  it('outerEdgeCoverage is clamp((d − 1)·radiusPx + ½, 0, 1): exactly 0 at d ≤ 1 − ½/R and exactly 1 at d ≥ 1 + ½/R', () => {
    for (const R of [40, 147, 223.125]) {
      const f = frame('dark', { radiusPx: R });
      for (let i = -400; i <= 400; i++) {
        const d = 1 + i / (100 * R);
        expect(outerEdgeCoverage(d, f)).toBe(betaOf(f, d));
      }
      // 1 ± ½/R itself is not a float, so the bounds are probed just past it, as the inner edge's are.
      expect(outerEdgeCoverage(1 - 0.5 / R - 1e-9, f)).toBe(0);
      expect(outerEdgeCoverage(1 - 0.5 / R - 1e-6, f)).toBe(0);
      expect(outerEdgeCoverage(1 + 0.5 / R + 1e-9, f)).toBe(1);
      expect(outerEdgeCoverage(1 + 0.5 / R + 1e-6, f)).toBe(1);
      expect(outerEdgeCoverage(1, f)).toBe(0.5);
      expect(outerEdgeCoverage(0, f)).toBe(0);
      expect(outerEdgeCoverage(f.ringInner, f)).toBe(0);
      expect(outerEdgeCoverage(f.moatOuter, f)).toBe(1);
    }
  });

  describe.each(FACES)('abyss %s face, the ground alone', (face) => {
    it.each([40, 147, 223])('at R %s px: the outer ramp spans exactly one canvas pixel, centred on d = 1, along every ray', (R) => {
      const f = frame(face, { radiusPx: R });
      for (const theta of ANGLES) {
        const ramp = outerRampOf(f, GROUND, theta);
        expect(ramp.width).toBeCloseTo(1, 2);
        expect(Math.abs(ramp.offset)).toBeLessThan(1 / 256);
        expect(ramp.between).toBeGreaterThan(200);
      }
    });

    it('at 1/16 canvas px, no step across the rim is more than 1/10 of the ring-to-outside difference', () => {
      const f = frame(face);
      for (const theta of ANGLES) expect(largestOuterStep(f, GROUND, theta)).toBeLessThan(0.1);
    });

    it('bites (c): β ≡ step(d − 1) has no ramp and steps the whole difference', () => {
      const f = frame(face);
      expect(outerRampOf(f, STEP_BETA, ANGLES[0]).width).toBe(0);
      expect(largestOuterStep(f, STEP_BETA, ANGLES[0])).toBeGreaterThan(0.99);
    });
  });
});

// ------------------------------------------------------------------ the ground: G_in and the outside at q_o, mixed in OKLab

const OUTER: PlateShadow = { offset: -0.05, blur: 0.1, strength: 0.3, mode: 1 };
const INNER: PlateShadow = { offset: -0.05, blur: 0.1, strength: 0.3, mode: -1 };

/** Every pixel centre of a 100×100 frame with its distances and both coverages. */
function pixels(f: FieldFrame): Array<{ x: number; y: number; qx: number; qy: number; d: number; a: number; b: number }> {
  const out = [];
  for (let y = 0; y < 100; y++) {
    for (let x = 0; x < 100; x++) {
      const p = at(f, x + 0.5, y + 0.5);
      out.push({ x: x + 0.5, y: y + 0.5, ...p, a: alphaOf(f, p.d), b: betaOf(f, p.d) });
    }
  }
  return out;
}

/** f25d232's ground, by hand from that commit's law: inside the rim the inner edge's mix, beyond it the outside shaded at q. */
const groundBefore = (f: FieldFrame, qx: number, qy: number, d: number): Oklab => {
  if (d <= 1) return edgeMixOklab(faceGroundAt(f, qx, qy), f.grounds.ring, ringEdgeCoverage(d, f));
  const g = f.grounds.outside;
  return { L: g.L * shadowFactor(f, regionOf(d, f), qx, qy), a: g.a, b: g.b };
};

describe.each(FACES)('D6-1: the outer band’s ground, abyss %s face, with an outer and an inner shadow', (face) => {
  const f = frame(face, { shadows: [OUTER, INNER] });

  it('in the band (0 < β < 1) the ground is mix_OKLab(G_in, the outside at q_o, β); G_in is the ring there (α = 1)', () => {
    let band = 0;
    for (const p of pixels(f)) {
      if (!(p.b > 0 && p.b < 1)) continue;
      band++;
      expect(p.a).toBe(1);
      const expected = mixLab(f.grounds.ring, outsideSide(f, p.qx, p.qy), p.b);
      const got = pixelTerms(f, p.x, p.y).ground;
      for (const k of ['L', 'a', 'b'] as const) expect(got[k]).toBeCloseTo(expected[k], 14);
    }
    expect(band).toBeGreaterThan(200);
  });

  it('(a) where β = 0 the ground is f25d232’s bit for bit, and where β = 1 too', () => {
    let zero = 0;
    let one = 0;
    for (const p of pixels(f)) {
      if (p.b === 0) zero++;
      else if (p.b === 1) one++;
      else continue;
      expect(pixelTerms(f, p.x, p.y).ground).toEqual(groundBefore(f, p.qx, p.qy, p.d));
    }
    expect([zero > 3000, one > 2000]).toEqual([true, true]);
  });

  it('outsideGroundAt is the outside ground with its outer shadows read at q_o', () => {
    for (const [qx, qy] of [[0, 0.99], [0.7, -0.7], [0.995, 0.004], [0, 1.01], [-0.8, -0.9], [0, 1.3]]) {
      const got = outsideGroundAt(f, qx, qy);
      const expected = outsideSide(f, qx, qy);
      expect(got.L).toBeCloseTo(expected.L, 14);
      expect([got.a, got.b]).toEqual([expected.a, expected.b]);
    }
  });

  it('q_o is pulled to the rim: inside the rim the outside side is its value on the rim; bites (c): read at q itself, it is not', () => {
    let checked = 0;
    let differs = 0;
    for (const p of pixels(f)) {
      if (!(p.d < 1 && p.b > 0.05)) continue;
      checked++;
      const G = pixelTerms(f, p.x, p.y).ground;
      // The outside side recovered from the law: (G − (1 − β)·ring)/β, on L.
      const side = (G.L - (1 - p.b) * f.grounds.ring.L) / p.b;
      const rim = f.grounds.outside.L * outerFactor(f, p.qx / p.d, p.qy / p.d);
      expect(side).toBeCloseTo(rim, 10);
      const atQ = f.grounds.outside.L * outerFactor(f, p.qx, p.qy);
      if (Math.abs(atQ - rim) > 1e-4) differs++;
    }
    expect(checked).toBeGreaterThan(100);
    expect(differs).toBeGreaterThan(0.5 * checked);
  });
});

// ------------------------------------------------------------------ the inputs in OKLab, not the outputs

/** The ruled outer band pixel with no field or halo: the ground mixed in OKLab, grain at the ground's amplitude. */
const ruledOuter = (f: FieldFrame, x: number, y: number): Oklab => {
  const { qx, qy, d } = at(f, x, y);
  const G = mixLab(f.grounds.ring, outsideSide(f, qx, qy), betaOf(f, d));
  return { L: G.L + f.grain.ground * blueNoiseValue('grain', Math.floor(x), Math.floor(y)), a: G.a, b: G.b };
};
/** Planted (c): the ring's pixel and the outside's, each composited, mixed at β in sRGB (returned as sRGB). */
const srgbOuter = (f: FieldFrame, x: number, y: number): number[] => {
  const { qx, qy, d } = at(f, x, y);
  const n = f.grain.ground * blueNoiseValue('grain', Math.floor(x), Math.floor(y));
  const ring = oklabToSrgb({ ...f.grounds.ring, L: f.grounds.ring.L + n });
  const o = outsideSide(f, qx, qy);
  const out = oklabToSrgb({ ...o, L: o.L + n });
  const b = betaOf(f, d);
  return ring.map((v, i) => (1 - b) * v + b * out[i]);
};

function notRuled(f: FieldFrame, pixel: (f: FieldFrame, x: number, y: number) => number[], space: 'oklab' | 'srgb'): { band: number; off: number } {
  let band = 0;
  let off = 0;
  for (const p of pixels(f)) {
    if (!(p.b > 0 && p.b < 1)) continue;
    band++;
    const ruled = ruledOuter(f, p.x, p.y);
    const expected = space === 'srgb' ? oklabToSrgb(ruled) : [ruled.L, ruled.a, ruled.b];
    const got = pixel(f, p.x, p.y);
    if (Math.max(...expected.map((v, i) => Math.abs(v - got[i]))) > 1e-9) off++;
  }
  return { band, off };
}
const asArray = (fn: PixelFn) => (f: FieldFrame, x: number, y: number) => {
  const p = fn(f, x, y);
  return [p.L, p.a, p.b];
};

describe.each(FACES)('D6-1: the outer band is mixed in OKLab, abyss %s face', (face) => {
  const f = frame(face, { grain: { inside: 0.03, ground: 0.004 } });

  it('every band pixel is the ruled OKLab mix, grain at the ground’s amplitude', () => {
    const { band, off } = notRuled(f, asArray(LAW), 'oklab');
    expect(band).toBeGreaterThan(200);
    expect(off).toBe(0);
  });

  it('bites (c): β mixed in sRGB fails the check; the ruled oracle passes its own', () => {
    expect(notRuled(f, srgbOuter, 'srgb').off).toBeGreaterThan(150);
    expect(notRuled(f, asArray(ruledOuter), 'oklab').off).toBe(0);
  });

  it('(a) the grain is bit-equal across the outer band: the ring’s ground amplitude, α = 1 there', () => {
    const noGrain = { ...f, grain: { inside: 0.03, ground: 0 } };
    let band = 0;
    for (const p of pixels(f)) {
      if (!(p.b > 0 && p.b < 1)) continue;
      band++;
      expect(pixelTerms(f, p.x, p.y).coverage).toBe(1);
      const n = blueNoiseValue('grain', Math.floor(p.x), Math.floor(p.y));
      expect(fieldOklab(f, p.x, p.y).L - fieldOklab(noGrain, p.x, p.y).L).toBeCloseTo(0.004 * n, 15);
    }
    expect(band).toBeGreaterThan(200);
  });
});

// ------------------------------------------------------------------ the extent

describe.each(FACES)('D6-1: the extent is ((1 − β)·[(1 − α)·mask.face + α·mask.ring] + β·0)·quiet, abyss %s face', (face) => {
  it('with a planted ring mask of ½ the field weight fades over the band and is 0 beyond; f25d232’s binary rim fails', () => {
    const f = frame(face, { mask: { ...abyss.field.mask, ring: 0.5 }, nodes: withNodes([restLobe(face)]) });
    let band = 0;
    let binaryOff = 0;
    for (const p of pixels(f)) {
      if (p.d < f.ringInner + 1 / f.radiusPx || p.d > 1 + 1 / f.radiusPx) continue;
      const node = f.nodes[0];
      const r2 = node.radius * node.radius;
      const m = smoothstep(0.55, 1.6, r2 / (p.qx * p.qx + p.qy * p.qy + f.lobeCore * r2));
      const inner = (1 - p.a) * f.mask.face + p.a * f.mask.ring;
      const expected = f.kField * m * ((1 - p.b) * inner + p.b * 0);
      const got = pixelTerms(f, p.x, p.y).kField;
      expect(got).toBeCloseTo(expected, 14);
      if (p.b === 1) expect(got).toBe(0);
      if (p.b > 0 && p.b < 1) {
        band++;
        const before = f.kField * m * (p.d <= 1 ? inner : 0);
        if (Math.abs(before - expected) > 1e-6) binaryOff++;
      }
    }
    expect(band).toBeGreaterThan(200);
    expect(binaryOff).toBeGreaterThan(0.95 * band);
  });

  it('on Abyss’s own mask (ring 0) the band is field-free, as the ring and the moat are', () => {
    const f = frame(face, { nodes: withNodes([restLobe(face)]) });
    for (const p of pixels(f)) if (p.b > 0 && p.b < 1) expect(pixelTerms(f, p.x, p.y).kField).toBe(0);
  });
});

// ------------------------------------------------------------------ the precondition

// The device matrix: no density matrix exists in the repo, so this takes the densities quietZones.test.ts
// already holds the upsampling half-width to (mdpi to xxxhdpi, with the Pixel classes 2.625 and 2.8125).
const DENSITIES = [1, 1.5, 2, 2.625, 2.8125, 3, 3.5, 4];
const SCALES = [BASE.field.tiers.full.renderScale, BASE.field.tiers.low.renderScale];
const IDS = Object.keys(DIRECTIONS) as DirectionId[];

describe('D6-1: the precondition (1 − ringInner)·radiusPx ≥ 1, so the two one-pixel bands never overlap', () => {
  it.each(IDS.flatMap((id) => FACES.map((face) => [id, face] as const)))(
    '%s, %s face: at renderScale 0.5 and 0.33, every density in the matrix, the smallest and largest plate and font scale 1',
    (id, face) => {
      const rows: string[] = [];
      for (const renderScale of SCALES) {
        for (const density of DENSITIES) {
          for (const diameter of [BASE.plate.minDiameter, BASE.plate.maxDiameter]) {
            const pxPerDp = density * renderScale;
            const radiusPx = (diameter / 2) * pxPerDp;
            const state: FieldState = { direction: id, face, placements: [], restFade: 1, stress: 0, confidence: 1, genesis: false, tMs: 7000, breathPhase: 0.3, tier: renderScale === 0.5 ? 'full' : 'low' };
            const f = buildFieldFrame(state, { centrePx: [radiusPx, radiusPx], radiusPx, pxPerDp, fontScale: 1 }, staticsFor(id, EXTENSIONS as never));
            const gap = (1 - f.ringInner) * f.radiusPx;
            if (!(gap >= 1) || !ringBandsApart(f)) rows.push(`renderScale ${renderScale} density ${density} plate ${diameter} dp: ${gap}`);
          }
        }
      }
      expect(rows).toEqual([]);
    },
  );

  it('ringBandsApart is (1 − ringInner)·radiusPx ≥ 1; bites: a plate whose label band is under one canvas pixel fails it', () => {
    expect(ringBandsApart(frame('dark', { radiusPx: 40 }))).toBe(true);
    expect(ringBandsApart(frame('dark', { radiusPx: 40, ringInner: 1 - 1 / 40 }))).toBe(true);
    expect(ringBandsApart(frame('dark', { radiusPx: 40, ringInner: 1 - 0.999 / 40 }))).toBe(false);
    expect(ringBandsApart(frame('dark', { radiusPx: 5 }))).toBe(false);
  });
});
