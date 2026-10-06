import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, TileMode, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { mixOklab, oklabToSrgb, type Oklab } from '../../color/oklab.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { BLUE_NOISE_SIZE, blueNoiseRgba } from '../blueNoise.ts';
import { NODE, NODE_SLOTS, fieldOklab, fieldPixel, inertNode, isWaypoint, type FieldFrame, type FieldNodeFrame } from '../fieldLaw.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { FIELD_SKSL } from '../fieldShader.ts';
import { staticsFor } from '../statics.ts';
import { FIELD_UNIFORMS, FIELD_UNIFORM_FLOATS, packFrame } from '../uniforms.ts';

// The field shader in real Skia (CanvasKit), held to the TypeScript law (fieldLaw.ts) pixel for
// pixel. Every claim about the shader is made here, on rendered pixels, never on the source text.

const W = 64;
const H = 64;
const lab = (c: { oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const scale = (c: Oklab, p: number): Oklab => ({ L: c.L, a: c.a * p, b: c.b * p });

let effect: SkRuntimeEffect;
let blueNoise: SkShader;

beforeAll(() => {
  const made = Skia.RuntimeEffect.Make(FIELD_SKSL);
  if (!made) throw new Error('the field shader did not compile');
  effect = made;
  const image = Skia.Image.MakeImage(
    { width: BLUE_NOISE_SIZE, height: BLUE_NOISE_SIZE, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul },
    Skia.Data.fromBytes(blueNoiseRgba()),
    BLUE_NOISE_SIZE * 4,
  );
  if (!image) throw new Error('the blue-noise image was not made');
  blueNoise = image.makeShaderOptions(TileMode.Repeat, TileMode.Repeat, FilterMode.Nearest, MipmapMode.None);
});

function render(frame: FieldFrame, source: SkRuntimeEffect = effect, w = W, h = H): Uint8Array {
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('no surface');
  const paint = Skia.Paint();
  paint.setDither(false);
  paint.setShader(source.makeShaderWithChildren(packFrame(frame), [blueNoise]));
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!pixels) throw new Error('no pixels');
  return pixels as Uint8Array;
}

const rgbAt = (pixels: Uint8Array, x: number, y: number, w = W) => [0, 1, 2].map((c) => pixels[(y * w + x) * 4 + c]);

/** The largest per-channel difference between the render and the law, over every pixel, with where it is. */
function worstDisagreement(frame: FieldFrame, pixels: Uint8Array, w = W, h = H): { delta: number; at: [number, number]; drawn: number[]; law: number[] } {
  let worst = { delta: -1, at: [0, 0] as [number, number], drawn: [] as number[], law: [] as number[] };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const drawn = rgbAt(pixels, x, y, w);
      const law = fieldPixel(frame, x + 0.5, y + 0.5);
      const delta = Math.max(...drawn.map((v, c) => Math.abs(v - law[c])));
      if (delta > worst.delta) worst = { delta, at: [x, y], drawn, law };
    }
  }
  return worst;
}


/** A frame for a direction and face, with the given nodes; geometry at 64×64 with R = 24 px. */
function frameFor(id: DirectionId, face: Face, nodes: FieldNodeFrame[], overrides: Partial<FieldFrame> = {}): FieldFrame {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  const rDp = 150;
  return {
    centrePx: [31.3, 32.7],
    radiusPx: 24,
    ringInner: 1 - 28 / rDp,
    moatOuter: 1 + d.field.mask.moat / rDp,
    moatFeather: d.field.mask.moatFeather / rDp,
    beadRadius: d.bead.diameter / 2 / rDp,
    haloRadius: BASE.field.halo.diameter / 2 / rDp,
    mask: d.field.mask,
    grounds: { outside: lab(c.ground), face: lab(c.plate.face), ring: lab(c.plate.ring) },
    vignette: d.plate.face.vignette[face],
    centreLift: d.plate.face.centreLift[face],
    kField: d.field.K[face] * d.field.presence.none,
    kMax: Math.max(d.field.cap[face], face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight),
    haloPeak: face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight,
    kp: d.field.pivot,
    warp: { amount: d.field.warp.W0, orbit: d.field.warp.orbit, cos: Math.cos(1.1), sin: Math.sin(1.1), octaves: 3 },
    shimmer: { cos: Math.cos((d.field.shimmer.deg * Math.PI) / 180), sin: Math.sin((d.field.shimmer.deg * Math.PI) / 180) },
    lambda: BASE.field.graph.lambda,
    restIntenseWaypoint: d.field.graph.restIntenseRoute === 'waypoint',
    grain: { inside: d.field.grain.inside, ground: d.field.grain.ground },
    dither: BASE.field.dither.amplitude,
    nodes: [...nodes, ...Array.from({ length: NODE_SLOTS - nodes.length }, inertNode)],
    ...overrides,
  };
}

