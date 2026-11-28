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
import { blendCandidates, maxInBandOnPixelBlend, maxInBandOnSrgbBlend, type BlendMax, type Bytes } from '../color/edgeSweep.ts';
import { mixSafe } from '../color/mixSafe.ts';
import { mixOklab, type Oklab, type Srgb } from '../color/oklab.ts';
import { ditherReachable, hueInBand, maxInBandChromaInTriangle, maxInBandChromaOfPixels, type RedBand } from '../color/redBand.ts';
import { sweepOklabToSrgb, sweepSrgbToOklab } from '../color/sweepConvert.ts';
import { edgeMixOklab, encodeSrgb8 } from '../field/fieldLaw.ts';
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

/**
 * The k values the face-lit families light a face-side surface with the field at, the inner band's grounds too
 * (UI-164: D6-3 (i) met by the superset): from 0 to the face's cap, both included, in steps no longer than kStep;
 * none where the face's mask keeps the field out.
 */
export function faceLitFieldKs(id: DirectionId, face: Face, kStep: number): number[] {
  const d = DIRECTIONS[id];
  return d.field.mask.face > 0 ? upTo(d.field.cap[face], kStep) : [];
}

/** The surfaces an ink lands on, lit, in float and as 8-bit pixels: the face side's, and the ring's with its bands. */
interface LitSurfaces {
  readonly faceFloat: Oklab[];
  readonly faceBytes: Bytes[];
  readonly ringFloat: Oklab[];
  readonly ringBytes: Bytes[];
}

/** What litSurfaces samples: edgeSweepInputs' grid, or F1's (beadTwinFamiliesFor). */
type LitSurfaceInputs = Pick<EdgeSweepInputs, 'floatKStep' | 'byteKStep' | 'presences' | 'shimmers' | 'lShifts' | 'byteLShifts' | 'byteDitherAmplitude'>;

