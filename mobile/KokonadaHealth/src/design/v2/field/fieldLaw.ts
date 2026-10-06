// The field law, per pixel (minimal F9): the TypeScript reference that the SkSL shader
// (fieldShader.ts) is held to pixel for pixel in the skia jest project. Every per-frame value,
// anything that depends on t, s, c, the breath or the placements, is computed in JS by the
// uniform builder (uniforms.ts) and arrives here as a FieldFrame. What is left is what each pixel
// does with it (designer §1.4, addendum §2.4–2.5):
//
//   q          the pixel in plate units: R = 1 at the rim, y up;
//   region     face (inside the label ring), ring, moat (field-free) or outside;
//   warp       q' = q + W·(fbm(1.4q + orbit·(cos θ, sin θ)) − 0.5, fbm(1.4q + (5.2, 1.3) + orbit·(sin θ, cos θ)) − 0.5);
//   lobes      f_i = fade_i·r_i²/|q' − c_i|², m = smoothstep(0.55, 1.6, Σ f_i);
//   halos      h_i = fade_i·peak·(1 − smoothstep(r_bead, r_halo, |q − b_i|)), inside the rim only;
//   k_field    kField·m·extent; H = max h_i; k = min(max(k_field, H), max(cap, peak));
//   a node     its turned field colour, giving way to its steady halo colour where the halo
//              outweighs the field: w_i = smoothstep(−0.05, 0.05, h_i − k_field) (marks never shimmer);
//   selection  topTwoSoft over e_i = f_i + λ·h_i: (e1·a1 + max(0, e2 − e3)·a2)/(e1 + max(0, e2 − e3)),
//              through N = (mid L, 0, 0) on a waypoint edge (J–I, and R0–I where the direction says);
//   composite  route R4: L = mix(G.L, col.L, k); ab = k·col.ab + (1 − k)·(1 − smoothstep(0, kp, k))·G.ab;
//   noise      static grain and blue-noise dither, on L only;
//   encode     OKLab → linear sRGB, clamped, sRGB-encoded, 8 bits.
//
// Math.* stays inline: the fallback gradients may compute their stops with this law on the UI thread.

import { oklabToSrgb, type Oklab } from '../color/oklab.ts';
import { blueNoiseValue } from './blueNoise.ts';

/** Node ids: the four quadrants and the rest glow. */
export const NODE = { J: 0, C: 1, R: 2, I: 3, R0: 4 } as const;
/** Three beads and two rest lobes. */
export const NODE_SLOTS = 5;

export interface FieldNodeFrame {
  /** A NODE id. */
  readonly id: number;
  /** 0 is absent, 1 fully present: the lobe's and the halo's fade. */
  readonly fade: number;
  /** The lobe centre, in plate units. */
  readonly centre: readonly [number, number];
  /** The lobe radius r_L, in plate units, with the breath applied. */
  readonly radius: number;
  /** The field colour: presence and stress applied, not yet turned by the shimmer. */
  readonly field: Oklab;
  /** The halo colour: steady (no stress, no presence, no shimmer). */
  readonly halo: Oklab;
  /** The bead centre its halo surrounds, in plate units; null for a rest lobe, which has no halo. */
  readonly bead: readonly [number, number] | null;
}

export type Region = 'face' | 'ring' | 'moat' | 'outside';

export interface FieldFrame {
  /** The plate centre and radius R, in pixels. */
  readonly centrePx: readonly [number, number];
  readonly radiusPx: number;
  /** The label ring's inner edge, the moat's outer edge and the field's feather beyond it, in plate units. */
  readonly ringInner: number;
  readonly moatOuter: number;
  readonly moatFeather: number;
  /** The bead and halo radii, in plate units. */
  readonly beadRadius: number;
  readonly haloRadius: number;
  /** field.mask: where the field may show. */
  readonly mask: { readonly outside: number; readonly face: number; readonly ring: number };
  /** The local grounds: color.ground, plate.face and plate.ring. */
  readonly grounds: { readonly outside: Oklab; readonly face: Oklab; readonly ring: Oklab };
  /** The face's vignette (L × (1 + vignette·ρ²)) and centre lift (L + lift·(1 − ρ²)), ρ = d / ringInner. */
  readonly vignette: number;
  readonly centreLift: number;
  /** K·P·(1 − 0.2s), with the breath's presence term: the field weight before m and the extent. */
  readonly kField: number;
  /** max(cap, halo peak): no pixel's weight goes above it (genesisPresence is above 1). */
  readonly kMax: number;
  readonly haloPeak: number;
  /** The ground pivot kp (route R4); 0 is the plain mix. */
  readonly kp: number;
  /** W(s), the orbit, cos and sin of 2πt/T, and the fbm octaves (3 at tier full, 2 at tier low). */
  readonly warp: { readonly amount: number; readonly orbit: number; readonly cos: number; readonly sin: number; readonly octaves: number };
  /** cos and sin of the common-mode hue turn φ. */
  readonly shimmer: { readonly cos: number; readonly sin: number };
  /** λ in e_i = f_i + λ·h_i. */
  readonly lambda: number;
  /** Is R0–I a waypoint edge in this direction? */
  readonly restIntenseWaypoint: boolean;
  /** Grain amplitudes on L: inside the face, and everywhere else. */
  readonly grain: { readonly inside: number; readonly ground: number };
  /** The dither amplitude on L. */
  readonly dither: number;
  readonly nodes: readonly FieldNodeFrame[];
}