const anchor = (q: 'joy' | 'calm' | 'reflective' | 'intense', face: Face) => lab(BASE.emotion[q][face === 'dark' ? 'core' : 'deep']);
const bead = (id: number, q: 'joy' | 'calm' | 'reflective' | 'intense', face: Face, at: [number, number], radius: number): FieldNodeFrame => ({
  id,
  fade: 1,
  centre: at,
  radius,
  field: scale(anchor(q, face), 0.9),
  halo: anchor(q, face),
  bead: at,
});

describe('the field shader compiles, with the builder’s uniform layout', () => {
  it('compiles in real Skia', () => {
    expect(effect).toBeDefined();
  });

  it('declares exactly the builder’s uniforms: names, order, float counts and slots', () => {
    const declared = Array.from({ length: effect.getUniformCount() }, (_, i) => {
      const u = effect.getUniform(i);
      return { name: effect.getUniformName(i), floats: u.columns * u.rows, slot: u.slot };
    });
    let slot = 0;
    const expected = FIELD_UNIFORMS.map((u) => {
      const entry = { name: u.name, floats: u.floats, slot };
      slot += u.floats;
      return entry;
    });
    expect(declared).toEqual(expected);
    expect(effect.getUniformFloatCount()).toBe(FIELD_UNIFORM_FLOATS);
  });
});

// G8 in Skia: graphConformance.test.ts holds the law's waypoint edges to the token graph; this holds
// the shader to the law on every ordered pair of node ids, routed and not. Two equal lobes meet at the
// plate centre, which sits on a pixel centre, so the pair mixes at exactly t = 0.5: through N (a
// neutral pixel) on a waypoint edge, at the joy–calm midpoint (a green one) on a straight edge.
describe('the shader routes exactly the law’s waypoint pairs', () => {
  const names = Object.keys(NODE) as Array<keyof typeof NODE>;
  const cases = names.flatMap((a) => names.flatMap((b) => [false, true].map((routed) => [a, b, routed] as const)));

  it('over all 25 ordered pairs of node ids, R0–I routed and not', () => {
    expect(cases).toHaveLength(50);
    const joy = anchor('joy', 'dark');
    const calm = anchor('calm', 'dark');
    const grey = { L: 0.5, a: 0, b: 0 };
    const centres: Record<string, string> = {};
    for (const [a, b, routed] of cases) {
      const frame = frameFor('abyss', 'dark', [
        { id: NODE[a], fade: 1, centre: [-0.5, 0], radius: 0.6, field: joy, halo: joy, bead: null },
        { id: NODE[b], fade: 1, centre: [0.5, 0], radius: 0.6, field: calm, halo: calm, bead: null },
      ], {
        centrePx: [1.5, 1.5],
        restIntenseWaypoint: routed,
        grounds: { outside: grey, face: grey, ring: grey },
        vignette: 0,
        centreLift: 0,
        grain: { inside: 0, ground: 0 },
        dither: 0,
        shimmer: { cos: 1, sin: 0 },
        warp: { amount: 0, orbit: 0, cos: 1, sin: 0, octaves: 3 },
      });
      const pixels = render(frame, effect, 4, 4);
      const worst = worstDisagreement(frame, pixels, 4, 4);
      expect({ pair: `${a}–${b}`, routed, delta: Math.min(worst.delta, 2) }).toEqual({ pair: `${a}–${b}`, routed, delta: Math.min(worst.delta, 1) });
      centres[`${a}–${b} ${routed}`] = rgbAt(pixels, 1, 1, 4).join(',');
    }
    // Not vacuous: the waypoint pairs draw one colour (N, neutral), the straight pairs another.
    const through = cases.filter(([a, b, routed]) => isWaypoint(NODE[a], NODE[b], routed)).map(([a, b, routed]) => centres[`${a}–${b} ${routed}`]);
    const straight = cases.filter(([a, b, routed]) => !isWaypoint(NODE[a], NODE[b], routed)).map(([a, b, routed]) => centres[`${a}–${b} ${routed}`]);
    expect([through.length, new Set(through).size, straight.length, new Set(straight).size]).toEqual([6, 1, 44, 1]);
    const [n, mid] = [through[0], straight[0]].map((s) => s.split(',').map(Number));
    expect(Math.max(...n.map((v, c) => Math.abs(v - mid[c])))).toBeGreaterThan(8);
  });
});

