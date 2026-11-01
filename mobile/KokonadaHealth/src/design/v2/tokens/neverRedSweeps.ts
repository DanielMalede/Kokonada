// The never-red sweeps over the committed tokens, per direction and face (QA-065, DSN-013, DSN-019).
//
// Two kinds:
//   • fieldSweepFor: the blend graph composited over every local ground the field or a halo lands
//     on (blendSpace.ts), including each ground the plate's shadows darken or lift, at P 0.5 and 1,
//     and the face under its vignette and centre lift (faceShadingGrounds); and ringEdgeSweepFor, the
//     same over the ring's anti-aliased inner edge, the law's OKLab mixes of face and ring (UI-114), and
//     ringOuterSweepFor over its outer edge, the mixes of ring and outside ground (D6-1, UI-151).
//   • edgeFamiliesFor: every pair of colours that meet at an anti-aliased edge, a stroke, a shadow
//     tail or a gradient, blended in sRGB as Skia draws them (edgeSweep.ts). Each family reports its
//     exact largest in-band chroma in float (design band) and on 8-bit pixels (check band).
//
// tokens.rules.test.ts asserts DEC-081's margin on both; the evidence scripts print the same
// numbers. The graph's edges come from the extensions module, which only tests, scripts and the lab
// import, so the caller passes them in. Sweep-only: never imported by app code.

import { graphSegments, pivotComposite, samplesAround, samplesUpTo, sweepNeverRed, type BlendGraph, type NeverRedReport, type NeverRedSweep } from '../color/blendSpace.ts';
import { maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type BlendMax, type Bytes } from '../color/edgeSweep.ts';
import { mixSafe } from '../color/mixSafe.ts';
import { mixOklab, type Oklab, type Srgb } from '../color/oklab.ts';
import { ditherReachable, hueInBand, maxInBandChromaOfPixels, type RedBand } from '../color/redBand.ts';
import { sweepOklabToSrgb, sweepSrgbToOklab } from '../color/sweepConvert.ts';
import { edgeMixOklab } from '../field/fieldLaw.ts';
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

/**
 * The face's own shading (resilience HIGH-3, law round 2): the law draws the face ground at
 * L·(1 + vignette·ρ²) + centreLift·(1 − ρ²), ρ = d / ringInner in [0, 1), on L only (fieldLaw.ts
 * groundAt). Sampled at n + 1 evenly spaced ρ², both ends included, n the fewest steps whose L step is
 * at most the sweep's L amplitude A (dither plus grain). Every 8-bit pass that dithers over L ± A (the
 * field sweep, and the edge sweep at full resolution) then reaches every pixel any ρ² can show, because
 * neighbouring samples' intervals overlap; the float passes step L by A, as the grain shifts do. A
 * sample equal to the plain face, which the sweeps take as 'face', is left out. The plate's inner
 * shadows still shade the plain face only: their product with this shading belongs to the certified
 * sampler (law round 2, D8), and the UI-096 tripwire keeps every shipped shadow at 0 until it exists.
 */
export function faceShadingGrounds(id: DirectionId, face: Face): Record<string, Oklab> {
  const d = DIRECTIONS[id];
  const g = lab(d.color[face].plate.face);
  const vignette = d.plate.face.vignette[face];
  const lift = d.plate.face.centreLift[face];
  const at = (rho2: number) => g.L * (1 + vignette * rho2) + lift * (1 - rho2);
  const n = Math.max(1, Math.ceil(Math.abs(at(1) - at(0)) / amplitudeFor(id) - 1e-9));
  const out: Record<string, Oklab> = {};
  for (let i = 0; i <= n; i++) {
    const L = at(i / n);
    if (L !== g.L) out[`face ρ² ${i / n}`] = { L, a: g.a, b: g.b };
  }
  return out;
}

/** The ring edge's α steps per unit (UI-114): every 0.1 by default, every 0.02 in the sweeps project. */
const RING_EDGE_STEPS: Record<SweepResolution, number> = { coarse: 10, full: 50 };

