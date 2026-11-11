jest.mock('../../tokens/tokens.generated.ts', () => {
  const tokens = require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedTokensModule();
  // A planted direction for the region's third case: fixture-inner with no field on the face or the ground.
  const none = JSON.parse(JSON.stringify(tokens.DIRECTIONS['fixture-inner']));
  none.field.mask.face = 0;
  none.field.mask.outside = 0;
  return { ...tokens, DIRECTIONS: { ...tokens.DIRECTIONS, 'fixture-none': none } };
});
jest.mock('../../tokens/tokens.extensions.generated.ts', () => require('../../__tests__/__fixtures__/fixtureTokens.ts').mockedExtensionsModule());

import { oklabToSrgb, type Oklab } from '../../color/oklab.ts';
import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { FIXTURE_INNER, FIXTURE_OUTER, actualExtensions, actualTokens } from '../../__tests__/__fixtures__/fixtureTokens.ts';
import { fallbackPlan, fallbackPose, fallbackRegion, fallbackStill, fallbackStops, removedZones, type FallbackPlan } from '../fallbackModel.ts';
import { ONE_C_RIGHT, PHONE, fallbackScenes, heroLayout } from '../fallbackScenes.ts';
import { renderGeometry, type FieldLayout, type LayoutRect } from '../fieldDriver.ts';
import { NODE_TIER, buildFieldFrame, lobeAnchor, nodeAt, placementRamp, type FieldStatics } from '../fieldFrame.ts';
import { NODE, quietFactor, smoothstep, type FieldFrame, type QuietRect } from '../fieldLaw.ts';
import type { Tap } from '../placementLedger.ts';
import { staticsFor } from '../statics.ts';

// T13, FieldFallback's model (the designer's rulings Q1–Q5 of 2026-11-11, v1b-B4-T13-designer-rulings.md, outside the
// repository): the region by field.mask, the mean pose, k and the stops, presence, and the clip decided per device pixel
// by the law. Every number is held to the builder or the law, computed here on its own, never by the model's code.

const ABYSS = 'abyss' as DirectionId;
const NONE = 'fixture-none' as DirectionId;
const FACES: readonly Face[] = ['dark', 'light'];
const EXT = EXTENSIONS as unknown as { base: { $root: { hero: { scenes: never } } }; abyss: { $root: { hardest: never } } };
const statics = (id: DirectionId): FieldStatics => staticsFor(id === NONE ? FIXTURE_INNER : id, EXTENSIONS as never);
const hero = (id: DirectionId, fontScale = 1): FieldLayout => heroLayout(id, PHONE.width, PHONE.height, fontScale);
const SCENES = fallbackScenes(EXT.base.$root.hero.scenes, EXT.abyss.$root.hardest);
const sceneTaps = (id: string): readonly Tap[] => {
  const found = SCENES.find((s) => s.id === id);
  if (!found) throw new Error(`no scene ${id}`);
  return found.taps;
};
const lab = (c: { readonly oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });

const planOf = (id: DirectionId, face: Face, taps: readonly Tap[], over: { layout?: FieldLayout; pxPerDp?: number; quietPresence?: readonly number[] } = {}): FallbackPlan =>
  fallbackPlan({ direction: id, face, statics: statics(id), taps, layout: over.layout ?? hero(id), pxPerDp: over.pxPerDp ?? PHONE.pxPerDp, quietPresence: over.quietPresence });

/** The builder's frame for the fallback's state: the still, s 0, c null, genesis off, the taps at fade 1. */
function stillFrame(id: DirectionId, face: Face, layout: FieldLayout, k: number, taps: readonly Tap[]): FieldFrame {
  return buildFieldFrame(
    {
      direction: id, face, placements: taps.map((t, i) => ({ x: t.x, y: t.y, fade: 1, ordinal: i })), restFade: 1,
      stress: 0, confidence: null, genesis: false, tMs: 0, breathPhase: 0, tier: 'still',
    },
    { ...renderGeometry(layout, k, 1), quietRects: [] },
    statics(id),
  );
}

