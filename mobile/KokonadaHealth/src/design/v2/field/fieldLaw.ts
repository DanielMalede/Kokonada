// The field law, per pixel (minimal F9): the TypeScript reference that the SkSL shader
// (fieldShader.ts) is held to pixel for pixel in the skia jest project. Every per-frame value,
// anything that depends on t, s, c, the breath or the placements, is computed in JS by the
// uniform builder (uniforms.ts) and arrives here as a FieldFrame. What is left is what each pixel
// does with it (designer §1.4, addendum §2.4–2.5):
//
//   q          the pixel in plate units: R = 1 at the rim, y up;
//   region     face (inside the label ring), ring, moat (field-free) or outside;
//   edge       the ring's inner edge over one canvas pixel (UI-114): α = clamp((d − ringInner)·R_px + ½, 0, 1);
//              inside the rim the inputs mix in OKLab: ground = mix(face ground at d_f = min(d, ringInner),
//              its inner shadows at q_f, ring ground, α), extent = mix(mask.face, mask.ring, α), grain
//              amplitude = mix(inside, ground, α); the halos are unchanged;
//   outer edge the rim over one canvas pixel (D6-1, UI-151): β = clamp((d − 1)·R_px + ½, 0, 1), after α; ground =
//              mix(G_in, the outside ground with its outer shadows at q_o, β), q_o = q/d below d = 1 and q beyond,
//              in OKLab; extent = (1 − β)·extent_in + β·0 (the moat); grain unchanged (the ring's is the ground's);
//   warp       q' = q + W·(fbm(1.4q + orbit·(cos θ, sin θ)) − 0.5, fbm(1.4q + (5.2, 1.3) + orbit·(sin θ, cos θ)) − 0.5);
//   lobes      ρ_i = r_i²/(|q' − c_i|² + κ·r_i²), the lobe with a core (κ = field.lobe.core), f_i = fade_i·ρ_i,
//              m = smoothstep(0.55, 1.6, Σ f_i) (law round 2, designer L1);
//   halos      η_i = 1 − smoothstep(r_bead, r_halo, |q − b_i|) inside the rim only, h_i = fade_i·peak·η_i;
//   k_field    kField·m·extent; H = min(peak, Σ h_i) (L2); k = min(max(k_field, H), max(cap, peak));
//   nodes      five bins, one per NODE id (L4 amended at D5b): each slot with fade > 0 belongs to its id's
//              bin; H_n = min(peak, Σ h_i over the slots of n);
//   a slot     a bead slot: (1 − w_n)·turned field colour + w_n·steady halo colour,
//              w_n = smoothstep(−0.05, 0, H_n − k_field) (UI-129); a rest lobe: its turned field colour
//              (designer 2.1, with the critic's exact mix: where w_n = 1 it is the halo bit for bit);
//   selection  topTwoSoft over nodes, not slots: e_i = fade_i·(extent·ρ_i + λ·η_i), linear in the fade
//              (L3; λ = 1/κ); E_n = Σ e_i over the slots of n, C_n their e-weighted mean colour (a guarded
//              running mean in slot order); E1 ≥ E2 ≥ E3 over the bins, ties to the lower id;
//              w1 = (E1 − E3)², w2 = (E2 − E3)², t = w2/(w1 + w2) (0 where w1 = 0) (L5′, UI-125); C1→C2
//              by t, or C1→N by s(2t), s(x) = 1 − (1 − x)², on a waypoint edge (J–I, and R0–I where the
//              direction says), N = (mid L, 0, 0); the pair fades to N̄ = (Σ e_i·L_i / Σ e_i over the
//              slots, 0, 0) by β = smoothstep(0, θ, r) near a third node, r = 3·√(d1² − d1·d2 + d2²)/
//              (E1 + E2 + E3), d1 = E1 − E3, d2 = E2 − E3 (L4–L6, L6′ at UI-139);
//   quiet      extent = regionExtent · Π over the quiet rects of (1 − p_z) + p_z·q_z, q_z = smoothstep(0, F, sd)
//              (a step where F = 0), sd the signed distance to the rect grown by g, rounded (designer r3 §1), and
//              p_z ∈ [0, 1] the zone's presence (DSN-023 amended, law round 2 item 7): p_z = 0 is no zone, bit for
//              bit, and p_z = 1 the zone, bit for bit;
//   shadows    G.L ← G.L·(1 − Σ strength·smoothstep(−blur, blur, u)): outer u = R − |q − o| outside the
//              rim, inner u = |q − o| − R_face on the face (designer 2.9);
//   composite  route R4: L = mix(G.L, col.L, k); ab = k·col.ab + (1 − k)·(1 − smoothstep(0, kp, k))·G.ab;
//   noise      static grain and blue-noise dither, on L only;
//   encode     OKLab → linear sRGB, clamped, sRGB-encoded, 8 bits.
//
// Math.* stays inline: the fallback gradients may compute their stops with this law on the UI thread.