/**
 * The ring's anti-aliased inner edge (law round 2, item 4, designer §4 (a), UI-114): the law mixes the
 * face's ground at d_f = ringInner (ρ = 1: the vignette in full, the lift's 1 − ρ² at 0) and the ring's,
 * in OKLab, at the ring's coverage α (fieldLaw.ts edgeMixOklab, the same function). One ground per α
 * strictly inside (0, 1); α 0 and 1 are the face at ρ = 1 and the ring, which the field sweep already
 * takes. The face's side never darkens past ρ = 1 inside the band, and within one canvas pixel of the
 * edge it differs from ρ = 1 by far less than the sweep's L amplitude (neverRed.field.test.ts reaches
 * every band pixel from these grounds). The inner shadows' product with the edge belongs to the certified
 * sampler (law round 2, D8), as for the face's shading, and the UI-096 tripwire keeps every shadow at 0.
 */
export function ringEdgeGrounds(id: DirectionId, face: Face, resolution: SweepResolution = 'coarse'): Record<string, Oklab> {
  const d = DIRECTIONS[id];
  const g = lab(d.color[face].plate.face);
  const faceEdge = { L: g.L * (1 + d.plate.face.vignette[face]), a: g.a, b: g.b };
  const ring = lab(d.color[face].plate.ring);
  const n = RING_EDGE_STEPS[resolution];
  const out: Record<string, Oklab> = {};
  for (let i = 1; i < n; i++) out[`face·ring α ${i / n}`] = edgeMixOklab(faceEdge, ring, i / n);
  return out;
}

/**
 * The field sweep over the ring edge's grounds (designer §4 (a)): the same graph, k range, pivot,
 * shimmer, bands and dither as fieldSweepFor, over ringEdgeGrounds at the resolution. Its grid is the
 * default field grid at both resolutions: the float pass there is already the full one (k 0.01,
 * shimmer 1°); the full 8-bit grid would cost about a minute per ground (dark), 49 grounds in full.
 */
export function ringEdgeSweepFor(
  id: DirectionId,
  face: Face,
  graphEdges: GraphEdges,
  edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> },
  resolution: SweepResolution = 'coarse',
): NeverRedSweep {
  return { ...fieldSweepFor(id, face, graphEdges, edges), grounds: ringEdgeGrounds(id, face, resolution) };
}

/**
 * The ring's anti-aliased outer edge (law round 2, D6-1 (d), the designer's ruling at UI-151): the law mixes the
 * ring's ground and the outside ground in OKLab at the outside's coverage β (fieldLaw.ts edgeMixOklab, the same
 * function). One ground per β strictly inside (0, 1), at the inner edge's steps: every 0.1 by default, every 0.02
 * in the sweeps project; β 0 and 1 are the ring and the ground, which the field sweep already takes. The outer
 * shadows read at q_o shade the outside side's L: no shipped direction draws one (the UI-096 tripwire), and their
 * product with the band belongs to the certified sampler (law round 2, D8), as the inner shadows' does.
 */
export function ringOuterGrounds(id: DirectionId, face: Face, resolution: SweepResolution = 'coarse'): Record<string, Oklab> {
  const c = DIRECTIONS[id].color[face];
  const ring = lab(c.plate.ring);
  const outside = lab(c.ground);
  const n = RING_EDGE_STEPS[resolution];
  const out: Record<string, Oklab> = {};
  for (let i = 1; i < n; i++) out[`ring·outside β ${i / n}`] = edgeMixOklab(ring, outside, i / n);
  return out;
}

/** The field sweep over the outer edge's grounds (D6-1 (d)): ringEdgeSweepFor's pass, over ringOuterGrounds. */
export function ringOuterSweepFor(
  id: DirectionId,
  face: Face,
  graphEdges: GraphEdges,
  edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> },
  resolution: SweepResolution = 'coarse',
): NeverRedSweep {
  return { ...fieldSweepFor(id, face, graphEdges, edges), grounds: ringOuterGrounds(id, face, resolution) };
}

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
  // The face's vignette and centre lift, which the field and the halos land on.
  Object.assign(grounds, faceShadingGrounds(id, face));
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

