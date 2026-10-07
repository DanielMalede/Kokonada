// The never-red sweeps over the committed tokens, per direction and face (QA-065, DSN-013, DSN-019).
//
// Two kinds:
//   • fieldSweepFor: the blend graph composited over every local ground the field or a halo lands
//     on (blendSpace.ts), including each ground the plate's shadows darken or lift, at P 0.5 and 1.
//   • edgeFamiliesFor: every pair of colours that meet at an anti-aliased edge, a stroke, a shadow
//     tail or a gradient, blended in sRGB as Skia draws them (edgeSweep.ts). Each family reports its
//     exact largest in-band chroma in float (design band) and on 8-bit pixels (check band).
//
// tokens.rules.test.ts asserts DEC-081's margin on both; the evidence scripts print the same
// numbers. The graph's edges come from the extensions module, which only tests, scripts and the lab
// import, so the caller passes them in. Sweep-only: never imported by app code.

import { pivotComposite, samplesAround, sweepNeverRed, type BlendGraph, type NeverRedReport, type NeverRedSweep } from '../color/blendSpace.ts';
import { maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type BlendMax, type Bytes } from '../color/edgeSweep.ts';
import { mixSafe } from '../color/mixSafe.ts';
import { mixOklab, type Oklab, type Srgb } from '../color/oklab.ts';
import { ditherReachable, type RedBand } from '../color/redBand.ts';
import { sweepOklabToSrgb } from '../color/sweepConvert.ts';
import { BASE, DIRECTIONS, type ColorValue, type DirectionId, type Face } from './tokens.generated.ts';

export interface GraphEdges {
  readonly straight: ReadonlyArray<readonly [string, string]>;
  readonly waypoint: ReadonlyArray<readonly [string, string]>;
  readonly restIntense: readonly [string, string];
}

const band = (b: { hueStart: number; hueEnd: number; chromaFloor: number }): RedBand => ({
  hueFrom: b.hueStart,
  hueTo: b.hueEnd,
  chromaFloor: b.chromaFloor,
});
export const DESIGN_BAND = band(BASE.neverRed.design);
export const CHECK_BAND = band(BASE.neverRed.check);

export const lab = (c: ColorValue): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
/** Dark faces carry the core tier of each emotion, light faces the deep tier (designer §1.1). */
export const tierFor = (face: Face) => (face === 'dark' ? 'core' : 'deep');
const QUADRANTS = ['joy', 'calm', 'reflective', 'intense'] as const;

/** The field's dither plus the larger grain: the L excursion an 8-bit field pixel can take. */
const amplitudeFor = (id: DirectionId) =>
  BASE.field.dither.amplitude + Math.max(DIRECTIONS[id].field.grain.ground, DIRECTIONS[id].field.grain.inside);
const haloPeak = (face: Face) => (face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight);

/**
 * How finely a sweep samples: 'coarse' in the default jest run, 'full' in the sweeps project
 * (UI-073), which runs serially in its own CI step.
 */
export type SweepResolution = 'coarse' | 'full';

/**
 * The field sweep's grids; neverRed.field.test.ts pins both. Float is exact over t and presence,
 * sampled at k 0.01 and shimmer 1°, in both. The default 8-bit grid is coarser (t and k at 0.2, each
 * end of a segment at −shimmer, 0 and +shimmer), because rounding is a small perturbation of the
 * float colour; the full grid takes t and k at 0.1 and pixel shimmer at 1°, so it also sees a colour
 * just outside the design band that rounding turns into the check band.
 */
function fieldGrid(resolution: SweepResolution): NeverRedSweep['grid'] {
  const chromaScales = [0.25, 0.5, 1];
  return resolution === 'full'
    ? { kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.1, pixelKStep: 0.1, chromaScales, pixelShimmerStepDeg: 1 }
    : { kStep: 0.01, shimmerStepDeg: 1, pixelTStep: 0.2, pixelKStep: 0.2, chromaScales };
}

/**
 * The plate's shadows under the field (designer ruling 2.9, with the critic's text the designer
 * adopted): G.L ← G.L·(1 − Σ strength·P) over the face's plate.shadow and plate.shadow2, outer shadows
 * (plate.depth > 0) outside the rim, where the field lands only if mask.outside > 0, inner ones (< 0)
 * on the face. A shadow with no strength or no blur draws nothing (fieldFrame.ts). Null where no
 * shadow lands under the field.
 */