describe('the region, by field.mask (Q1, the amended DEC)', () => {
  it('the face where the face carries the field, else the outside beyond the moat, else none; never both', () => {
    expect([ABYSS, FIXTURE_INNER, FIXTURE_OUTER, NONE].map(fallbackRegion)).toEqual(['face', 'face', 'outside', 'none']);
    expect(DIRECTIONS[ABYSS].field.mask.outside).toBeGreaterThan(0);
  });

  it('a direction with no field region draws no field: the plan holds the ground, the face and the ring only', () => {
    const plan = planOf(NONE, 'dark', sceneTaps('three'));
    expect(plan.field).toBeNull();
    expect(plan.ground).toBe(DIRECTIONS[NONE].color.dark.ground.hex);
  });
});

describe('the mean pose (Q5)', () => {
  it.each(FACES)('(i) Abyss %s: the radius is radiusScale × lobe.radius × (1 + ampRadius/2) = 1.3338 R', (face) => {
    for (const scene of ['rest', 'one.J', 'three']) {
      const layout = hero(ABYSS);
      const plan = planOf(ABYSS, face, sceneTaps(scene));
      expect(Math.abs(plan.field!.radius / (layout.radius * PHONE.pxPerDp) - 1.3338)).toBeLessThan(1e-6);
    }
  });

  it.each(FACES)('(ii) Abyss %s: one.J/C/R/I centre the gradient on the lobe-centre rule at zero drift, never the still’s drift at t*', (face) => {
    const d = DIRECTIONS[ABYSS];
    const layout = hero(ABYSS);
    const k = PHONE.pxPerDp;
    for (const scene of ['one.J', 'one.C', 'one.R', 'one.I']) {
      const [tap] = sceneTaps(scene);
      const [ax, ay] = lobeAnchor(tap.x, tap.y, d.bead.diameter / 2 / layout.radius, d.field.lobe.centreAlpha, d.field.lobe.centreBeta);
      const plan = planOf(ABYSS, face, [tap]);
      const want = [layout.centre[0] * k + ax * layout.radius * k, layout.centre[1] * k - ay * layout.radius * k];
      expect(Math.abs(plan.field!.centre[0] - want[0])).toBeLessThan(1e-6);
      expect(Math.abs(plan.field!.centre[1] - want[1])).toBeLessThan(1e-6);
      // Not vacuous: the still's own lobe sits off the anchor by its drift at t*.
      const node = stillFrame(ABYSS, face, layout, k, [tap]).nodes.find((n) => n.bead !== null)!;
      expect(Math.hypot(node.centre[0] - ax, node.centre[1] - ay)).toBeGreaterThan(1e-3);
    }
  });

  it('(iii) the newest tap that carries a lobe, else the rest state', () => {
    const outer = DIRECTIONS[FIXTURE_OUTER];
    expect(outer.field.lobe.neutralLobe).toBe(0);
    const layout = hero(FIXTURE_OUTER);
    const rBead = outer.bead.diameter / 2 / layout.radius;
    const J = { x: 0.5, y: 0.5 };
    const neutral = { x: 0.05, y: 0 };
    for (const face of FACES) {
      // fixture-outer, [J, neutral]: the neutral carries no lobe, so J's gradient.
      const pose = fallbackPose(FIXTURE_OUTER, face, statics(FIXTURE_OUTER), [J, neutral], layout.radius)!;
      expect([pose.node, pose.rest]).toEqual(['J', false]);
      expect(pose.centre).toEqual(lobeAnchor(J.x, J.y, rBead, outer.field.lobe.centreAlpha, outer.field.lobe.centreBeta));
      // fixture-outer, [neutral]: no lobe anywhere, so the rest state at the centroid of the face's rest lobes.
      const rest = fallbackPose(FIXTURE_OUTER, face, statics(FIXTURE_OUTER), [neutral], layout.radius)!;
      const lobes = statics(FIXTURE_OUTER).restLobes[face];
      expect([rest.node, rest.rest]).toEqual(['R0', true]);
      expect(rest.centre[0]).toBeCloseTo(lobes.reduce((s, l) => s + l[0], 0) / lobes.length, 12);
      expect(rest.centre[1]).toBeCloseTo(lobes.reduce((s, l) => s + l[1], 0) / lobes.length, 12);
      expect(rest.colour).toEqual(lab(outer.color[face].field.restGlow));
    }
    // Abyss, [J, neutral]: Abyss's neutral carries a lobe, so an R0 gradient at the neutral's anchor.
    const abyss = DIRECTIONS[ABYSS];
    const aLayout = hero(ABYSS);
    expect(abyss.field.lobe.neutralLobe).toBeGreaterThan(0);
    const rB = abyss.bead.diameter / 2 / aLayout.radius;
    for (const face of FACES) {
      const pose = fallbackPose(ABYSS, face, statics(ABYSS), [J, neutral], aLayout.radius)!;
      expect([pose.node, pose.rest]).toEqual(['R0', false]);
      expect(pose.centre).toEqual(lobeAnchor(neutral.x, neutral.y, rB, abyss.field.lobe.centreAlpha, abyss.field.lobe.centreBeta));
      expect(pose.centre[0]).toBeCloseTo(0.05 * (1 - rB), 12);
      expect(pose.colour).toEqual(lab(abyss.color[face].field.restGlow));
    }
  });

  it('(iv) the rest state is one R0 gradient at the centroid of the face’s rest lobes: Abyss light (0.025, 0.025), dark (−0.30, 0.35)', () => {
    const at = (face: Face) => fallbackPose(ABYSS, face, statics(ABYSS), [], hero(ABYSS).radius)!;
    expect(statics(ABYSS).restLobes.light).toHaveLength(2);
    expect(Math.abs(at('light').centre[0] - 0.025)).toBeLessThan(1e-6);
    expect(Math.abs(at('light').centre[1] - 0.025)).toBeLessThan(1e-6);
    expect(Math.abs(at('dark').centre[0] + 0.3)).toBeLessThan(1e-6);
    expect(Math.abs(at('dark').centre[1] - 0.35)).toBeLessThan(1e-6);
    for (const face of FACES) expect([at(face).node, at(face).rest, at(face).colour]).toEqual(['R0', true, lab(DIRECTIONS[ABYSS].color[face].field.restGlow)]);
  });

  it('pin: every shipped face’s rest lobes lie within field.lobe.radius of their centroid', () => {
    const shipped = actualTokens().DIRECTIONS as Record<string, { field: { lobe: { radius: number } } }>;
    const ext = actualExtensions().EXTENSIONS;
    const ids = Object.keys(shipped) as DirectionId[];
    expect(ids).toContain(ABYSS);
    for (const id of ids) {
      const s = staticsFor(id, ext as never);
      for (const face of FACES) {
        const lobes = s.restLobes[face];
        expect(lobes.length).toBeGreaterThan(0);
        const c = [lobes.reduce((a, l) => a + l[0], 0) / lobes.length, lobes.reduce((a, l) => a + l[1], 0) / lobes.length];
        for (const l of lobes) expect(Math.hypot(l[0] - c[0], l[1] - c[1])).toBeLessThanOrEqual(shipped[id].field.lobe.radius);
      }
    }
  });
});