/**
 * The grounds the edge sweep composites over, with the plate's shadows (resilience, rulings after T5d,
 * §3): the face, its vignette and centre lift (faceShadingGrounds), and each inner-shadowed face at
 * every profile value; the ground, and each outer-shadowed ground. The law and the shader shade a
 * ground's L wherever a shadow is drawn, whether or not the field lands there, so the condition is
 * that a shadow is drawn (strength and blur), never the mask.
 */
export function plateShadowGrounds(id: DirectionId, face: Face): { readonly face: Record<string, Oklab>; readonly ground: Record<string, Oklab> } {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  // The face, then its vignette and centre lift (faceShadingGrounds).
  const out = { face: { face: lab(c.plate.face), ...faceShadingGrounds(id, face) } as Record<string, Oklab>, ground: { ground: lab(c.ground) } as Record<string, Oklab> };
  const drawn = [d.plate.shadow[face], d.plate.shadow2[face]].filter((t) => t.strength !== 0 && t.blur > 0);
  if (drawn.length === 0 || d.plate.depth === 0) return out;
  const sum = drawn.reduce((t, x) => t + x.strength, 0);
  const side = d.plate.depth < 0 ? 'face' : 'ground';
  const g = out[side][side];
  for (const P of SHADOW_PROFILE) out[side][`${side} shadowed ${P}`] = { L: g.L * (1 - sum * P), a: g.a, b: g.b };
  return out;
}