function plateShadowsUnderField(id: DirectionId, face: Face): { readonly under: 'face' | 'ground'; readonly sum: number } | null {
  const d = DIRECTIONS[id];
  const drawn = [d.plate.shadow[face], d.plate.shadow2[face]].filter((t) => t.strength !== 0 && t.blur > 0);
  const under = d.plate.depth < 0 ? 'face' : d.plate.depth > 0 && d.field.mask.outside > 0 ? 'ground' : null;
  if (drawn.length === 0 || under === null) return null;
  return { under, sum: drawn.reduce((t, x) => t + x.strength, 0) };
}

/** The shadow profile values the sweep adds (P = 0 is the ground itself): quantisation near black is not monotone in L. */
const SHADOW_PROFILE = [0.5, 1];

export function fieldSweepFor(
  id: DirectionId,
  face: Face,
  graphEdges: GraphEdges,
  edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> },
  resolution: SweepResolution = 'coarse',
): NeverRedSweep {
  const d = DIRECTIONS[id];
  const colours = d.color[face];
  const tier = tierFor(face);
  const routed = d.field.graph.restIntenseRoute === 'waypoint';
  const graph: BlendGraph = {
    nodes: {
      J: lab(BASE.emotion.joy[tier]),
      C: lab(BASE.emotion.calm[tier]),
      R: lab(BASE.emotion.reflective[tier]),
      I: lab(BASE.emotion.intense[tier]),
      R0: lab(colours.field.restGlow),
    },
    straight: edges?.straight ?? [...graphEdges.straight, ...(routed ? [] : [graphEdges.restIntense])],
    waypoint: edges?.waypoint ?? [...graphEdges.waypoint, ...(routed ? [graphEdges.restIntense] : [])],
  };
  const grounds: Record<string, Oklab> = { face: lab(colours.plate.face), ring: lab(colours.plate.ring) };
  if (d.field.mask.outside > 0) grounds.ground = lab(colours.ground);
  // Each shadowed ground, on L only, at every profile value.
  const shadows = plateShadowsUnderField(id, face);
  if (shadows !== null) {
    const g = grounds[shadows.under];
    for (const P of SHADOW_PROFILE) grounds[`${shadows.under} shadowed ${P}`] = { L: g.L * (1 - shadows.sum * P), a: g.a, b: g.b };
  }
  return {
    graph,
    grounds,
    kMax: Math.max(d.field.cap[face], haloPeak(face)),
    kp: d.field.pivot,
    shimmerDeg: d.field.shimmer.deg,
    designBand: DESIGN_BAND,
    checkBand: CHECK_BAND,
    ditherAmplitude: amplitudeFor(id),
    grid: fieldGrid(resolution),
  };
}

// ---------------------------------------------------------------- edge families

export interface EdgeFamilyMax {
  readonly family: string;
  /** Float sRGB blends against the design band. */
  readonly design: BlendMax;
  /** 8-bit blends, every GPU rounding, against the check band. */
  readonly check: BlendMax & { readonly pixel?: Bytes };
  /** The distinct 8-bit blends (background, ink, coverage cap) checked: how much the grid saw. */
  readonly pixelBlends: number;
}

const toBytes = (rgb: Srgb): Bytes =>
  rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255)) as unknown as Bytes;
const hexBytes = (c: ColorValue): Bytes => [1, 3, 5].map((i) => parseInt(c.hex.slice(i, i + 2), 16)) as unknown as Bytes;
const scale = (c: Oklab, p: number): Oklab => ({ L: c.L, a: c.a * p, b: c.b * p });
const rotate = (c: Oklab, deg: number): Oklab => {
  const r = (deg * Math.PI) / 180;
  return { L: c.L, a: c.a * Math.cos(r) - c.b * Math.sin(r), b: c.a * Math.sin(r) + c.b * Math.cos(r) };
};
const upTo = (limit: number, step: number) => {
  const n = Math.max(1, Math.ceil(limit / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? limit : (i * limit) / n));
};

/**
 * The edge sweep's grids, 'coarse' for the default run and 'full' for the sweeps project (UI-073);
 * neverRed.edges.test.ts pins both.
 *   • floatKStep: the halo and field k step of the exact float pass (design band).
 *   • byteKStep: the k step of the 8-bit pass (check band).
 *   • presenceShares: the bead presences, as shares of the direction's bead chroma scale.
 *   • shimmerStepDeg: the turns of a field-lit colour; null takes only −shimmer, 0 and +shimmer.
 *   • byteBackground: 'nearest' takes the nearest pixels of a lit colour at L − A, L and L + A;
 *     'dithered' takes every pixel the dither and grain reach over L ± A (ditherReachable).
 *   • ctaMixSteps: the CTA fill is taken at every i / ctaMixSteps of each mixSafe transition.
 */
