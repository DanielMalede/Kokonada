jest.mock('../../tokens/tokens.generated.ts', () => {
  const tokens = require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule();
  // Q4's controls: each fixture again with every plate shadow's strength at 0 (ids '<fixture>-flat').
  const flat = (id: string) => {
    const d = JSON.parse(JSON.stringify(tokens.DIRECTIONS[id]));
    for (const s of ['shadow', 'shadow2']) for (const f of ['dark', 'light']) d.plate[s][f].strength = 0;
    return d;
  };
  return { ...tokens, DIRECTIONS: { ...tokens.DIRECTIONS, 'fixture-outer-flat': flat('fixture-outer'), 'fixture-inner-flat': flat('fixture-inner') } };
});
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AlphaType, ClipOp, ColorType, Picture, Skia, TileMode, type SkPicture } from '@shopify/react-native-skia';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { FIXTURE_INNER, FIXTURE_OUTER } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { drawFallbackField, drawFallbackGround, recordFieldFallback } from '../fallbackDraw.ts';
import { fallbackPlan, type FallbackField, type FallbackPlan } from '../fallbackModel.ts';
import { PHONE, fallbackScenes, heroLayout } from '../fallbackScenes.ts';
import { FieldFallback } from '../FieldFallback.tsx';
import type { FieldLayout, LayoutRect } from '../fieldDriver.ts';
import type { FieldStatics } from '../fieldFrame.ts';
import type { Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';

// T13, FieldFallback in real Skia (CanvasKit), against the designer's acceptance tests for Q1–Q5 (2026-11-11,
// v1b-B4-T13-designer-rulings.md, outside the repository). The fallback's picture is played as RN Skia's Canvas plays it:
// on a surface of the view's device px, under the density's scale. The model's numbers are held in fallbackModel.test.ts;
// here, the pixels.

// Skia's jest environment loads CanvasKit in its own realm, and CanvasKit's gradient factory reads the colours with
// instanceof Float32Array / Array, which arrays made in the test's realm (RN Skia's module included) fail; on the device
// JSI takes them as they are. So, at CanvasKit's own door and nowhere else, the colours are re-homed into one flat
// Float32Array of CanvasKit's realm, the form CanvasKit itself accepts. Every value passes unchanged.
beforeAll(() => {
  const ck = (globalThis as unknown as { CanvasKit: { HEAPF32: Float32Array; Shader: { MakeRadialGradient: (...args: unknown[]) => unknown } } }).CanvasKit;
  const Home = ck.HEAPF32.constructor as Float32ArrayConstructor;
  const make = ck.Shader.MakeRadialGradient.bind(ck.Shader);
  ck.Shader.MakeRadialGradient = (centre: unknown, radius: unknown, colours: unknown, ...rest: unknown[]) =>
    make(centre, radius, Array.isArray(colours) ? Home.from((colours as Float32Array[]).flatMap((c) => Array.from(c))) : colours, ...rest);
});

// Bound once: a global lookup is many times slower in jest's sandbox, and the scans below run millions of times.
const { abs, atan2, ceil, cos, floor, max, min, round, sin, sqrt } = Math;

const SK = { Skia, ClipOp, TileMode };
const ABYSS = 'abyss' as DirectionId;
const OUTER_FLAT = 'fixture-outer-flat' as DirectionId;
const INNER_FLAT = 'fixture-inner-flat' as DirectionId;
const FACES: readonly Face[] = ['dark', 'light'];
const EXT = EXTENSIONS as unknown as { base: { $root: { hero: { scenes: never } } }; abyss: { $root: { hardest: never } } };
const SCENES = fallbackScenes(EXT.base.$root.hero.scenes, EXT.abyss.$root.hardest);
const HERO_SCENES = ['rest', 'one.J', 'one.C', 'one.R', 'one.I', 'one.neutral', 'three', 'reach.top', 'reach.bottom'];
const tapsOf = (id: string): readonly Tap[] => SCENES.find((s) => s.id === id)!.taps;
const staticsOf = (id: DirectionId): FieldStatics => staticsFor(id === OUTER_FLAT ? FIXTURE_OUTER : id === INNER_FLAT ? FIXTURE_INNER : id, EXTENSIONS as never);
const hero = (id: DirectionId, fontScale = 1) => heroLayout(id, PHONE.width, PHONE.height, fontScale);
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

interface Drawn {
  readonly plan: FallbackPlan;
  readonly layout: FieldLayout;
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;
}

/** The surface's pixels, then the surface and its snapshot freed: CanvasKit's heap holds every phone-size canvas until then. */
const read = (surface: ReturnType<typeof Skia.Surface.Make>, w: number, h: number) => {
  surface!.flush();
  const image = surface!.makeImageSnapshot();
  const px = image.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
  image.dispose();
  surface!.dispose();
  return px;
};

/** The picture as RN Skia's Canvas plays it: the view's device px, under the density's scale. */
function play(picture: SkPicture, w: number, h: number, k: number): Uint8Array {
  const surface = Skia.Surface.Make(w, h)!;
  const canvas = surface.getCanvas();
  canvas.scale(k, k);
  canvas.drawPicture(picture);
  return read(surface, w, h);
}

function drawPlan(plan: FallbackPlan, layout: FieldLayout): Drawn {
  const w = round(layout.width * plan.pxPerDp);
  const h = round(layout.height * plan.pxPerDp);
  const picture = recordFieldFallback(SK, plan, layout.width, layout.height);
  const px = play(picture, w, h, plan.pxPerDp);
  picture.dispose();
  return { plan, layout, w, h, px };
}

function draw(id: DirectionId, face: Face, taps: readonly Tap[], over: { layout?: FieldLayout; pxPerDp?: number; quietPresence?: readonly number[] } = {}): Drawn {
  const layout = over.layout ?? hero(id);
  const plan = fallbackPlan({ direction: id, face, statics: staticsOf(id), taps, layout, pxPerDp: over.pxPerDp ?? PHONE.pxPerDp, quietPresence: over.quietPresence });
  return drawPlan(plan, layout);
}

/** Only the ground and the clipped gradient (the DEC's acceptance render), in device px, translated by `shift` px on both axes. */
function groundAndField(d: Drawn, shift = 0): Uint8Array {
  const surface = Skia.Surface.Make(d.w, d.h)!;
  const canvas = surface.getCanvas();
  if (shift !== 0) canvas.translate(shift, shift);
  drawFallbackGround(SK, canvas, d.plan);
  drawFallbackField(SK, canvas, d.plan);
  return read(surface, d.w, d.h);
}

const at = (d: { w: number; px: Uint8Array }, x: number, y: number) => [0, 1, 2].map((c) => d.px[4 * (y * d.w + x) + c]);
/** A pixel's distance from the plate's centre, in device px, from the layout itself. */
const radial = (d: Drawn, x: number, y: number) => {
  const dx = x + 0.5 - d.layout.centre[0] * d.plan.pxPerDp;
  const dy = y + 0.5 - d.layout.centre[1] * d.plan.pxPerDp;
  return sqrt(dx * dx + dy * dy);
};
const R = (d: Drawn) => d.layout.radius * d.plan.pxPerDp;
/** The ring's inner radius in device px, from the tokens and the layout (the builder's ringInner). */
const ringInnerPx = (d: Drawn) => (1 - max(BASE.plate.labelBand.min, BASE.plate.labelBand.min * d.layout.fontScale) / d.layout.radius) * R(d);

/** The gradient at a pixel's centre as Skia draws a clamped radial gradient: t = distance / radius, linear between the stops. */
function gradientAt(field: FallbackField, x: number, y: number, centre: readonly [number, number] = field.centre): number[] {
  const t = dist(x, y, centre) / field.radius;
  const { positions: p, colours: c } = field;
  if (t <= p[0]) return c[0].map((v) => v * 255);
  for (let i = 0; i < p.length - 1; i++) {
    if (t <= p[i + 1]) {
      const u = (t - p[i]) / (p[i + 1] - p[i]);
      return [0, 1, 2].map((ch) => (c[i][ch] + (c[i + 1][ch] - c[i][ch]) * u) * 255);
    }
  }
  return c[c.length - 1].map((v) => v * 255);
}
const near = (a: readonly number[], b: readonly number[], tol: number) => a.every((v, i) => abs(v - round(b[i])) <= tol);
const same = (a: readonly number[], b: readonly number[]) => a.every((v, i) => v === b[i]);

/** Every pixel in a region of the canvas, by a predicate on (x, y), within a bounding box. */
function pixels(d: Drawn, keep: (x: number, y: number) => boolean, box?: { x0: number; y0: number; x1: number; y1: number }): Array<readonly [number, number]> {
  const b = box ?? { x0: 0, y0: 0, x1: d.w, y1: d.h };
  const out: Array<readonly [number, number]> = [];
  for (let y = max(0, b.y0); y < min(d.h, b.y1); y++) for (let x = max(0, b.x0); x < min(d.w, b.x1); x++) if (keep(x, y)) out.push([x, y]);
  return out;
}
const dist = (x: number, y: number, c: readonly [number, number]) => {
  const dx = x + 0.5 - c[0];
  const dy = y + 0.5 - c[1];
  return sqrt(dx * dx + dy * dy);
};
/** The plate's bounding box with a margin, in device px. */
const plateBox = (d: Drawn, margin: number) => {
  const [cx, cy] = [d.layout.centre[0] * d.plan.pxPerDp, d.layout.centre[1] * d.plan.pxPerDp];
  const r = R(d) + margin;
  return { x0: floor(cx - r), y0: floor(cy - r), x1: ceil(cx + r), y1: ceil(cy + r) };
};

/** A zone's grown bounding box in device px, a pixel wider on each side. */
const zoneBox = (zone: LayoutRect, k: number) => {
  const g = BASE.quiet.grow;
  return { x0: floor((zone.x - g) * k) - 1, y0: floor((zone.y - g) * k) - 1, x1: ceil((zone.x + zone.width + g) * k) + 1, y1: ceil((zone.y + zone.height + g) * k) + 1 };
};

/** A zone's signed distance at a pixel's centre (r3 §1, sdBox − grow), in device px, written out. */
function sdOf(zone: LayoutRect, k: number, x: number, y: number): number {
  const qx = abs(x + 0.5 - (zone.x + zone.width / 2) * k) - (zone.width / 2) * k;
  const qy = abs(y + 0.5 - (zone.y + zone.height / 2) * k) - (zone.height / 2) * k;
  const ox = max(qx, 0);
  const oy = max(qy, 0);
  return sqrt(ox * ox + oy * oy) + min(max(qx, qy), 0) - BASE.quiet.grow * k;
}

describe('Q1: on Abyss the field shows only in the lens', () => {
  it.each(FACES.flatMap((face) => [1, 2].map((fs) => [face, fs] as const)))('%s, font scale %d, every hero scene: every pixel at d ≥ R + 1.5 px is the ground, exactly', (face, fontScale) => {
    const ground = rgbOf(DIRECTIONS[ABYSS].color[face].ground.hex);
    const word = new Uint32Array(Uint8Array.of(ground[0], ground[1], ground[2], 255).buffer)[0];
    for (const scene of HERO_SCENES) {
      const d = draw(ABYSS, face, tapsOf(scene), { layout: hero(ABYSS, fontScale) });
      expect(d.plan.field).not.toBeNull();
      const words = new Uint32Array(d.px.buffer, d.px.byteOffset, d.w * d.h);
      const [cx, cy, reach] = [d.layout.centre[0] * d.plan.pxPerDp, d.layout.centre[1] * d.plan.pxPerDp, R(d) + 1.5];
      let checked = 0;
      let off = '';
      for (let y = 0; y < d.h; y++) {
        const dy = y + 0.5 - cy;
        // The row's pixels with d < R + 1.5 lie in [inLo, inHi); every other pixel of the row is checked.
        const half = dy * dy < reach * reach ? sqrt(reach * reach - dy * dy) : -1;
        const inLo = half < 0 ? d.w : max(0, floor(cx - half - 0.5));
        const inHi = half < 0 ? d.w : min(d.w, ceil(cx + half - 0.5) + 1);
        for (let x = 0; x < d.w; x++) {
          if (x >= inLo && x < inHi) {
            const dx = x + 0.5 - cx;
            if (dx * dx + dy * dy < reach * reach) continue;
          }
          checked++;
          if (words[y * d.w + x] !== word && !off) off = `${scene}: (${x}, ${y}) ${at(d, x, y).join(', ')}`;
        }
      }
      expect(off).toBe('');
      expect(checked).toBeGreaterThan(d.w * d.h * 0.5);
    }
  });
});

describe('Q1: no mixing at the clip edge (the ground and the clipped gradient only)', () => {
  it.each([ABYSS, FIXTURE_INNER].flatMap((id) => FACES.map((face) => [id, face] as const)))('%s %s: within 2 px of the face’s clip circle, each pixel is the ground ±1 or the gradient ±1', (id, face) => {
    for (const scene of ['one.C.right', 'one.J.top']) {
      const d = draw(id, face, tapsOf(scene));
      const px = { w: d.w, px: groundAndField(d) };
      const ground = rgbOf(DIRECTIONS[id].color[face].ground.hex);
      const bound = ringInnerPx(d) + d.plan.pxPerDp;
      let lit = 0;
      const bad: string[] = [];
      for (const [x, y] of pixels(d, (i, j) => abs(radial(d, i, j) - bound) <= 2, plateBox(d, 0))) {
        const model = gradientAt(d.plan.field!, x, y);
        const got = at(px, x, y);
        if (near(got, ground, 1)) continue;
        if (near(got, model, 1)) {
          if (!near(model, ground, 4)) lit++;
          continue;
        }
        if (bad.length < 3) bad.push(`${scene} (${x}, ${y}) got ${got.join(', ')} gradient ${model.map(Math.round).join(', ')} ground ${ground.join(', ')}`);
      }
      expect(bad).toEqual([]);
      expect(lit).toBeGreaterThan(20);
    }
  });

  // RA-30 (UI-212): on the shipped path every clip edge lies on a whole device pixel, so the clip's doAntiAlias flag cannot
  // show there. A quarter-pixel translate puts each edge a quarter into a pixel: an aliased clip still decides every pixel
  // whole, an anti-aliased one mixes the gradient with the ground along the whole boundary.
  it.each([ABYSS, FIXTURE_INNER].flatMap((id) => FACES.map((face) => [id, face] as const)))('%s %s, translated by a quarter pixel: the clip edge holds only the ground or the gradient (mixed 0, lit > 20)', (id, face) => {
    const SHIFT = 0.25;
    for (const scene of ['one.C.right', 'one.J.top']) {
      const d = draw(id, face, tapsOf(scene));
      const px = { w: d.w, px: groundAndField(d, SHIFT) };
      const ground = rgbOf(DIRECTIONS[id].color[face].ground.hex);
      const bound = ringInnerPx(d) + d.plan.pxPerDp;
      const centre: readonly [number, number] = [d.plan.field!.centre[0] + SHIFT, d.plan.field!.centre[1] + SHIFT];
      const plate: readonly [number, number] = [d.layout.centre[0] * d.plan.pxPerDp + SHIFT, d.layout.centre[1] * d.plan.pxPerDp + SHIFT];
      let lit = 0;
      let mixed = 0;
      const bad: string[] = [];
      for (const [x, y] of pixels(d, (i, j) => abs(dist(i, j, plate) - bound) <= 2, plateBox(d, 1))) {
        const model = gradientAt(d.plan.field!, x, y, centre);
        const got = at(px, x, y);
        if (near(got, ground, 1)) continue;
        if (near(got, model, 1)) {
          if (!near(model, ground, 4)) lit++;
          continue;
        }
        mixed++;
        if (bad.length < 3) bad.push(`${scene} (${x}, ${y}) got ${got.join(', ')} gradient ${model.map(Math.round).join(', ')} ground ${ground.join(', ')}`);
      }
      expect({ mixed, bad }).toEqual({ mixed: 0, bad: [] });
      expect(lit).toBeGreaterThan(20);
    }
  });
});

describe('Q1: a zone inside the lens', () => {
  it.each([ABYSS, FIXTURE_INNER].flatMap((id) => FACES.map((face) => [id, face] as const)))('%s %s: every pixel with sd ≤ 0 is plate.face exactly; just outside the grown edge the gradient', (id, face) => {
    const base = hero(id);
    const r = base.radius;
    const zone: LayoutRect = { x: base.centre[0] - 0.7 * r, y: base.centre[1] - 12, width: 1.4 * r, height: 24 };
    const d = draw(id, face, tapsOf('one.J'), { layout: { ...base, quietRects: [...(base.quietRects ?? []), zone] } });
    const faceRgb = rgbOf(DIRECTIONS[id].color[face].plate.face.hex);
    const interior = ringInnerPx(d) - 1.5;
    let inside = 0;
    let edge = 0;
    const bad: string[] = [];
    for (const [x, y] of pixels(d, (i, j) => radial(d, i, j) < interior, plateBox(d, 0))) {
      const sd = sdOf(zone, d.plan.pxPerDp, x, y);
      const got = at(d, x, y);
      if (sd <= 0) {
        inside++;
        if (!same(got, faceRgb) && bad.length < 3) bad.push(`in (${x}, ${y}) sd ${sd.toFixed(3)} got ${got.join(', ')}`);
      } else if (sd <= 2) {
        const model = gradientAt(d.plan.field!, x, y);
        if (near(model, faceRgb, 3)) continue;
        edge++;
        if (!near(got, model, 1) && bad.length < 3) bad.push(`edge (${x}, ${y}) sd ${sd.toFixed(3)} got ${got.join(', ')} gradient ${model.map(Math.round).join(', ')}`);
      }
    }
    expect(bad).toEqual([]);
    expect(inside).toBeGreaterThan(1000);
    expect(edge).toBeGreaterThan(50);
  });
});

describe('the fixtures: fixture-inner draws its floor as the face; fixture-outer the outside beyond the moat', () => {
  it.each(FACES)('fixture-outer %s: inside the moat, every pixel off the ring is the ground (the moat) or plate.face (the dish)', (face) => {
    const c = DIRECTIONS[FIXTURE_OUTER].color[face];
    const [ground, dish] = [rgbOf(c.ground.hex), rgbOf(c.plate.face.hex)];
    for (const scene of ['rest', 'three', 'one.I']) {
      const d = draw(FIXTURE_OUTER, face, tapsOf(scene));
      const moat = (1 + DIRECTIONS[FIXTURE_OUTER].field.mask.moat / d.layout.radius) * R(d);
      const bad: string[] = [];
      let dishes = 0;
      let moats = 0;
      for (const [x, y] of pixels(d, () => true, plateBox(d, moat - R(d) + 2))) {
        const r = radial(d, x, y);
        if (r < ringInnerPx(d) - 1.5) {
          dishes++;
          if (!same(at(d, x, y), dish) && bad.length < 3) bad.push(`dish (${x}, ${y}) ${at(d, x, y).join(', ')}`);
        } else if (r > R(d) + 1.5 && r <= moat) {
          moats++;
          if (!same(at(d, x, y), ground) && bad.length < 3) bad.push(`moat (${x}, ${y}) ${at(d, x, y).join(', ')}`);
        }
      }
      expect(bad).toEqual([]);
      expect([dishes > 1000, moats > 100]).toEqual([true, true]);
    }
  });

  it.each(FACES)('fixture-outer %s, three and one.I: every pixel inside every grown zone is the ground (r3’s S6 zone test, on the fixture)', (face) => {
    const ground = rgbOf(DIRECTIONS[FIXTURE_OUTER].color[face].ground.hex);
    let reached = 0;
    for (const scene of ['three', 'one.I']) {
      const d = draw(FIXTURE_OUTER, face, tapsOf(scene));
      const bad: string[] = [];
      for (const zone of d.layout.quietRects!) {
        for (const [x, y] of pixels(d, (i, j) => sdOf(zone, d.plan.pxPerDp, i, j) <= 0 && radial(d, i, j) > R(d) + 1.5, zoneBox(zone, d.plan.pxPerDp))) {
          if (reached <= 100 && !near(gradientAt(d.plan.field!, x, y), ground, 3)) reached++;
          if (!same(at(d, x, y), ground) && bad.length < 3) bad.push(`${scene} (${x}, ${y}) ${at(d, x, y).join(', ')}`);
        }
      }
      expect(bad).toEqual([]);
    }
    // Not vacuous: the gradient reaches into the zones, so a zone left in would show.
    expect(reached).toBeGreaterThan(100);
  });
});

describe('Q2: presence is hard (fixture-outer, region outside, scene three, the hero’s rects)', () => {
  const layout = hero(FIXTURE_OUTER);
  const zones = layout.quietRects!;
  const CTA = 4;
  const ones = zones.map(() => 1);
  const with4 = (p: number) => zones.map((_, i) => (i === CTA ? p : 1));
  const dark = (presence?: readonly number[], rects: readonly LayoutRect[] = zones) => draw(FIXTURE_OUTER, 'dark', tapsOf('three'), { layout: { ...layout, quietRects: rects }, quietPresence: presence });
  const ground = rgbOf(DIRECTIONS[FIXTURE_OUTER].color.dark.ground.hex);
  const removed = (d: Drawn, zone: LayoutRect) => {
    let reached = 0;
    const bad: string[] = [];
    for (const [x, y] of pixels(d, (i, j) => sdOf(zone, d.plan.pxPerDp, i, j) <= 0 && radial(d, i, j) > R(d) + 1.5, zoneBox(zone, d.plan.pxPerDp))) {
      if (!near(gradientAt(d.plan.field!, x, y), ground, 3)) reached++;
      if (!same(at(d, x, y), ground) && bad.length < 3) bad.push(`(${x}, ${y}) ${at(d, x, y).join(', ')}`);
    }
    return { reached, bad };
  };

  it('the CTA’s zone is in the gradient’s reach (not vacuous)', () => {
    expect(removed(dark(with4(1)), zones[CTA]).reached).toBeGreaterThan(100);
  });

  it.each([1, 0.5, 1e-6])('presence %d removes the whole grown zone: every pixel with sd ≤ 0 is the ground, exactly', (p) => {
    expect(removed(dark(with4(p)), zones[CTA]).bad).toEqual([]);
  });

  it('presence 0 is byte for byte the render with that rect removed', () => {
    const zero = dark(with4(0));
    const gone = dark(undefined, zones.filter((_, i) => i !== CTA));
    expect(Buffer.from(zero.px).equals(Buffer.from(gone.px))).toBe(true);
    expect(Buffer.from(zero.px).equals(Buffer.from(dark(ones).px))).toBe(false);
  });

  it.each([['NaN', Number.NaN], ['−0.1', -0.1], ['+Infinity', Number.POSITIVE_INFINITY]] as const)('presence %s is byte for byte presence 1', (_label, p) => {
    expect(Buffer.from(dark(with4(p)).px).equals(Buffer.from(dark(ones).px))).toBe(true);
  });

  it('a presence list one short counts the last rect as present: byte for byte presence 1', () => {
    expect(Buffer.from(dark(ones.slice(0, -1)).px).equals(Buffer.from(dark(ones).px))).toBe(true);
  });

  it.each([
    ['a NaN centre', { x: Number.NaN, y: 100, width: 10, height: 6 }],
    ['hx −1', { x: 20, y: 100, width: -2, height: 6 }],
  ])('a rect with %s: the no-field render (the ground, the face and the ring), and nothing throws', (_label, bad) => {
    const d = dark(ones.concat(1), [...zones, bad]);
    expect(d.plan.field).toBeNull();
    const noField = drawPlan({ ...dark(ones).plan, field: null }, layout);
    expect(Buffer.from(d.px).equals(Buffer.from(noField.px))).toBe(true);
  });

  it('seven rects: all seven removed, none clamped', () => {
    const extra: LayoutRect[] = [
      { x: 4, y: layout.centre[1] + layout.radius + 40, width: 20, height: 20 },
      { x: 30, y: layout.centre[1] + layout.radius - 10, width: 16, height: 12 },
    ];
    const seven = [...zones, ...extra];
    const d = dark(undefined, seven);
    for (const zone of extra) {
      const { reached, bad } = removed(d, zone);
      expect(bad).toEqual([]);
      expect(reached).toBeGreaterThan(20);
    }
  });
});

describe('Q3: the plate surfaces, flat, the ring opaque and anti-aliased', () => {
  const ABYSS_AND_FIXTURES = [ABYSS, FIXTURE_INNER, FIXTURE_OUTER].flatMap((id) => FACES.map((face) => [id, face] as const));

  it.each(ABYSS_AND_FIXTURES)('%s %s: the ring’s interior, 1.5 px from both edges, is plate.ring exactly', (id, face) => {
    const ring = rgbOf(DIRECTIONS[id].color[face].plate.ring.hex);
    for (const scene of ['rest', 'one.C.right', 'one.J.top']) {
      const d = draw(id, face, tapsOf(scene));
      let n = 0;
      const bad: string[] = [];
      for (const [x, y] of pixels(d, (i, j) => radial(d, i, j) >= ringInnerPx(d) + 1.5 && radial(d, i, j) <= R(d) - 1.5, plateBox(d, 0))) {
        n++;
        if (!same(at(d, x, y), ring) && bad.length < 3) bad.push(`${scene} (${x}, ${y}) ${at(d, x, y).join(', ')}`);
      }
      expect(bad).toEqual([]);
      expect(n).toBeGreaterThan(1000);
    }
  });

  it.each(FACES)('Abyss %s, one.C at the right edge: a lens pixel the gradient does not reach is plate.face exactly (no vignette, no lift)', (face) => {
    const d = draw(ABYSS, face, tapsOf('one.C.right'));
    const flat = rgbOf(DIRECTIONS[ABYSS].color[face].plate.face.hex);
    const reach = 1.3338 * R(d) + 1;
    let n = 0;
    const bad: string[] = [];
    for (const [x, y] of pixels(d, (i, j) => radial(d, i, j) < ringInnerPx(d) - 1.5 && dist(i, j, d.plan.field!.centre) >= reach, plateBox(d, 0))) {
      n++;
      if (!same(at(d, x, y), flat) && bad.length < 3) bad.push(`(${x}, ${y}) ${at(d, x, y).join(', ')}`);
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(1000);
  });

  it.each(FACES)('Abyss %s, rest and one.C at the right edge: at or beyond 1.3338 R from the gradient’s centre the lens is plate.face exactly', (face) => {
    const flat = rgbOf(DIRECTIONS[ABYSS].color[face].plate.face.hex);
    for (const scene of ['rest', 'one.C.right']) {
      const d = draw(ABYSS, face, tapsOf(scene));
      const bad: string[] = [];
      for (const [x, y] of pixels(d, (i, j) => radial(d, i, j) < ringInnerPx(d) - 1.5 && dist(i, j, d.plan.field!.centre) >= 1.3338 * R(d), plateBox(d, 0))) {
        if (!same(at(d, x, y), flat) && bad.length < 3) bad.push(`${scene} (${x}, ${y}) ${at(d, x, y).join(', ')}`);
      }
      expect(bad).toEqual([]);
    }
  });

  /** The ring's inner circle within 30° of the lobe, in 8 px arc steps: each pixel within `band` px of it, by step. */
  function innerArc(d: Drawn, band: number): Array<Array<readonly [number, number]>> {
    const [cx, cy] = [d.layout.centre[0] * d.plan.pxPerDp, d.layout.centre[1] * d.plan.pxPerDp];
    const rIn = ringInnerPx(d);
    const lobe = atan2(d.plan.field!.centre[1] - cy, d.plan.field!.centre[0] - cx);
    const span = (30 * Math.PI) / 180;
    const step = 8 / rIn;
    const steps: Array<Array<readonly [number, number]>> = Array.from({ length: floor((2 * span) / step) }, () => []);
    for (const [x, y] of pixels(d, (i, j) => abs(radial(d, i, j) - rIn) <= band, plateBox(d, 0))) {
      let rel = atan2(y + 0.5 - cy, x + 0.5 - cx) - lobe;
      rel = atan2(sin(rel), cos(rel));
      const i = floor((rel + span) / step);
      if (i >= 0 && i < steps.length) steps[i].push([x, y]);
    }
    return steps;
  }

  it.each(FACES)('Abyss %s, the bright edge: every 8 px of the ring’s inner circle within 30° of the lobe holds a pixel strictly between plate.ring and the gradient', (face) => {
    const d = draw(ABYSS, face, tapsOf('one.C.right'));
    const ring = rgbOf(DIRECTIONS[ABYSS].color[face].plate.ring.hex);
    const steps = innerArc(d, 1);
    expect(steps.length).toBeGreaterThan(20);
    const empty = steps
      .map((step, i) => ({ i, ok: step.some(([x, y]) => {
        const model = gradientAt(d.plan.field!, x, y).map(Math.round);
        const got = at(d, x, y);
        return [0, 1, 2].some((c) => abs(model[c] - ring[c]) >= 2 && got[c] > min(model[c], ring[c]) && got[c] < max(model[c], ring[c]));
      }) }))
      .filter((s) => !s.ok)
      .map((s) => s.i);
    expect(empty).toEqual([]);
  });

  it.each([ABYSS, FIXTURE_INNER].flatMap((id) => FACES.map((face) => [id, face] as const)))('%s %s: the 1 dp under the ring: within 1.5 px of its inner circle each pixel lies between plate.ring and the gradient, ±1', (id, face) => {
    const ring = rgbOf(DIRECTIONS[id].color[face].plate.ring.hex);
    for (const scene of ['one.C.right', 'one.J.top']) {
      const d = draw(id, face, tapsOf(scene));
      const bad: string[] = [];
      let n = 0;
      for (const [x, y] of pixels(d, (i, j) => abs(radial(d, i, j) - ringInnerPx(d)) <= 1.5, plateBox(d, 0))) {
        n++;
        const model = gradientAt(d.plan.field!, x, y);
        const got = at(d, x, y);
        const ok = [0, 1, 2].every((c) => got[c] >= min(model[c], ring[c]) - 1 && got[c] <= max(model[c], ring[c]) + 1);
        if (!ok && bad.length < 3) bad.push(`${scene} (${x}, ${y}) got ${got.join(', ')} ring ${ring.join(', ')} gradient ${model.map(Math.round).join(', ')}`);
      }
      expect(bad).toEqual([]);
      expect(n).toBeGreaterThan(500);
    }
  });

  it.each(FACES)('Abyss %s, one.C at the right edge: the gradient is drawn undithered, each channel moving one way inside each stop interval along its row', (face) => {
    const d = draw(ABYSS, face, tapsOf('one.C.right'));
    const field = d.plan.field!;
    const row = floor(field.centre[1]);
    const x0 = floor(field.centre[0]);
    let varied = 0;
    for (const dir of [1, -1]) {
      const runs = new Map<number, number[][]>();
      for (let x = x0; x >= 0 && x < d.w; x += dir) {
        if (!(radial(d, x, row) < ringInnerPx(d) - 2)) continue;
        const t = dist(x, row, field.centre) / field.radius;
        const interval = field.positions.findIndex((p, i) => i < field.positions.length - 1 && t >= p && t <= field.positions[i + 1]);
        if (interval < 0) continue;
        if (!runs.has(interval)) runs.set(interval, []);
        runs.get(interval)!.push(at(d, x, row));
      }
      for (const values of runs.values()) {
        for (let c = 0; c < 3; c++) {
          const series = values.map((v) => v[c]);
          const up = series.every((v, i) => i === 0 || v >= series[i - 1]);
          const down = series.every((v, i) => i === 0 || v <= series[i - 1]);
          expect(up || down).toBe(true);
          if (new Set(series).size >= 3) varied++;
        }
      }
    }
    expect(varied).toBeGreaterThan(0);
  });
});

describe('Q4: no plate shadows in the fallback', () => {
  it.each([[FIXTURE_OUTER, OUTER_FLAT], [FIXTURE_INNER, INNER_FLAT]] as const)('%s: every hero scene on both faces is byte for byte the same fixture with every shadow strength at 0', (id, flatId) => {
    const shadows = DIRECTIONS[id].plate;
    expect([shadows.shadow.light.strength, shadows.shadow2.light.strength].some((s) => s !== 0)).toBe(true);
    for (const face of FACES) {
      for (const scene of HERO_SCENES) {
        const layout = heroLayout(id, PHONE.width, PHONE.height, 1);
        const a = draw(id, face, tapsOf(scene), { layout, pxPerDp: 1 });
        const b = draw(flatId, face, tapsOf(scene), { layout, pxPerDp: 1 });
        expect(Buffer.from(a.px).equals(Buffer.from(b.px))).toBe(true);
      }
    }
  });
});

describe('Q5 (iv) in pixels: Abyss light at rest is one gradient at the rest lobes’ centroid', () => {
  it('every lens pixel is the single gradient at (0.025, 0.025) R, ±1', () => {
    const d = draw(ABYSS, 'light', tapsOf('rest'));
    const k = d.plan.pxPerDp;
    const centre: readonly [number, number] = [(d.layout.centre[0] + 0.025 * d.layout.radius) * k, (d.layout.centre[1] - 0.025 * d.layout.radius) * k];
    let n = 0;
    const bad: string[] = [];
    for (const [x, y] of pixels(d, (i, j) => radial(d, i, j) < ringInnerPx(d) - 1.5, plateBox(d, 0))) {
      n++;
      const model = gradientAt(d.plan.field!, x, y, centre);
      if (!near(at(d, x, y), model, 1) && bad.length < 3) bad.push(`(${x}, ${y}) got ${at(d, x, y).join(', ')} want ${model.map(Math.round).join(', ')}`);
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(100000);
  });
});

describe('FieldFallback: one sRGB canvas holding one picture, no React Native View painting a colour (UI-204)', () => {
  it.each(FACES)('Abyss %s, three: the picture is the plan’s, byte for byte', (face) => {
    const layout = hero(ABYSS);
    const props = { direction: ABYSS, face, statics: staticsOf(ABYSS), taps: tapsOf('three'), layout, pxPerDp: PHONE.pxPerDp, reason: 'planted' };
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<FieldFallback {...props} />);
    });
    const canvases = tree.root.findAll((n) => typeof n.type !== 'string' && n.props.colorSpace !== undefined);
    expect(canvases).toHaveLength(1);
    expect(canvases[0].props.colorSpace).toBe('srgb');
    expect(canvases[0].props.opaque).toBeFalsy();
    expect(canvases[0].props.style).toEqual({ width: layout.width, height: layout.height });
    const pictures = tree.root.findAllByType(Picture);
    expect(pictures).toHaveLength(1);
    const coloured = tree.root.findAll((n) => {
      const style = [n.props.style].flat(Infinity) as Array<Record<string, unknown> | undefined>;
      return style.some((s) => s !== undefined && s !== null && 'backgroundColor' in s);
    });
    expect(coloured).toEqual([]);
    const w = round(layout.width * PHONE.pxPerDp);
    const h = round(layout.height * PHONE.pxPerDp);
    const shown = play(pictures[0].props.picture, w, h, PHONE.pxPerDp);
    const planned = drawPlan(fallbackPlan(props), layout);
    expect(Buffer.from(shown).equals(Buffer.from(planned.px))).toBe(true);
    act(() => tree.unmount());
  });

  // Q5: on a change of placement or presence the fallback redraws at once, and never crossfades.
  it('a new tap, then a zone leaving the lens: each redraws at once, the picture its own props’ plan, byte for byte', () => {
    const plain = hero(ABYSS);
    const zone: LayoutRect = { x: plain.centre[0] - 40, y: plain.centre[1] - 10, width: 80, height: 20 };
    const layout: FieldLayout = { ...plain, quietRects: [...(plain.quietRects ?? []), zone] };
    const base = { direction: ABYSS, face: 'dark' as Face, statics: staticsOf(ABYSS), layout, pxPerDp: PHONE.pxPerDp, reason: 'planted' };
    const steps = [
      { taps: tapsOf('one.J'), quietPresence: [1, 1, 1, 1, 1, 1] },
      { taps: tapsOf('one.C'), quietPresence: [1, 1, 1, 1, 1, 1] },
      { taps: tapsOf('one.C'), quietPresence: [1, 1, 1, 1, 1, 0] },
    ];
    const w = round(layout.width * PHONE.pxPerDp);
    const h = round(layout.height * PHONE.pxPerDp);
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<FieldFallback {...base} {...steps[0]} />);
    });
    let previous: Uint8Array | null = null;
    steps.forEach((step, i) => {
      if (i > 0) act(() => tree.update(<FieldFallback {...base} {...step} />));
      const shown = play(tree.root.findByType(Picture).props.picture, w, h, PHONE.pxPerDp);
      expect(Buffer.from(shown).equals(Buffer.from(drawPlan(fallbackPlan({ ...base, ...step }), layout).px))).toBe(true);
      if (previous !== null) expect(Buffer.from(shown).equals(Buffer.from(previous))).toBe(false);
      previous = shown;
    });
    act(() => tree.unmount());
  });
});