import { oklabToSrgb, type Oklab } from '../color/oklab.ts';
import { blueNoiseValue } from './blueNoise.ts';

/** Node ids: the four quadrants and the rest glow. */
export const NODE = { J: 0, C: 1, R: 2, I: 3, R0: 4 } as const;
/**
 * The node bins (law round 2, D5b, the designer's amended L4): one per NODE id, so every NODE value is a
 * whole number below NODE_BINS. The selection pools the slots of each id into its bin, and the shader's
 * pooling loops are bound by this constant (fieldShader.ts).
 */
export const NODE_BINS = 5;
/**
 * Node slots (designer final ruling (1), on the architect's counter): one pool of six stable per-node
 * slots, at most three of them live (the ledger's bound), with no fixed live/shared split. A node
 * keeps its slot from the frame it enters until its fade reaches 0. A slot whose fade is 0 is skipped
 * by a uniform branch in the shader; no value changes.
 */
export const NODE_SLOTS = 6;

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

/**
 * An unused slot: no fade, so no lobe and no halo, and a finite colour, so that 0·c never makes a NaN
 * (architect re-rule §2). A new object each call: frames never share mutable nodes.
 */
export function inertNode(): FieldNodeFrame {
  'worklet';
  return { id: NODE.R0, fade: 0, centre: [0, 0], radius: 0, field: { L: 0, a: 0, b: 0 }, halo: { L: 0, a: 0, b: 0 }, bead: null };
}

/** A quiet zone (DSN-023): the measured bound's centre and half-size, in render px. */
export interface QuietRect {
  readonly cx: number;
  readonly cy: number;
  readonly hx: number;
  readonly hy: number;
}

/** At most six quiet zones (designer r3; orchestrator: more is a RangeError in tests and the lab). */
export const QUIET_SLOTS = 6;

/**
 * The quiet-zone slot registry (law round 2 item 7, architect option D): each zone keeps its slot whether or not it
 * shows, so a zone's presence moves only its own factor and a slot whose presence is 0 is exactly inert. Slot 5 is
 * the spare. The hero (B6) imports it.
 */
export const QUIET_ZONE = { avatar: 0, aiLine: 1, nav: 2, voiceBox: 3, cta: 4 } as const;

/**
 * Presence is aligned to the rects, one value per slot in use, each finite in [0, 1]: anything else is a
 * RangeError in every build (law round 2 item 7). The future FieldView sanitises at its boundary (non-finite → 1).
 */
export function checkQuietPresence(count: number, presence: readonly number[]): void {
  'worklet';
  if (presence.length !== count) throw new RangeError(`quiet presence must hold one value per quiet rect: ${count} rects, ${presence.length} values`);
  for (const p of presence) {
    if (!(Number.isFinite(p) && p >= 0 && p <= 1)) throw new RangeError(`a quiet presence must be finite in [0, 1], got ${p}`);
  }
}

/**
 * A plate shadow (designer 2.9), in plate units: its offset along y (y up: downward on screen is
 * negative), its blur, its signed strength (a negative one lifts), and its mode: 1 outer, outside the
 * rim; −1 inner, on the face; 0 none.
 */