describe('k and the agreement with the builder (Q3, Q5)', () => {
  it('Abyss k: 0.5391 dark, 0.1647 light', () => {
    expect(Math.abs(fallbackStill(ABYSS, 'dark', hero(ABYSS)).k - 0.5391)).toBeLessThan(1e-4);
    expect(Math.abs(fallbackStill(ABYSS, 'light', hero(ABYSS)).k - 0.1647)).toBeLessThan(1e-4);
  });

  it.each([ABYSS, FIXTURE_OUTER, FIXTURE_INNER].flatMap((id) => FACES.flatMap((face) => [1, 2].map((fs) => [id, face, fs] as const))))(
    '%s %s, font scale %d: ringInner, moatOuter, grounds, mask, k, the lobe radius and the node colour equal the builder’s still frame',
    (id, face, fontScale) => {
      const layout = hero(id, fontScale);
      const k = PHONE.pxPerDp;
      const still = fallbackStill(id, face, layout);
      for (const taps of [[], [{ x: 0.5, y: 0.5 }], [{ x: -0.3, y: -0.2 }], [{ x: 0.05, y: 0.05 }]] as Tap[][]) {
        const frame = stillFrame(id, face, layout, k, taps);
        expect(Math.abs(still.ringInner - frame.ringInner)).toBeLessThan(1e-9);
        expect(Math.abs(still.moatOuter - frame.moatOuter)).toBeLessThan(1e-9);
        expect(still.grounds).toEqual(frame.grounds);
        expect(still.mask).toEqual(frame.mask);
        expect(Math.abs(still.k - frame.kField)).toBeLessThan(1e-9);
        const lit = frame.nodes.filter((n) => n.fade > 0 && n.radius > 0);
        expect(lit.length).toBeGreaterThan(0);
        for (const n of lit) expect(Math.abs(still.lobeRadius - n.radius)).toBeLessThan(1e-9);
        const pose = fallbackPose(id, face, statics(id), taps, layout.radius);
        if (pose !== null && !pose.rest) {
          const node = frame.nodes.find((n) => n.fade > 0 && n.bead !== null)!;
          expect(node.id).toBe(NODE[pose.node]);
          for (const ch of ['L', 'a', 'b'] as const) expect(Math.abs(pose.colour[ch] - node.field[ch])).toBeLessThan(1e-12);
        }
      }
    },
  );
});