export const EDGE_SWEEP_GRIDS = {
  coarse: { floatKStep: 0.01, byteKStep: 0.1, presenceShares: [0.25, 0.5, 1], shimmerStepDeg: null, byteBackground: 'nearest', ctaMixSteps: 20 },
  full: { floatKStep: 0.01, byteKStep: 0.01, presenceShares: [0.25, 0.5, 1], shimmerStepDeg: 1, byteBackground: 'dithered', ctaMixSteps: 20 },
} as const;

export interface EdgeSweepInputs {
  readonly floatKStep: number;
  readonly byteKStep: number;
  /** The grid's presenceShares times the direction's bead chroma scale. */
  readonly presences: readonly number[];
  /** The turns a field-lit colour takes; halo-lit colours never turn. */
  readonly shimmers: readonly number[];
  /** The L shifts grain and dither give a lit surface in float: −A, 0 and +A. */
  readonly lShifts: readonly number[];
  /** The L shifts of the 8-bit backgrounds, before each is dithered by byteDitherAmplitude. */
  readonly byteLShifts: readonly number[];
  readonly byteDitherAmplitude: number;
  readonly ctaMixSteps: number;
}

/** What edgeFamiliesFor sweeps for a direction, from the grid and the direction's tokens. */
export function edgeSweepInputs(id: DirectionId, resolution: SweepResolution = 'coarse'): EdgeSweepInputs {
  const d = DIRECTIONS[id];
  const deg = d.field.shimmer.deg;
  const amplitude = amplitudeFor(id);
  const grid = EDGE_SWEEP_GRIDS[resolution];
  const lShifts = [-amplitude, 0, amplitude];
  const dithered = grid.byteBackground === 'dithered';
  return {
    floatKStep: grid.floatKStep,
    byteKStep: grid.byteKStep,
    presences: grid.presenceShares.map((p) => p * d.bead.chromaScale),
    shimmers: grid.shimmerStepDeg === null ? samplesAround(deg, deg || 1) : samplesAround(deg, grid.shimmerStepDeg),
    lShifts,
    byteLShifts: dithered ? [0] : lShifts,
    byteDitherAmplitude: dithered ? amplitude : 0,
    ctaMixSteps: grid.ctaMixSteps,
  };
}

/**
 * The coverages an ink at coverage α ∈ (0, 1] is swept over: [0, α] in float; 1 to ⌈α·255⌉ on 8-bit
 * pixels, at most 254 (255 is the ink itself, which the authored-colour check covers). For α > 0,
 * ⌈α·255⌉ is at least 1.
 */
export function coverageRange(coverage: number): { readonly float: readonly [number, number]; readonly bytes: readonly [number, number] } {
  if (!(coverage > 0 && coverage <= 1)) {
    throw new RangeError(`an ink's coverage must be in (0, 1], got ${coverage}`);
  }
  return { float: [0, coverage], bytes: [1, Math.min(254, Math.ceil(coverage * 255))] };
}

/** An ink and how far it can cover: 1 for a solid edge, its alpha for a shadow. */
interface Ink {
  readonly colour: ColorValue;
  readonly coverage: number;
}

// Plain fields only: Node's type stripping (the evidence scripts load this module) has no
// parameter properties.
class Family {
  readonly family: string;
  design: BlendMax = { chroma: 0, hue: NaN, coverage: NaN };
  check: BlendMax & { pixel?: Bytes } = { chroma: 0, hue: NaN, coverage: NaN };
  private readonly seen = new Set<string>();

  constructor(family: string) {
    this.family = family;
  }

  float(bg: Srgb, ink: Srgb, coverage: number): void {
    const found = maxInBandOnSrgbBlend(bg, ink, DESIGN_BAND, coverageRange(coverage).float[1]);
    if (found.chroma > this.design.chroma) this.design = found;
  }

