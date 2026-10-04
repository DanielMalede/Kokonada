// The field's blend graph and the never-red sweep over everything the field can show (QA-065).
//
// The model is the designer's signed schema (V1 addendum §2.4) and routes (designer §1.2):
//   • A pixel mixes at most two graph-adjacent nodes, plus its local ground (DSN-049).
//   • A straight edge mixes its two nodes in OKLab. A waypoint edge runs a→N→b, where N is the
//     neutral at the midpoint of the two lightnesses, so it is two straight segments.
//   • Each node's chroma can be scaled by presence p in [0, 1]. Stress and the bead's chromaScale
//     only scale chroma further, so they stay inside the same set.
//   • The common-mode shimmer rotates the field's hue by φ in [−shimmer, +shimmer]; the ground
//     does not rotate.
//   • The field is composited over a local ground with weight k in [0, cap] through the pivot kp
//     (route R4), and the result is dithered on L before 8-bit quantisation.
//
// What is exact and what is sampled. For one segment, ground, k and φ, every colour the presence
// scaling and the mix parameter can reach lies in one OKLab triangle, and the float check tests
// that triangle against the design band exactly. k and φ are sampled on a grid. The 8-bit check
// against the check band is sampled on a coarser grid; each sample lists every pixel the dither
// can produce. Not modelled here: the lightness ramp of a low-presence placement, the dark-face
// lightness drop under stress, glyph anti-aliasing pairs, grain, and the real Skia render.

import { mixOklab, type Oklab, type Srgb } from './oklab.ts';
import { assertRedBand, maxInBandChromaInTriangle, maxInBandChromaOfPixels, type RedBand } from './redBand.ts';

export interface BlendGraph {
  readonly nodes: Readonly<Record<string, Oklab>>;
  readonly straight: ReadonlyArray<readonly [string, string]>;
  readonly waypoint: ReadonlyArray<readonly [string, string]>;
}

/** One straight OKLab segment a field pixel can lie on. A node alone is the segment [a, a]. */
export interface Segment {
  readonly id: string;
  readonly from: Oklab;
  readonly to: Oklab;
}

export type MixViolationCode = 'too-many-nodes' | 'not-adjacent' | 'unknown-node' | 'invalid-weight';

export interface MixViolation {
  readonly code: MixViolationCode;
  readonly nodes: readonly string[];
}

export interface NeverRedSweep {
  readonly graph: BlendGraph;
  /** The local grounds the field composites over: the ground, the plate face, the ring. */
  readonly grounds: Readonly<Record<string, Oklab>>;
  /** The largest composite weight k (the face's field cap). */
  readonly kMax: number;
  /** The ground pivot of route R4; 0 is the plain mix. */
  readonly kp: number;
  /** The common-mode hue shimmer, ± degrees. */
  readonly shimmerDeg: number;
  /** Checked in float, exactly over the mix parameter and presence. */
  readonly designBand: RedBand;
  /** Checked on the 8-bit pixels each sample can show. */
  readonly checkBand: RedBand;
  /** The field's dither on OKLab L, ± this amplitude. */
  readonly ditherAmplitude: number;
  readonly grid: {
    readonly kStep: number;
    readonly shimmerStepDeg: number;
    readonly pixelTStep: number;
    readonly pixelKStep: number;
    readonly chromaScales: readonly number[];
    /** The pixel shimmer step; absent, each end of a segment takes only −shimmer, 0 and +shimmer. */
    readonly pixelShimmerStepDeg?: number;
  };
}

export interface NeverRedFailure {
  readonly check: 'design-band' | 'check-band-pixel';
  readonly segment: string;
  readonly ground: string;
  readonly k: number;
  /** The rotation of each end of the segment. */
  readonly shimmerDeg: readonly [number, number];
  readonly t?: number;
  readonly chromaScales?: readonly [number, number];
  readonly pixel?: Srgb;
}

/** Where a sweep's largest in-band chroma sits, for DEC-081's margin rule. */
export interface NeverRedMax extends Omit<NeverRedFailure, 'check'> {
  /** 0 when nothing is in the band. */
  readonly chroma: number;
  readonly hue: number;
}