/** Route R4 written out (fieldLaw.ts, the composite): L = mix(G.L, c.L, k); ab = k·c.ab + (1 − k)·(1 − smoothstep(0, kp, k))·G.ab. */
const r4 = (g: Oklab, c: Oklab, k: number, kp: number): Oklab => {
  const share = (1 - k) * (kp > 0 ? 1 - smoothstep(0, kp, k) : 1);
  return { L: g.L + (c.L - g.L) * k, a: k * c.a + share * g.a, b: k * c.b + share * g.b };
};
const clampRgb = (c: Oklab) => oklabToSrgb(c).map((v) => Math.min(1, Math.max(0, v)));
const QUADRANTS = { J: 'joy', C: 'calm', R: 'reflective', I: 'intense' } as const;

describe('the stops (§2.5 as amended): composite(the region’s flat ground, the node colour at p, weight × k) through kp, opaque', () => {
  it.each([ABYSS, FIXTURE_OUTER, FIXTURE_INNER].flatMap((id) => FACES.map((face) => [id, face] as const)))('%s %s', (id, face) => {
    const d = DIRECTIONS[id];
    const region = fallbackRegion(id);
    expect(region).not.toBe('none');
    const ground = region === 'face' ? lab(d.color[face].plate.face) : lab(d.color[face].ground);
    const kRegion = d.field.K[face] * d.field.presence.none * (1 - d.field.breath.ampPresence / 2) * (region === 'face' ? d.field.mask.face : d.field.mask.outside);
    const { position, weight } = statics(id).fallbackStops;
    for (const tap of [{ x: 0.566, y: 0.566 }, { x: -0.566, y: 0.566 }, { x: 0.3, y: -0.2 }]) {
      const node = nodeAt(tap.x, tap.y) as 'J' | 'C' | 'R' | 'I';
      const p = placementRamp(tap.x, tap.y);
      const glow = lab(d.color[face].field.restGlow);
      const anchor = lab(BASE.emotion[QUADRANTS[node]][NODE_TIER[face]]);
      const colour = { L: glow.L + (anchor.L - glow.L) * p, a: anchor.a * p * d.bead.chromaScale, b: anchor.b * p * d.bead.chromaScale };
      const stops = fallbackStops(id, face, region as 'face' | 'outside', statics(id), colour);
      expect(stops.positions).toEqual([...position]);
      expect(stops.colours).toHaveLength(weight.length);
      stops.colours.forEach((c, i) => {
        const want = clampRgb(r4(ground, colour, weight[i] * kRegion, d.field.pivot));
        for (let ch = 0; ch < 3; ch++) expect(Math.abs(c[ch] - want[ch])).toBeLessThan(1e-12);
      });
      // The last stop is the region's ground itself, so beyond the radius the gradient is that token, byte for byte.
      const groundHex = region === 'face' ? d.color[face].plate.face.hex : d.color[face].ground.hex;
      const last = stops.colours[stops.colours.length - 1].map((v) => Math.round(v * 255));
      expect(last).toEqual([1, 3, 5].map((i) => parseInt(groundHex.slice(i, i + 2), 16)));
      // Not vacuous: the core differs from the ground.
      expect(stops.colours[0]).not.toEqual(stops.colours[stops.colours.length - 1]);
    }
  });
});