export interface PlateShadow {
  readonly offset: number;
  readonly blur: number;
  readonly strength: number;
  readonly mode: number;
}

/** The face's plate.shadow and plate.shadow2. */
export const SHADOW_SLOTS = 2;

/** A shadow that draws nothing. */
export function inertShadow(): PlateShadow {
  'worklet';
  return { offset: 0, blur: 0, strength: 0, mode: 0 };
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
  /** λ in e_i = fade_i·(extent·ρ_i + λ·η_i) (field.graph.lambda, 1/κ). */
  readonly lambda: number;
  /** κ, the lobe's core: ρ_i = r_i²/(|q′ − c_i|² + κ·r_i²) is at most 1/κ (field.lobe.core). */
  readonly lobeCore: number;
  /** θ, the fade near the triple point, on r: β = smoothstep(0, θ, r) (field.graph.tripleFade; selectColour). */
  readonly tripleFade: number;
  /** Is R0–I a waypoint edge in this direction? */
  readonly restIntenseWaypoint: boolean;
  /** Grain amplitudes on L: inside the face, and everywhere else. */
  readonly grain: { readonly inside: number; readonly ground: number };
  /** The dither amplitude on L. */
  readonly dither: number;
  /**
   * Up to QUIET_SLOTS quiet zones, with quiet.grow and field.mask.quietFeather in render px, and each zone's
   * presence, aligned to the rects (checkQuietPresence).
   */
  readonly quiet: { readonly rects: readonly QuietRect[]; readonly presence: readonly number[]; readonly grow: number; readonly feather: number };
  /** SHADOW_SLOTS plate shadows. */
  readonly shadows: readonly PlateShadow[];
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

/**
 * The ring's inner edge, anti-aliased (law round 2, item 4, UI-114): the ring's coverage
 * α = clamp((d − ringInner)·radiusPx + ½, 0, 1), one field-canvas pixel wide and centred on ringInner, so
 * radiusPx is the canvas's own (uGeom.z) and no uniform is added. Away from that pixel α is exactly 0
 * or 1. The shader computes it in the same order (fieldShader.ts), and the never-red sweep reads it here.
 */
export function ringEdgeCoverage(d: number, frame: FieldFrame): number {
  return Math.min(1, Math.max(0, (d - frame.ringInner) * frame.radiusPx + 0.5));
}

/**
 * The ring's outer edge, anti-aliased (law round 2, D6-1, UI-151): the outside's coverage
 * β = clamp((d − 1)·radiusPx + ½, 0, 1), one field-canvas pixel wide and centred on the rim, radiusPx the
 * canvas's own (uGeom.z, no uniform added). Exactly 0 at d ≤ 1 − ½/radiusPx and 1 at d ≥ 1 + ½/radiusPx. The
 * shader computes it after α, in the same order (fieldShader.ts), and the never-red sweep reads it here.
 */
export function outerEdgeCoverage(d: number, frame: FieldFrame): number {
  return Math.min(1, Math.max(0, (d - 1) * frame.radiusPx + 0.5));
}

/**
 * The precondition of the two edges (D6-1): (1 − ringInner)·radiusPx ≥ 1, so the inner edge's pixel and the
 * outer edge's never overlap, and the outer band sees the ring at α = 1. ringOuterEdge.test.ts asserts it for
 * every token set at renderScale 0.5 and 0.33 over the device densities.
 */
export function ringBandsApart(frame: FieldFrame): boolean {
  return (1 - frame.ringInner) * frame.radiusPx >= 1;
}

/** The edge's mix of a face input and a ring input: (1 − α)·face + α·ring, the face bit for bit at α = 0, the ring at α = 1. */
export function edgeMix(face: number, ring: number, alpha: number): number {
  return (1 - alpha) * face + alpha * ring;
}

/** edgeMix on each OKLab channel: the edge's grounds are mixed in OKLab, never in sRGB. */
export function edgeMixOklab(face: Oklab, ring: Oklab, alpha: number): Oklab {
  return { L: edgeMix(face.L, ring.L, alpha), a: edgeMix(face.a, ring.a, alpha), b: edgeMix(face.b, ring.b, alpha) };
}

/**
 * The face's side of the edge at q (plate units, y up): the face ground at d_f = min(d, ringInner), its
 * inner shadows read at q_f, q pulled in to d_f (designer §4), so inside the band ρ ≤ 1 and P ≤ P_max
 * hold as they do on the face. Inside the face (d ≤ ringInner) it is the face's ground at q itself.
 */
export function faceGroundAt(frame: FieldFrame, qx: number, qy: number): Oklab {
  const d = Math.sqrt(qx * qx + qy * qy);
  const pull = d > frame.ringInner ? frame.ringInner / d : 1;
  const local = groundAt('face', Math.min(d, frame.ringInner), frame);
  return { L: local.L * shadowFactor(frame, 'face', qx * pull, qy * pull), a: local.a, b: local.b };
}

/**
 * The outside's side of the outer edge at q (plate units, y up): the outside ground, its outer shadows read at
 * q_o, q pulled out to the rim below d = 1 (q_o = q·(1/d)) and q itself beyond (D6-1), so inside the rim the
 * band sees the outer shadows as they are on the rim.
 */
export function outsideGroundAt(frame: FieldFrame, qx: number, qy: number): Oklab {
  const d = Math.sqrt(qx * qx + qy * qy);
  const pull = d < 1 ? 1 / d : 1;
  const g = frame.grounds.outside;
  return { L: g.L * shadowFactor(frame, 'outside', qx * pull, qy * pull), a: g.a, b: g.b };
}

function extentAt(region: Region, d: number, frame: FieldFrame, alpha: number): number {
  if (region === 'face' || region === 'ring') return edgeMix(frame.mask.face, frame.mask.ring, alpha);
  if (region === 'moat') return 0;
  return frame.mask.outside * (frame.moatFeather > 0 ? smoothstep(frame.moatOuter, frame.moatOuter + frame.moatFeather, d) : 1);
}

/**
 * The quiet zones' factor at the pixel centre (x, y), in render px (designer r3 §1): the product over the rects
 * of (1 − p)·1 + p·q, q being 0 on and inside the grown rect (DSN-023 amended). Written so, p = 0 gives exactly 1
 * and p = 1 exactly q, so the two ends are no zone and today's zone, bit for bit. It reads only frame.quiet: FieldFallback
 * decides its clip's pixels with it (fallbackModel.ts), at presence 1 and no feather.
 */
export function quietFactor(frame: Pick<FieldFrame, 'quiet'>, x: number, y: number): number {
  const { rects, presence, grow, feather } = frame.quiet;
  checkQuietPresence(rects.length, presence);
  let product = 1;
  for (let k = 0; k < rects.length; k++) {
    const r = rects[k];
    const qx = Math.abs(x - r.cx) - r.hx;
    const qy = Math.abs(y - r.cy) - r.hy;
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const sd = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - grow;
    const q = feather > 0 ? smoothstep(0, feather, sd) : sd > 0 ? 1 : 0;
    const p = presence[k];
    product *= (1 - p) + p * q;
  }
  return product;
}

/** The plate shadows' factor on the ground's L at q (plate units, y up), in a region (designer 2.9). */
export function shadowFactor(frame: FieldFrame, region: Region, qx: number, qy: number): number {
  let sum = 0;
  for (const s of frame.shadows) {
    if (s.mode === 0) continue;
    const dist = Math.sqrt(qx * qx + (qy - s.offset) * (qy - s.offset));
    if (s.mode > 0 && (region === 'moat' || region === 'outside')) sum += s.strength * smoothstep(-s.blur, s.blur, 1 - dist);
    if (s.mode < 0 && region === 'face') sum += s.strength * smoothstep(-s.blur, s.blur, dist - frame.ringInner);
  }
  return 1 - sum;
}

/** The halo's shape η at a distance from its bead's centre: 1 inside the bead, 0 at the halo radius. */
export function haloShape(distance: number, frame: FieldFrame): number {
  return 1 - smoothstep(frame.beadRadius, frame.haloRadius, distance);
}

/** The halo at a distance from its bead's centre: the peak inside the bead, 0 at the halo radius. */
export function haloWeight(distance: number, frame: FieldFrame): number {
  return frame.haloPeak * haloShape(distance, frame);
}

/**
 * The lobe with a core (designer L1): ρ = r²/(d² + κ·r²), at most 1/κ at the centre, so a lobe at fade φ
 * weighs at most φ/κ there. A lobe of radius 0 is nothing (0, never 0/0).
 */
export function lobeShape(dx: number, dy: number, radius: number, core: number): number {
  const r2 = radius * radius;
  return r2 > 0 ? r2 / (dx * dx + dy * dy + core * r2) : 0;
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
 * r, how far the three strongest nodes are from a tie (L6′, the designer's Ruling 1 at UI-139):
 * 3·√(d1² − d1·d2 + d2²)/(E1 + E2 + E3), d1 = E1 − E3, d2 = E2 − E3. d1² − d1·d2 + d2² = ½·Σ_{i<j}(E_i − E_j)²,
 * so r is symmetric in the three, never negative and 0 only at an exact triple tie; it needs no guard where
 * selectColour runs (E1 > 0). With E3 = 0 it is at least 1.5 (in float, up to two units in the last place
 * below it), so β = 1 for every θ ≤ 1. The shader computes it in the same order (fieldShader.ts).
 */
export function tripleRatio(e1: number, e2: number, e3: number): number {
  const d1 = e1 - e3;
  const d2 = e2 - e3;
  return (3 * Math.sqrt(d1 * d1 - d1 * d2 + d2 * d2)) / (e1 + e2 + e3);
}

/**
 * topTwoSoft over nodes, not slots (law round 2, designer L4–L6, L4 amended at D5b): each node pools its
 * slots (pooledNodes: E_n = Σ e_i, C_n the e-weighted mean of its slots' colours), so a mood placed more
 * than once never competes with itself. The two strongest nodes are each weighted by the square of how
 * far they lead the third (L5′, UI-125), w1 = (E1 − E3)² and w2 = (E2 − E3)², so t = w2/(w1 + w2) is ½
 * where the first two swap and 0 where the second and third do, and there its slope is 0 from both sides
 * (w2 and its slope vanish on E2 = E3, where E2 − E3 bends like |·|): no Mach band along that line. Ties
 * go to the lower id, and the colour does not depend on them. A waypoint pair mixes along C1→N,
 * N = (mid L, 0, 0), by s(2t), s(x) = 1 − (1 − x)², 2t ≤ 1, so the mix never passes N and arrives there
 * with slope 0: with v the second's share along the pair, one curve N + (C_a − N)·(1 − 2v)² for v ≤ ½
 * and N + (C_b − N)·(2v − 1)² for v ≥ ½. Near the triple point (r below θ, tripleRatio) the pair fades
 * to N̄, the e-weighted mean lightness, summed over the slots (equal to the node sum; the shader sums in
 * the same order): N̄ is symmetric in the nodes, so the colour is continuous there too, and r is
 * symmetric in the three strongest, so β's slope does not break where they swap (L6′, UI-139). With no
 * third node (E3 = 0) r ≥ 1.5, β is 1 and the colour is the pair, bit for bit; where each id has one slot
 * it is the slot law's, bit for bit. Called only where some e_i > 0 (fieldOklab).
 */
export function selectColour(e: readonly number[], colours: readonly Oklab[], ids: readonly number[], restIntenseWaypoint: boolean, tripleFade: number): Oklab {
  const { E, C } = pooledNodes(e, colours, ids);
  const [i1, i2, e3] = rankNodes(E);
  const c1 = C[i1];
  const c2 = C[i2];
  const d1 = E[i1] - e3;
  const d2 = E[i2] - e3;
  const w1 = d1 * d1;
  const w2 = d2 * d2;
  // The guard: at an exact triple tie w1 = w2 = 0, and 0/0 would be NaN (w2 ≤ w1, so w1 = 0 is the only case).
  const t = w1 > 0 ? w2 / (w1 + w2) : 0;
  let pair: Oklab;
  if (isWaypoint(i1, i2, restIntenseWaypoint)) {
    const x = 2 * t;
    const s = 1 - (1 - x) * (1 - x);
    const nL = (c1.L + c2.L) / 2;
    pair = { L: c1.L + (nL - c1.L) * s, a: c1.a * (1 - s), b: c1.b * (1 - s) };
  } else {
    pair = { L: c1.L + (c2.L - c1.L) * t, a: c1.a + (c2.a - c1.a) * t, b: c1.b + (c2.b - c1.b) * t };
  }
  const beta = smoothstep(0, tripleFade, tripleRatio(E[i1], E[i2], e3));
  let eSum = 0;
  let eL = 0;
  for (let i = 0; i < e.length; i++) {
    eSum += e[i];
    eL += e[i] * colours[i].L;
  }
  const neutralL = eL / eSum;
  // Written P·β + N̄·(1 − β), so at β = 1 the colour is the pair bit for bit.
  return { L: pair.L * beta + neutralL * (1 - beta), a: beta * pair.a, b: beta * pair.b };
}

/**
 * A slot's colour (designer 2.1): a bead node's field colour turned by the shimmer gives way to its
 * steady halo colour where its node's halo reaches the field's weight, w = smoothstep(−0.05, 0, H − kField),
 * H the node's pooled halo H_n (L4 amended, UI-129: slotColours passes it); a rest lobe is its turned
 * field colour. Written (1 − w)·turned + w·halo, so where w = 1 the node is the halo bit for bit, in the
 * law and in the shader (marks never shimmer, never feel s, c or t).
 */
export function nodeColour(node: FieldNodeFrame, h: number, kField: number, shimmer: { readonly cos: number; readonly sin: number }): Oklab {
  const turned = { L: node.field.L, a: node.field.a * shimmer.cos - node.field.b * shimmer.sin, b: node.field.a * shimmer.sin + node.field.b * shimmer.cos };
  if (node.bead === null) return turned;
  const w = smoothstep(-0.05, 0, h - kField);
  return { L: (1 - w) * turned.L + w * node.halo.L, a: (1 - w) * turned.a + w * node.halo.a, b: (1 - w) * turned.b + w * node.halo.b };
}

// ---------------------------------------------------------------------------------- the pixel

/**
 * What a pixel's selection reads: its region, its (shadowed) ground, the field weight k_field there and
 * the composite weight k, and per slot the selection weight e_i and the halo h_i; per node bin, the pooled
 * halo H_n = min(peak, Σ h_i over the slots of n) (L4 amended). Exported for the tests and their twins
 * (lawTwins.ts), which recompose the pixel from these pieces.
 */
export interface PixelTerms {
  readonly region: Region;
  /** The ring's coverage α at the pixel (ringEdgeCoverage): 0 on the face, 1 on the ring and beyond the rim. */
  readonly coverage: number;
  readonly ground: Oklab;
  readonly kField: number;
  readonly k: number;
  readonly e: readonly number[];
  readonly h: readonly number[];
  readonly halos: readonly number[];
}

/** H_n per node bin: min(peak, Σ h_i over the slots of id n, in ascending slot order). */
export function pooledHalos(h: readonly number[], ids: readonly number[], haloPeak: number): number[] {
  const out: number[] = new Array(NODE_BINS);
  for (let n = 0; n < NODE_BINS; n++) {
    let sum = 0;
    for (let i = 0; i < h.length; i++) if (ids[i] === n) sum += h[i];
    out[n] = Math.min(haloPeak, sum);
  }
  return out;
}

/**
 * Each node's weight and colour (L4 amended): E_n = Σ e_i over the slots of n, and C_n the guarded running
 * mean over its slots with e_i > 0, in ascending slot order: W′ = W + e_i; C_n = W > 0 ? C_n + (c_i −
 * C_n)·(e_i/W′) : c_i; W = W′. An empty bin is (0, 0, 0): finite, never read with a non-zero weight. A
 * slot at e = 0 is skipped, so it is bit for bit an inert slot.
 */
export function pooledNodes(e: readonly number[], colours: readonly Oklab[], ids: readonly number[]): { E: number[]; C: Oklab[] } {
  const E: number[] = new Array(NODE_BINS);
  const C: Oklab[] = new Array(NODE_BINS);
  for (let n = 0; n < NODE_BINS; n++) {
    let W = 0;
    let L = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < e.length; i++) {
      if (ids[i] !== n || !(e[i] > 0)) continue;
      const c = colours[i];
      const W2 = W + e[i];
      if (W > 0) {
        const s = e[i] / W2;
        L += (c.L - L) * s;
        a += (c.a - a) * s;
        b += (c.b - b) * s;
      } else {
        L = c.L;
        a = c.a;
        b = c.b;
      }
      W = W2;
    }
    E[n] = W;
    C[n] = { L, a, b };
  }
  return { E, C };
}

/** The ranking over the bins: E1 ≥ E2 ≥ E3, ties to the lower id. Returns [i1, i2, E3]. */
export function rankNodes(E: readonly number[]): [number, number, number] {
  let i1 = 0;
  for (let i = 1; i < E.length; i++) if (E[i] > E[i1]) i1 = i;
  let i2 = i1 === 0 ? 1 : 0;
  for (let i = 0; i < E.length; i++) if (i !== i1 && E[i] > E[i2]) i2 = i;
  let e3 = 0;
  for (let i = 0; i < E.length; i++) if (i !== i1 && i !== i2 && E[i] > e3) e3 = E[i];
  return [i1, i2, e3];
}

/** The pixel's selection terms at (x, y), in pixels. */
export function pixelTerms(frame: FieldFrame, x: number, y: number): PixelTerms {
  // Malformed presence is refused on every pixel, also where the extent gate skips the quiet factor.
  checkQuietPresence(frame.quiet.rects.length, frame.quiet.presence);
  const qx = (x - frame.centrePx[0]) / frame.radiusPx;
  const qy = -(y - frame.centrePx[1]) / frame.radiusPx;
  const d = Math.sqrt(qx * qx + qy * qy);
  const region = regionOf(d, frame);
  // Inside the rim the ground is the edge's mix of the face's side and the ring's, at the ring's coverage
  // (UI-114): the face's ground bit for bit where α = 0, the ring's where α = 1; beyond it the ring's, G_in.
  // Then the outer edge (D6-1), after α: G_in mixed toward the outside's side at β, which is 0 everywhere but
  // the rim's pixel and beyond it, so where β = 0 the ground is G_in bit for bit.
  const coverage = d <= 1 ? ringEdgeCoverage(d, frame) : 1;
  const beta = outerEdgeCoverage(d, frame);
  let ground = d <= 1 ? edgeMixOklab(faceGroundAt(frame, qx, qy), frame.grounds.ring, coverage) : frame.grounds.ring;
  if (beta > 0) ground = edgeMixOklab(ground, outsideGroundAt(frame, qx, qy), beta);

  const w = frame.warp;
  const wx = qx + w.amount * (fbm(1.4 * qx + w.orbit * w.cos, 1.4 * qy + w.orbit * w.sin, w.octaves) - 0.5);
  const wy = qy + w.amount * (fbm(1.4 * qx + 5.2 + w.orbit * w.sin, 1.4 * qy + 1.3 + w.orbit * w.cos, w.octaves) - 0.5);

  // A slot at fade 0 is skipped, as the shader's uniform branch skips it: every term it adds is 0, so
  // the frame equals the frame with that slot inert, bit for bit.
  const n = frame.nodes.length;
  const rho: number[] = new Array(n);
  const eta: number[] = new Array(n);
  const h: number[] = new Array(n);
  let fSum = 0;
  let hSum = 0;
  for (let i = 0; i < n; i++) {
    const node = frame.nodes[i];
    rho[i] = 0;
    eta[i] = 0;
    h[i] = 0;
    if (node.fade > 0) {
      rho[i] = lobeShape(wx - node.centre[0], wy - node.centre[1], node.radius, frame.lobeCore);
      if (node.bead !== null && d <= 1) {
        const bx = qx - node.bead[0];
        const by = qy - node.bead[1];
        eta[i] = haloShape(Math.sqrt(bx * bx + by * by), frame);
      }
      h[i] = node.fade * (frame.haloPeak * eta[i]);
    }
    fSum += node.fade * rho[i];
    hSum += h[i];
  }
  // The halos add, up to the peak (designer L2): two halves of one halo draw the whole halo.
  const H = Math.min(frame.haloPeak, hSum);
  // The extent: (1 − β)·the inner edge's + β·the region's beyond the rim, which is the moat's 0 in the band.
  const innerExtent = extentAt(d <= 1 ? region : 'ring', d, frame, coverage);
  const regionExtent = beta > 0 ? edgeMix(innerExtent, d <= 1 ? 0 : extentAt(region, d, frame, coverage), beta) : innerExtent;
  const extent = regionExtent > 0 ? regionExtent * quietFactor(frame, x, y) : 0;
  const kFieldHere = frame.kField * smoothstep(0.55, 1.6, fSum) * extent;
  const k = Math.min(Math.max(kFieldHere, H), frame.kMax);

  // Selection is gated by the extent (where the field is absent, only the halos compete) and linear in
  // each node's fade (designer L3), so a fading node hands its colour over across its fade.
  const e = frame.nodes.map((node, i) => node.fade * (extent * rho[i] + frame.lambda * eta[i]));
  const halos = pooledHalos(h, frame.nodes.map((node) => node.id), frame.haloPeak);
  return { region, coverage, ground, kField: kFieldHere, k, e, h, halos };
}

/**
 * Each slot's colour at the pixel (designer 2.1, L4 amended, UI-129): nodeColour with its node's pooled
 * halo H_n, so the mark weight w_n is the node's, and two halves of a swap draw one steady mark.
 */
export function slotColours(frame: FieldFrame, terms: PixelTerms): Oklab[] {
  return frame.nodes.map((node) => nodeColour(node, terms.halos[node.id], terms.kField, frame.shimmer));
}

/**
 * The pixel from its terms and its selected colour: route R4's composite, then grain and dither on L. FieldFallback's
 * stops are this composite with no grain and no dither (fallbackModel.ts), so it reads only what it needs.
 */
export function compositePixel(frame: Pick<FieldFrame, 'kp' | 'grain' | 'dither'>, terms: Pick<PixelTerms, 'ground' | 'k' | 'coverage'>, colour: Oklab, x: number, y: number): Oklab {
  const { ground, k } = terms;
  const share = (1 - k) * (frame.kp > 0 ? 1 - smoothstep(0, frame.kp, k) : 1);
  const px = Math.floor(x);
  const py = Math.floor(y);
  // The grain's amplitude is an input too: inside on the face, ground on the ring and beyond, mixed at α (UI-114).
  const grain = edgeMix(frame.grain.inside, frame.grain.ground, terms.coverage);
  return {
    L: ground.L + (colour.L - ground.L) * k + grain * blueNoiseValue('grain', px, py) + frame.dither * blueNoiseValue('dither', px, py),
    a: k * colour.a + share * ground.a,
    b: k * colour.b + share * ground.b,
  };
}

/** The pixel's OKLab colour, grain and dither included, before encoding. (x, y) in pixels. */
export function fieldOklab(frame: FieldFrame, x: number, y: number): Oklab {
  const terms = pixelTerms(frame, x, y);
  let colour = terms.ground;
  if (Math.max(...terms.e) > 0) {
    colour = selectColour(terms.e, slotColours(frame, terms), frame.nodes.map((node) => node.id), frame.restIntenseWaypoint, frame.tripleFade);
  }
  return compositePixel(frame, terms, colour, x, y);
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
