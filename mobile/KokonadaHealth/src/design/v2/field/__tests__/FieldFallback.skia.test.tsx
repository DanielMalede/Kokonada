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

const read = (surface: ReturnType<typeof Skia.Surface.Make>, w: number, h: number) => {
  surface!.flush();
  return surface!.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
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
  const w = Math.round(layout.width * plan.pxPerDp);
  const h = Math.round(layout.height * plan.pxPerDp);
  return { plan, layout, w, h, px: play(recordFieldFallback(SK, plan, layout.width, layout.height), w, h, plan.pxPerDp) };
}

function draw(id: DirectionId, face: Face, taps: readonly Tap[], over: { layout?: FieldLayout; pxPerDp?: number; quietPresence?: readonly number[] } = {}): Drawn {
  const layout = over.layout ?? hero(id);
  const plan = fallbackPlan({ direction: id, face, statics: staticsOf(id), taps, layout, pxPerDp: over.pxPerDp ?? PHONE.pxPerDp, quietPresence: over.quietPresence });
  return drawPlan(plan, layout);
}

/** Only the ground and the clipped gradient (the DEC's acceptance render), in device px. */
function groundAndField(d: Drawn): Uint8Array {
  const surface = Skia.Surface.Make(d.w, d.h)!;
  drawFallbackGround(SK, surface.getCanvas(), d.plan);
  drawFallbackField(SK, surface.getCanvas(), d.plan);
  return read(surface, d.w, d.h);
}

const at = (d: { w: number; px: Uint8Array }, x: number, y: number) => [0, 1, 2].map((c) => d.px[4 * (y * d.w + x) + c]);
/** A pixel's distance from the plate's centre, in device px, from the layout itself. */
const radial = (d: Drawn, x: number, y: number) => Math.hypot(x + 0.5 - d.layout.centre[0] * d.plan.pxPerDp, y + 0.5 - d.layout.centre[1] * d.plan.pxPerDp);
const R = (d: Drawn) => d.layout.radius * d.plan.pxPerDp;
/** The ring's inner radius in device px, from the tokens and the layout (the builder's ringInner). */
const ringInnerPx = (d: Drawn) => (1 - Math.max(BASE.plate.labelBand.min, BASE.plate.labelBand.min * d.layout.fontScale) / d.layout.radius) * R(d);

