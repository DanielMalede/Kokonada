/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { validatePlan } from '../../../../scripts/lab/capture.mjs';
import { WITNESS_MODELS, hexBytes, lsbDelta, MODEL_SEPARATION_LSB } from '../../v2/color/displayP3';
import { PHONE } from '../../v2/field/fallbackScenes';
import { fieldStep, renderGeometry, renderScaleFor, type FieldLayout } from '../../v2/field/fieldDriver';
import { NODE_TIER, QUADRANT, fixedFieldBreath } from '../../v2/field/fieldFrame';
import { fieldPixel, pixelTerms, type FieldFrame } from '../../v2/field/fieldLaw';
import { emptyLedger } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { BASE, DIRECTIONS, type Face } from '../../v2/tokens/tokens.generated';
import { FIELD_STATICS, sceneSpec } from '../fieldScenes';
import { parseLabArgs } from '../params';
import {
  PATCH_KINDS, WITNESS_HERO, WITNESS_SCENE_FACTS, WITNESS_TIER, WITNESS_TIME_MS, bytesHex, noiseFree, patchBytes, w1aFrame,
  w1bFrame, witnessColours, witnessFace, witnessSceneId,
} from '../witness/witnessFrames';
import { GAP_DP, PATCH_DP, SAMPLE_DP, sampleOf, witnessLayout, type WitnessLayout } from '../witness/witnessLayout';

// B8-2 (the architect's B8 plan; B4 fork 2E; the designer's 3c amendments): the colour-path witness's frames and layout,
// on the JS law. Per face: the four anchors at the face's tier (joy and intense among them) and the face's ground; W1a is
// the runtime effect with every ground set to the colour, grain and dither 0; W1b a production high-k patch of the hero
// scene one.joy; W2 the hex as a Skia paint; W3 the hex as a React Native View; and the three planted wrong paths
// (B8-1's models). The pixels themselves are drawn in CanvasKit in witnessFrames.skia.test.ts.

const FACES: readonly Face[] = ['dark', 'light'];
type Rect = { x: number; y: number; width: number; height: number };
const gapBetween = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
/** The distance from a point to the nearest point of a rect (0 inside it), and to its farthest corner. */
const nearest = (r: Rect, px: number, py: number) => Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.width)), Math.max(r.y - py, 0, py - (r.y + r.height)));
const farthest = (r: Rect, px: number, py: number) => Math.hypot(Math.max(Math.abs(r.x - px), Math.abs(r.x + r.width - px)), Math.max(Math.abs(r.y - py), Math.abs(r.y + r.height - py)));

/** Every render-pixel centre of a dp rect, in render px. */
function renderPixels(r: Rect, k: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = Math.ceil(r.y * k - 0.5); y + 0.5 <= (r.y + r.height) * k; y++) {
    for (let x = Math.ceil(r.x * k - 0.5); x + 0.5 <= (r.x + r.width) * k; x++) out.push([x + 0.5, y + 0.5]);
  }
  return out;
}

describe('the witness colours, per face', () => {
  it.each(FACES)('%s: the four anchors at the face\'s tier, then the face\'s ground', (face) => {
    const colours = witnessColours(face);
    expect(colours.map((c) => c.name)).toEqual(['joy', 'calm', 'reflective', 'intense', 'ground']);
    for (const c of colours.slice(0, 4)) {
      expect(c.hex).toBe(BASE.emotion[c.name as (typeof QUADRANT)[keyof typeof QUADRANT]][NODE_TIER[face]].hex);
    }
    expect(colours[4].hex).toBe(DIRECTIONS.abyss.color[face].ground.hex);
    for (const c of colours) expect(c.bytes).toEqual(hexBytes(c.hex));
  });

  it('the patch kinds, and the bytes each paints or is held to: the token, or a planted model of it', () => {
    expect(PATCH_KINDS).toEqual(['W1a', 'W2', 'W3', 'misreadAsP3', 'doubleEncode', 'skipEncode']);
    const joy = witnessColours('dark')[0];
    for (const kind of ['W1a', 'W2', 'W3'] as const) expect(patchBytes(kind, joy)).toEqual(joy.bytes);
    for (const model of ['misreadAsP3', 'doubleEncode', 'skipEncode'] as const) expect(patchBytes(model, joy)).toEqual(WITNESS_MODELS[model](joy.bytes));
    expect(bytesHex(joy.bytes)).toBe(joy.hex);
    expect(bytesHex([227, 182, 3]).split('#')).toEqual(['', 'E3B603']); // upper case, two digits a channel
    expect(hexBytes(bytesHex([0, 15, 255]))).toEqual([0, 15, 255]);
  });
});