describe('the field shader draws the TypeScript law, pixel for pixel (±1 LSB)', () => {
  const ids: DirectionId[] = ['abyss', 'linen', 'basin'];
  const faces: Face[] = ['dark', 'light'];
  const cases = ids.flatMap((id) => faces.map((face) => [id, face] as const));

  it.each(cases)('%s, %s face: the rest glow on its rest lobes, warped and grained', (id, face) => {
    const R0 = lab(DIRECTIONS[id].color[face].field.restGlow);
    const rest = (at: [number, number]): FieldNodeFrame => ({ id: NODE.R0, fade: 1, centre: at, radius: DIRECTIONS[id].field.lobe.radius, field: R0, halo: R0, bead: null });
    const frame = frameFor(id, face, [rest([-0.35, -0.3]), rest([0.4, 0.35])]);
    expect(worstDisagreement(frame, render(frame)).delta).toBeLessThanOrEqual(1);
  });

  it.each(cases)('%s, %s face: the seam, intense beside joy, turned by the shimmer', (id, face) => {
    const r = DIRECTIONS[id].field.lobe.radius;
    const frame = frameFor(id, face, [bead(NODE.I, 'intense', face, [-0.15, 0.8], r), bead(NODE.J, 'joy', face, [0.15, 0.8], r)]);
    expect(worstDisagreement(frame, render(frame)).delta).toBeLessThanOrEqual(1);
  });

  // Genesis raises presence to 1.2, so k_field can pass the cap: the shader must clamp k to max(cap, peak).
  it.each(cases)('%s, %s face: a genesis-sized weight, clamped at max(cap, peak)', (id, face) => {
    const r = DIRECTIONS[id].field.lobe.radius;
    const frame = frameFor(id, face, [bead(NODE.C, 'calm', face, [0.2, 0.1], r), bead(NODE.R, 'reflective', face, [-0.3, -0.2], r)], {
      kField: 1.3,
    });
    expect(worstDisagreement(frame, render(frame)).delta).toBeLessThanOrEqual(1);
  });

  // Every slot lit (architect re-rule §4 T4): three live beads, a rest lobe and two leaving beads,
  // so the sixth slot is drawn and selected like the others.
  it.each(cases)('%s, %s face: all six slots lit, three live, a rest lobe and two leaving', (id, face) => {
    const r = DIRECTIONS[id].field.lobe.radius;
    const R0 = lab(DIRECTIONS[id].color[face].field.restGlow);
    const leaving = (node: FieldNodeFrame, fade: number): FieldNodeFrame => ({ ...node, fade });
    const frame = frameFor(id, face, [
      bead(NODE.C, 'calm', face, [0.5, -0.4], r),
      bead(NODE.R, 'reflective', face, [-0.6, -0.2], r),
      bead(NODE.I, 'intense', face, [0.1, 0.94], r),
      { id: NODE.R0, fade: 0.6, centre: [0, 0], radius: r, field: R0, halo: R0, bead: null },
      leaving(bead(NODE.J, 'joy', face, [0.55, 0.55], r), 0.5),
      leaving(bead(NODE.I, 'intense', face, [-0.5, 0.6], r), 0.8),
    ]);
    expect(frame.nodes.every((n) => n.fade > 0)).toBe(true);
    expect(worstDisagreement(frame, render(frame)).delta).toBeLessThanOrEqual(1);
  });

  it.each(cases)('%s, %s face: three beads and a fading rest lobe, at tier low (two octaves)', (id, face) => {
    const r = DIRECTIONS[id].field.lobe.radius;
    const R0 = lab(DIRECTIONS[id].color[face].field.restGlow);
    const frame = frameFor(
      id,
      face,
      [
        bead(NODE.C, 'calm', face, [0.5, -0.4], r),
        bead(NODE.R, 'reflective', face, [-0.6, -0.2], r),
        bead(NODE.I, 'intense', face, [0.1, 0.94], r),
        { id: NODE.R0, fade: 0.4, centre: [0, 0], radius: r, field: R0, halo: R0, bead: null },
      ],
      { warp: { amount: DIRECTIONS[id].field.warp.W0, orbit: DIRECTIONS[id].field.warp.orbit, cos: 0.3, sin: -0.95, octaves: 2 } },
    );
    expect(worstDisagreement(frame, render(frame)).delta).toBeLessThanOrEqual(1);
  });
});

