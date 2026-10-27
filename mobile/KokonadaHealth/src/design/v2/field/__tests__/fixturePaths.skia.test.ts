jest.mock('../../tokens/tokens.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule());
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import { AlphaType, ColorType, FilterMode, MipmapMode, Skia, TileMode, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import type { Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { FIXTURE_IDS, FIXTURE_INNER, FIXTURE_OUTER, actualTokens } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { BLUE_NOISE_SIZE, blueNoiseRgba } from '../blueNoise.ts';
import { buildFieldFrame } from '../fieldFrame.ts';
import { NODE, NODE_SLOTS, fieldOklab, fieldPixel, inertNode, inertShadow, type FieldFrame, type FieldNodeFrame, type QuietRect } from '../fieldLaw.ts';
import { FIELD_SKSL } from '../fieldShader.ts';
import { staticsFor } from '../statics.ts';
import { packFrame } from '../uniforms.ts';

// The field shader in real Skia (CanvasKit) on the fixture directions' paths (__fixtures__/fixtureTokens.ts),
// held to the TypeScript law pixel for pixel (±1 LSB): the outer shadow, the inner shadow and its lift,
// L only, a zero-extent face, a zero-extent ground, the quiet step path, and a builder frame of neutral
// placements with no lobe. Each case asserts its own path; none asserts never-red. The law side is
// fixturePaths.test.ts.

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

function render(frame: FieldFrame): Uint8Array {
  const surface = Skia.Surface.Make(W, H);
  if (!surface) throw new Error('no surface');
  const paint = Skia.Paint();
  paint.setDither(false);
  paint.setShader(effect.makeShaderWithChildren(packFrame(frame), [blueNoise]));
  surface.getCanvas().drawPaint(paint);
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!pixels) throw new Error('no pixels');
  return pixels as Uint8Array;
}

/** The largest per-channel difference between the render and the law, over every pixel. */
function worstDisagreement(frame: FieldFrame): number {
  const pixels = render(frame);
  let worst = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const law = fieldPixel(frame, x + 0.5, y + 0.5);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(pixels[(y * W + x) * 4 + c] - law[c]));
    }
  }
  return worst;
}
const differs = (a: FieldFrame, b: FieldFrame) => expect(Array.from(render(a))).not.toEqual(Array.from(render(b)));

/** A frame for a direction and face, with the given nodes and the direction's own mask; 64×64 with R = 24 px. */
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
    quiet: { rects: [], grow: 8 * (24 / rDp), feather: d.field.mask.quietFeather * (24 / rDp) },
    shadows: [inertShadow(), inertShadow()],
    nodes: [...nodes, ...Array.from({ length: NODE_SLOTS - nodes.length }, inertNode)],
    ...overrides,
  };
}

/** The plate's shadows as the builder makes them, at frameFor's plate (R 150 dp). */
const shadowsFor = (id: DirectionId, face: Face) => {
  const d = DIRECTIONS[id];
  const mode = Math.sign(d.plate.depth);
  return [d.plate.shadow[face], d.plate.shadow2[face]].map((t) => (t.strength !== 0 && t.blur > 0 && mode !== 0 ? { offset: -t.offsetY / 150, blur: t.blur / 150, strength: t.strength, mode } : inertShadow()));
};

const anchor = (q: 'joy' | 'calm' | 'reflective' | 'intense', face: Face) => lab(BASE.emotion[q][face === 'dark' ? 'core' : 'deep']);
const bead = (id: number, q: 'joy' | 'calm' | 'reflective' | 'intense', face: Face, at: [number, number], radius: number): FieldNodeFrame => ({
  id, fade: 1, centre: at, radius, field: scale(anchor(q, face), 0.9), halo: anchor(q, face), bead: at,
});
/** A lobe over the whole canvas, so the field is present wherever its extent lets it land. */
const wide = (face: Face): FieldNodeFrame[] => [bead(NODE.C, 'calm', face, [0.1, -0.1], 2.5)];

it('the fixture mock: the fixture ids exist, BASE and DIRECTIONS.abyss are the shipped objects', () => {
  expect(BASE).toBe(actualTokens().BASE);
  expect(DIRECTIONS.abyss).toBe(actualTokens().DIRECTIONS.abyss);
  for (const id of FIXTURE_IDS) expect(DIRECTIONS[id]).toBeDefined();
});