function litSurfaces(
  id: DirectionId,
  face: Face,
  inputs: LitSurfaceInputs,
  grounds: ReturnType<typeof plateShadowGrounds>,
  ringEdge: Record<string, Oklab>,
  ringOuter: Record<string, Oklab>,
): LitSurfaces {
  const d = DIRECTIONS[id];
  const c = d.color[face];
  const tier = tierFor(face);
  const kp = d.field.pivot;
  const { floatKStep, byteKStep, presences, shimmers, lShifts, byteLShifts, byteDitherAmplitude } = inputs;
  const anchors = QUADRANTS.map((q) => lab(BASE.emotion[q][tier]));

  // Surfaces lit by a halo (no shimmer: marks never shimmer) or by the field (which shimmers).
  const lit = (ground: Oklab, nodes: Oklab[], ks: readonly number[], turns: readonly number[]): Oklab[] => {
    const out: Oklab[] = [];
    for (const node of nodes) {
      for (const p of presences) {
        for (const phi of turns) {
          for (const k of ks) out.push(pivotComposite(rotate(scale(node, p), phi), ground, k, kp));
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
  // The face, and each face an inner shadow reaches.
  const faceGrounds = Object.values(grounds.face);
  const fieldNodes = [...anchors, lab(c.field.restGlow)];
  // A face-side surface: lit by the halos, and by the field where the face's mask lets it in.
  const faceLit = (surfaces: Oklab[], kStep: number): Oklab[] =>
    surfaces.flatMap((ground) => [
      ...lit(ground, anchors, upTo(haloPeak(face), kStep), [0]),
      ...lit(ground, fieldNodes, faceLitFieldKs(id, face, kStep), shimmers),
    ]);
  // The ring edge's band (designer §4 (b), UI-114): its mixed grounds join the backgrounds of every
  // face-lit and ring-halo family, each lit as the family lights its own ground: the ring-halo surfaces by
  // the halos, the face-lit ones by the halos and the field, which reaches the band with the face's mask,
  // (1 − α)·mask.face. The inks a bead brings into the band (its setting and shadow) are in both.
  const bandGrounds = Object.values(ringEdge);
  // The outer edge's band (D6-1 (d)): its mixed grounds join the ring-halo families' backgrounds alone, lit by
  // the halos as the ring is (the band is field-free: the ring's mask and the moat's extent are 0).
  const outerGrounds = Object.values(ringOuter);
  const ringLit = (surfaces: Oklab[], kStep: number): Oklab[] => surfaces.flatMap((ground) => lit(ground, anchors, upTo(haloPeak(face), kStep), [0]));
  const ringFloat = shifted(ringLit([ring, ...bandGrounds, ...outerGrounds], floatKStep));
  const ringBytes = quantised(byteShifted(ringLit([ring, ...bandGrounds, ...outerGrounds], byteKStep)));
  const faceFloat = shifted(faceLit([...faceGrounds, ...bandGrounds], floatKStep));
  const faceBytes = quantised(byteShifted(faceLit([...faceGrounds, ...bandGrounds], byteKStep)));
  return { faceFloat, faceBytes, ringFloat, ringBytes };
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
  const inputs = edgeSweepInputs(id, resolution);
  const { presences, ctaMixSteps } = inputs;
  const anchors = QUADRANTS.map((q) => lab(BASE.emotion[q][tier]));
  const srgb = (x: Oklab) => sweepOklabToSrgb(x);
  const { faceFloat, faceBytes, ringFloat, ringBytes } = litSurfaces(id, face, inputs, grounds, ringEdge, ringOuter);
  // The ground, and each ground an outer shadow reaches.
  const groundGrounds = Object.values(grounds.ground);

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

// ---------------------------------------------------------------- the bead's grey twin (F1, F10 G8-2a/2b)
//
// F1 (P0, the designer's rulings of 2026-11-25): a bead is never translucent in colour over the field. Below opacity 1
// it shows only its grey disc, its achromatic twin (the fill at its own OKLab L with chroma 0, and the highlight drawn
// from it); the colour disc over it fades only while the bead is opaque (components/Bead/beadTimeline.ts). So the
// colours a bead can show over the field are:
//   · the grey disc at every opacity α over every surface a bead sits on: the face lit by the halos and the field, and
//     the ring with its inner and outer bands lit by the halos (litSurfaces, as for the setting and the shadow), in
//     every grey from the darkest fill's twin to the lightest highlight's, which the radial gradient spans;
//   · the colour disc at every fraction over its grey twin, at each step of the highlight's gradient.
// The setting ring and the shadow keep their families above. Float sweeps the design band over the grid's grey levels;
// the 8-bit pass is exact over every grey byte, coverage and rounding (greyOverPixelsMax). The fills are DSN-017's, read
// from the tokens here (a lower layer never imports a component); Bead's own tests hold them to beadModel.ts.
// Planted control: the pre-F1 bead, its coloured fill at α over the face lit by another family, must fail.

export interface BeadTwinGrid {
  /** The k step of the float surfaces (halo and field). */
  readonly floatKStep: number;
  /** The k step of the 8-bit surfaces (the nearest pixels of each lit colour at L − A, L and L + A). */
  readonly byteKStep: number;
  /** The node presences, as shares of the direction's bead chroma scale. */
  readonly presenceShares: readonly number[];
  /** The turns of a field-lit colour: null takes −shimmer, 0 and +shimmer. */
  readonly shimmerStepDeg: number | null;
  /** The ring's inner (α) and outer (β) bands at every 1/bandSteps, strictly inside (0, 1). */
  readonly bandSteps: number;
  /** The float pass's greys: floatGreys + 1 levels from the darkest to the lightest (8-bit takes every grey byte). */
  readonly floatGreys: number;
  /** DSN-017's ramp p for each quadrant's fill: 0 is the neutral bead, 1 the anchor. */
  readonly ramps: readonly number[];
  /** The highlight's gradient, every 1/gradientSteps from its centre (0) to the fill (1). */
  readonly gradientSteps: number;
}

/** F1's grids: 'coarse' in the default run (neverRed.beadTwin.test.ts), 'full' in the sweeps project. */
export const BEAD_TWIN_GRIDS: Record<SweepResolution, BeadTwinGrid> = {
  coarse: { floatKStep: 0.05, byteKStep: 0.1, presenceShares: [1], shimmerStepDeg: null, bandSteps: 4, floatGreys: 4, ramps: [0, 0.5, 1], gradientSteps: 4 },
  full: { floatKStep: 0.01, byteKStep: 0.1, presenceShares: [0.25, 0.5, 1], shimmerStepDeg: null, bandSteps: 10, floatGreys: 8, ramps: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], gradientSteps: 10 },
};

export interface BeadTwinInk {
  readonly quadrant: (typeof QUADRANTS)[number];
  readonly p: number;
  readonly fill: Oklab;
  readonly highlight: Oklab;
}

export interface BeadTwinInks {
  /** Each quadrant's fill at the grid's ramps (DSN-017), with its highlight (bead.highlight.mix toward white). */
  readonly fills: readonly BeadTwinInk[];
  /** The darkest and lightest OKLab L the grey disc paints: the darkest fill's twin and the lightest highlight's. */
  readonly greyL: readonly [number, number];
  /** The same as 8-bit greys (the byte beadModel.ts greyHex repeats); the gradient paints every byte between. */
  readonly greyBytes: readonly [number, number];
}

const WHITE: Oklab = { L: 1, a: 0, b: 0 };
const twinOf = (c: Oklab): Oklab => ({ L: c.L, a: 0, b: 0 });
/** The 8-bit grey an achromatic L paints: the encode's middle byte, which greyHex repeats on every channel. */
const greyByte = (L: number) => encodeSrgb8({ L, a: 0, b: 0 })[1];

export function beadTwinInks(id: DirectionId, face: Face, resolution: SweepResolution = 'coarse'): BeadTwinInks {
  const d = DIRECTIONS[id];
  const neutral = lab(d.color[face].bead.neutral);
  const tier = tierFor(face);
  const mix = d.bead.highlight.mix;
  const fills: BeadTwinInk[] = [];
  for (const quadrant of QUADRANTS) {
    const anchor = lab(BASE.emotion[quadrant][tier]);
    for (const p of BEAD_TWIN_GRIDS[resolution].ramps) {
      const chroma = p * d.bead.chromaScale;
      const fill = { L: neutral.L + (anchor.L - neutral.L) * p, a: anchor.a * chroma, b: anchor.b * chroma };
      fills.push({ quadrant, p, fill, highlight: mixOklab(fill, WHITE, mix) });
    }
  }
  // A fill's L runs straight from the neutral bead's to its anchor's, and its highlight is lighter still.
  const Ls = [neutral.L, ...QUADRANTS.map((q) => lab(BASE.emotion[q][tier]).L)];
  const greyL = [Math.min(...Ls), mixOklab(twinOf({ L: Math.max(...Ls), a: 0, b: 0 }), WHITE, mix).L] as const;
  return { fills, greyL, greyBytes: [greyByte(greyL[0]), greyByte(greyL[1])] };
}

// Bound once: a global lookup is ten times slower in jest's sandbox (redBand.ts), and these loops run millions of times.
const MATH = Math;

/** Below this chroma the hue is powerless (redBand.ts, edgeSweep.ts): no colour there is red. */
const ACHROMATIC_CHROMA = 0.000004;

/** The pixels (g + dr, g, g + db), g 0..255: their in-band chroma (−1 off the byte cube or the band), and a range-maximum table. */
interface GreyLine {
  readonly base: Float64Array;
  readonly max: number;
  levels: Float64Array[] | null;
}

const GREY_LINES = new Map<RedBand, Map<number, GreyLine>>();

function greyLine(redBand: RedBand, dr: number, db: number): GreyLine {
  let lines = GREY_LINES.get(redBand);
  if (lines === undefined) {
    lines = new Map();
    GREY_LINES.set(redBand, lines);
  }
  const key = (dr + 512) * 1024 + (db + 512);
  let line = lines.get(key);
  if (line === undefined) {
    const base = new Float64Array(256);
    let top = -1;
    for (let g = 0; g < 256; g++) {
      const r = g + dr;
      const b = g + db;
      let chroma = -1;
      if (r >= 0 && r <= 255 && b >= 0 && b <= 255) {
        const p = sweepSrgbToOklab([r / 255, g / 255, b / 255]);
        const C = MATH.hypot(p.a, p.b);
        if (C > ACHROMATIC_CHROMA && hueInBand(MATH.atan2(p.b, p.a) / DEG, redBand)) chroma = C;
      }
      base[g] = chroma;
      if (chroma > top) top = chroma;
    }
    line = { base, max: top, levels: null };
    lines.set(key, line);
  }
  return line;
}

/** The largest value of a line over g in [lo, hi], from its sparse table (built on the first query that needs it). */
function lineMax(line: GreyLine, lo: number, hi: number): number {
  if (line.levels === null) {
    const levels = [line.base];
    for (let w = 1; 2 * w <= 256; w *= 2) {
      const prev = levels[levels.length - 1];
      const next = new Float64Array(256);
      for (let g = 0; g + 2 * w <= 256; g++) next[g] = MATH.max(prev[g], prev[g + w]);
      levels.push(next);
    }
    line.levels = levels;
  }
  let k = 0;
  let span = 1;
  while (span * 2 <= hi - lo + 1) {
    span *= 2;
    k++;
  }
  return MATH.max(line.levels[k][lo], line.levels[k][hi - span + 1]);
}

/**
 * The largest in-band chroma of any 8-bit pixel a grey ink (every grey byte from v0 to v1) can make over the 8-bit
 * background `bg`, at every coverage a/255 from 1 to 254 and every rounding either way on each channel: exact, as a
 * superset. Each channel of the blend is x_c = ((255 − a)·bg_c + a·v)/255, and a pixel takes ⌊x_c⌋ or ⌈x_c⌉; the
 * differences r − g and b − g then lie within 2 of (255 − a)·(bg_r − bg_g)/255 and (255 − a)·(bg_b − bg_g)/255 whatever
 * the grey, and g within [⌊x_g(v0)⌋, ⌈x_g(v1)⌉]. So the pixels are on a few lines (g + dr, g, g + db), each read by its
 * range maximum, never a grey at a time.
 */
export function greyOverPixelsMax(bg: Bytes, v0: number, v1: number, redBand: RedBand = CHECK_BAND): BlendMax & { readonly pixel?: Bytes } {
  const EPS = 1e-9;
  let best: BlendMax & { pixel?: Bytes } = { chroma: 0, hue: NaN, coverage: NaN };
  for (let a = 1; a <= 254; a++) {
    const s = (255 - a) / 255;
    const eRG = s * (bg[0] - bg[1]);
    const eBG = s * (bg[2] - bg[1]);
    const gLo = MATH.max(0, MATH.floor(s * bg[1] + (a * v0) / 255 - EPS));
    const gHi = MATH.min(255, MATH.ceil(s * bg[1] + (a * v1) / 255 + EPS));
    for (let dr = MATH.floor(eRG - 2 - EPS) + 1; dr <= MATH.ceil(eRG + 2 + EPS) - 1; dr++) {
      for (let db = MATH.floor(eBG - 2 - EPS) + 1; db <= MATH.ceil(eBG + 2 + EPS) - 1; db++) {
        const lo = MATH.max(gLo, -dr, -db);
        const hi = MATH.min(gHi, 255 - dr, 255 - db);
        if (lo > hi) continue;
        const line = greyLine(redBand, dr, db);
        if (!(line.max > best.chroma)) continue;
        const m = lineMax(line, lo, hi);
        if (!(m > best.chroma)) continue;
        let g = lo;
        while (line.base[g] !== m) g++;
        const pixel: Bytes = [g + dr, g, g + db];
        const p = sweepSrgbToOklab([pixel[0] / 255, pixel[1] / 255, pixel[2] / 255]);
        best = { chroma: m, hue: ((MATH.atan2(p.b, p.a) / DEG) % 360 + 360) % 360, coverage: a / 255, pixel };
      }
    }
  }
  return best;
}

/** The surfaces F1's grid samples: litSurfaces' inputs at its own k steps and presences, nearest 8-bit pixels. */
function beadTwinSurfaceInputs(id: DirectionId, grid: BeadTwinGrid): LitSurfaceInputs {
  const d = DIRECTIONS[id];
  const deg = d.field.shimmer.deg;
  const amplitude = amplitudeFor(id);
  const lShifts = [-amplitude, 0, amplitude];
  return {
    floatKStep: grid.floatKStep,
    byteKStep: grid.byteKStep,
    presences: grid.presenceShares.map((p) => p * d.bead.chromaScale),
    shimmers: grid.shimmerStepDeg === null ? samplesAround(deg, deg || 1) : samplesAround(deg, grid.shimmerStepDeg),
    lShifts,
    byteLShifts: lShifts,
    byteDitherAmplitude: 0,
  };
}

/**
 * F1's families for one direction and face: the grey disc at every α over the face-lit and the ring-halo surfaces, and
 * the colour disc at every fraction over its grey twin. With `plant`, the pre-F1 bead joins: its coloured fills at α
 * over the face-lit surfaces, which must break both bands.
 */
export function beadTwinFamiliesFor(id: DirectionId, face: Face, resolution: SweepResolution = 'coarse', options: { readonly plant?: boolean } = {}): EdgeFamilyMax[] {
  const grid = BEAD_TWIN_GRIDS[resolution];
  const bandAt = (edge: BandEdge): Record<string, Oklab> => {
    const { from, to, label } = bandSides(id, face, edge);
    const out: Record<string, Oklab> = {};
    for (let i = 1; i < grid.bandSteps; i++) out[`${label} ${i / grid.bandSteps}`] = edgeMixOklab(from, to, i / grid.bandSteps);
    return out;
  };
  const surfaces = litSurfaces(id, face, beadTwinSurfaceInputs(id, grid), plateShadowGrounds(id, face), bandAt('alpha'), bandAt('beta'));
  const inks = beadTwinInks(id, face, resolution);
  const [L0, L1] = inks.greyL;
  const [v0, v1] = inks.greyBytes;
  const greyFloats = Array.from({ length: grid.floatGreys + 1 }, (_, i) => sweepOklabToSrgb({ L: L0 + ((L1 - L0) * i) / grid.floatGreys, a: 0, b: 0 }));
  const faceSrgb = surfaces.faceFloat.map((x) => sweepOklabToSrgb(x));

  const grey = (family: string, float: readonly Srgb[], bytes: readonly Bytes[]): EdgeFamilyMax => {
    const sweep = new Family(family);
    for (const bg of float) for (const ink of greyFloats) sweep.float(bg, ink, 1);
    let check: BlendMax & { pixel?: Bytes } = { chroma: 0, hue: NaN, coverage: NaN };
    for (const bg of bytes) {
      const found = greyOverPixelsMax(bg, v0, v1);
      if (found.chroma > check.chroma) check = found;
    }
    return { family, design: sweep.design, check, pixelBlends: bytes.length * (v1 - v0 + 1) };
  };

  // The colour disc over its grey twin: at each step s of the highlight's gradient, the colour's pixel over the grey's.
  const twin = new Family('bead colour disc · grey twin');
  const lerp = (x: Srgb, y: Srgb, s: number): Srgb => [x[0] + (y[0] - x[0]) * s, x[1] + (y[1] - x[1]) * s, x[2] + (y[2] - x[2]) * s];
  const greyBytesOf = (L: number): Bytes => {
    const v = greyByte(L);
    return [v, v, v];
  };
  for (const { fill, highlight } of inks.fills) {
    const colour = [sweepOklabToSrgb(highlight), sweepOklabToSrgb(fill)] as const;
    const greys = [sweepOklabToSrgb(twinOf(highlight)), sweepOklabToSrgb(twinOf(fill))] as const;
    const colourBytes = [encodeSrgb8(highlight) as Bytes, encodeSrgb8(fill) as Bytes] as const;
    const greyBytes = [greyBytesOf(highlight.L), greyBytesOf(fill.L)] as const;
    for (let i = 0; i <= grid.gradientSteps; i++) {
      const s = i / grid.gradientSteps;
      twin.float(lerp(greys[0], greys[1], s), lerp(colour[0], colour[1], s), 1);
      // The gradient's own pixel rounds either way; a grey stop pair rounds alike on every channel, so it stays grey.
      const greyPixels = blendCandidates(greyBytes[0], greyBytes[1], s * 255).filter((p) => p[0] === p[1] && p[1] === p[2]);
      for (const g of greyPixels) for (const c of blendCandidates(colourBytes[0], colourBytes[1], s * 255)) twin.pixels(g, c, 1);
    }
  }

  const out = [
    grey('face lit · bead grey disc at α', faceSrgb, surfaces.faceBytes),
    grey('ring halo · bead grey disc at α', surfaces.ringFloat.map((x) => sweepOklabToSrgb(x)), surfaces.ringBytes),
    twin.result(),
  ];
  if (options.plant) {
    // The two hues either side of the band (joy below it, intense above it), each over the face the other lights.
    const planted = new Family('face lit · bead colour fill at α (planted: the pre-F1 bead)');
    for (const { fill } of inks.fills.filter((f) => f.p === 1 && (f.quadrant === 'joy' || f.quadrant === 'intense'))) {
      const ink = sweepOklabToSrgb(fill);
      const inkBytes = encodeSrgb8(fill) as Bytes;
      for (const bg of faceSrgb) planted.float(bg, ink, 1);
      for (const bg of surfaces.faceBytes) planted.pixels(bg, inkBytes, 1);
    }
    out.push(planted.result());
  }
  return out;
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
  /**
   * UI-163: the q8 the threshold uses, the largest OKLab move of a half-step rounding over every composite cell of
   * the five rows and over the grounds, each at L − A, L and L + A.
   */
  readonly q8: number;
  /** Where q8 was taken (UI-163): every cell, and the grounds. */
  readonly q8Source: 'all cells';
  /** The same on the band's grounds alone (every 0.02 and the samples): never above q8. */
  readonly q8Grounds: number;
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
 * D6-2 (4) with UI-161 and UI-163: the margin certificate over every 8-bit cell of the band's full grid at each of the five
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
  // The grounds' q8: every 0.02 of the band and the three samples, each where the dither and grain take it.
  const n = Math.round(1 / BAND_REFINE_STEP);
  const values = [...Array.from({ length: n + 1 }, (_, j) => j / n), ...BAND_SAMPLES];
  let q8Grounds = 0;
  for (const v of values) {
    const g = edgeMixOklab(from, to, v);
    for (const dL of [-A, 0, A]) q8Grounds = Math.max(q8Grounds, halfStepReach(shift(g, dL)));
  }

  const segments = graphSegments(config.graph);
  const pixelShimmers = samplesAround(config.shimmerDeg, grid.pixelShimmerStepDeg ?? (config.shimmerDeg || 1));
  const ks = samplesUpTo(config.kMax, grid.pixelKStep);
  const ts = samplesUpTo(1, grid.pixelTStep);
  const scales = grid.chromaScales;
  /** Every 8-bit cell at one sample, in sweepNeverRed's order: its float mix before the ground, and the colour shown. */
  const walk = (G: Oklab, visit: (mixed: Oklab, shown: Oklab, segment: string, k: number, t: number, si: number, sj: number, fp: number, fq: number) => void) => {
    for (const segment of segments) {
      for (const k of ks) {
        for (const t of ts) {
          for (const si of scales) {
            for (const sj of scales) {
              const p = { L: segment.from.L, a: si * segment.from.a, b: si * segment.from.b };
              const q = { L: segment.to.L, a: sj * segment.to.a, b: sj * segment.to.b };
              for (const fp of pixelShimmers) {
                for (const fq of pixelShimmers) {
                  const mixed = mixOklab(rotate(p, fp), rotate(q, fq), t);
                  visit(mixed, pivotComposite(mixed, G, k, kp), segment.id, k, t, si, sj, fp, fq);
                }
              }
            }
          }
        }
      }
    }
  };
  // UI-163: q8 is the largest half-step reach over every composite cell the certificate covers, at L − A, L and
  // L + A, and over the grounds: a first pass, so the threshold is known before any cell is judged.
  let q8 = q8Grounds;
  for (const sample of BAND_CERT_SAMPLES) {
    walk(edgeMixOklab(from, to, sample), (_mixed, shown) => {
      for (const dL of [-A, 0, A]) {
        const reach = halfStepReach(shift(shown, dL));
        if (reach > q8) q8 = reach;
      }
    });
  }
  const threshold = (S * BAND_STEP) / 2 + q8;
  const chromaOf = new Map<string, number>();

  const rows: BandCertRow[] = BAND_CERT_SAMPLES.map((sample) => {
    const G = edgeMixOklab(from, to, sample);
    let cells = 0;
    let failing = 0;
    let outOfGamut = 0;
    let worst: BandCertRow['worst'] = { m: Infinity, ...NO_CELL };
    const toRefine: Array<{ mixed: Oklab; where: BandCellWhere }> = [];
    walk(G, (mixed, shown, segment, k, t, si, sj, fp, fq) => {
      cells++;
      const m = distanceToRed(shown, config.checkBand, floor);
      const gamut = inGamut(shift(shown, -A)) && inGamut(shift(shown, A));
      const certified = gamut && m > threshold;
      if (!gamut) outOfGamut++;
      else if (!certified) failing++;
      if (m < worst.m || (refine && !certified)) {
        const where: BandCellWhere = { sample, segment, k, t, chromaScales: [si, sj], shimmerDeg: [fp, fq] };
        if (m < worst.m) worst = { m, ...where };
        if (refine && !certified) toRefine.push({ mixed, where });
      }
    });
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
    q8Source: 'all cells',
    q8Grounds,
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

// ---------------------------------------------------------------- the β pair family (iv) (criterion G, UI-165)
//
// Criterion G (D5b, the designer's (2)): "never-red measured, not presumed: per node, the segment between its
// presence-ramp extremes × shimmer × w in [0, 1] toward its halo, used as an endpoint of every straight edge and both
// waypoint legs, × β × N̄.L over the node set's L range, every ground, float and 8-bit, with the planted red control:
// 0 failures." D6-3 (ii) puts the band's mixed grounds, α and β, among its backgrounds; UI-165 brings it into the repo:
// a small grid in the default jest run (betaPairFamily.test.ts), the full grid in the evidence lane (bandEvidence.mts).
//
// A node's colour under the amended L4 is the e-weighted mean of its slots' colours, each slot
// (1 − w)·turned(tense(halo(p))) + w·halo(p), halo(p) = (lerp(L_R0, L_tier, p), p·chromaScale·tier.ab) (fieldFrame.ts),
// so it lies in the convex hull of its family over p, the stress s, the shimmer and w.
//   Float (design band, exact): in OKLab ab a quadrant node's family lies inside the hull of the origin and the arc
//   R_φ(A), |φ| ≤ shimmer.deg, A its chroma-scaled tier anchor; R0's the same with A its rest glow. A straight pair,
//   its fade by β toward the achromatic N̄ and the composite over a ground (ab = k·c + share·G, k + share ≤ 1) stay
//   inside hull(0, G, arc_a, arc_b); a waypoint leg inside hull(0, G, arc_a). Each arc is replaced by its
//   circumscribed polygon (a superset), each hull fanned into triangles, and maxInBandChromaInTriangle is exact.
//   8-bit (check band, sampled): the grid's endpoints, t (and the eased waypoint leg's own samples s(2t)), fades β
//   with N̄.L at the node set's L extremes, k, every ground; each composite through pivotComposite, then every 8-bit
//   pixel the dither and grain reach (maxInBandChromaOfPixels).
//   Planted control: a red node X (hue 20°, chroma 0.12, L 0.6) on a straight edge with J: both passes must fail.

/** A fade toward N̄ by β; below 1, N̄.L sits at the node set's lowest or highest L. */
export interface BetaPairFade {
  readonly beta: number;
  readonly at?: 'min' | 'max';
}

export interface BetaPairGrid {
  /** Presence-ramp values p of each endpoint. */
  readonly presences: readonly number[];
  /** Stress values s. */
  readonly stresses: readonly number[];
  /** Shimmer turns, as shares of shimmer.deg. */
  readonly turns: readonly number[];
  /** Mark weights w. */
  readonly marks: readonly number[];
  /** Positions t along a straight edge (and, with their eased s(2t), along a waypoint leg). */
  readonly ts: readonly number[];
  readonly fades: readonly BetaPairFade[];
  /** The composite's k values; the sweep's kMax is always added. */
  readonly ks: readonly number[];
  /** The float pass's arc polygon step. */
  readonly arcStepDeg: number;
  /** The band's mixed grounds at every 1/bandSteps of α and of β, strictly inside (0, 1). */
  readonly bandSteps: number;
}

/**
 * The family's grids. 'full' is criterion G's own grid, the one its probe ran and the designer read at ae8b132, with
 * the band every 0.1 (D6-1 (d)'s default steps); the evidence lane runs it. 'coarse' takes a subset of every axis for
 * the default jest run (about 31k composites, under a second a face): one presence, both stresses, the shimmer's
 * ends, both mark weights, t at 0, ½ and 1, the pair and one fade, k at kMax, and the band at α ½ and β ½.
 */
export const BETA_PAIR_GRIDS: Record<SweepResolution, BetaPairGrid> = {
  coarse: {
    presences: [1],
    stresses: [0, 1],
    turns: [-1, 1],
    marks: [0, 1],
    ts: [0, 0.5, 1],
    fades: [{ beta: 1 }, { beta: 0.3, at: 'min' }],
    ks: [],
    arcStepDeg: 1,
    bandSteps: 2,
  },
  full: {
    presences: [0.5, 1],
    stresses: [0, 1],
    turns: [-1, 0, 1],
    marks: [0, 1],
    ts: [0, 0.25, 0.5, 0.75, 1],
    fades: [{ beta: 1 }, { beta: 0.6, at: 'min' }, { beta: 0.6, at: 'max' }, { beta: 0.3, at: 'min' }, { beta: 0.3, at: 'max' }, { beta: 0, at: 'min' }, { beta: 0, at: 'max' }],
    ks: [0.1, 0.3, 0.5],
    arcStepDeg: 0.25,
    bandSteps: 10,
  },
};

/** The family's backgrounds: the field sweep's grounds, and the band's mixed grounds α and β at the grid's steps (D6-3 (ii)). */
export function betaPairGrounds(id: DirectionId, face: Face, graphEdges: GraphEdges, grid: BetaPairGrid): Record<string, Oklab> {
  const out: Record<string, Oklab> = { ...fieldSweepFor(id, face, graphEdges).grounds };
  for (const edge of ['alpha', 'beta'] as const) {
    const { from, to, label } = bandSides(id, face, edge);
    for (let i = 1; i < grid.bandSteps; i++) out[`${label} ${i / grid.bandSteps}`] = edgeMixOklab(from, to, i / grid.bandSteps);
  }
  return out;
}

export interface BetaPairWorst {
  readonly chroma: number;
  readonly hue: number;
  readonly where: string;
}

export interface BetaPairReport {
  readonly grounds: Readonly<Record<string, Oklab>>;
  /** Straight edges plus both legs of every waypoint edge. */
  readonly legs: number;
  /** The node set's L range over the endpoints: where N̄.L sits. */
  readonly lRange: readonly [number, number];
  /** The design band's floor less the margin (float), the check band's (8-bit). */
  readonly limits: { readonly design: number; readonly check: number };
  readonly float: { readonly failures: readonly string[]; readonly worst: BetaPairWorst };
  readonly pixel: { readonly composites: number; readonly failures: number; readonly first: readonly string[]; readonly worst: BetaPairWorst };
}

type Ab = readonly [number, number];

/** The convex hull of points in the plane (monotone chain), counter-clockwise. */
function hull2(points: readonly Ab[]): Ab[] {
  const p = [...points].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const cross = (o: Ab, a: Ab, b: Ab) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Ab[] = [];
  const upper: Ab[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The largest in-band chroma anywhere in the hull of the points: its fan of triangles, each exact. */
function hullMaxInBand(points: readonly Ab[], redBand: RedBand): { chroma: number; hue: number } {
  const h = hull2(points);
  const at = (q: Ab): Oklab => ({ L: 0.5, a: q[0], b: q[1] });
  let best = { chroma: 0, hue: NaN };
  for (let i = 1; i + 1 < h.length; i++) {
    const m = maxInBandChromaInTriangle(at(h[0]), at(h[i]), at(h[i + 1]), redBand);
    if (m.chroma > best.chroma) best = m;
  }
  return best;
}

/** The β pair family (iv) for one direction and face, on a grid; with `plant`, the red node X joins on J–X. */
export function betaPairFamilyFor(
  id: DirectionId,
  face: Face,
  graphEdges: GraphEdges,
  resolution: SweepResolution,
  options: { readonly plant?: boolean } = {},
): BetaPairReport {
  const grid = BETA_PAIR_GRIDS[resolution];
  const d = DIRECTIONS[id];
  const sweep = fieldSweepFor(id, face, graphEdges);
  const grounds = betaPairGrounds(id, face, graphEdges, grid);
  const tier = tierFor(face);
  const deg = d.field.shimmer.deg;
  const restGlow = lab(d.color[face].field.restGlow);
  const stress = BASE.field.stress;
  const lightness = face === 'dark' ? stress.lightnessDark : stress.lightnessLight;
  const limits = { design: DESIGN_BAND.chromaFloor - BASE.neverRed.margin, check: CHECK_BAND.chromaFloor - BASE.neverRed.margin };

  // Each node's L at full presence and its chroma-scaled anchor in ab.
  const nodes: Record<string, { L1: number; A: Ab }> = {};
  const quadrantIds = { J: 'joy', C: 'calm', R: 'reflective', I: 'intense' } as const;
  for (const [n, q] of Object.entries(quadrantIds)) {
    const anchor = lab(BASE.emotion[q][tier]);
    nodes[n] = { L1: anchor.L, A: [anchor.a * d.bead.chromaScale, anchor.b * d.bead.chromaScale] };
  }
  nodes.R0 = { L1: restGlow.L, A: [restGlow.a, restGlow.b] };
  const RAD = Math.PI / 180;
  if (options.plant) nodes.X = { L1: 0.6, A: [0.12 * Math.cos(20 * RAD), 0.12 * Math.sin(20 * RAD)] };
  const turn = (a: number, b: number, phi: number): Ab => [a * Math.cos(phi * RAD) - b * Math.sin(phi * RAD), a * Math.sin(phi * RAD) + b * Math.cos(phi * RAD)];
  const halo = (n: string, p: number): Oklab =>
    n === 'R0' ? restGlow : { L: restGlow.L + (nodes[n].L1 - restGlow.L) * p, a: nodes[n].A[0] * p, b: nodes[n].A[1] * p };
  const slot = (n: string, p: number, s: number, phi: number, w: number): Oklab => {
    const h = halo(n, p);
    const f = { L: h.L * (1 - lightness * s), a: h.a * (1 - stress.chroma * s), b: h.b * (1 - stress.chroma * s) };
    const [ta, tb] = turn(f.a, f.b, phi);
    return { L: (1 - w) * f.L + w * h.L, a: (1 - w) * ta + w * h.a, b: (1 - w) * tb + w * h.b };
  };
  // Each node's arc in ab, |φ| ≤ deg, as its circumscribed polygon.
  const arc = (n: string): Ab[] => {
    if (deg === 0) return [nodes[n].A];
    const steps = Math.ceil((2 * deg) / grid.arcStepDeg - 1e-9);
    const grow = 1 / Math.cos(((deg / steps) * RAD));
    return Array.from({ length: steps + 1 }, (_, i) => {
      const [a, b] = turn(nodes[n].A[0], nodes[n].A[1], -deg + (2 * deg * i) / steps);
      return [a * grow, b * grow] as Ab;
    });
  };
  const straight: Array<readonly [string, string]> = [...sweep.graph.straight];
  const waypoint: Array<readonly [string, string]> = [...sweep.graph.waypoint];
  if (options.plant) straight.push(['J', 'X']);

  // The endpoints, and the node set's L range over them.
  const endpoints: Record<string, Oklab[]> = {};
  let Lmin = Infinity;
  let Lmax = -Infinity;
  for (const n of Object.keys(nodes)) {
    endpoints[n] = [];
    for (const p of grid.presences) for (const s of grid.stresses) for (const share of grid.turns) for (const w of grid.marks) {
      const c = slot(n, p, s, share * deg, w);
      endpoints[n].push(c);
      Lmin = Math.min(Lmin, c.L);
      Lmax = Math.max(Lmax, c.L);
    }
  }

  // Float: exact hull certificates.
  const floatFailures: string[] = [];
  let floatWorst: BetaPairWorst = { chroma: 0, hue: NaN, where: '' };
  for (const [gName, G] of Object.entries(grounds)) {
    const check = (label: string, pts: Ab[]) => {
      const m = hullMaxInBand(pts, DESIGN_BAND);
      if (m.chroma > floatWorst.chroma) floatWorst = { ...m, where: `${label} over ${gName}` };
      if (m.chroma > limits.design) floatFailures.push(`${label} over ${gName}: C ${m.chroma.toFixed(5)} at ${m.hue.toFixed(1)}`);
    };
    for (const [a, b] of straight) check(`${a}-${b}`, [[0, 0], [G.a, G.b], ...arc(a), ...arc(b)]);
    for (const [a, b] of waypoint) {
      check(`${a}->N leg`, [[0, 0], [G.a, G.b], ...arc(a)]);
      check(`${b}->N leg`, [[0, 0], [G.a, G.b], ...arc(b)]);
    }
  }

  // 8-bit: sampled.
  const colours: Array<{ label: string; c: Oklab }> = [];
  const add = (label: string, c: Oklab) => {
    for (const fade of grid.fades) {
      if (fade.at === undefined) colours.push({ label, c });
      else {
        const NL = fade.at === 'min' ? Lmin : Lmax;
        colours.push({ label, c: { L: c.L * fade.beta + NL * (1 - fade.beta), a: fade.beta * c.a, b: fade.beta * c.b } });
      }
    }
  };
  for (const [a, b] of straight) for (const e1 of endpoints[a]) for (const e2 of endpoints[b]) for (const t of grid.ts) {
    add(`${a}-${b}`, { L: e1.L + (e2.L - e1.L) * t, a: e1.a + (e2.a - e1.a) * t, b: e1.b + (e2.b - e1.b) * t });
  }
  const leg = [...new Set([...grid.ts, ...grid.ts.map((x) => 1 - (1 - x) * (1 - x))])];
  for (const [a, b] of waypoint) for (const [x, y] of [[a, b], [b, a]] as const) for (const e1 of endpoints[x]) for (const e2 of endpoints[y]) for (const s of leg) {
    const nL = (e1.L + e2.L) / 2;
    add(`${x}->N leg`, { L: e1.L + (nL - e1.L) * s, a: e1.a * (1 - s), b: e1.b * (1 - s) });
  }
  const ks = [...grid.ks, sweep.kMax];
  let composites = 0;
  let pixelFailures = 0;
  const first: string[] = [];
  let pixelWorst: BetaPairWorst = { chroma: 0, hue: NaN, where: '' };
  for (const [gName, G] of Object.entries(grounds)) {
    for (const { label, c } of colours) {
      for (const k of ks) {
        composites++;
        const m = maxInBandChromaOfPixels(pivotComposite(c, G, k, sweep.kp), CHECK_BAND, sweep.ditherAmplitude);
        if (m.chroma > pixelWorst.chroma) pixelWorst = { chroma: m.chroma, hue: m.hue, where: `${label} over ${gName}, k ${k}` };
        if (m.chroma > limits.check) {
          pixelFailures++;
          if (first.length < 3) first.push(`${label} over ${gName} k ${k}: C ${m.chroma.toFixed(5)} at ${m.hue.toFixed(1)}`);
        }
      }
    }
  }
  return {
    grounds,
    legs: straight.length + 2 * waypoint.length,
    lRange: [Lmin, Lmax],
    limits,
    float: { failures: floatFailures, worst: floatWorst },
    pixel: { composites, failures: pixelFailures, first, worst: pixelWorst },
  };
}