describe('the witness scene ids and their facts', () => {
  it('one scene per face, witness.abyss.<face>, its facts the W1b frame\'s', () => {
    expect(Object.keys(WITNESS_SCENE_FACTS)).toEqual(['witness.abyss.dark', 'witness.abyss.light']);
    for (const face of FACES) {
      expect(witnessSceneId(face)).toBe(`witness.abyss.${face}`);
      expect(witnessFace(witnessSceneId(face))).toBe(face);
      expect(WITNESS_SCENE_FACTS[witnessSceneId(face)]).toEqual({ id: `witness.abyss.${face}`, direction: 'abyss', face, hero: 'one.joy', tier: 'full' });
    }
    expect([WITNESS_HERO, WITNESS_TIER, WITNESS_TIME_MS]).toEqual(['one.joy', 'full', DIRECTIONS.abyss.field.stillTime]);
  });

  it.each(['witness.abyss.dusk', 'witness.abyss', 'field.abyss.dark.one.joy.full', 'witness.abyss.dark.x'])('refuses %s', (id) => {
    expect(() => witnessFace(id)).toThrow(/not a witness scene/);
  });
});

describe('W1a: the runtime effect with every ground set to the colour, grain and dither 0', () => {
  it.each(FACES)('%s: every colour is its own hex ±1 over the whole patch, on the law', (face) => {
    for (const colour of witnessColours(face)) {
      const f = w1aFrame(face, colour, { width: 32, height: 32 });
      expect([f.grounds.outside, f.grounds.face, f.grounds.ring].every((g) => g.L === f.grounds.outside.L && g.a === f.grounds.outside.a && g.b === f.grounds.outside.b)).toBe(true);
      expect([f.grain.inside, f.grain.ground, f.dither, f.vignette, f.centreLift, f.quiet.rects.length]).toEqual([0, 0, 0, 0, 0, 0]);
      expect(f.shadows.every((s) => s.strength === 0)).toBe(true);
      for (let y = 0; y < 32; y += 3) for (let x = 0; x < 32; x += 3) {
        expect(lsbDelta(fieldPixel(f, x + 0.5, y + 0.5), colour.bytes)).toBeLessThanOrEqual(1);
      }
    }
  });
});

const GEOMETRY = (layout: FieldLayout, pxPerDp: number) => renderGeometry(layout, pxPerDp, renderScaleFor(WITNESS_TIER));

describe('W1b: a production frame of the hero scene one.joy', () => {
  it.each(FACES)('%s: its uniforms are the ones FieldView\'s own step packs for the scene at t*', (face) => {
    const spec = sceneSpec(`field.abyss.${face}.one.joy.full`, 'field');
    const layout = spec.layout(PHONE.width, PHONE.height, 1);
    const geometry = GEOMETRY(layout, PHONE.pxPerDp);
    const step = fieldStep(emptyLedger(ledgerConfigFor('abyss', face, FIELD_STATICS, geometry)), { seq: 0, taps: spec.taps }, 0,
      { direction: 'abyss', face, stress: 0, confidence: 1, genesis: false, tier: 'full' }, geometry, FIELD_STATICS,
      WITNESS_TIME_MS, fixedFieldBreath('abyss', 0, WITNESS_TIME_MS).phase);
    expect(step.error).toBeNull();
    const w1b = w1bFrame(face, layout, PHONE.pxPerDp);
    expect(w1b.uniforms).toEqual(step.uniforms);
    expect(w1b.renderScale).toBe(renderScaleFor('full'));
    expect(w1b.frame.nodes.filter((n) => n.fade > 0 && n.bead !== null)).toHaveLength(1);
  });

  it('noiseFree zeroes the grain and the dither, and nothing else', () => {
    const { frame } = w1bFrame('dark', heroOf('dark'), PHONE.pxPerDp);
    expect(noiseFree(frame)).toEqual({ ...frame, grain: { inside: 0, ground: 0 }, dither: 0 });
    expect(frame.grain.inside).toBeGreaterThan(0);
    expect(frame.dither).toBeGreaterThan(0);
  });
});

function heroOf(face: Face, width: number = PHONE.width, height: number = PHONE.height, fontScale = 1): FieldLayout {
  return sceneSpec(`field.abyss.${face}.one.joy.full`, 'field').layout(width, height, fontScale);
}

// The board's phone, and a narrower, shorter one (a 1080 × 2340 panel at 450 dpi, as the S22+ reports), at font scale 1
// and 1.3: the layout must hold its rules on each.
const STAGES: ReadonlyArray<readonly [string, number, number, number, number]> = [
  ['the board phone', PHONE.width, PHONE.height, PHONE.pxPerDp, 1],
  ['a 384 × 832 dp phone', 1080 / 2.8125, 2340 / 2.8125, 2.8125, 1],
  ['the board phone at font scale 1.3', PHONE.width, PHONE.height, PHONE.pxPerDp, 1.3],
];
const CASES = FACES.flatMap((face) => STAGES.map(([name, w, h, k, scale]) => [face, name, w, h, k, scale] as const));