describe('plate shadows on the fixtures draw the law, pixel for pixel (±1 LSB)', () => {
  it.each([[FIXTURE_OUTER, 'light'], [FIXTURE_INNER, 'dark'], [FIXTURE_INNER, 'light']] as const)('%s, %s face: the plate’s shadows on the ground', (id, face) => {
    const frame = frameFor(id, face, [], { shadows: shadowsFor(id, face), grain: { inside: 0, ground: 0 } });
    expect(frame.shadows.some((sh) => sh.mode !== 0)).toBe(true);
    expect(worstDisagreement(frame)).toBeLessThanOrEqual(1);
    differs(frame, { ...frame, shadows: [inertShadow(), inertShadow()] });
  });

  it('fixture-inner, light face: the lift alone (the negative strength) draws the law, and brightens', () => {
    const shadows = shadowsFor(FIXTURE_INNER, 'light');
    expect(shadows[1].strength).toBeLessThan(0);
    const chroma: Oklab = { L: 0.4, a: 0.02, b: -0.01 };
    const frame = frameFor(FIXTURE_INNER, 'light', [], { shadows: [inertShadow(), shadows[1]], grounds: { outside: chroma, face: chroma, ring: chroma }, vignette: 0, centreLift: 0, grain: { inside: 0, ground: 0 }, dither: 0 });
    expect(worstDisagreement(frame)).toBeLessThanOrEqual(1);
    let brightest = chroma.L;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) brightest = Math.max(brightest, fieldOklab(frame, x + 0.5, y + 0.5).L);
    expect(brightest).toBeGreaterThan(chroma.L);
  });

  it.each([[FIXTURE_OUTER, 'light'], [FIXTURE_INNER, 'dark']] as const)('%s, %s face: the shadows darken L only, on a strongly chromatic ground', (id, face) => {
    const chroma: Oklab = { L: 0.62, a: 0.1, b: 0.06 };
    const frame = frameFor(id, face, [], { shadows: shadowsFor(id, face), grounds: { outside: chroma, face: chroma, ring: chroma }, vignette: 0, centreLift: 0, grain: { inside: 0, ground: 0 }, dither: 0 });
    expect(worstDisagreement(frame)).toBeLessThanOrEqual(1);
    let deepest = chroma;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const at = fieldOklab(frame, x + 0.5, y + 0.5);
      if (at.L < deepest.L) deepest = at;
    }
    expect(deepest.L).toBeLessThan(0.95 * chroma.L);
    expect([deepest.a, deepest.b]).toEqual([chroma.a, chroma.b]);
  });
});

describe('zero extents on the fixtures draw the law, pixel for pixel (±1 LSB)', () => {
  it.each([[FIXTURE_OUTER, 'face'], [FIXTURE_INNER, 'outside']] as const)('%s: the field does not land where mask.%s is 0', (id, part) => {
    for (const face of ['dark', 'light'] as Face[]) {
      const frame = frameFor(id, face, wide(face));
      expect(frame.mask[part]).toBe(0);
      expect(worstDisagreement(frame)).toBeLessThanOrEqual(1);
      differs(frame, { ...frame, mask: { ...frame.mask, [part]: 1 } });
    }
  });
});

describe('the quiet step path on fixture-inner draws the law, pixel for pixel (±1 LSB)', () => {
  const RECTS: QuietRect[] = [
    { cx: 10, cy: 8, hx: 6, hy: 2 },
    { cx: 15, cy: 12, hx: 5, hy: 3 },
    { cx: 70, cy: 40, hx: 12, hy: 4 },
    { cx: 50, cy: 58, hx: 0, hy: 0 },
  ];
  it.each(['dark', 'light'] as Face[])('fixture-inner, %s face: four zones on the step path (feather 0), the unused slots inert', (face) => {
    const frame = frameFor(FIXTURE_INNER, face, wide(face), { mask: { outside: 1, face: 1, ring: 1 } });
    expect(frame.quiet.feather).toBe(0);
    const withZones = { ...frame, quiet: { ...frame.quiet, rects: RECTS } };
    expect(worstDisagreement(withZones)).toBeLessThanOrEqual(1);
    differs(withZones, frame);
  });

  it('shadows and step-path zones together, with beads and halos, on fixture-inner dark; and on fixture-outer light with its outer shadow', () => {
    for (const [id, face] of [[FIXTURE_INNER, 'dark'], [FIXTURE_OUTER, 'light']] as const) {
      const r = DIRECTIONS[id].field.lobe.radius;
      const base = frameFor(id, face, [bead(NODE.I, 'intense', face, [-0.6, 0.6], r), bead(NODE.J, 'joy', face, [0.5, -0.7], r)], { shadows: shadowsFor(id, face) });
      const frame = { ...base, quiet: { ...base.quiet, rects: [{ cx: 32, cy: 60, hx: 20, hy: 3 }, { cx: 32, cy: 14, hx: 10, hy: 3 }] } };
      expect(worstDisagreement(frame)).toBeLessThanOrEqual(1);
    }
  });
});

describe('neutral placements with no lobe (fixture-outer): the builder’s frame draws the law (±1 LSB)', () => {
  it.each(['dark', 'light'] as Face[])('fixture-outer, %s face: only neutral placements, the rest lobes lit at fade 1', (face) => {
    const frame = buildFieldFrame(
      { direction: FIXTURE_OUTER, face, placements: [{ x: 0.01, y: -0.02, fade: 1 }, { x: 0.03, y: -0.02, fade: 0.5 }], restFade: 0, stress: 0, confidence: 1, genesis: false, tMs: 7000, breathPhase: 0.3, tier: 'full' },
      { centrePx: [31.3, 32.7], radiusPx: 24, pxPerDp: 24 / 150, fontScale: 1 },
      staticsFor(FIXTURE_OUTER, EXTENSIONS as never),
    );
    expect(frame.nodes.filter((n) => n.id === NODE.R0 && n.bead === null && n.fade > 0).map((n) => n.fade)).toEqual(staticsFor(FIXTURE_OUTER, EXTENSIONS as never).restLobes.map(() => 1));
    expect(worstDisagreement(frame)).toBeLessThanOrEqual(1);
  });
});