export interface NeverRedReport {
  readonly segments: readonly string[];
  readonly floatChecks: number;
  readonly pixelSamples: number;
  readonly failures: readonly NeverRedFailure[];
  /** The largest in-band chroma in float, against the design band. */
  readonly maxDesign: NeverRedMax;
  /** The largest in-band chroma on 8-bit pixels, against the check band. */
  readonly maxCheck: NeverRedMax;
}

const RAD = Math.PI / 180;
// Bound once: global lookups are ten times slower in jest's sandbox (see oklab.ts).
const { ceil, cos, max, min, sin } = Math;
const numberIsFinite = Number.isFinite;
const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);
const edgeKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

function assertFinite(lab: Oklab, what: string): void {
  if (!(numberIsFinite(lab.L) && numberIsFinite(lab.a) && numberIsFinite(lab.b))) {
    throw new RangeError(`${what} must be a finite colour`);
  }
}

/** The graph's edges by unordered pair, after checking every edge names real, distinct nodes once. */
function edgesOf(graph: BlendGraph): Set<string> {
  for (const [id, colour] of Object.entries(graph.nodes)) {
    assertFinite(colour, `node ${id}`);
  }
  const edges = new Set<string>();
  for (const [a, b] of [...graph.straight, ...graph.waypoint]) {
    if (!hasOwn(graph.nodes, a) || !hasOwn(graph.nodes, b)) {
      throw new RangeError(`edge ${a}-${b} names a node the graph does not have`);
    }
    if (a === b) {
      throw new RangeError(`edge ${a}-${b} joins a node to itself`);
    }
    const key = edgeKey(a, b);
    if (edges.has(key)) {
      throw new RangeError(`edge ${a}-${b} is listed more than once`);
    }
    edges.add(key);
  }
  return edges;
}

export function graphSegments(graph: BlendGraph): Segment[] {
  edgesOf(graph);
  const { nodes } = graph;
  const segments: Segment[] = [];
  for (const [a, b] of graph.straight) {
    segments.push({ id: `${a}-${b}`, from: nodes[a], to: nodes[b] });
  }
  for (const [a, b] of graph.waypoint) {
    const neutral: Oklab = { L: (nodes[a].L + nodes[b].L) / 2, a: 0, b: 0 };
    segments.push({ id: `${a}-N-${b}/1`, from: nodes[a], to: neutral });
    segments.push({ id: `${a}-N-${b}/2`, from: neutral, to: nodes[b] });
  }
  for (const id of Object.keys(nodes)) {
    segments.push({ id, from: nodes[id], to: nodes[id] });
  }
  return segments;
}