describe('presence in the fallback (Q2): hard', () => {
  const rect = (x: number): LayoutRect => ({ x, y: 20, width: 10, height: 6 });
  const rects = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => rect(20 * i));

  it('a zone escapes removal only at presence exactly 0; p > 0, NaN, negative, +Infinity and a missing value remove it', () => {
    const zones = removedZones(rects, [1, 0.5, 1e-6, 0, Number.NaN, -0.1, Number.POSITIVE_INFINITY], 2)!;
    // Slot 3 (p 0) escapes; slot 7 is past the list, so it counts as present.
    expect(zones.map((z) => z.cx / 2 - 5)).toEqual([0, 20, 40, 80, 100, 120, 140]);
    expect(removedZones(rects.slice(0, 2), undefined, 2)).toHaveLength(2);
    expect(removedZones(undefined, [1], 2)).toEqual([]);
  });

  it('every rect is removed, with no clamp to QUIET_SLOTS, in device px as the builder’s geometry converts it', () => {
    const seven = rects.slice(0, 7);
    const zones = removedZones(seven, undefined, 2.625)!;
    expect(zones).toHaveLength(7);
    const layout: FieldLayout = { width: 200, height: 100, centre: [50, 50], radius: 40, fontScale: 1, quietRects: seven.slice(0, 6) };
    expect(zones.slice(0, 6)).toEqual(renderGeometry(layout, 2.625, 1).quietRects);
  });

  it.each([
    ['a NaN centre', { x: Number.NaN, y: 20, width: 10, height: 6 }],
    ['an infinite size', { x: 20, y: 20, width: Number.POSITIVE_INFINITY, height: 6 }],
    ['a negative width (hx −1)', { x: 20, y: 20, width: -2, height: 6 }],
    ['a negative height', { x: 20, y: 20, width: 10, height: -0.5 }],
  ])('a rect with %s cannot be removed: no zones, and the plan draws no field; nothing throws', (_label, bad) => {
    expect(removedZones([rect(0), bad], undefined, 2)).toBeNull();
    const layout = hero(ABYSS);
    const plan = planOf(ABYSS, 'dark', sceneTaps('three'), { layout: { ...layout, quietRects: [...(layout.quietRects ?? []), bad] } });
    expect(plan.field).toBeNull();
    expect(plan.face.colour).toBe(DIRECTIONS[ABYSS].color.dark.plate.face.hex);
  });
});

/**
 * The law's step test at a device pixel's centre (the amended DEC), from the builder's frame and the law's own
 * quietFactor: the face keeps it while d < ringInner·R + 1 dp, the outside while d > moatOuter·R, and a zone removes
 * it where sd ≤ 0 (presence 1, no feather). The region is read off field.mask here, not from the model.
 */