// ---------------------------------------------------------------------------------- helpers

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

const mod289 = (x: number) => x - 289 * Math.floor(x / 289);

/** The permutation polynomial mod 289: integers below 2^24 at every step, so float32 is exact. */
export function hash289(x: number): number {
  return mod289((x * 34 + 1) * x);
}

/** Value noise in [0, 1): hashed lattice values, smoothly interpolated. */
export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // The inner mod289 keeps every hash input below 289, so each step stays exact in float32 even where
  // a GPU divides by a reciprocal (fieldShader.ts does the same).
  const corner = (dx: number, dy: number) => hash289(mod289(hash289(mod289(ix + dx)) + mod289(iy + dy))) / 289;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const bottom = corner(0, 0) + (corner(1, 0) - corner(0, 0)) * ux;
  const top = corner(0, 1) + (corner(1, 1) - corner(0, 1)) * ux;
  return bottom + (top - bottom) * uy;
}

/** Fractal noise in [0, 1): `octaves` octaves (2 or 3), each twice the frequency and half the weight. */
export function fbm(x: number, y: number, octaves: number): number {
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    const w = o < octaves ? 0.5 ** o : 0;
    sum += w * valueNoise(x * 2 ** o, y * 2 ** o);
    norm += w;
  }
  return sum / norm;
}

export function regionOf(d: number, frame: FieldFrame): Region {
  if (d < frame.ringInner) return 'face';
  if (d <= 1) return 'ring';
  if (d < frame.moatOuter) return 'moat';
  return 'outside';
}

export function groundAt(region: Region, d: number, frame: FieldFrame): Oklab {
  if (region === 'face') {
    const g = frame.grounds.face;
    const rho2 = (d / frame.ringInner) ** 2;
    return { L: g.L * (1 + frame.vignette * rho2) + frame.centreLift * (1 - rho2), a: g.a, b: g.b };
  }
  return region === 'ring' ? frame.grounds.ring : frame.grounds.outside;
}

function extentAt(region: Region, d: number, frame: FieldFrame): number {
  if (region === 'face') return frame.mask.face;
  if (region === 'ring') return frame.mask.ring;
  if (region === 'moat') return 0;
  return frame.mask.outside * (frame.moatFeather > 0 ? smoothstep(frame.moatOuter, frame.moatOuter + frame.moatFeather, d) : 1);
}

/** The halo at a distance from its bead's centre: the peak inside the bead, 0 at the halo radius. */
export function haloWeight(distance: number, frame: FieldFrame): number {
  return frame.haloPeak * (1 - smoothstep(frame.beadRadius, frame.haloRadius, distance));
}

/**
 * The waypoint edges (designer §2.4, field.graph.edges): J–I always, and R0–I (`ROUTED_EDGES`) in a
 * direction whose restIntenseRoute is "waypoint". The shader's isWaypoint is generated from these
 * tables (fieldShader.ts), and graphConformance.test.ts holds them to the token graph.
 */
export const WAYPOINT_EDGES: ReadonlyArray<readonly [number, number]> = [[NODE.J, NODE.I]];
export const ROUTED_EDGES: ReadonlyArray<readonly [number, number]> = [[NODE.R0, NODE.I]];

const joins = (edges: ReadonlyArray<readonly [number, number]>, a: number, b: number) =>
  edges.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

/** Does the unordered pair (a, b) mix through N? `routed`: the direction routes R0–I. */
export function isWaypoint(a: number, b: number, routed: boolean): boolean {
  return joins(WAYPOINT_EDGES, a, b) || (routed && joins(ROUTED_EDGES, a, b));
}

/**
 * topTwoSoft: the two strongest nodes, the second weighted by how far it leads the third.
 * Ties go to the lower slot. A waypoint pair mixes along a→N, N = (mid L, 0, 0); the second never
 * outweighs the first, so the mix never passes N.
 */