/** The ways a pixel's node weights break DSN-049. A weight of exactly 0 does not count. */
export function validateMix(graph: BlendGraph, weights: Readonly<Record<string, number>>): MixViolation[] {
  const edges = edgesOf(graph);
  const violations: MixViolation[] = [];
  const active: string[] = [];
  for (const [id, weight] of Object.entries(weights)) {
    if (!hasOwn(graph.nodes, id)) {
      violations.push({ code: 'unknown-node', nodes: [id] });
    } else if (!(weight >= 0 && numberIsFinite(weight))) {
      violations.push({ code: 'invalid-weight', nodes: [id] });
    } else if (weight > 0) {
      active.push(id);
    }
  }
  if (active.length > 2) {
    violations.push({ code: 'too-many-nodes', nodes: active });
  } else if (active.length === 2 && !edges.has(edgeKey(active[0], active[1]))) {
    violations.push({ code: 'not-adjacent', nodes: active });
  }
  return violations;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = min(1, max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How much of the ground's (1 − k) share of chroma survives at weight k (route R4). */
function groundChromaShare(k: number, kp: number): number {
  return (1 - k) * (kp === 0 ? 1 : 1 - smoothstep(0, kp, k));
}

/**
 * Route R4: out.L = mix(G.L, col.L, k); out.ab = k·col.ab + (1 − k)·(1 − smoothstep(0, kp, k))·G.ab.
 * With kp = 0 it is the plain OKLab mix.
 */
export function pivotComposite(colour: Oklab, ground: Oklab, k: number, kp: number): Oklab {
  if (!(k >= 0 && k <= 1)) {
    throw new RangeError(`composite weight k must be in [0, 1], got ${k}`);
  }
  if (!(kp >= 0 && numberIsFinite(kp))) {
    throw new RangeError(`pivot kp must be a finite number >= 0, got ${kp}`);
  }
  const share = groundChromaShare(k, kp);
  return {
    L: ground.L * (1 - k) + colour.L * k,
    a: k * colour.a + share * ground.a,
    b: k * colour.b + share * ground.b,
  };
}

/** 0 to `max` inclusive, in equal steps no longer than `step`. */
function samplesUpTo(limit: number, step: number): number[] {
  if (limit === 0) {
    return [0];
  }
  const n = max(1, ceil(limit / step - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? limit : (i * limit) / n));
}

/** −half to +half inclusive, in equal steps no longer than `step`. */
export function samplesAround(half: number, step: number): number[] {
  if (half === 0) {
    return [0];
  }
  const n = ceil((2 * half) / step - 1e-9);
  return Array.from({ length: n + 1 }, (_, i) => (i === n ? half : -half + (2 * half * i) / n));
}

function rotateHue(lab: Oklab, deg: number): Oklab {
  const c = cos(deg * RAD);
  const s = sin(deg * RAD);
  return { L: lab.L, a: lab.a * c - lab.b * s, b: lab.a * s + lab.b * c };
}

function assertSweep(config: NeverRedSweep): void {
  const { kMax, kp, shimmerDeg, ditherAmplitude, grid, grounds } = config;
  const positive = (x: number) => x > 0 && numberIsFinite(x);
  if (!(kMax >= 0 && kMax <= 1)) {
    throw new RangeError(`kMax must be in [0, 1], got ${kMax}`);
  }
  if (!(kp >= 0 && numberIsFinite(kp))) {
    throw new RangeError(`kp must be a finite number >= 0, got ${kp}`);
  }
  if (!(shimmerDeg >= 0 && shimmerDeg < 180)) {
    throw new RangeError(`shimmer must be in [0, 180) degrees, got ${shimmerDeg}`);
  }
  if (!(ditherAmplitude >= 0 && numberIsFinite(ditherAmplitude))) {
    throw new RangeError(`dither amplitude must be a finite number >= 0, got ${ditherAmplitude}`);
  }
  if (![grid.kStep, grid.shimmerStepDeg, grid.pixelTStep, grid.pixelKStep].every(positive)) {
    throw new RangeError('every grid step must be a finite number > 0');
  }
  if (grid.pixelShimmerStepDeg !== undefined && !positive(grid.pixelShimmerStepDeg)) {
    throw new RangeError('the pixel shimmer step, when given, must be a finite number > 0');
  }
  if (grid.chromaScales.length === 0 || !grid.chromaScales.every((p) => p >= 0 && p <= 1)) {
    throw new RangeError('chroma scales must be a non-empty list of values in [0, 1]');
  }
  if (Object.keys(grounds).length === 0) {
    throw new RangeError('the sweep needs at least one local ground');
  }
  for (const [name, ground] of Object.entries(grounds)) {
    assertFinite(ground, `ground ${name}`);
  }
  assertRedBand(config.designBand);
  assertRedBand(config.checkBand);
}

export function sweepNeverRed(config: NeverRedSweep): NeverRedReport {
  assertSweep(config);
  const segments = graphSegments(config.graph);
  const { grid, kp } = config;
  const groundNames = Object.keys(config.grounds);
  // Halos do not shimmer and the field does, so one pixel can mix a turned colour with an unturned
  // one: each end of a segment takes its own rotation. Float takes every pair of shimmer samples;
  // pixels take each end at −shimmer, 0 and +shimmer, or every grid.pixelShimmerStepDeg when given.
  const shimmers = samplesAround(config.shimmerDeg, grid.shimmerStepDeg);
  const pixelShimmers = samplesAround(config.shimmerDeg, grid.pixelShimmerStepDeg ?? (config.shimmerDeg || 1));
  const floatKs = samplesUpTo(config.kMax, grid.kStep);
  const pixelKs = samplesUpTo(config.kMax, grid.pixelKStep);
  const ts = samplesUpTo(1, grid.pixelTStep);
  const scales = grid.chromaScales;
  const failures: NeverRedFailure[] = [];
  let maxDesign: NeverRedMax = { chroma: 0, hue: NaN, segment: '', ground: '', k: 0, shimmerDeg: [0, 0] };
  let maxCheck: NeverRedMax = { chroma: 0, hue: NaN, segment: '', ground: '', k: 0, shimmerDeg: [0, 0] };
  let floatChecks = 0;
  let pixelSamples = 0;

  // The hot path: tens of thousands of samples for each direction and face.
  for (let s = 0; s < segments.length; s++) {
    const segment = segments[s];
    for (let g = 0; g < groundNames.length; g++) {
      const ground = groundNames[g];
      const G = config.grounds[ground];
      // Float, exact over presence and the mix parameter: at a given k and pair of rotations the
      // reachable set is the triangle (c·G, c·G + k·P, c·G + k·Q) in the a-b plane, c being the
      // ground's share; its largest in-band chroma is exact, and C >= floor is the red verdict.
      for (let ki = 0; ki < floatKs.length; ki++) {
        const k = floatKs[ki];
        const c = groundChromaShare(k, kp);
        const base = { L: 0, a: c * G.a, b: c * G.b };
        for (let fp = 0; fp < shimmers.length; fp++) {
          const P = rotateHue(segment.from, shimmers[fp]);
          const atP = { L: 0, a: base.a + k * P.a, b: base.b + k * P.b };
          for (let fq = 0; fq < shimmers.length; fq++) {
            const Q = rotateHue(segment.to, shimmers[fq]);
            const atQ = { L: 0, a: base.a + k * Q.a, b: base.b + k * Q.b };
            floatChecks++;
            const found = maxInBandChromaInTriangle(base, atP, atQ, config.designBand);
            const shimmerDeg = [shimmers[fp], shimmers[fq]] as const;
            if (found.chroma > maxDesign.chroma) {
              maxDesign = { chroma: found.chroma, hue: found.hue, segment: segment.id, ground, k, shimmerDeg };
            }
            if (found.chroma >= config.designBand.chromaFloor) {
              failures.push({ check: 'design-band', segment: segment.id, ground, k, shimmerDeg });
            }
          }
        }
      }
      // 8-bit, sampled: every pixel the dither can make from each sampled colour.
      for (let ki = 0; ki < pixelKs.length; ki++) {
        for (let ti = 0; ti < ts.length; ti++) {
          for (let i = 0; i < scales.length; i++) {
            for (let j = 0; j < scales.length; j++) {
              const from = { L: segment.from.L, a: scales[i] * segment.from.a, b: scales[i] * segment.from.b };
              const to = { L: segment.to.L, a: scales[j] * segment.to.a, b: scales[j] * segment.to.b };
              for (let fp = 0; fp < pixelShimmers.length; fp++) {
                for (let fq = 0; fq < pixelShimmers.length; fq++) {
                  pixelSamples++;
                  const mixed = mixOklab(rotateHue(from, pixelShimmers[fp]), rotateHue(to, pixelShimmers[fq]), ts[ti]);
                  const shown = pivotComposite(mixed, G, pixelKs[ki], kp);
                  const found = maxInBandChromaOfPixels(shown, config.checkBand, config.ditherAmplitude);
                  const where = {
                    segment: segment.id,
                    ground,
                    k: pixelKs[ki],
                    shimmerDeg: [pixelShimmers[fp], pixelShimmers[fq]] as const,
                    t: ts[ti],
                    chromaScales: [scales[i], scales[j]] as const,
                    pixel: found.pixel,
                  };
                  if (found.chroma > maxCheck.chroma) {
                    maxCheck = { chroma: found.chroma, hue: found.hue, ...where };
                  }
                  if (found.chroma >= config.checkBand.chromaFloor) {
                    failures.push({ check: 'check-band-pixel', ...where });
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return { segments: segments.map((seg) => seg.id), floatChecks, pixelSamples, failures, maxDesign, maxCheck };
}
