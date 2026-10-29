import { pivotComposite } from '../../color/blendSpace.ts';
import { mixOklab, oklabToSrgb, type Oklab } from '../../color/oklab.ts';
import { BASE, DIRECTIONS } from '../../tokens/tokens.generated.ts';
import { blueNoiseValue } from '../blueNoise.ts';
import {
  NODE,
  NODE_SLOTS,
  inertShadow,
  encodeSrgb8,
  fbm,
  fieldOklab,
  fieldPixel,
  groundAt,
  haloWeight,
  hash289,
  regionOf,
  selectColour as select,
  smoothstep,
  tripleRatio,
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
    lambda: 25,
    lobeCore: 0.04,
    tripleFade: 0.15,
    restIntenseWaypoint: false,
    grain: { inside: 0, ground: 0 },
    dither: 0,
    quiet: { rects: [], grow: 0, feather: 0 },
    shadows: [inertShadow(), inertShadow()],
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

// Law round 2 (designer L4–L6, L5′ at UI-125): w1 = (e1 − e3)², w2 = (e2 − e3)², t = w2/(w1 + w2), the
// waypoint leg by s(2t), s(x) = 1 − (1 − x)², the pair fading to the e-weighted neutral N̄ by
// β = smoothstep(0, θ, r), r = 3·√(d1² − d1·d2 + d2²)/(e1 + e2 + e3) (L6′, UI-139); the properties are in
// seamContinuity.test.ts and seamSlope.test.ts.
// The two worked values below are re-authored at UI-125 (L5′ squares the weights, so t moves; not a
// loosening: the same exact expectation, at the new law's t).
describe('topTwoSoft: e1 ≥ e2 ≥ e3, the pair mixed by t = (e2 − e3)²/((e1 − e3)² + (e2 − e3)²), faded to N̄ near a third', () => {
  const ids = [NODE.J, NODE.C, NODE.R, NODE.I, NODE.R0];
  const selectColour = (e: readonly number[], colours: readonly Oklab[], order: readonly number[], routed: boolean) => select(e, colours, order, routed, 0.15);

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

  it('a third node takes weight from both: t = (2 − 1)²/((3 − 1)² + (2 − 1)²), and far from the triple point the pair is not faded', () => {
    const out = selectColour([3, 2, 1, 0, 0], [J, C, I, I, C], ids, false);
    const expected = mixOklab(J, C, 1 / 5); // β = smoothstep(0, 0.15, 2/3) = 1
    expectLab(out, expected);
  });

  it('at an exact triple tie the colour is the e-weighted neutral N̄ = (Σ e·L / Σ e, 0, 0)', () => {
    const out = selectColour([1, 1, 1, 0.5, 0], [J, C, I, I, C], ids, false);
    expectLab(out, { L: (J.L + C.L + I.L + 0.5 * I.L) / 3.5, a: 0, b: 0 });
  });

  it('joy and intense route through the neutral N = (mid L, 0, 0): never the straight chord', () => {
    const order = [NODE.I, NODE.J, NODE.C, NODE.R, NODE.R0];
    const out = selectColour([1, 1, 0, 0, 0], [I, J, C, C, C], order, false);
    expectLab(out, { L: (I.L + J.L) / 2, a: 0, b: 0 });
    const part = selectColour([3, 1, 0, 0, 0], [I, J, C, C, C], order, false);
    const N = { L: (I.L + J.L) / 2, a: 0, b: 0 };
    const t = 1 / 10; // 1²/(3² + 1²)
    const s = 1 - (1 - 2 * t) ** 2; // the eased leg, 0.36
    expect(part.L).toBeCloseTo(I.L + (N.L - I.L) * s, 12);
    expect(part.a).toBeCloseTo(I.a * (1 - s), 12);
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

// L6′ (UI-139, the designer's Ruling 1 d)): β reads r = 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3), d1 = E1 − E3,
// d2 = E2 − E3, symmetric in the three strongest nodes (d1² − d1·d2 + d2² = ½·Σ_{i<j}(E_i − E_j)²), so its
// slope does not bend where E1 and E2, or E2 and E3, swap; with no third node r ≥ 1.5, so β = 1 for every
// θ ≤ 1 and the colour is the pair bit for bit; at an exact triple tie r = 0 and β = 0.
describe('L6′: β = smoothstep(0, θ, r), r symmetric in the three strongest nodes', () => {
  /** r as the designer wrote it, from the three values in any order. */
  const rOf = (e1: number, e2: number, e3: number) => {
    const d1 = e1 - e3;
    const d2 = e2 - e3;
    return (3 * Math.sqrt(d1 * d1 - d1 * d2 + d2 * d2)) / (e1 + e2 + e3);
  };
  /** A seeded generator (Park–Miller, exact in float64). */
  const random = (seed: number) => {
    let x = (seed % 2147483646) + 1;
    return () => {
      x = (16807 * x) % 2147483647;
      return (x - 1) / 2147483646;
    };
  };
  const PERMUTATIONS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  it('r is the designer’s formula, and invariant under every permutation of (E1, E2, E3) to 1e-15 relative', () => {
    const next = random(139);
    let worst = 0;
    for (let n = 0; n < 5000; n++) {
      // Near-ties too: a third of the trials put the three within 1e-3 of each other.
      const base = next() * 3;
      const v = n % 3 === 0 ? [base, base + 1e-3 * next(), base + 1e-3 * next()] : [next() * 3, next() * 3, n % 7 === 0 ? 0 : next() * 3];
      const sorted = [...v].sort((a, b) => b - a);
      const ref = tripleRatio(sorted[0], sorted[1], sorted[2]);
      expect(ref).toBe(rOf(sorted[0], sorted[1], sorted[2]));
      for (const [i, j, k] of PERMUTATIONS) worst = Math.max(worst, Math.abs(tripleRatio(v[i], v[j], v[k]) - ref) / ref);
    }
    expect(worst).toBeLessThanOrEqual(1e-15);
  });

  it('E3 = 0: r ≥ 1.5, so β = 1 bit for bit for θ 0.15, 0.25 and 1, and the colour is the pair bit for bit', () => {
    const next = random(1391);
    const ids = [NODE.J, NODE.C, NODE.R, NODE.I, NODE.R0];
    for (let n = 0; n < 2000; n++) {
      const e1 = 0.01 + next() * 3;
      const e2 = next() * e1;
      expect(tripleRatio(e1, e2, 0)).toBeGreaterThanOrEqual(1.5);
      const e = [e1, e2, 0, 0, 0];
      const pair = { L: J.L + (C.L - J.L) * ((e2 * e2) / (e1 * e1 + e2 * e2)), a: J.a + (C.a - J.a) * ((e2 * e2) / (e1 * e1 + e2 * e2)), b: J.b + (C.b - J.b) * ((e2 * e2) / (e1 * e1 + e2 * e2)) };
      for (const theta of [0.15, 0.25, 1]) {
        expect(smoothstep(0, theta, tripleRatio(e1, e2, 0))).toBe(1);
        expect(select(e, [J, C, I, I, C], ids, false, theta)).toEqual(pair);
      }
    }
    // The equal pair, r = 1.5 exactly.
    expect(tripleRatio(1, 1, 0)).toBe(1.5);
  });

  it('an exact triple tie: r = 0 and β = 0', () => {
    for (const x of [1e-6, 0.3, 1, 7]) {
      expect(tripleRatio(x, x, x)).toBe(0);
      expect(smoothstep(0, 0.15, tripleRatio(x, x, x))).toBe(0);
    }
  });

  it('inside the fade the law is P·β + N̄·(1 − β) with β on r, not on the ratio (E1 − E3)/E1', () => {
    const ids = [NODE.J, NODE.C, NODE.R, NODE.I, NODE.R0];
    const colours = [J, C, I, I, C];
    const next = random(1392);
    let differsFromRatio = 0;
    for (let n = 0; n < 500; n++) {
      // Three nodes within the fade: E1 = 1, E2 and E3 within 0.2 of it.
      const e3 = 1 - 0.2 * next();
      const e2 = e3 + (1 - e3) * next();
      const e = [1, e2, e3, 0, 0];
      const d1 = 1 - e3;
      const d2 = e2 - e3;
      const t = d1 * d1 > 0 ? (d2 * d2) / (d1 * d1 + d2 * d2) : 0;
      const P = { L: J.L + (C.L - J.L) * t, a: J.a + (C.a - J.a) * t, b: J.b + (C.b - J.b) * t };
      const beta = smoothstep(0, 0.15, rOf(1, e2, e3));
      const nL = (J.L + C.L * e2 + I.L * e3) / (1 + e2 + e3);
      const out = select(e, colours, ids, false, 0.15);
      expect(out.L).toBeCloseTo(P.L * beta + nL * (1 - beta), 14);
      expect(out.a).toBeCloseTo(beta * P.a, 14);
      expect(out.b).toBeCloseTo(beta * P.b, 14);
      if (Math.abs(beta - smoothstep(0, 0.15, d1)) > 1e-6) differsFromRatio++;
    }
    // Not vacuous: on most of these samples the ratio's β is a different number.
    expect(differsFromRatio).toBeGreaterThan(250);
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