  pixels(bg: Bytes, ink: Bytes, coverage: number): void {
    const cap = coverageRange(coverage).bytes[1];
    const key = `${bg.join(',')}>${ink.join(',')}@${cap}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const found = maxInBandOnPixelBlend(bg, ink, CHECK_BAND, cap);
    if (found.chroma > this.check.chroma) this.check = found;
  }

  result(): EdgeFamilyMax {
    return { family: this.family, design: this.design, check: this.check, pixelBlends: this.seen.size };
  }
}

export function edgeFamiliesFor(id: DirectionId, face: Face, resolution: SweepResolution = 'coarse'): EdgeFamilyMax[] {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  const tier = tierFor(face);
  const kp = d.field.pivot;
  const { floatKStep, byteKStep, presences, shimmers, lShifts, byteLShifts, byteDitherAmplitude, ctaMixSteps } = edgeSweepInputs(id, resolution);
  const anchors = QUADRANTS.map((q) => lab(BASE.emotion[q][tier]));
  const srgb = (x: Oklab) => sweepOklabToSrgb(x);

  // Surfaces lit by a halo (no shimmer: marks never shimmer) or by the field (which shimmers).
  const lit = (ground: Oklab, nodes: Oklab[], kMax: number, turns: readonly number[], kStep: number): Oklab[] => {
    const out: Oklab[] = [];
    for (const node of nodes) {
      for (const p of presences) {
        for (const phi of turns) {
          for (const k of upTo(kMax, kStep)) out.push(pivotComposite(rotate(scale(node, p), phi), ground, k, kp));
        }
      }
    }
    return out;
  };
  // Grain and dither move a surface pixel on L only, by up to ±amplitude. Each lit surface is taken
  // at L − amplitude, L and L + amplitude ("grain at both extremes", designer §1.2 step 1), in float
  // and as its 8-bit pixel (a rounding tie either way). At full resolution each 8-bit background is
  // instead every pixel the dither and grain reach over L ± amplitude (byteLShifts [0], dithered).
  const shiftedBy = (deltas: readonly number[]) => (colours: Oklab[]): Oklab[] =>
    colours.flatMap((colour) => deltas.map((delta) => ({ L: colour.L + delta, a: colour.a, b: colour.b })));
  const shifted = shiftedBy(lShifts);
  const byteShifted = shiftedBy(byteLShifts);
  const quantised = (colours: Oklab[]): Bytes[] => {
    const out = new Map<string, Bytes>();
    for (const colour of colours) {
      for (const p of ditherReachable(colour, byteDitherAmplitude)) {
        const bytes = toBytes(p);
        out.set(bytes.join(','), bytes);
      }
    }
    return [...out.values()];
  };
  const ring = lab(c.plate.ring);
  const faceGround = lab(c.plate.face);
  const fieldNodes = [...anchors, lab(c.field.restGlow)];
  const ringFloat = shifted(lit(ring, anchors, haloPeak(face), [0], floatKStep));
  const ringBytes = quantised(byteShifted(lit(ring, anchors, haloPeak(face), [0], byteKStep)));
  const faceFloat = shifted([
    ...lit(faceGround, anchors, haloPeak(face), [0], floatKStep),
    ...(d.field.mask.face > 0 ? lit(faceGround, fieldNodes, d.field.cap[face], shimmers, floatKStep) : []),
  ]);
  const faceBytes = quantised(
    byteShifted([
      ...lit(faceGround, anchors, haloPeak(face), [0], byteKStep),
      ...(d.field.mask.face > 0 ? lit(faceGround, fieldNodes, d.field.cap[face], shimmers, byteKStep) : []),
    ]),
  );

  const shadows: Ink[] = [{ colour: c.bead.shadow, coverage: c.bead.shadow.alpha }];
  const levels = ['none', 'e1', 'e2', 'raised', 'recessed'] as const;
  const elevation: Ink[] = levels.flatMap((level) => d.elevation[level][face].map((layer) => ({ colour: layer.color, coverage: layer.color.alpha })));

  const families: Family[] = [];
  const over = (name: string, bgFloat: Oklab[], bgBytes: Bytes[], inks: Ink[]) => {
    const family = new Family(name);
    for (const ink of inks) {
      const inkFloat = srgb(lab(ink.colour));
      const inkBytes = hexBytes(ink.colour);
      for (const bg of bgFloat) family.float(srgb(bg), inkFloat, ink.coverage);
      for (const bg of bgBytes) family.pixels(bg, inkBytes, ink.coverage);
    }
    families.push(family);
  };
  const solid = (colour: ColorValue): Ink => ({ colour, coverage: 1 });

  // The ring, lit by halos: the rim words, the rim stroke, the highlight line, settings, shadows.
  over('ring halo · text.primary', ringFloat, ringBytes, [solid(c.text.primary)]);
  over('ring halo · plate.rim.base', ringFloat, ringBytes, [solid(c.plate.rim.base)]);
  over('ring halo · plate.rim.lit', ringFloat, ringBytes, [solid(c.plate.rim.lit)]);
  over('ring halo · plate.ringHighlight', ringFloat, ringBytes, [solid(c.plate.ringHighlight)]);
  over('ring halo · bead.setting', ringFloat, ringBytes, [solid(c.bead.setting)]);
  over('ring halo · bead.shadow at α', ringFloat, ringBytes, shadows);
  if (elevation.length > 0) over('ring halo · elevation shadows at α', ringFloat, ringBytes, elevation);
  // The face, lit by halos and (where the mask lets it in) by the field.
  over('face lit · bead.setting', faceFloat, faceBytes, [solid(c.bead.setting)]);
  over('face lit · bead.shadow at α', faceFloat, faceBytes, shadows);
  if (elevation.length > 0) over('face lit · elevation shadows at α', faceFloat, faceBytes, elevation);

  // Beads: each fill against its setting ring, and its fill-to-highlight gradient.
  const white = { L: 1, a: 0, b: 0 };
  const fills = anchors.flatMap((node) => presences.map((p) => scale(node, p)));
  const pairsOf = (name: string, pairs: Array<[Oklab, Oklab]>) => {
    const family = new Family(name);
    for (const [a, b] of pairs) {
      family.float(srgb(a), srgb(b), 1);
      family.pixels(toBytes(srgb(a)), toBytes(srgb(b)), 1);
    }
    families.push(family);
  };
  pairsOf('bead fill · bead.setting', fills.map((f) => [f, lab(c.bead.setting)]));
  pairsOf('bead fill · highlight', fills.map((f) => [f, mixOklab(f, white, d.bead.highlight.mix)]));

  // The CTA: the four tints and the neutral fill, and every mixSafe step between any two of them.
  const ends = [...anchors, lab(c.text.primary)];
  const ctaFills: Oklab[] = [...ends];
  for (const from of ends) {
    for (const to of ends) {
      if (from === to) continue;
      for (let i = 1; i < ctaMixSteps; i++) ctaFills.push(mixSafe(from, to, i / ctaMixSteps, DESIGN_BAND));
    }
  }
  pairsOf('CTA fill · text.onTint', ctaFills.map((f) => [f, lab(c.text.onTint)]));
  pairsOf('CTA fill · text.onInk', ctaFills.map((f) => [f, lab(c.text.onInk)]));
  if (d.cta.keyline > 0) {
    const keyline = (f: Oklab): Oklab => ({ L: f.L, a: 0, b: 0 });
    pairsOf('CTA fill · keyline', ctaFills.map((f) => [f, keyline(f)]));
    pairsOf('CTA keyline · ground', ctaFills.map((f) => [keyline(f), lab(c.ground)]));
  } else {
    pairsOf('CTA fill · ground', ctaFills.map((f) => [f, lab(c.ground)]));
  }
  return families.map((family) => family.result());
}

// ---------------------------------------------------------------- the sweeps project (UI-073)

/** The field at full resolution, for one direction and face: what the sweeps project checks. */
export function fullFieldReport(id: DirectionId, face: Face, graphEdges: GraphEdges): { grid: NeverRedSweep['grid']; report: NeverRedReport } {
  const config = fieldSweepFor(id, face, graphEdges, undefined, 'full');
  return { grid: config.grid, report: sweepNeverRed(config) };
}

/**
 * The edges at full resolution, for one direction and face, with the families over a lit surface
 * that did not check more pixel blends than the default grid: the proof the full grid really ran.
 */
export function fullEdgeReport(id: DirectionId, face: Face): { families: EdgeFamilyMax[]; litFamilies: number; notFiner: string[] } {
  const full = edgeFamiliesFor(id, face, 'full');
  const coarse = edgeFamiliesFor(id, face);
  const lit = (f: EdgeFamilyMax) => f.family.startsWith('ring halo') || f.family.startsWith('face lit');
  return {
    families: full,
    litFamilies: full.filter(lit).length,
    notFiner: full.filter((f, i) => lit(f) && !(f.pixelBlends > coarse[i].pixelBlends)).map((f) => f.family),
  };
}