function lawKeep(id: DirectionId, layout: FieldLayout, k: number, zones: readonly QuietRect[]): (x: number, y: number) => boolean {
  const frame = stillFrame(id, 'dark', layout, k, []);
  const R = layout.radius * k;
  const [cx, cy] = [layout.centre[0] * k, layout.centre[1] * k];
  const mask = DIRECTIONS[id].field.mask;
  const zoneFrame = { quiet: { rects: zones, presence: zones.map(() => 1), grow: BASE.quiet.grow * k, feather: 0 } };
  return (x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRegion = mask.face > 0 ? dist < frame.ringInner * R + k : mask.outside > 0 ? dist > frame.moatOuter * R : false;
    return inRegion && quietFactor(zoneFrame, x + 0.5, y + 0.5) !== 0;
  };
}

/** The plan's clip rects as a keep grid (a pixel is kept when its centre is inside a rect); every rect whole pixels, none overlapping. */
function clipGrid(plan: FallbackPlan): Uint8Array {
  const { width, height } = plan.size;
  const grid = new Uint8Array(width * height);
  let fractional = 0;
  let overlaps = 0;
  for (const [x, y, w, h] of plan.field!.clip) {
    if (![x, y, w, h].every((v) => Number.isInteger(v)) || !(w > 0 && h > 0)) fractional++;
    for (let j = Math.max(0, Math.ceil(y - 0.5)); j < Math.min(height, Math.ceil(y + h - 0.5)); j++) {
      for (let i = Math.max(0, Math.ceil(x - 0.5)); i < Math.min(width, Math.ceil(x + w - 0.5)); i++) {
        if (grid[j * width + i] === 1) overlaps++;
        grid[j * width + i] = 1;
      }
    }
  }
  expect({ fractional, overlaps }).toEqual({ fractional: 0, overlaps: 0 });
  return grid;
}

describe('the clip: each device pixel decided at its centre by the law’s step test (the amended DEC)', () => {
  // pxPerDp 2, so a zone's grown edge can be put exactly on a pixel centre: the tie, which the law removes (sd = 0).
  const K = 2;
  const g = BASE.quiet.grow * K;
  const TIE_X = 170.5;
  const TIE_Y = 130.5;
  // The view 160 × 120 dp, the plate R 50 dp at (80, 60): the lens 22 dp (44 px), the moat out to 62 dp. The rects in dp:
  // one across the lens, a zero-size one in it, the tie (its grown right edge at x = 170.5 px and its grown bottom edge at
  // y = 130.5 px, both pixel centres, in the lens), and one in a corner, beyond the moat.
  const tie: LayoutRect = { x: (TIE_X - g) / K - 6, y: (TIE_Y - g) / K - 4, width: 6, height: 4 };
  const rects: LayoutRect[] = [
    { x: 40, y: 58, width: 80, height: 4 },
    { x: 75, y: 50, width: 0, height: 0 },
    tie,
    { x: 4, y: 4, width: 10, height: 6 },
  ];
  const base: FieldLayout = { width: 160, height: 120, centre: [80, 60], radius: 50, fontScale: 1, quietRects: rects };

  it.each([[ABYSS, 'face'], [FIXTURE_INNER, 'face'], [FIXTURE_OUTER, 'outside']] as const)('%s (%s): every kept pixel is exactly the law’s', (id, region) => {
    const zones = removedZones(rects, undefined, K)!;
    const keep = lawKeep(id, base, K, zones);
    const regionOnly = lawKeep(id, base, K, []);
    for (const face of FACES) {
      const plan = planOf(id, face, [{ x: 0.3, y: 0.2 }], { layout: base, pxPerDp: K });
      expect(plan.region).toBe(region);
      const grid = clipGrid(plan);
      let kept = 0;
      let removedByZones = 0;
      const wrong: string[] = [];
      for (let y = 0; y < plan.size.height; y++) {
        for (let x = 0; x < plan.size.width; x++) {
          const want = keep(x, y);
          if (regionOnly(x, y) && !want) removedByZones++;
          if (want) kept++;
          if ((grid[y * plan.size.width + x] === 1) !== want && wrong.length < 5) wrong.push(`(${x}, ${y}) law ${want}`);
        }
      }
      expect(wrong).toEqual([]);
      expect(kept).toBeGreaterThan(100);
      expect(removedByZones).toBeGreaterThan(20);
    }
  });

  it('the tie: a pixel centred exactly on a zone’s grown boundary is removed, on its right and its bottom edge', () => {
    const plan = planOf(ABYSS, 'dark', [{ x: 0.3, y: 0.2 }], { layout: { ...base, quietRects: [tie] }, pxPerDp: K });
    const zone = removedZones([tie], undefined, K)![0];
    expect(zone.cx + zone.hx + g).toBe(TIE_X);
    expect(zone.cy + zone.hy + g).toBe(TIE_Y);
    const zoneFrame = { quiet: { rects: [zone], presence: [1], grow: g, feather: 0 } };
    const grid = clipGrid(plan);
    const at = (x: number, y: number) => grid[y * plan.size.width + x];
    const row = Math.floor(zone.cy);
    const col = Math.floor(zone.cx);
    expect([quietFactor(zoneFrame, TIE_X, row + 0.5), quietFactor(zoneFrame, TIE_X + 1, row + 0.5)]).toEqual([0, 1]);
    expect([at(TIE_X - 0.5, row), at(TIE_X + 0.5, row)]).toEqual([0, 1]);
    expect([quietFactor(zoneFrame, col + 0.5, TIE_Y), quietFactor(zoneFrame, col + 0.5, TIE_Y + 1)]).toEqual([0, 1]);
    expect([at(col, TIE_Y - 0.5), at(col, TIE_Y + 0.5)]).toEqual([0, 1]);
  });
});