export function selectColour(e: readonly number[], colours: readonly Oklab[], ids: readonly number[], restIntenseWaypoint: boolean): Oklab {
  let i1 = 0;
  for (let i = 1; i < e.length; i++) if (e[i] > e[i1]) i1 = i;
  let i2 = i1 === 0 ? 1 : 0;
  for (let i = 0; i < e.length; i++) if (i !== i1 && e[i] > e[i2]) i2 = i;
  let e3 = 0;
  for (let i = 0; i < e.length; i++) if (i !== i1 && i !== i2 && e[i] > e3) e3 = e[i];
  const c1 = colours[i1];
  const c2 = colours[i2];
  const w2 = Math.max(0, e[i2] - e3);
  const t = w2 / (e[i1] + w2);
  if (isWaypoint(ids[i1], ids[i2], restIntenseWaypoint)) {
    const s = 2 * t;
    const nL = (c1.L + c2.L) / 2;
    return { L: c1.L + (nL - c1.L) * s, a: c1.a * (1 - s), b: c1.b * (1 - s) };
  }
  return { L: c1.L + (c2.L - c1.L) * t, a: c1.a + (c2.a - c1.a) * t, b: c1.b + (c2.b - c1.b) * t };
}

// ---------------------------------------------------------------------------------- the pixel

/** The pixel's OKLab colour, grain and dither included, before encoding. (x, y) in pixels. */
export function fieldOklab(frame: FieldFrame, x: number, y: number): Oklab {
  const qx = (x - frame.centrePx[0]) / frame.radiusPx;
  const qy = -(y - frame.centrePx[1]) / frame.radiusPx;
  const d = Math.sqrt(qx * qx + qy * qy);
  const region = regionOf(d, frame);
  const ground = groundAt(region, d, frame);

  const w = frame.warp;
  const wx = qx + w.amount * (fbm(1.4 * qx + w.orbit * w.cos, 1.4 * qy + w.orbit * w.sin, w.octaves) - 0.5);
  const wy = qy + w.amount * (fbm(1.4 * qx + 5.2 + w.orbit * w.sin, 1.4 * qy + 1.3 + w.orbit * w.cos, w.octaves) - 0.5);

  const n = frame.nodes.length;
  const f: number[] = new Array(n);
  const h: number[] = new Array(n);
  let fSum = 0;
  let H = 0;
  for (let i = 0; i < n; i++) {
    const node = frame.nodes[i];
    const dx = wx - node.centre[0];
    const dy = wy - node.centre[1];
    f[i] = (node.fade * node.radius * node.radius) / Math.max(dx * dx + dy * dy, 1e-6);
    fSum += f[i];
    if (node.bead !== null && d <= 1) {
      const bx = qx - node.bead[0];
      const by = qy - node.bead[1];
      h[i] = node.fade * haloWeight(Math.sqrt(bx * bx + by * by), frame);
    } else {
      h[i] = 0;
    }
    H = Math.max(H, h[i]);
  }
  const kFieldHere = frame.kField * smoothstep(0.55, 1.6, fSum) * extentAt(region, d, frame);
  const k = Math.min(Math.max(kFieldHere, H), frame.kMax);

  let colour = ground;
  const e = f.map((fi, i) => fi + frame.lambda * h[i]);
  if (Math.max(...e) > 0) {
    const s = frame.shimmer;
    const colours = frame.nodes.map((node, i) => {
      const turned = { L: node.field.L, a: node.field.a * s.cos - node.field.b * s.sin, b: node.field.a * s.sin + node.field.b * s.cos };
      const toHalo = node.bead === null ? 0 : smoothstep(-0.05, 0.05, h[i] - kFieldHere);
      return {
        L: turned.L + (node.halo.L - turned.L) * toHalo,
        a: turned.a + (node.halo.a - turned.a) * toHalo,
        b: turned.b + (node.halo.b - turned.b) * toHalo,
      };
    });
    colour = selectColour(e, colours, frame.nodes.map((node) => node.id), frame.restIntenseWaypoint);
  }

  const share = (1 - k) * (frame.kp > 0 ? 1 - smoothstep(0, frame.kp, k) : 1);
  const px = Math.floor(x);
  const py = Math.floor(y);
  const grain = region === 'face' ? frame.grain.inside : frame.grain.ground;
  return {
    L: ground.L + (colour.L - ground.L) * k + grain * blueNoiseValue('grain', px, py) + frame.dither * blueNoiseValue('dither', px, py),
    a: k * colour.a + share * ground.a,
    b: k * colour.b + share * ground.b,
  };
}

/** OKLab to 8-bit sRGB: clamped to the gamut, rounded. */
export function encodeSrgb8(lab: Oklab): [number, number, number] {
  const rgb = oklabToSrgb(lab);
  return [0, 1, 2].map((c) => Math.round(Math.min(1, Math.max(0, rgb[c])) * 255)) as [number, number, number];
}

/** The pixel at (x, y) as the shader draws it: 8-bit sRGB. */
export function fieldPixel(frame: FieldFrame, x: number, y: number): [number, number, number] {
  return encodeSrgb8(fieldOklab(frame, x, y));
}