export function edgeFamiliesFor(
  id: DirectionId,
  face: Face,
  resolution: SweepResolution = 'coarse',
  grounds = plateShadowGrounds(id, face),
  ringEdge: Record<string, Oklab> = ringEdgeGrounds(id, face, resolution),
  ringOuter: Record<string, Oklab> = ringOuterGrounds(id, face, resolution),
): EdgeFamilyMax[] {
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
  // The face, and each face an inner shadow reaches; the ground, and each ground an outer shadow reaches.
  const faceGrounds = Object.values(grounds.face);
  const groundGrounds = Object.values(grounds.ground);
  const fieldNodes = [...anchors, lab(c.field.restGlow)];
  // A face-side surface: lit by the halos, and by the field where the face's mask lets it in.
  const faceLit = (surfaces: Oklab[], kStep: number): Oklab[] =>
    surfaces.flatMap((ground) => [
      ...lit(ground, anchors, haloPeak(face), [0], kStep),
      ...(d.field.mask.face > 0 ? lit(ground, fieldNodes, d.field.cap[face], shimmers, kStep) : []),
    ]);
  // The ring edge's band (designer §4 (b), UI-114): its mixed grounds join the backgrounds of every
  // face-lit and ring-halo family, each lit as the family lights its own ground: the ring-halo surfaces by
  // the halos, the face-lit ones by the halos and the field, which reaches the band with the face's mask,
  // (1 − α)·mask.face. The inks a bead brings into the band (its setting and shadow) are in both.
  const bandGrounds = Object.values(ringEdge);
  // The outer edge's band (D6-1 (d)): its mixed grounds join the ring-halo families' backgrounds alone, lit by
  // the halos as the ring is (the band is field-free: the ring's mask and the moat's extent are 0).
  const outerGrounds = Object.values(ringOuter);
  const ringLit = (surfaces: Oklab[], kStep: number): Oklab[] => surfaces.flatMap((ground) => lit(ground, anchors, haloPeak(face), [0], kStep));
  const ringFloat = shifted(ringLit([ring, ...bandGrounds, ...outerGrounds], floatKStep));
  const ringBytes = quantised(byteShifted(ringLit([ring, ...bandGrounds, ...outerGrounds], byteKStep)));
  const faceFloat = shifted(faceLit([...faceGrounds, ...bandGrounds], floatKStep));
  const faceBytes = quantised(byteShifted(faceLit([...faceGrounds, ...bandGrounds], byteKStep)));

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
    pairsOf('CTA keyline · ground', ctaFills.flatMap((f) => groundGrounds.map((g): [Oklab, Oklab] => [keyline(f), g])));
  } else {
    pairsOf('CTA fill · ground', ctaFills.flatMap((f) => groundGrounds.map((g): [Oklab, Oklab] => [f, g])));
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

// ---------------------------------------------------------------- the band grid (D6-2, UI-153)
//
// The designer's ruling at UI-153: (1) α ∈ {0, 1} are the face and ring families on their full grid; (2) α ∈
// {0.25, 0.5, 0.75} on that same full 8-bit grid; (3) the fine pass, α every 0.02 on the default grid
// (ringEdgeSweepFor); (4) a margin certificate over every cell of (2), a failing cell re-swept locally at α every
// 0.02, the refined cells counted. The same for β (D6-1, ringOuterSweepFor). (2) and (4) run in the scheduled
// evidence lane (scripts/field/bandEvidence.mts), never thinned; bandCertificate.test.ts holds them on small grids.

/** D6-2 (2): the band's samples inside (0, 1); (4): the cell each one certifies, Δ wide; the local refinement's step. */
export const BAND_SAMPLES: readonly number[] = [0.25, 0.5, 0.75];
export const BAND_STEP = 0.25;
export const BAND_REFINE_STEP = 0.02;

export type BandEdge = 'alpha' | 'beta';

export interface BandSpec {
  /** The field sweep at full resolution over the band's three samples: the full 8-bit grid of (2). */
  readonly config: NeverRedSweep;
  /** The band runs from `from` (α or β = 0) to `to` (= 1), mixed in OKLab (edgeMixOklab). */
  readonly from: Oklab;
  readonly to: Oklab;
  readonly label: string;
}

/**
 * The band's two sides: the inner edge (α) from the face at ρ = 1 (d_f = ringInner, as ringEdgeGrounds) to the
 * ring; the outer edge (β) from the ring to the outside ground (as ringOuterGrounds).
 */
function bandSides(id: DirectionId, face: Face, edge: BandEdge): { from: Oklab; to: Oklab; label: string } {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  const g = lab(c.plate.face);
  const ring = lab(c.plate.ring);
  if (edge === 'alpha') return { from: { L: g.L * (1 + d.plate.face.vignette[face]), a: g.a, b: g.b }, to: ring, label: 'face·ring α' };
  return { from: ring, to: lab(c.ground), label: 'ring·outside β' };
}

/** D6-2 (2): the field sweep at full resolution (its full 8-bit grid, never thinned) over the band's three samples. */
export function bandGridSweepFor(
  id: DirectionId,
  face: Face,
  graphEdges: GraphEdges,
  edge: BandEdge,
  edges?: { straight: Array<[string, string]>; waypoint: Array<[string, string]> },
): NeverRedSweep {
  const { from, to, label } = bandSides(id, face, edge);
  const grounds: Record<string, Oklab> = {};
  for (const s of BAND_SAMPLES) grounds[`${label} ${s}`] = edgeMixOklab(from, to, s);
  return { ...fieldSweepFor(id, face, graphEdges, edges, 'full'), grounds };
}

/** The band's (2) sweep and the sides its certificate needs. */
export function bandSpecFor(id: DirectionId, face: Face, graphEdges: GraphEdges, edge: BandEdge): BandSpec {
  return { config: bandGridSweepFor(id, face, graphEdges, edge), ...bandSides(id, face, edge) };
}

const DEG = Math.PI / 180;

/**
 * The OKLab distance from a colour to the red-exclusion band: the region of hues in `band` at chroma ≥ `floor`
 * (the 8-bit check band at its floor less DEC-081's margin). Lightness never decides redness, so it is the
 * distance in the a-b plane: 0 inside; floor − C at a hue in the band; else the distance to the nearer edge
 * ray (from C = floor outward).
 */
export function distanceToRed(colour: Oklab, redBand: RedBand, floor: number): number {
  const { a, b } = colour;
  const C = Math.hypot(a, b);
  if (hueInBand(Math.atan2(b, a) / DEG, redBand) || C === 0) return C >= floor ? 0 : floor - C;
  let best = Infinity;
  for (const hue of [redBand.hueFrom, redBand.hueTo]) {
    const ux = Math.cos(hue * DEG);
    const uy = Math.sin(hue * DEG);
    const along = a * ux + b * uy;
    const d = along >= floor ? Math.abs(a * uy - b * ux) : Math.hypot(a - floor * ux, b - floor * uy);
    if (d < best) best = d;
  }
  return best;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const HALF_STEP = 0.5 / 255;

/** The largest OKLab move of a half-step 8-bit rounding at a colour: every corner of the ±½-step cube around its clamped sRGB. */
export function halfStepReach(colour: Oklab): number {
  const rgb = sweepOklabToSrgb(colour).map(clamp01);
  const base = sweepSrgbToOklab(rgb as unknown as Srgb);
  let worst = 0;
  for (const dr of [-HALF_STEP, HALF_STEP]) {
    for (const dg of [-HALF_STEP, HALF_STEP]) {
      for (const db of [-HALF_STEP, HALF_STEP]) {
        const p = sweepSrgbToOklab([clamp01(rgb[0] + dr), clamp01(rgb[1] + dg), clamp01(rgb[2] + db)]);
        const move = Math.hypot(p.L - base.L, p.a - base.a, p.b - base.b);
        if (move > worst) worst = move;
      }
    }
  }
  return worst;
}

const inGamut = (colour: Oklab) => sweepOklabToSrgb(colour).every((v) => v >= -1e-9 && v <= 1 + 1e-9);

export interface BandCellWhere {
  readonly sample: number;
  readonly segment: string;
  readonly k: number;
  readonly t: number;
  readonly chromaScales: readonly [number, number];
  readonly shimmerDeg: readonly [number, number];
}

/**
 * UI-161: the certificate's samples, the endpoints too. Each certifies its own cell: Δ wide around 0.25, 0.5 and
 * 0.75, and the one-sided half-cells [0, 0.125] and [0.875, 1] at the ends, whose reach 0.125·S is S·Δ/2, so one
 * threshold holds for all five and they cover [0, 1] with no gap.
 */
export const BAND_CERT_SAMPLES: readonly number[] = [0, ...BAND_SAMPLES, 1];

export interface BandRefinement {
  /** The cells re-swept: every failing or out-of-gamut one. */
  readonly cells: number;
  /** Distinct colours the refinement checked on 8-bit pixels. */
  readonly distinct: number;
  /** The largest in-band chroma it found on 8-bit pixels, against the check band. */
  readonly maxCheck: number;
  /** How many checked colours reach a pixel above the check band's floor less the margin. */
  readonly overLimit: number;
  readonly worst: ({ readonly value: number; readonly chroma: number } & BandCellWhere) | null;
}

/** One sample's row of the certificate (UI-161: five per band). */
export interface BandCertRow {
  readonly sample: number;
  /** The 8-bit cells at this sample: as many as sweepNeverRed's pixel samples on one ground of the same config. */
  readonly cells: number;
  /** Cells with m ≤ threshold. */
  readonly failing: number;
  /** Cells whose dither range L ± A leaves the sRGB gamut: the clamp is not an OKLab move, so the bound does not hold (UI-162). */
  readonly outOfGamut: number;
  /** The smallest m, and where. */
  readonly worst: { readonly m: number } & BandCellWhere;
  /** The values the row's cell is re-swept at (every multiple of 0.02 inside it), and what that found. */
  readonly refined: BandRefinement & { readonly values: readonly number[] };
}

export interface BandCertificate {
  readonly label: string;
  /** |to − from| in OKLab: how far the band's colour moves per unit of α (or β). */
  readonly S: number;
  readonly step: number;
  /** The largest OKLab move of a half-step rounding on the band's grounds (every 0.02 and the samples), at L − A, L and L + A. */
  readonly q8: number;
  /** S·Δ/2 + q8: a cell passes only if its m is above this. */
  readonly threshold: number;
  /** The rows' totals. */
  readonly cells: number;
  readonly failing: number;
  readonly outOfGamut: number;
  readonly worst: { readonly m: number } & BandCellWhere;
  readonly refined: BandRefinement;
  /** One row per sample of BAND_CERT_SAMPLES, in order. */
  readonly rows: readonly BandCertRow[];
}

/** Every multiple of the refinement step inside a sample's cell, both ends included: Δ/2 either side, inside [0, 1]. */
function refineValues(sample: number): number[] {
  const n = Math.round(1 / BAND_REFINE_STEP);
  const out: number[] = [];
  for (let j = 0; j <= n; j++) {
    const v = j / n;
    if (v >= sample - BAND_STEP / 2 - 1e-9 && v <= sample + BAND_STEP / 2 + 1e-9) out.push(v);
  }
  return out;
}

const NO_CELL: BandCellWhere = { sample: NaN, segment: '', k: NaN, t: NaN, chromaScales: [NaN, NaN], shimmerDeg: [NaN, NaN] };

/**
 * D6-2 (4) with UI-161: the margin certificate over every 8-bit cell of the band's full grid at each of the five
 * samples, in sweepNeverRed's order within a sample (each segment, k, t, pair of chroma scales and pair of shimmer
 * turns). m is the distance from the cell's composited float colour to the red-exclusion band; between two samples
 * the band's colour moves along a straight OKLab segment, by at most S·Δ/2 within a cell (an end's half-cell too),
 * and the composite by no more, so a cell with m > S·Δ/2 + q8 has no red 8-bit neighbour. A cell that fails it, or
 * whose dither leaves the gamut, is re-swept locally at every 0.02 inside its own cell (the same cell at each value,
 * every 8-bit pixel the dither and grain reach, against the check band), unless `refine` is false. The grounds are
 * the law's mixes edgeMixOklab(from, to, sample); the (2) sweep's must be the same, bit for bit.
 */
export function certifyBand(spec: BandSpec, options: { readonly refine?: boolean } = {}): BandCertificate {
  const { config, from, to, label } = spec;
  const refine = options.refine ?? true;
  const { grid, kp } = config;
  const A = config.ditherAmplitude;
  const floor = config.checkBand.chromaFloor - BASE.neverRed.margin;
  const S = Math.hypot(to.L - from.L, to.a - from.a, to.b - from.b);
  const shift = (c: Oklab, dL: number): Oklab => ({ L: c.L + dL, a: c.a, b: c.b });
  for (const s of BAND_SAMPLES) {
    const G = config.grounds[`${label} ${s}`];
    if (G === undefined) throw new RangeError(`the band's sweep has no ground ${label} ${s}`);
    const mixed = edgeMixOklab(from, to, s);
    if (G.L !== mixed.L || G.a !== mixed.a || G.b !== mixed.b) throw new RangeError(`the band's sweep ground ${label} ${s} is not the law's mix at ${s}`);
  }
  // q8 on the band's grounds: every 0.02 of it and the three samples, each where the dither and grain take it.
  const n = Math.round(1 / BAND_REFINE_STEP);
  const values = [...Array.from({ length: n + 1 }, (_, j) => j / n), ...BAND_SAMPLES];
  let q8 = 0;
  for (const v of values) {
    const g = edgeMixOklab(from, to, v);
    for (const dL of [-A, 0, A]) q8 = Math.max(q8, halfStepReach(shift(g, dL)));
  }
  const threshold = (S * BAND_STEP) / 2 + q8;

  const segments = graphSegments(config.graph);
  const pixelShimmers = samplesAround(config.shimmerDeg, grid.pixelShimmerStepDeg ?? (config.shimmerDeg || 1));
  const ks = samplesUpTo(config.kMax, grid.pixelKStep);
  const ts = samplesUpTo(1, grid.pixelTStep);
  const scales = grid.chromaScales;
  const chromaOf = new Map<string, number>();

  const rows: BandCertRow[] = BAND_CERT_SAMPLES.map((sample) => {
    const G = edgeMixOklab(from, to, sample);
    let cells = 0;
    let failing = 0;
    let outOfGamut = 0;
    let worst: BandCertRow['worst'] = { m: Infinity, ...NO_CELL };
    const toRefine: Array<{ mixed: Oklab; where: BandCellWhere }> = [];
    for (const segment of segments) {
      for (const k of ks) {
        for (const t of ts) {
          for (const si of scales) {
            for (const sj of scales) {
              const p = { L: segment.from.L, a: si * segment.from.a, b: si * segment.from.b };
              const q = { L: segment.to.L, a: sj * segment.to.a, b: sj * segment.to.b };
              for (const fp of pixelShimmers) {
                for (const fq of pixelShimmers) {
                  cells++;
                  const mixed = mixOklab(rotate(p, fp), rotate(q, fq), t);
                  const shown = pivotComposite(mixed, G, k, kp);
                  const m = distanceToRed(shown, config.checkBand, floor);
                  const where: BandCellWhere = { sample, segment: segment.id, k, t, chromaScales: [si, sj], shimmerDeg: [fp, fq] };
                  if (m < worst.m) worst = { m, ...where };
                  const gamut = inGamut(shift(shown, -A)) && inGamut(shift(shown, A));
                  if (!gamut) outOfGamut++;
                  else if (!(m > threshold)) failing++;
                  if (refine && (!gamut || !(m > threshold))) toRefine.push({ mixed, where });
                }
              }
            }
          }
        }
      }
    }
    const at = refineValues(sample);
    const seen = new Set<string>();
    let maxCheck = 0;
    let overLimit = 0;
    let refinedWorst: BandRefinement['worst'] = null;
    for (const cell of toRefine) {
      for (const value of at) {
        const shown = pivotComposite(cell.mixed, edgeMixOklab(from, to, value), cell.where.k, kp);
        const key = `${shown.L},${shown.a},${shown.b}`;
        let chroma = chromaOf.get(key);
        if (chroma === undefined) {
          chroma = maxInBandChromaOfPixels(shown, config.checkBand, A).chroma;
          chromaOf.set(key, chroma);
        }
        if (!seen.has(key)) {
          seen.add(key);
          if (chroma > floor) overLimit++;
        }
        if (chroma > maxCheck) {
          maxCheck = chroma;
          refinedWorst = { value, chroma, ...cell.where };
        }
      }
    }
    return { sample, cells, failing, outOfGamut, worst, refined: { cells: toRefine.length, values: at, distinct: seen.size, maxCheck, overLimit, worst: refinedWorst } };
  });

  const sum = (f: (r: BandCertRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const worst = rows.reduce((w, r) => (r.worst.m < w.m ? r.worst : w), rows[0].worst);
  const refinedWorst = rows.reduce<BandRefinement['worst']>((w, r) => (r.refined.worst !== null && (w === null || r.refined.worst.chroma > w.chroma) ? r.refined.worst : w), null);
  return {
    label,
    S,
    step: BAND_STEP,
    q8,
    threshold,
    cells: sum((r) => r.cells),
    failing: sum((r) => r.failing),
    outOfGamut: sum((r) => r.outOfGamut),
    worst,
    refined: {
      cells: sum((r) => r.refined.cells),
      distinct: sum((r) => r.refined.distinct),
      maxCheck: Math.max(...rows.map((r) => r.refined.maxCheck)),
      overLimit: sum((r) => r.refined.overLimit),
      worst: refinedWorst,
    },
    rows,
  };
}

/**
 * What fails a certificate, one line per finding, each `<label> row <sample>: …`: a row that did not refine every
 * cell it did not certify, or whose refinement found a colour over the check band's floor less the margin. Empty is
 * a pass; the evidence lane exits 1 on any line.
 */
export function bandCertificateFailures(cert: BandCertificate): string[] {
  const limit = CHECK_BAND.chromaFloor - BASE.neverRed.margin;
  const out: string[] = [];
  for (const row of cert.rows) {
    const r = row.refined;
    if (r.cells !== row.failing + row.outOfGamut) out.push(`${cert.label} row ${row.sample}: refined ${r.cells} of ${row.failing + row.outOfGamut} uncertified cells`);
    if (r.overLimit > 0 || r.maxCheck > limit) out.push(`${cert.label} row ${row.sample}: ${r.overLimit} refined colours over the margin, max C ${r.maxCheck}`);
  }
  return out;
}