describe('the hero layout the rulings were measured on (fallbackScenes.ts, test-only)', () => {
  it('at 384 dp: plate 304 dp, the voice zone’s grown edge 4 dp above the moat, the CTA’s 12 dp below it, no zone within 44 dp of the lens', () => {
    const layout = heroLayout(ABYSS, 384, 832, 1);
    const d = DIRECTIONS[ABYSS];
    expect(layout.radius * 2).toBe(304);
    const [, , , voice, cta] = layout.quietRects!;
    const grow = BASE.quiet.grow;
    const plateTop = layout.centre[1] - layout.radius;
    const plateBottom = layout.centre[1] + layout.radius;
    expect(plateTop - d.field.mask.moat - (voice.y + voice.height + grow)).toBeCloseTo(4, 9);
    expect(cta.y - grow - (plateBottom + d.field.mask.moat)).toBeCloseTo(12, 9);
    const lens = layout.radius - BASE.plate.labelBand.min;
    for (const r of layout.quietRects!) {
      const dx = Math.max(r.x - layout.centre[0], 0, layout.centre[0] - (r.x + r.width));
      const dy = Math.max(r.y - layout.centre[1], 0, layout.centre[1] - (r.y + r.height));
      expect(Math.hypot(dx, dy) - grow - lens).toBeGreaterThanOrEqual(44 - 1e-9);
    }
  });

  it('the scenes: the hero’s, the hardest reach beads, and the board’s edge scenes', () => {
    expect(SCENES.map((s) => s.id)).toEqual(['rest', 'one.J', 'one.C', 'one.R', 'one.I', 'one.neutral', 'three', 'reach.top', 'reach.bottom', 'one.J.top', 'one.C.right']);
    expect(sceneTaps('rest')).toEqual([]);
    expect(sceneTaps('three')).toHaveLength(3);
    expect(sceneTaps('reach.top')).toHaveLength(3);
    expect(sceneTaps('one.C.right')).toEqual([ONE_C_RIGHT]);
    const [top] = sceneTaps('one.J.top');
    expect(nodeAt(top.x, top.y)).toBe('J');
  });
});