describe('what the shader’s pixels show', () => {
  it.each([['dark'], ['light']] as Array<[Face]>)('an anchor composited over itself renders as its token hex ±1 (%s face)', (face) => {
    for (const q of ['joy', 'calm', 'reflective', 'intense'] as const) {
      const colour = anchor(q, face);
      const frame = frameFor('abyss', face, [{ id: NODE.J, fade: 1, centre: [0, 0], radius: 0.95, field: colour, halo: colour, bead: null }], {
        grounds: { outside: colour, face: colour, ring: colour },
        vignette: 0,
        centreLift: 0,
        grain: { inside: 0, ground: 0 },
        dither: 0,
        shimmer: { cos: 1, sin: 0 },
      });
      const hex = BASE.emotion[q][face === 'dark' ? 'core' : 'deep'].hex;
      const token = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const drawn = rgbAt(render(frame), 31, 32);
      expect(drawn.map((v, c) => Math.abs(v - token[c])).every((d) => d <= 1)).toBe(true);
    }
  });

  it('two equal straight nodes (joy and calm) mix to the OKLab midpoint, not the sRGB one', () => {
    const joy = anchor('joy', 'dark');
    const calm = anchor('calm', 'dark');
    const mid = mixOklab(joy, calm, 0.5);
    const frame = frameFor('abyss', 'dark', [
      { id: NODE.J, fade: 1, centre: [-0.5, 0], radius: 0.6, field: joy, halo: joy, bead: null },
      { id: NODE.C, fade: 1, centre: [0.5, 0], radius: 0.6, field: calm, halo: calm, bead: null },
    ], { grounds: { outside: mid, face: mid, ring: mid }, vignette: 0, centreLift: 0, grain: { inside: 0, ground: 0 }, dither: 0, shimmer: { cos: 1, sin: 0 }, warp: { amount: 0, orbit: 0, cos: 1, sin: 0, octaves: 3 } });
    // The plate centre (31.3, 32.7) sits on the bisector; pixel (31, 32) is 0.3 px from it.
    const pixels = render(frame);
    const drawn = rgbAt(pixels, 31, 32);
    const okMid = oklabToSrgb(mid).map((v) => Math.round(v * 255));
    const srgbMid = [0, 1, 2].map((c) => Math.round(((oklabToSrgb(joy)[c] + oklabToSrgb(calm)[c]) / 2) * 255));
    expect(drawn.map((v, c) => Math.abs(v - okMid[c])).every((d) => d <= 1)).toBe(true);
    expect(Math.max(...srgbMid.map((v, c) => Math.abs(v - okMid[c])))).toBeGreaterThan(8);
  });

  it('dither and grain move L only: a neutral ground stays neutral on every pixel', () => {
    const grey = { L: 0.6, a: 0, b: 0 };
    const frame = frameFor('linen', 'light', [], { grounds: { outside: grey, face: grey, ring: grey } });
    const pixels = render(frame);
    for (let i = 0; i < W * H; i++) {
      expect([pixels[4 * i], pixels[4 * i + 1]]).toEqual([pixels[4 * i + 2], pixels[4 * i + 2]]);
    }
  });

  it('the dither is fixed in time: frames that differ only in their clock draw the same ground', () => {
    const a = frameFor('abyss', 'dark', [], { warp: { amount: 0.3, orbit: 0.6, cos: 1, sin: 0, octaves: 3 }, shimmer: { cos: 1, sin: 0 } });
    const b = frameFor('abyss', 'dark', [], { warp: { amount: 0.3, orbit: 0.6, cos: -0.4, sin: 0.9165, octaves: 3 }, shimmer: { cos: 0.99, sin: 0.1 } });
    expect(Array.from(render(b))).toEqual(Array.from(render(a)));
  });

  // The field dither (designer ruling 1, option (a)): ±1/255 on OKLab L, one scalar per pixel,
  // added before the sRGB encode and rounded once. Its 8-bit footprint per channel is at most ⌈σ⌉,
  // σ being the channel's unrounded 8-bit change over ±amplitude of L at the undithered colour.
  // σ_c at an undithered colour c0.
  const sigma = (c0: Oklab, A: number): number[] => {
    const enc = (L: number) => oklabToSrgb({ L, a: c0.a, b: c0.b }).map((v) => Math.min(1, Math.max(0, v)) * 255);
    const lo = enc(c0.L - A);
    const mid = enc(c0.L);
    const hi = enc(c0.L + A);
    return [0, 1, 2].map((c) => Math.max(Math.abs(hi[c] - mid[c]), Math.abs(mid[c] - lo[c])));
  };

  it('the dither is ±1/255 on OKLab L: each channel moves at most ⌈σ⌉, its total matches the law within 5%, unbiased', () => {
    const A = BASE.field.dither.amplitude;
    const r = DIRECTIONS.abyss.field.lobe.radius;
    const nodes = [bead(NODE.C, 'calm', 'dark', [0.3, 0.2], r), bead(NODE.R, 'reflective', 'dark', [-0.4, -0.3], r)];
    const clean = frameFor('abyss', 'dark', nodes, { grain: { inside: 0, ground: 0 }, dither: 0 });
    const dithered = frameFor('abyss', 'dark', nodes, { grain: { inside: 0, ground: 0 } });
    const a = render(clean);
    const b = render(dithered);
    let over = 0;
    let worst = 0;
    let sum = 0;
    let drawn = 0;
    let law = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const s = sigma(fieldOklab(clean, x + 0.5, y + 0.5), A);
        const l0 = fieldPixel(clean, x + 0.5, y + 0.5);
        const l1 = fieldPixel(dithered, x + 0.5, y + 0.5);
        for (let c = 0; c < 3; c++) {
          const d = b[4 * (y * W + x) + c] - a[4 * (y * W + x) + c];
          if (Math.abs(d) > Math.ceil(s[c])) over++;
          worst = Math.max(worst, Math.abs(d));
          sum += d;
          drawn += Math.abs(d);
          law += Math.abs(l1[c] - l0[c]);
        }
      }
    }
    expect(over).toBe(0);
    expect(worst).toBeGreaterThan(0);
    expect(Math.abs(drawn / law - 1)).toBeLessThan(0.05);
    expect(Math.abs(sum / (W * H * 3))).toBeLessThan(0.1);
  });

  // The premise (σ < 1 on every dark-face ground) is a guard: if a token change breaks it, stop and
  // report to the designer; never relax this test.
  it.each(['abyss', 'linen', 'basin'] as DirectionId[])('%s dark: on every calm ground the dither moves a channel by at most 1 LSB, and moves some', (id) => {
    const c = DIRECTIONS[id].color.dark;
    for (const g of [lab(c.ground), lab(c.plate.face), lab(c.plate.ring)]) {
      expect(Math.max(...sigma(g, BASE.field.dither.amplitude))).toBeLessThan(1); // the premise
      const flat = { grounds: { outside: g, face: g, ring: g }, vignette: 0, centreLift: 0, grain: { inside: 0, ground: 0 } };
      const a = render(frameFor(id, 'dark', [], { ...flat, dither: 0 }));
      const b = render(frameFor(id, 'dark', [], flat));
      let worst = 0;
      for (let i = 0; i < W * H; i++) for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(b[4 * i + ch] - a[4 * i + ch]));
      expect(worst).toBe(1);
    }
  });

  // Designer 2.1: wherever the field is absent (extent 0 by the direction's mask: the ring and the
  // moat everywhere, Linen's dish, Basin's screen ground), a pixel depends on the halos alone, so the
  // shader draws it byte for byte the same across s 0 and 1, two clocks, c, genesis and the breath.
  it.each((['abyss', 'linen', 'basin'] as DirectionId[]).flatMap((id) => (['dark', 'light'] as Face[]).map((face) => [id, face] as const)))(
    '%s, %s face: where the field is absent, the halos alone draw it, byte for byte steady',
    (id, face) => {
      const R = 48;
      const size = 112;
      const geometry = { centrePx: [size / 2 + 0.3, size / 2 - 0.4] as [number, number], radiusPx: R, pxPerDp: R / (BASE.plate.maxDiameter / 2), fontScale: 1 };
      const roots = EXTENSIONS as unknown as Record<string, { $root: { neverRedScenes?: Array<{ id: string; beads?: Array<{ x: number; y: number }> }>; hardest?: Array<{ id: string; node?: string; x?: number; y?: number }> } }>;
      const ring = roots[id].$root.neverRedScenes?.find((s) => s.id === 'ringHalo')?.beads?.[0]
        ?? (roots[id].$root.hardest?.find((h) => h.id === 'word.top' && h.node === 'I') as { x: number; y: number });
      const placements = [{ x: ring.x, y: ring.y, fade: 1 }, { x: 0.566, y: -0.566, fade: 1 }, { x: -0.566, y: -0.566, fade: 1 }];
      const statics = staticsFor(id, EXTENSIONS as never);
      const peak = BASE.field.clock.T / (4 * BASE.field.clock.shimmer.harmonic);
      const base = { direction: id, face, placements, tier: 'full' as const, restFade: 0 };
      const a = buildFieldFrame({ ...base, stress: 0, confidence: null, genesis: false, tMs: peak, breathPhase: 0.1 }, geometry, statics);
      const b = buildFieldFrame({ ...base, stress: 1, confidence: 1, genesis: true, tMs: 37000, breathPhase: 0.7 }, geometry, statics);
      const pa = render(a, effect, size, size);
      const pb = render(b, effect, size, size);
      let fieldFree = 0;
      let lit = 0;
      const moved: string[] = [];
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const qx = (x + 0.5 - a.centrePx[0]) / R;
          const qy = -(y + 0.5 - a.centrePx[1]) / R;
          const d = Math.hypot(qx, qy);
          const region = d < a.ringInner ? 'face' : d <= 1 ? 'ring' : d < a.moatOuter ? 'moat' : 'outside';
          const maskOf = { face: a.mask.face, ring: a.mask.ring, moat: 0, outside: a.mask.outside }[region];
          if (maskOf !== 0) continue;
          fieldFree++;
          if (d <= 1 && a.nodes.some((n) => n.bead && Math.hypot(qx - n.bead[0], qy - n.bead[1]) < a.haloRadius)) lit++;
          const i = 4 * (y * size + x);
          if (pa[i] !== pb[i] || pa[i + 1] !== pb[i + 1] || pa[i + 2] !== pb[i + 2]) moved.push(`(${x}, ${y}) ${region}`);
        }
      }
      expect(lit).toBeGreaterThan(20);
      expect(fieldFree).toBeGreaterThan(lit);
      expect(moved).toEqual([]);
      // Not vacuous: where the field is present, the two moments do differ.
      expect(Array.from(pa)).not.toEqual(Array.from(pb));
    },
  );

  // The critic's clause in the shader itself. One float32 ULP is invisible in an 8-bit render except
  // at a rounding tie, so the shader's own nodeColour (cut from FIELD_SKSL's text) is compiled alone,
  // and its residual against the halo is drawn ×1e9: any residual at all moves the byte off 64.
  it('the shader’s nodeColour is the halo bit for bit where w = 1, for every anchor turned and under tension', () => {
    const cut = (re: RegExp) => {
      const m = FIELD_SKSL.match(re);
      if (!m) throw new Error(`not in FIELD_SKSL: ${re}`);
      return m[0];
    };
    const probe = Skia.RuntimeEffect.Make(`uniform float2 uShimmer;
uniform float3 uField;
uniform float3 uHalo;
${cut(/float sstep\([^)]*\) \{[\s\S]*?\n\}/)}
${cut(/float3 nodeColour\([^)]*\) \{[\s\S]*?\n\}/)}
half4 main(float2 p) {
  float3 d = (nodeColour(uField, uHalo, 1.0, 0.2, 0.0) - uHalo) * 1.0e9;
  return half4(0.25 + d.x, 0.25 + d.y, 0.25 + d.z, 1.0);
}`);
    if (!probe) throw new Error('the nodeColour probe did not compile');
    const off: string[] = [];
    let cases = 0;
    for (const q of ['joy', 'calm', 'reflective', 'intense'] as const) {
      for (const tier of ['core', 'deep'] as const) {
        const halo = lab(BASE.emotion[q][tier]);
        for (const s of [0, 1]) {
          const field = { L: halo.L * (1 - 0.15 * s), a: halo.a * (1 - 0.35 * s), b: halo.b * (1 - 0.35 * s) };
          for (const deg of [-6, -3, 3, 6]) {
            const phi = (deg * Math.PI) / 180;
            const surface = Skia.Surface.Make(1, 1);
            if (!surface) throw new Error('no surface');
            const paint = Skia.Paint();
            paint.setDither(false);
            paint.setShader(probe.makeShader([Math.cos(phi), Math.sin(phi), field.L, field.a, field.b, halo.L, halo.a, halo.b]));
            surface.getCanvas().drawPaint(paint);
            surface.flush();
            const px = surface.makeImageSnapshot().readPixels(0, 0, { width: 1, height: 1, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
            cases++;
            if (px[0] !== 64 || px[1] !== 64 || px[2] !== 64) off.push(`${q} ${tier} s ${s} at ${deg}°: (${px[0]}, ${px[1]}, ${px[2]})`);
          }
        }
      }
    }
    expect(cases).toBe(64);
    expect(off).toEqual([]);
  });

  // Marks never shimmer (designer rulings, QA-064): in the ring, where only the halo shows, the
  // shimmer changes no pixel.
  it('a halo is never turned by the shimmer', () => {
    const r = DIRECTIONS.basin.field.lobe.radius;
    const nodes = [bead(NODE.I, 'intense', 'dark', [-0.02, 0.92], r)];
    const turned = frameFor('basin', 'dark', nodes, { shimmer: { cos: Math.cos(0.05), sin: Math.sin(0.05) } });
    const still = frameFor('basin', 'dark', nodes, { shimmer: { cos: 1, sin: 0 } });
    const a = render(turned);
    const b = render(still);
    let ringPixels = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const qx = (x + 0.5 - turned.centrePx[0]) / turned.radiusPx;
        const qy = -(y + 0.5 - turned.centrePx[1]) / turned.radiusPx;
        const d = Math.hypot(qx, qy);
        const nearBead = Math.hypot(qx + 0.02, qy - 0.92) < turned.haloRadius;
        if (d >= turned.ringInner && d <= 1 && nearBead) {
          ringPixels++;
          expect(rgbAt(a, x, y)).toEqual(rgbAt(b, x, y));
        }
      }
    }
    expect(ringPixels).toBeGreaterThan(0);
  });

});