/** The gradient at a pixel's centre as Skia draws a clamped radial gradient: t = distance / radius, linear between the stops. */
function gradientAt(field: FallbackField, x: number, y: number, centre: readonly [number, number] = field.centre): number[] {
  const t = Math.hypot(x + 0.5 - centre[0], y + 0.5 - centre[1]) / field.radius;
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
const near = (a: readonly number[], b: readonly number[], tol: number) => a.every((v, i) => Math.abs(v - Math.round(b[i])) <= tol);
const same = (a: readonly number[], b: readonly number[]) => a.every((v, i) => v === b[i]);

/** Every pixel in a region of the canvas, by a predicate on (x, y), within a bounding box. */
function* pixels(d: Drawn, keep: (x: number, y: number) => boolean, box?: { x0: number; y0: number; x1: number; y1: number }) {
  const b = box ?? { x0: 0, y0: 0, x1: d.w, y1: d.h };
  for (let y = Math.max(0, b.y0); y < Math.min(d.h, b.y1); y++) for (let x = Math.max(0, b.x0); x < Math.min(d.w, b.x1); x++) if (keep(x, y)) yield [x, y] as const;
}
/** The plate's bounding box with a margin, in device px. */
const plateBox = (d: Drawn, margin: number) => {
  const [cx, cy] = [d.layout.centre[0] * d.plan.pxPerDp, d.layout.centre[1] * d.plan.pxPerDp];
  const r = R(d) + margin;
  return { x0: Math.floor(cx - r), y0: Math.floor(cy - r), x1: Math.ceil(cx + r), y1: Math.ceil(cy + r) };
};

/** A zone's signed distance at a pixel's centre (r3 §1, sdBox − grow), in device px, written out. */
function sdOf(zone: LayoutRect, k: number, x: number, y: number): number {
  const [cx, cy, hx, hy] = [(zone.x + zone.width / 2) * k, (zone.y + zone.height / 2) * k, (zone.width / 2) * k, (zone.height / 2) * k];
  const qx = Math.abs(x + 0.5 - cx) - hx;
  const qy = Math.abs(y + 0.5 - cy) - hy;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - BASE.quiet.grow * k;
}

describe('Q1: on Abyss the field shows only in the lens', () => {
  it.each(FACES.flatMap((face) => [1, 2].map((fs) => [face, fs] as const)))('%s, font scale %d, every hero scene: every pixel at d ≥ R + 1.5 px is the ground, exactly', (face, fontScale) => {
    const ground = rgbOf(DIRECTIONS[ABYSS].color[face].ground.hex);
    for (const scene of HERO_SCENES) {
      const d = draw(ABYSS, face, tapsOf(scene), { layout: hero(ABYSS, fontScale) });
      expect(d.plan.field).not.toBeNull();
      let checked = 0;
      let off = '';
      for (let y = 0; y < d.h; y++) {
        for (let x = 0; x < d.w; x++) {
          if (radial(d, x, y) < R(d) + 1.5) continue;
          checked++;
          if (!off && !same(at(d, x, y), ground)) off = `${scene}: (${x}, ${y}) ${at(d, x, y).join(', ')}`;
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
      for (const [x, y] of pixels(d, (x, y) => Math.abs(radial(d, x, y) - bound) <= 2, plateBox(d, 0))) {
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
    for (const [x, y] of pixels(d, (x, y) => radial(d, x, y) < interior, plateBox(d, 0))) {
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
        const dist = radial(d, x, y);
        if (dist < ringInnerPx(d) - 1.5) {
          dishes++;
          if (!same(at(d, x, y), dish) && bad.length < 3) bad.push(`dish (${x}, ${y}) ${at(d, x, y).join(', ')}`);
        } else if (dist > R(d) + 1.5 && dist <= moat) {
          moats++;
          if (!same(at(d, x, y), ground) && bad.length < 3) bad.push(`moat (${x}, ${y}) ${at(d, x, y).join(', ')}`);
        }
      }
      expect(bad).toEqual([]);
      expect([dishes > 1000, moats > 100]).toEqual([true, true]);
    }
  });

  it.each(FACES)('fixture-outer %s, three and one.I: every pixel inside every grown zone is the ground (r3’s Linen S6 test)', (face) => {
    const ground = rgbOf(DIRECTIONS[FIXTURE_OUTER].color[face].ground.hex);
    let reached = 0;
    for (const scene of ['three', 'one.I']) {
      const d = draw(FIXTURE_OUTER, face, tapsOf(scene));
      const zones = d.layout.quietRects!;
      const bad: string[] = [];
      for (const [x, y] of pixels(d, (x, y) => radial(d, x, y) > R(d) + 1.5 && zones.some((z) => sdOf(z, d.plan.pxPerDp, x, y) <= 0))) {
        if (!near(gradientAt(d.plan.field!, x, y), ground, 3)) reached++;
        if (!same(at(d, x, y), ground) && bad.length < 3) bad.push(`${scene} (${x}, ${y}) ${at(d, x, y).join(', ')}`);
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
    for (const [x, y] of pixels(d, (x, y) => radial(d, x, y) > R(d) + 1.5 && sdOf(zone, d.plan.pxPerDp, x, y) <= 0)) {
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
      for (const [x, y] of pixels(d, (x, y) => radial(d, x, y) >= ringInnerPx(d) + 1.5 && radial(d, x, y) <= R(d) - 1.5, plateBox(d, 0))) {
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
    for (const [x, y] of pixels(d, (x, y) => radial(d, x, y) < ringInnerPx(d) - 1.5 && Math.hypot(x + 0.5 - d.plan.field!.centre[0], y + 0.5 - d.plan.field!.centre[1]) >= reach, plateBox(d, 0))) {
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
      for (const [x, y] of pixels(d, (x, y) => radial(d, x, y) < ringInnerPx(d) - 1.5 && Math.hypot(x + 0.5 - d.plan.field!.centre[0], y + 0.5 - d.plan.field!.centre[1]) >= 1.3338 * R(d), plateBox(d, 0))) {
        if (!same(at(d, x, y), flat) && bad.length < 3) bad.push(`${scene} (${x}, ${y}) ${at(d, x, y).join(', ')}`);
      }
      expect(bad).toEqual([]);
    }
  });

  /** The ring's inner circle within 30° of the lobe, in 8 px arc steps: each pixel within `band` px of it, by step. */
  function innerArc(d: Drawn, band: number): Array<Array<readonly [number, number]>> {
    const [cx, cy] = [d.layout.centre[0] * d.plan.pxPerDp, d.layout.centre[1] * d.plan.pxPerDp];
    const rIn = ringInnerPx(d);
    const lobe = Math.atan2(d.plan.field!.centre[1] - cy, d.plan.field!.centre[0] - cx);
    const span = (30 * Math.PI) / 180;
    const step = 8 / rIn;
    const steps: Array<Array<readonly [number, number]>> = Array.from({ length: Math.floor((2 * span) / step) }, () => []);
    for (const [x, y] of pixels(d, (x, y) => Math.abs(radial(d, x, y) - rIn) <= band, plateBox(d, 0))) {
      let rel = Math.atan2(y + 0.5 - cy, x + 0.5 - cx) - lobe;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      const i = Math.floor((rel + span) / step);
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
        return [0, 1, 2].some((c) => Math.abs(model[c] - ring[c]) >= 2 && got[c] > Math.min(model[c], ring[c]) && got[c] < Math.max(model[c], ring[c]));
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
      for (const [x, y] of pixels(d, (x, y) => Math.abs(radial(d, x, y) - ringInnerPx(d)) <= 1.5, plateBox(d, 0))) {
        n++;
        const model = gradientAt(d.plan.field!, x, y);
        const got = at(d, x, y);
        const ok = [0, 1, 2].every((c) => got[c] >= Math.min(model[c], ring[c]) - 1 && got[c] <= Math.max(model[c], ring[c]) + 1);
        if (!ok && bad.length < 3) bad.push(`${scene} (${x}, ${y}) got ${got.join(', ')} ring ${ring.join(', ')} gradient ${model.map(Math.round).join(', ')}`);
      }
      expect(bad).toEqual([]);
      expect(n).toBeGreaterThan(500);
    }
  });

  it.each(FACES)('Abyss %s, one.C at the right edge: the gradient is drawn undithered, each channel moving one way inside each stop interval along its row', (face) => {
    const d = draw(ABYSS, face, tapsOf('one.C.right'));
    const field = d.plan.field!;
    const row = Math.floor(field.centre[1]);
    const x0 = Math.floor(field.centre[0]);
    let varied = 0;
    for (const dir of [1, -1]) {
      const runs = new Map<number, number[][]>();
      for (let x = x0; x >= 0 && x < d.w; x += dir) {
        if (!(radial(d, x, row) < ringInnerPx(d) - 2)) continue;
        const t =Math.hypot(x + 0.5 - field.centre[0], row + 0.5 - field.centre[1]) / field.radius;
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
    for (const [x, y] of pixels(d, (x, y) => radial(d, x, y) < ringInnerPx(d) - 1.5, plateBox(d, 0))) {
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
    const w = Math.round(layout.width * PHONE.pxPerDp);
    const h = Math.round(layout.height * PHONE.pxPerDp);
    const shown = play(pictures[0].props.picture, w, h, PHONE.pxPerDp);
    const planned = drawPlan(fallbackPlan(props), layout);
    expect(Buffer.from(shown).equals(Buffer.from(planned.px))).toBe(true);
    act(() => tree.unmount());
  });
});