describe('RA-32 (UI-213): degenerate input draws no field and never throws (Q2: malformed input means no field)', () => {
  const layout = hero(ABYSS);
  const k = PHONE.pxPerDp;
  const w = round(layout.width * k);
  const h = round(layout.height * k);
  const taps = tapsOf('one.J');
  const statics = staticsOf(ABYSS);
  type Input = Parameters<typeof fallbackPlan>[0];
  const input = (over: Partial<Input> = {}): Input => ({ direction: ABYSS, face: 'dark', statics, taps, layout, pxPerDp: k, ...over });
  /** The plan and its picture as FieldFallback makes them, played as RN Skia's Canvas plays it at the device's density. */
  const shown = (i: Input) => {
    const plan = fallbackPlan(i);
    const picture = recordFieldFallback(SK, plan, i.layout.width, i.layout.height);
    const px = i.layout.width > 0 && i.layout.height > 0 ? play(picture, w, h, k) : null;
    picture.dispose();
    return { plan, px };
  };
  /** The same scene with no field: the ground, the face material and the ring only. */
  const plateOnly = () => drawPlan({ ...fallbackPlan(input()), field: null }, layout).px;
  const face = rgbOf(DIRECTIONS[ABYSS].color.dark.plate.face.hex);

  it.each([['0', 0], ['NaN', Number.NaN], ['−1', -1], ['+Infinity', Number.POSITIVE_INFINITY]] as const)('pxPerDp %s: no field; the ground, the face and the ring drawn in dp (to the pixel off their edges)', (_label, bad) => {
    let got!: ReturnType<typeof shown>;
    expect(() => {
      got = shown(input({ pxPerDp: bad }));
    }).not.toThrow();
    expect(got.plan.field).toBeNull();
    expect([Number.isFinite(got.plan.size.width), Number.isFinite(got.plan.size.height)]).toEqual([true, true]);
    const want = plateOnly();
    const R0 = layout.radius * k;
    const edges = [got.plan.face.radius * k, got.plan.ring.inner * k, R0];
    let compared = 0;
    const off: string[] = [];
    const [cx, cy] = [layout.centre[0] * k, layout.centre[1] * k];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = dist(x, y, [cx, cy]);
        if (edges.some((e) => abs(r - e) <= 2)) continue;
        compared++;
        const i = 4 * (y * w + x);
        if ((got.px![i] !== want[i] || got.px![i + 1] !== want[i + 1] || got.px![i + 2] !== want[i + 2]) && off.length < 3) off.push(`(${x}, ${y}) ${[got.px![i], got.px![i + 1], got.px![i + 2]].join(', ')}`);
      }
    }
    expect(off).toEqual([]);
    expect(compared).toBeGreaterThan(w * h * 0.9);
    expect(at({ w, px: got.px! }, round(cx), round(cy))).toEqual(face);
  });

  it.each([['width', { width: 0 }], ['height', { height: 0 }], ['width and height', { width: 0, height: 0 }]] as const)('layout %s 0: no field, a finite canvas, and the recording does not throw (the view has no area: nothing shows)', (_label, size) => {
    let got!: ReturnType<typeof shown>;
    expect(() => {
      got = shown(input({ layout: { ...layout, ...size } }));
    }).not.toThrow();
    expect(got.plan.field).toBeNull();
    expect([Number.isFinite(got.plan.size.width), Number.isFinite(got.plan.size.height)]).toEqual([true, true]);
  });

  it.each([['one stop', { position: [0], weight: [1] }], ['no stops', { position: [], weight: [] }]] as const)('%s: no field (the device throws on fewer than two gradient colours); byte for byte the plate-only render', (_label, stops) => {
    let got!: ReturnType<typeof shown>;
    expect(() => {
      got = shown(input({ statics: { ...statics, fallbackStops: stops } }));
    }).not.toThrow();
    expect(got.plan.field).toBeNull();
    expect(Buffer.from(got.px!).equals(Buffer.from(plateOnly()))).toBe(true);
  });

  it('NaN tap coordinates: the field at the tap read as 0 there (the builder’s own rule), byte for byte', () => {
    let got!: ReturnType<typeof shown>;
    expect(() => {
      got = shown(input({ taps: [{ x: Number.NaN, y: 0.3 }, { x: 0.4, y: Number.NaN }] }));
    }).not.toThrow();
    expect(got.plan.field).not.toBeNull();
    expect(got.plan.field!.centre.every(Number.isFinite)).toBe(true);
    const zeroed = shown(input({ taps: [{ x: 0, y: 0.3 }, { x: 0.4, y: 0 }] }));
    expect(Buffer.from(got.px!).equals(Buffer.from(zeroed.px!))).toBe(true);
    expect(Buffer.from(got.px!).equals(Buffer.from(plateOnly()))).toBe(false);
  });

  it('a presence list longer than the rects: the extra entries read nowhere, byte for byte the list of the rects’ length', () => {
    const n = layout.quietRects!.length;
    let got!: ReturnType<typeof shown>;
    expect(() => {
      got = shown(input({ quietPresence: Array.from({ length: n + 6 }, (_, i) => (i < n ? 1 : 0)) }));
    }).not.toThrow();
    expect(Buffer.from(got.px!).equals(Buffer.from(shown(input({ quietPresence: Array.from({ length: n }, () => 1) })).px!))).toBe(true);
  });
});