describe('the witness layout', () => {
  const layouts = new Map<string, WitnessLayout>();
  const layoutOf = (face: Face, w: number, h: number, k: number, fontScale: number) => {
    const key = `${face}|${w}|${h}|${k}|${fontScale}`;
    if (!layouts.has(key)) layouts.set(key, witnessLayout(face, w, h, k, fontScale));
    return layouts.get(key)!;
  };

  it('the patch geometry constants are the designer\'s: at least 24 dp, 8 dp apart, sampled over the central 16 dp', () => {
    expect([PATCH_DP, GAP_DP, SAMPLE_DP]).toEqual([24, 8, 16]);
    expect(sampleOf({ x: 10, y: 20, width: 24, height: 24 })).toEqual({ x: 14, y: 24, width: 16, height: 16 });
  });

  it.each(CASES)('%s, %s: every kind of every colour once, then W1b, each patch at least 24 dp with its central 16 dp sample', (face, _n, w, h, k, fontScale) => {
    const l = layoutOf(face, w, h, k, fontScale);
    expect(l.field).toEqual(heroOf(face, w, h, fontScale));
    expect(l.patches).toHaveLength(PATCH_KINDS.length * 5);
    const keys = l.patches.map((p) => `${p.kind}|${p.colour}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of [...l.patches, l.w1b]) {
      expect(p.rect.width).toBeGreaterThanOrEqual(PATCH_DP);
      expect(p.rect.height).toBeGreaterThanOrEqual(PATCH_DP);
      expect(p.sample).toEqual(sampleOf(p.rect));
    }
  });

  it.each(CASES)('%s, %s: the patches and W1b are 8 dp apart, 8 dp inside the stage and 8 dp clear of every quiet rect', (face, _n, w, h, k, fontScale) => {
    const l = layoutOf(face, w, h, k, fontScale);
    const all = [...l.patches.map((p) => p.rect), l.w1b.rect];
    const stage = { x: GAP_DP, y: GAP_DP, width: w - 2 * GAP_DP, height: h - 2 * GAP_DP };
    expect(l.field.quietRects?.length).toBe(5);
    for (let i = 0; i < all.length; i++) {
      expect(inside(all[i], stage)).toBe(true);
      for (let j = i + 1; j < all.length; j++) expect(gapBetween(all[i], all[j])).toBeGreaterThanOrEqual(GAP_DP);
      for (const q of l.field.quietRects ?? []) expect(gapBetween(all[i], q)).toBeGreaterThanOrEqual(GAP_DP);
    }
  });

  it.each(CASES)('%s, %s: away from the ring and every halo: each patch is on the face or beyond the moat, 8 dp clear', (face, _n, w, h, k, fontScale) => {
    const l = layoutOf(face, w, h, k, fontScale);
    const { frame } = w1bFrame(face, l.field, k);
    const R = l.field.radius;
    const [cx, cy] = l.field.centre;
    const faceDp = frame.ringInner * R - GAP_DP;
    const moatDp = frame.moatOuter * R + GAP_DP;
    const beads = frame.nodes.filter((n) => n.fade > 0 && n.bead !== null).map((n) => [cx + n.bead![0] * R, cy - n.bead![1] * R] as const);
    expect(beads).toHaveLength(1);
    for (const r of [...l.patches.map((p) => p.rect), l.w1b.rect]) {
      expect(farthest(r, cx, cy) <= faceDp || nearest(r, cx, cy) >= moatDp).toBe(true);
      for (const [bx, by] of beads) expect(nearest(r, bx, by)).toBeGreaterThanOrEqual(frame.haloRadius * R + GAP_DP);
    }
    expect(farthest(l.w1b.rect, cx, cy)).toBeLessThanOrEqual(faceDp); // W1b is on the field, on the face
  });

  it.each(CASES)('%s, %s: W1b samples the field where it is: every render pixel of its sample has extent > 0, no halo, no quiet zone, and a high k', (face, _n, w, h, k, fontScale) => {
    const l = layoutOf(face, w, h, k, fontScale);
    const { frame, renderScale } = w1bFrame(face, l.field, k);
    const px = renderPixels(l.w1b.sample, k * renderScale);
    expect(px.length).toBeGreaterThanOrEqual(400);
    let minK = Infinity;
    for (const [x, y] of px) {
      const t = pixelTerms(frame, x, y);
      expect(t.region).toBe('face');
      expect(t.coverage).toBe(0);
      expect(t.kField).toBeGreaterThan(0); // k_field = kField·m·extent: > 0 only where the extent is
      expect(t.h.every((v) => v === 0)).toBe(true);
      expect(noQuietAt(frame, x, y)).toBe(true);
      minK = Math.min(minK, t.k);
    }
    // High k: at least half the frame's field weight everywhere in the sample.
    expect(minK).toBeGreaterThanOrEqual(0.5 * frame.kField);
  });

  it.each(FACES)('%s: the planted patches name whether they must fail the witness (B8-1 D5), and the W kinds paint the token', (face) => {
    const l = witnessLayout(face, PHONE.width, PHONE.height, PHONE.pxPerDp, 1);
    for (const p of l.patches) {
      const colour = witnessColours(face).find((c) => c.name === p.colour)!;
      expect(p.token).toEqual(colour.bytes);
      if (p.kind === 'W1a') expect(p.paint).toBeNull();
      else expect(p.paint).toBe(bytesHex(patchBytes(p.kind, colour)));
      const planted = p.kind !== 'W1a' && p.kind !== 'W2' && p.kind !== 'W3';
      expect(p.separates).toBe(planted && lsbDelta(patchBytes(p.kind, colour), colour.bytes) > MODEL_SEPARATION_LSB);
    }
    // Only the ground's misread is identity-only (displayP3.test.ts D5): every other planted patch must fail.
    expect(l.patches.filter((p) => p.kind !== 'W1a' && p.kind !== 'W2' && p.kind !== 'W3' && !p.separates).map((p) => `${p.kind}|${p.colour}`)).toEqual(['misreadAsP3|ground']);
  });

  it('is a pure function of its inputs (the report rebuilds it from the manifest)', () => {
    expect(witnessLayout('dark', PHONE.width, PHONE.height, PHONE.pxPerDp, 1)).toEqual(witnessLayout('dark', PHONE.width, PHONE.height, PHONE.pxPerDp, 1));
  });

  it('a stage too small for every patch, or with no place for W1b, is a RangeError naming it, never a dropped patch', () => {
    expect(() => witnessLayout('dark', 280, 500, 2.625, 1)).toThrow(new RangeError('witness layout: only 24 of 30 patches fit on a 280×500 dp stage'));
    expect(() => witnessLayout('dark', 411, 420, 2.625, 1)).toThrow(new RangeError('witness layout: no place on the dark face for W1b on a 411×420 dp stage'));
  });
});

/** No quiet rect reaches the pixel: the quiet factor is 1 there. */
function noQuietAt(frame: FieldFrame, x: number, y: number): boolean {
  const g = frame.quiet.grow + frame.quiet.feather;
  return frame.quiet.rects.every((r) => Math.abs(x - r.cx) > r.hx + g || Math.abs(y - r.cy) > r.hy + g);
}

describe('the witness capture plan (scripts/lab/capture-plans/v1-witness.json)', () => {
  const plan = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../scripts/lab/capture-plans/v1-witness.json'), 'utf8')) as {
    id: string;
    shots: Array<{ id: string; repeat: number; scene: string; args: Record<string, string>; probes: string[]; device: { night: string; fontScale: number; animatorScale: number; powerSave: boolean }; expect: unknown }>;
  };
  const timings = Object.fromEntries(Object.keys(WITNESS_SCENE_FACTS).map((id) => [id, { periodMs: BASE.field.clock.T }]));

  it('is a valid plan for the harness, one shot per face, twice', () => {
    expect(validatePlan(plan)).toEqual([]);
    expect(plan.id).toBe('v1-witness');
    expect(plan.shots.map((s) => s.scene).sort()).toEqual(Object.keys(WITNESS_SCENE_FACTS).sort());
  });

  it('each shot: its expect is the catalogue\'s facts, the night mode its face, a fixed clock the lab parses, the stage probe', () => {
    for (const shot of plan.shots) {
      const facts = WITNESS_SCENE_FACTS[shot.scene];
      expect(shot.expect).toEqual({ direction: facts.direction, face: facts.face, hero: facts.hero, tier: facts.tier });
      expect(shot.device).toEqual({ fontScale: 1, night: facts.face === 'dark' ? 'yes' : 'no', animatorScale: 1, powerSave: false });
      expect(shot.probes).toEqual(['stage']);
      expect(shot.repeat).toBe(2);
      const parsed = parseLabArgs({ ...shot.args, run: 'plan-check', scene: shot.scene }, [], timings);
      expect(parsed).toMatchObject({ ok: true, params: { clock: 'fixed' } });
      expect(parsed.ok && parsed.params.frames).toBeGreaterThanOrEqual(10);
    }
  });
});
