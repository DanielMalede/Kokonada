import { pivotComposite } from '../../color/blendSpace.ts';
import { mixOklab, oklabToSrgb, type Oklab } from '../../color/oklab.ts';
import { BASE, DIRECTIONS } from '../../tokens/tokens.generated.ts';
import { blueNoiseValue } from '../blueNoise.ts';
import {
  NODE,
  NODE_SLOTS,
  encodeSrgb8,
  fbm,
  fieldOklab,
  fieldPixel,
  groundAt,
  haloWeight,
  hash289,
  regionOf,
  selectColour,
  valueNoise,
  type FieldFrame,
  type FieldNodeFrame,
} from '../fieldLaw.ts';

// The field law in TypeScript (minimal F9): the reference the SkSL shader is held to, pixel for
// pixel, in the skia project (fieldShader.skia.test.ts). Every per-frame value is computed in JS
// (uniforms.ts); the law here is only what each pixel does with them.

const lab = (c: { oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const J = lab(BASE.emotion.joy.core);
const I = lab(BASE.emotion.intense.core);
const C = lab(BASE.emotion.calm.core);
const abyssDark = DIRECTIONS.abyss.color.dark;

const expectLab = (out: Oklab, expected: Oklab) => {
  expect(out.L).toBeCloseTo(expected.L, 12);
  expect(out.a).toBeCloseTo(expected.a, 12);
  expect(out.b).toBeCloseTo(expected.b, 12);
};

const absent = (id: number): FieldNodeFrame => ({ id, fade: 0, centre: [0, 0], radius: 0.5, field: J, halo: J, bead: null });

/** Abyss dark, one bead of joy at the top, nothing turning. */
function frame(overrides: Partial<FieldFrame> = {}): FieldFrame {
  return {
    centrePx: [32, 32],
    radiusPx: 24,
    ringInner: 0.8,
    moatOuter: 1.08,
    moatFeather: 0.16,
    beadRadius: 0.0533,
    haloRadius: 0.1467,
    mask: { outside: 1, face: 1, ring: 0 },
    grounds: { outside: lab(abyssDark.ground), face: lab(abyssDark.plate.face), ring: lab(abyssDark.plate.ring) },
    vignette: 0,
    centreLift: 0,
    kField: 0.6,
    kMax: 0.85,
    haloPeak: 0.45,
    kp: 0,
    warp: { amount: 0, orbit: 0.6, cos: 1, sin: 0, octaves: 3 },
    shimmer: { cos: 1, sin: 0 },
    lambda: 1000,
    restIntenseWaypoint: false,
    grain: { inside: 0, ground: 0 },
    dither: 0,
    nodes: [
      { id: NODE.J, fade: 1, centre: [0, 0.9], radius: 0.95, field: J, halo: J, bead: [0, 0.9] },
      absent(NODE.C),
      absent(NODE.R),
      absent(NODE.R0),
      absent(NODE.R0),
    ],
    ...overrides,
  };
}

describe('the hash and the value noise: exact in float32, so the shader agrees', () => {
  it('hash289 is the integer permutation mod 289, every step below 2^24', () => {
    for (let x = 0; x < 578; x++) {
      const h = hash289(x);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(289);
      expect(((x * 34 + 1) * x)).toBeLessThan(2 ** 24);
    }
  });

  // The shader runs the same hash in float32 (and a GPU may divide by a reciprocal). Every input
  // stays below 289, so every product stays below 2^22 and every floor(x / 289) is exact: the
  // float32 lattice equals the float64 one at every point.
  it('the lattice values are the same in float32, step by step, at every lattice point', () => {
    const f = Math.fround;
    const mod289f = (x: number) => f(x - f(289 * Math.floor(f(x / 289))));
    const hashf = (x: number) => mod289f(f(f(f(x * 34) + 1) * x));
    const cornerf = (ix: number, iy: number) => f(hashf(mod289f(f(hashf(mod289f(ix)) + mod289f(iy)))) / 289);
    let checked = 0;
    for (let ix = -300; ix < 300; ix += 1) {
      for (let iy = -300; iy < 300; iy += 7) {
        expect(f(valueNoise(ix, iy))).toBe(cornerf(ix, iy));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50000);
  });

  it('value noise lies in [0, 1), and is continuous across a cell edge', () => {
    for (let i = 0; i < 200; i++) {
      const v = valueNoise(i * 0.37 - 20, i * 0.53 - 31);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(Math.abs(valueNoise(3 - 1e-9, 7.25) - valueNoise(3 + 1e-9, 7.25))).toBeLessThan(1e-6);
    expect(Math.abs(valueNoise(-2.5, 5 - 1e-9) - valueNoise(-2.5, 5 + 1e-9))).toBeLessThan(1e-6);
  });

  it('fbm stays in [0, 1); two octaves differ from three', () => {
    for (let i = 0; i < 100; i++) {
      const v = fbm(i * 0.11 - 3, i * 0.07 + 1, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(fbm(0.3, 0.7, 2)).not.toBe(fbm(0.3, 0.7, 3));
  });
});

describe('topTwoSoft: e1 ≥ e2 ≥ e3, colour = (e1·a1 + max(0, e2 − e3)·a2) / (e1 + max(0, e2 − e3))', () => {
  const ids = [NODE.J, NODE.C, NODE.R, NODE.I, NODE.R0];

  it('one node gives its own colour', () => {
    expect(selectColour([2, 0, 0, 0, 0], [J, C, C, I, C], ids, false)).toEqual(J);
  });

  it('two equal straight nodes give the OKLab midpoint', () => {
    const out = selectColour([1, 1, 0, 0, 0], [J, C, C, I, C], ids, false);
    const mid = mixOklab(J, C, 0.5);
    expect(out.L).toBeCloseTo(mid.L, 12);
    expect(out.a).toBeCloseTo(mid.a, 12);
    expect(out.b).toBeCloseTo(mid.b, 12);
  });

  it('a third node takes weight from the second only', () => {
    const out = selectColour([3, 2, 1, 0, 0], [J, C, I, I, C], ids, false);
    const expected = mixOklab(J, C, 1 / 4); // (3·J + (2 − 1)·C) / 4
    expect(out.a).toBeCloseTo(expected.a, 12);
  });

  it('joy and intense route through the neutral N = (mid L, 0, 0): never the straight chord', () => {
    const order = [NODE.I, NODE.J, NODE.C, NODE.R, NODE.R0];
    const out = selectColour([1, 1, 0, 0, 0], [I, J, C, C, C], order, false);
    expectLab(out, { L: (I.L + J.L) / 2, a: 0, b: 0 });
    const part = selectColour([3, 1, 0, 0, 0], [I, J, C, C, C], order, false);
    const N = { L: (I.L + J.L) / 2, a: 0, b: 0 };
    const t = 1 / 4;
    expect(part.L).toBeCloseTo(I.L + (N.L - I.L) * 2 * t, 12);
    expect(part.a).toBeCloseTo(I.a * (1 - 2 * t), 12);
  });

  it('rest glow and intense: straight by default, through N where the direction routes them', () => {
    const order = [NODE.R0, NODE.I, NODE.J, NODE.C, NODE.R];
    const R0 = lab(abyssDark.field.restGlow);
    const straight = selectColour([1, 1, 0, 0, 0], [R0, I, J, C, C], order, false);
    expect(straight.a).toBeCloseTo((R0.a + I.a) / 2, 12);
    const routed = selectColour([1, 1, 0, 0, 0], [R0, I, J, C, C], order, true);
    expectLab(routed, { L: (R0.L + I.L) / 2, a: 0, b: 0 });
  });
});

describe('the halo: peak at the bead edge, gone at the outer radius', () => {
  const f = frame();
  it('holds the peak inside the bead and falls by smoothstep to 0 at the halo radius', () => {
    expect(haloWeight(0, f)).toBe(0.45);
    expect(haloWeight(f.beadRadius, f)).toBe(0.45);
    expect(haloWeight(f.haloRadius, f)).toBe(0);
    expect(haloWeight((f.beadRadius + f.haloRadius) / 2, f)).toBeCloseTo(0.225, 12);
  });
});

describe('regions, extent and the local ground', () => {
  const f = frame({ vignette: -0.12, centreLift: 0.03 });
  it('classifies face, ring, moat and outside by the distance from the plate centre', () => {
    expect([regionOf(0.5, f), regionOf(0.9, f), regionOf(1.04, f), regionOf(1.5, f)]).toEqual(['face', 'ring', 'moat', 'outside']);
  });

  it('the face ground takes the vignette and the centre lift on L only', () => {
    const face = lab(abyssDark.plate.face);
    const atRim = groundAt('face', 0.8, f);
    expect(atRim.L).toBeCloseTo(face.L * (1 - 0.12), 12);
    expect([atRim.a, atRim.b]).toEqual([face.a, face.b]);
    expect(groundAt('face', 0, f).L).toBeCloseTo(face.L + 0.03, 12);
    expect(groundAt('outside', 2, f)).toEqual(lab(abyssDark.ground));
  });
});

describe('a pixel', () => {
  const px = (q: [number, number], f: FieldFrame): [number, number] => [f.centrePx[0] + q[0] * f.radiusPx, f.centrePx[1] - q[1] * f.radiusPx];

  it('with no node at all is its local ground', () => {
    const f = frame({ nodes: Array.from({ length: NODE_SLOTS }, (_, i) => absent(i % 5)) });
    expect(fieldOklab(f, ...px([0.3, 0.2], f))).toEqual(lab(abyssDark.plate.face));
    expect(fieldOklab(f, ...px([1.5, 0], f))).toEqual(lab(abyssDark.ground));
  });

  it('composites the field over the ground with the pivot, at k = min(max(k_field·m·extent, H), max(cap, peak))', () => {
    const f = frame({ kp: 0.2, kField: 2 }); // a genesis-sized weight: the clamp must hold it at kMax
    const at = px([0, 0.1], f); // deep inside the lobe: m = 1
    const out = fieldOklab(f, ...at);
    const expected = pivotComposite(J, lab(abyssDark.plate.face), 0.85, 0.2);
    expect(out.L).toBeCloseTo(expected.L, 12);
    expect(out.a).toBeCloseTo(expected.a, 12);
    expect(out.b).toBeCloseTo(expected.b, 12);
  });

  it('the moat is field-free, and the ring shows only halos', () => {
    const f = frame();
    expect(fieldOklab(f, ...px([0, -1.04], f))).toEqual(lab(abyssDark.ground));
    const ring = fieldOklab(f, ...px([0.6, -0.65], f)); // in the ring, far from the bead
    expect(ring).toEqual(lab(abyssDark.plate.ring));
    const nearBead = fieldOklab(f, ...px([0.06, 0.9], f)); // in the ring, inside the halo
    expect(nearBead).not.toEqual(lab(abyssDark.plate.ring));
  });

  // Marks never shimmer (designer rulings, QA-064): inside a halo the bead's colour is steady.
  it('turns field colours by the shimmer, never a halo', () => {
    // Neutral grounds, so a turned colour keeps its chroma through the composite.
    const neutral = { L: 0.15, a: 0, b: 0 };
    const grounds = { outside: neutral, face: neutral, ring: neutral };
    const turn = { cos: Math.cos(0.1), sin: Math.sin(0.1) };
    const f = frame({ shimmer: turn, grounds });
    const still = frame({ grounds });
    const haloOnly = px([0.06, 0.9], f); // in the ring: no field, only the halo
    expect(fieldOklab(f, ...haloOnly)).toEqual(fieldOklab(still, ...haloOnly));
    const fieldOnly = px([0, 0.2], f); // in the face, outside the halo
    const turned = fieldOklab(f, ...fieldOnly);
    const straight = fieldOklab(still, ...fieldOnly);
    expect(turned.L).toBeCloseTo(straight.L, 12);
    expect(Math.hypot(turned.a, turned.b)).toBeCloseTo(Math.hypot(straight.a, straight.b), 12);
    expect(turned.a).not.toBeCloseTo(straight.a, 6);
  });

  it('encodes to the token hex: an anchor composited at full weight over itself', () => {
    const f = frame({ grounds: { outside: J, face: J, ring: J } });
    const out = fieldPixel(f, ...px([0, 0.3], f));
    const hex = BASE.emotion.joy.core.hex;
    expect(out).toEqual([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
  });

  it('encodeSrgb8 is oklab.ts clamped and rounded', () => {
    const colour = { L: 0.55, a: 0.02, b: -0.03 };
    expect(encodeSrgb8(colour)).toEqual(oklabToSrgb(colour).map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)));
  });

  it('adds grain and dither on L only, from the blue-noise tile, fixed in time', () => {
    const f = frame({ grain: { inside: 0.012, ground: 0.02 }, dither: 1 / 255 });
    const clean = frame();
    const [x, y] = px([0.2, 0.1], f);
    const a = fieldOklab(f, x, y);
    const b = fieldOklab(clean, x, y);
    const expected = 0.012 * blueNoiseValue('grain', Math.floor(x), Math.floor(y)) + (1 / 255) * blueNoiseValue('dither', Math.floor(x), Math.floor(y));
    expect(a.L - b.L).toBeCloseTo(expected, 12);
    expect([a.a, a.b]).toEqual([b.a, b.b]);
  });
});