describe('RA-31 (UI-206): the fallback frees what it records', () => {
  /** The types RN Skia's API declares disposable (SkJSIInstance); rects, points and rrects are value types there. */
  const DISPOSABLE = new Set(['Paint', 'Shader', 'Path', 'PathBuilder', 'PictureRecorder', 'Picture']);
  interface Made { readonly type: string; readonly dispose: jest.SpyInstance }

  /** The real Skia behind a proxy that spies on every disposable it, or anything it made, hands out. */
  function tracking(): { sk: typeof SK; made: Made[] } {
    const made: Made[] = [];
    const track = (v: unknown): unknown => {
      if (v === null || typeof v !== 'object') return v;
      const o = v as { __typename__?: unknown; dispose?: unknown } & Record<string, unknown>;
      if (typeof o.__typename__ !== 'string' || typeof o.dispose !== 'function' || !DISPOSABLE.has(o.__typename__)) return v;
      made.push({ type: o.__typename__, dispose: jest.spyOn(o as { dispose(): void }, 'dispose') });
      for (const m of ['detach', 'finishRecordingAsPicture']) {
        const f = o[m];
        if (typeof f === 'function') o[m] = (...args: unknown[]) => track((f as (...a: unknown[]) => unknown).apply(o, args));
      }
      return v;
    };
    const api = (target: object): object =>
      new Proxy(target, {
        get(t, p) {
          const v = Reflect.get(t, p);
          if (typeof v === 'function') return (...args: unknown[]) => track((v as (...a: unknown[]) => unknown).apply(t, args));
          if (v !== null && typeof v === 'object' && !('__typename__' in v) && !ArrayBuffer.isView(v)) return api(v);
          return v;
        },
      });
    return { sk: { Skia: api(Skia) as typeof Skia, ClipOp, TileMode }, made };
  }

  it.each([['three', false], ['three with no field', true]] as const)('recordFieldFallback, %s: every paint, shader, path, builder and the recorder disposed once before it returns; the picture not, and it plays the plan', (_label, noField) => {
    const layout = hero(ABYSS);
    const planned = fallbackPlan({ direction: ABYSS, face: 'dark', statics: staticsOf(ABYSS), taps: tapsOf('three'), layout, pxPerDp: PHONE.pxPerDp });
    const plan = noField ? { ...planned, field: null } : planned;
    const { sk, made } = tracking();
    const picture = recordFieldFallback(sk, plan, layout.width, layout.height);
    const count = (type: string) => made.filter((m) => m.type === type).length;
    expect([count('Picture'), count('PictureRecorder')]).toEqual([1, 1]);
    expect(count('Paint')).toBe(noField ? 3 : 4);
    expect([count('Shader'), count('PathBuilder'), count('Path')]).toEqual(noField ? [0, 0, 0] : [1, 1, 1]);
    const undisposed = made.filter((m) => m.type !== 'Picture' && m.dispose.mock.calls.length !== 1).map((m) => `${m.type} ×${m.dispose.mock.calls.length}`);
    expect(undisposed).toEqual([]);
    expect(made.find((m) => m.type === 'Picture')!.dispose).not.toHaveBeenCalled();
    const w = round(layout.width * PHONE.pxPerDp);
    const h = round(layout.height * PHONE.pxPerDp);
    const shown = play(picture, w, h, PHONE.pxPerDp);
    expect(Buffer.from(shown).equals(Buffer.from(drawPlan(plan, layout).px))).toBe(true);
    picture.dispose();
  });

  it('FieldFallback disposes each replaced picture once, its last once on unmount, and never the picture it shows', () => {
    const layout = hero(ABYSS);
    const base = { direction: ABYSS, face: 'dark' as Face, statics: staticsOf(ABYSS), layout, pxPerDp: PHONE.pxPerDp, reason: 'planted' };
    const w = round(layout.width * PHONE.pxPerDp);
    const h = round(layout.height * PHONE.pxPerDp);
    let tree!: ReactTestRenderer.ReactTestRenderer;
    const shownPicture = () => tree.root.findByType(Picture).props.picture as SkPicture;
    const spies: jest.SpyInstance[] = [];
    act(() => {
      tree = ReactTestRenderer.create(<FieldFallback {...base} taps={tapsOf('one.J')} />);
    });
    spies.push(jest.spyOn(shownPicture(), 'dispose'));
    for (const scene of ['one.C', 'three']) {
      const taps = tapsOf(scene);
      act(() => tree.update(<FieldFallback {...base} taps={taps} />));
      const current = shownPicture();
      // The replaced picture freed exactly once; the one now shown untouched, and it still plays its plan.
      expect(spies.map((s) => s.mock.calls.length)).toEqual(spies.map(() => 1));
      spies.push(jest.spyOn(current, 'dispose'));
      // A re-render with equal props keeps the same picture and frees nothing.
      act(() => tree.update(<FieldFallback {...base} taps={taps} />));
      expect(shownPicture()).toBe(current);
      expect(spies[spies.length - 1]).not.toHaveBeenCalled();
      expect(Buffer.from(play(current, w, h, PHONE.pxPerDp)).equals(Buffer.from(drawPlan(fallbackPlan({ ...base, taps }), layout).px))).toBe(true);
    }
    expect(spies).toHaveLength(3);
    act(() => tree.unmount());
    expect(spies.map((s) => s.mock.calls.length)).toEqual([1, 1, 1]);
  });
});
