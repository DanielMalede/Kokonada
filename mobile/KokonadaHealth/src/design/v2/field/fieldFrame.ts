// The uniform builder: the tokens, the statics the caller passes in, and the state of the moment, to
// one FieldFrame (fieldLaw.ts). Everything that moves with t, s, c, the breath or the placements is
// computed here, in JS, so the shader never rounds n or runs an oscillator of its own (resilience
// MEDIUM-2), and the TypeScript law and the shader see exactly the same numbers.
//
// The laws (designer §1.4, addendum §2.5):
//   drift   A_d(s)·(sin(2π·kx·t/T + φx), cos(2π·ky·t/T + φy)), A_d(s) = A0·[1 + (D − 1)(1 − s)]·(1 − 0.4s);
//   warp    W(s) = W0·(1 − 0.4s), orbiting once per T;
//   shimmer deg·(1 − s)·sin(6πt/T), common-mode, off at tier low and in the still;
//   breath  lobe radius × (1 + ampRadius·b·(1 − 0.5s)), presence × (1 − ampPresence + ampPresence·b);
//   tension field colour C × (1 − 0.35s), L × (1 − 0.15s) on dark; weight × (1 − 0.2s); halos untouched;
//   presence P(c) = P_min + (1 − P_min)·c, or P_none with no inference; × genesisPresence in genesis;
//   a node  from (x, y): neutral inside placement.neutralRadius, else the quadrant by sign; its ramp
//           p = clamp((r − neutralRadius)/(rampEnd − neutralRadius)); halo L = lerp(L_R0, L_tier, p),
//           ab = p·bead.chromaScale·tier.ab (designer 2.7, critic item 7);
//   the still t = t*, b = 0.5, no shimmer.
//
// The drift tables and the rest lobes live in the token extensions, which app code may not import
// (extensionsBoundary.test.ts); the caller passes them in as FieldStatics, as the never-red sweeps
// take the graph's edges. statics.ts reads them on the JS thread, once per direction.
//
// Every function here is a worklet (workletSafe.test.ts): FieldView derives the uniforms on the UI
// thread, and a worklet may call only worklets. Math.* and Number.* stay inline.

import type { Oklab } from '../color/oklab.ts';
import { breathCycles, breathLevel } from '../motion/breathLaw.ts';
import type { MotionTier } from '../motion/useMotionPolicy.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import { NODE, NODE_SLOTS, QUIET_SLOTS, inertNode, inertShadow, type FieldFrame, type FieldNodeFrame, type PlateShadow, type QuietRect } from './fieldLaw.ts';

export type PlacementNode = 'J' | 'C' | 'R' | 'I' | 'neutral';

export interface Placement {
  /**
   * The bead on the unit disc (the plate's layout radius, R minus the bead), y up. Its node and its
   * chroma ramp follow from this position alone (nodeAt, placementRamp; designer 2.7).
   */
  readonly x: number;
  readonly y: number;
  /**
   * Its lobe's and halo's fade, 0..1, from the crossfade (crossfade.ts). Required on the runtime path:
   * a missing or non-finite fade draws nothing (0), never everything (resilience QA-068 finding 4).
   */
  readonly fade: number;
  /**
   * How many placements came before it (placementLedger.ts): its drift table for its whole life,
   * its fade-out included (critic item 5). Default: its index in `placements`, a scene's order.
   */
  readonly ordinal?: number;
  /**
   * The ledger's role, carried for the caller: the builder draws every placement it is given, live or
   * leaving, at its fade. At most three are live; that bound is the ledger's.
   */
  readonly role?: 'live' | 'leaving';
  /** The node slot the ledger gave it, 0..NODE_SLOTS − 1, kept from entering to fade 0. Default: the lowest free slot. */
  readonly slot?: number;
}

export interface FieldState {
  readonly direction: DirectionId;
  readonly face: Face;
  /** Live and leaving placements, every one drawn at its fade, each in its own node slot. */
  readonly placements: readonly Placement[];
  /** Tension s in [0, 1]. */
  readonly stress: number;
  /** Confidence c in [0, 1], or null with no inference (mood only). */
  readonly confidence: number | null;
  readonly genesis: boolean;
  /** The field clock's time, in ms (wrapped modulo T). */
  readonly tMs: number;
  /** The breath phase in [0, 1), from the phaser (real time) or fixedFieldBreath (fixed time). */
  readonly breathPhase: number;
  readonly tier: MotionTier;
  /**
   * The rest lobes' fade, from the crossfade: one number for every rest lobe, or one per lobe in the
   * table's order (the ledger's restFades: under L7 each outgoing lobe falls on its own curve). Forced to
   * 1 while no placement in the frame carries a lobe (nothing placed, or only neutral placements where
   * neutralLobe is 0), placements still fading out included (designer 2.6). Required; a missing or
   * non-finite value is 0.
   */
  readonly restFade: number | readonly number[];
  /** The node slot of each rest lobe, from the ledger. Default: the lowest free slots, after the placements. */
  readonly restSlots?: readonly number[];
}

export interface FieldGeometry {
  /** The plate centre and radius R, in pixels, and pixels per dp. */
  readonly centrePx: readonly [number, number];
  readonly radiusPx: number;
  readonly pxPerDp: number;
  /** The OS font scale: the label band grows with it. */
  readonly fontScale: number;
  /**
   * The quiet zones (DSN-023): each measured text or control bound's centre and half-size, in the
   * field canvas's render px. At most QUIET_SLOTS, each finite with a size of 0 or more: anything else
   * is a RangeError in every build (checkQuietRects). The shipped clamp to QUIET_SLOTS lives at
   * FieldView's geometry boundary, never in the builder.
   */
  readonly quietRects?: readonly QuietRect[];
}

/** More than QUIET_SLOTS rects, or a rect that is not finite or has a negative size, is a RangeError. */
export function checkQuietRects(rects: readonly QuietRect[]): void {
  'worklet';
  if (rects.length > QUIET_SLOTS) throw new RangeError(`at most ${QUIET_SLOTS} quiet rects, got ${rects.length}`);
  for (const r of rects) {
    const ok = Number.isFinite(r.cx) && Number.isFinite(r.cy) && Number.isFinite(r.hx) && Number.isFinite(r.hy) && r.hx >= 0 && r.hy >= 0;
    if (!ok) throw new RangeError(`a quiet rect must be finite with a size of 0 or more, got ${r.cx}, ${r.cy}, ${r.hx}, ${r.hy}`);
  }
}

export interface FieldStatics {
  /** Rest-lobe centres, × R from the plate centre, per face (UI-112): the builder draws the frame's face's. */
  readonly restLobes: Readonly<Record<Face, ReadonlyArray<readonly [number, number]>>>;
  /** Per lobe slot: [kx, ky] harmonics of 1/T, and [φx, φy] phases in radians. */
  readonly drift: {
    readonly harmonics: ReadonlyArray<readonly [number, number]>;
    readonly phases: ReadonlyArray<readonly [number, number]>;
  };
  /** The fallback's radial stops (field.fallback, F-11 A): positions × the lobe's fallback radius, and the metaball weight at each. */
  readonly fallbackStops: {
    readonly position: readonly number[];
    readonly weight: readonly number[];
  };
}

const finite = (v: number, fallback: number) => {
  'worklet';
  return Number.isFinite(v) ? v : fallback;
};
const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
/** A placement's ordinal: the one it carries, if it is a whole number ≥ 0, or its index in the list. */
const ordinalOf = (ordinal: number | undefined, index: number) => {
  'worklet';
  return ordinal !== undefined && Number.isInteger(ordinal) && ordinal >= 0 ? ordinal : index;
};
const lab = (c: { readonly oklab: readonly number[] }): Oklab => {
  'worklet';
  return { L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] };
};
const QUADRANT = { J: 'joy', C: 'calm', R: 'reflective', I: 'intense' } as const;
/** The emotion tier each face draws (field.graph.nodeTier); graphConformance.test.ts holds it to the token. */
export const NODE_TIER: Readonly<Record<Face, 'core' | 'deep'>> = { dark: 'core', light: 'deep' };

/**
 * The node a position on the unit disc places (designer 2.7): neutral inside
 * placement.neutralRadius, otherwise the quadrant by sign, x ≥ 0 pleasant and y ≥ 0 more energy.
 */
export function nodeAt(x: number, y: number): PlacementNode {
  'worklet';
  if (Math.min(1, Math.hypot(x, y)) < BASE.placement.neutralRadius) return 'neutral';
  if (x >= 0) return y >= 0 ? 'J' : 'C';
  return y >= 0 ? 'I' : 'R';
}

/**
 * The placement's ramp p (designer 2.7, DSN-017): 0 at placement.neutralRadius, 1 from
 * placement.rampEnd out, linear between; r is clamped to the unit disc.
 */
export function placementRamp(x: number, y: number): number {
  'worklet';
  const r = Math.min(1, Math.hypot(x, y));
  const from = BASE.placement.neutralRadius;
  return clamp01((r - from) / (BASE.placement.rampEnd - from));
}

/**
 * A placement's lobe centre before its drift (designer 2.7; L7 measures δ between these): the tap read
 * as the builder reads it (a non-finite coordinate is 0, a tap outside the unit disc is moved onto its
 * rim), its bead pulled in by the bead radius, then centreAlpha·bead + centreBeta·unit. The builder adds
 * the ordinal's drift to it, so the ledger and the builder cannot disagree on where a lobe sits.
 */
export function lobeAnchor(px: number, py: number, beadRadius: number, centreAlpha: number, centreBeta: number): [number, number] {
  'worklet';
  let x = finite(px, 0);
  let y = finite(py, 0);
  const r = Math.hypot(x, y);
  if (r > 1) {
    x /= r;
    y /= r;
  }
  const bead: [number, number] = [x * (1 - beadRadius), y * (1 - beadRadius)];
  const along = Math.hypot(bead[0], bead[1]);
  const unit: [number, number] = along > 0 ? [bead[0] / along, bead[1] / along] : [0, 0];
  return [centreAlpha * bead[0] + centreBeta * unit[0], centreAlpha * bead[1] + centreBeta * unit[1]];
}

/** The breath at a fixed time (captures, stills, sweeps): n(s) in JS, a whole number, and its phase. */
export function fixedFieldBreath(id: DirectionId, stress: number, tMs: number): { n: number; phase: number } {
  'worklet';
  const breath = DIRECTIONS[id].field.breath;
  const T = BASE.field.clock.T;
  const n = breathCycles({ masterPeriodMs: T, nRest: breath.nRest, nStress: breath.nStress, inhale: breath.inhale }, stress);
  const wrapped = ((finite(tMs, 0) % T) + T) % T;
  return { n, phase: ((n * wrapped) % T) / T };
}

export function buildFieldFrame(state: FieldState, geometry: FieldGeometry, statics: FieldStatics): FieldFrame {
  'worklet';
  const d = DIRECTIONS[state.direction];
  const face = state.face;
  const colours = d.color[face];
  const T = BASE.field.clock.T;
  const still = state.tier === 'still';
  const s = clamp01(finite(state.stress, 0));
  const c = state.confidence === null || !Number.isFinite(state.confidence) ? null : clamp01(state.confidence);
  const t = still ? d.field.stillTime : ((finite(state.tMs, 0) % T) + T) % T;
  const phase = ((finite(state.breathPhase, 0) % 1) + 1) % 1;
  const b = still ? 0.5 : breathLevel(phase, d.field.breath.inhale);
  const stress = BASE.field.stress;
  const angle = (harmonic: number) => (2 * Math.PI * harmonic * t) / T;

  // Geometry, in plate units (R = 1).
  const rDp = geometry.radiusPx / geometry.pxPerDp;
  const bandDp = Math.max(BASE.plate.labelBand.min, BASE.plate.labelBand.min * finite(geometry.fontScale, 1));
  const beadRadius = d.bead.diameter / 2 / rDp;

  // Weight, presence and the breath.
  const presence = (c === null ? d.field.presence.none : d.field.presence.min + (1 - d.field.presence.min) * c) * (state.genesis ? d.field.genesisPresence : 1);
  const ampP = d.field.breath.ampPresence;
  const kField = d.field.K[face] * presence * (1 - stress.weight * s) * (1 - ampP + ampP * b);
  const radius = d.field.lobe.radius * (1 + d.field.breath.ampRadius * b * (1 - stress.breathAmp * s));

  // Motion: drift, warp and shimmer, all whole harmonics of 1/T.
  const drift = d.field.drift.A0 * (1 + (d.field.drift.D - 1) * (1 - s)) * (1 - stress.speed * s);
  const offset = (slot: number): [number, number] => {
    const [kx, ky] = statics.drift.harmonics[slot % statics.drift.harmonics.length];
    const [px, py] = statics.drift.phases[slot % statics.drift.phases.length];
    return [drift * Math.sin(angle(kx) + px), drift * Math.cos(angle(ky) + py)];
  };
  const tierShimmer = still ? 0 : BASE.field.tiers[state.tier as 'full' | 'low'].shimmer;
  const phi = ((d.field.shimmer.deg * Math.PI) / 180) * (1 - stress.life * s) * Math.sin(angle(BASE.field.clock.shimmer.harmonic)) * tierShimmer;
  const theta = angle(BASE.field.clock.warp.harmonic);

  // Colours: the field's under tension, the halo's steady.
  const lightness = face === 'dark' ? stress.lightnessDark : stress.lightnessLight;
  const tense = (colour: Oklab): Oklab => ({
    L: colour.L * (1 - lightness * s),
    a: colour.a * (1 - stress.chroma * s),
    b: colour.b * (1 - stress.chroma * s),
  });
  const tier = NODE_TIER[face];
  const restGlow = lab(colours.field.restGlow);

  // Slots (designer final ruling (1)): one pool. Every placement, live or leaving, and every rest lobe
  // whose fade is above 0 takes a node slot: the one the ledger gave it, or else the lowest free one
  // (placements by ordinal, then rest lobes by index). More than NODE_SLOTS nodes, or a slot out of
  // range or taken twice, throws: the builder never cuts a node (the ledger's admission bounds demand).
  const entries = state.placements
    .map((placement, index) => ({ placement, ordinal: ordinalOf(placement.ordinal, index) }))
    .sort((p, q) => p.ordinal - q.ordinal);

  // A placement's lobe and halo; its drift is its ordinal's, never its slot's.
  const placed = (placement: Placement, ordinal: number): FieldNodeFrame => {
    let x = finite(placement.x, 0);
    let y = finite(placement.y, 0);
    const r = Math.hypot(x, y);
    if (r > 1) {
      x /= r;
      y /= r;
    }
    const node = nodeAt(x, y);
    const p = placementRamp(x, y);
    const bead: [number, number] = [x * (1 - beadRadius), y * (1 - beadRadius)];
    const [ax, ay] = lobeAnchor(placement.x, placement.y, beadRadius, d.field.lobe.centreAlpha, d.field.lobe.centreBeta);
    const [ox, oy] = offset(ordinal);
    const centre: [number, number] = [ax + ox, ay + oy];
    const fade = clamp01(finite(placement.fade, 0));
    if (node === 'neutral') {
      return { id: NODE.R0, fade, centre, radius: d.field.lobe.neutralLobe > 0 ? radius : 0, field: tense(restGlow), halo: restGlow, bead };
    }
    // DSN-017 applied to the field (critic item 7, accepted): the lightness ramps from the rest glow's,
    // and the chroma from 0, both with p; ab stays p·tier.ab, so every node pair keeps its graph route.
    const anchor = lab(BASE.emotion[QUADRANT[node]][tier]);
    const scale = p * d.bead.chromaScale;
    const halo = { L: restGlow.L + (anchor.L - restGlow.L) * p, a: anchor.a * scale, b: anchor.b * scale };
    return { id: NODE[node], fade, centre, radius, field: tense(halo), halo, bead };
  };

  const items: Array<{ node: FieldNodeFrame; slot: number | undefined }> = entries.map((e) => ({ node: placed(e.placement, e.ordinal), slot: e.placement.slot }));
  // The rest glow shows while no placement in the frame carries a lobe, those still fading out
  // included; otherwise each rest lobe takes the crossfade's value, its own where one is given per lobe
  // (designer 2.6, L7). Rest lobe i keeps drift table i. A rest lobe at fade 0 frees its slot.
  const anyLobe = entries.some(({ placement }) => nodeAt(finite(placement.x, 0), finite(placement.y, 0)) !== 'neutral' || d.field.lobe.neutralLobe > 0);
  const given = state.restFade;
  statics.restLobes[face].forEach(([rx, ry], i) => {
    const restFade = anyLobe ? clamp01(finite(Array.isArray(given) ? (i < given.length ? given[i] : 0) : (given as number), 0)) : 1;
    if (!(restFade > 0)) return;
    const [ox, oy] = offset(i);
    const node = { id: NODE.R0, fade: restFade, centre: [rx + ox, ry + oy] as [number, number], radius, field: tense(restGlow), halo: restGlow, bead: null };
    items.push({ node, slot: state.restSlots === undefined ? undefined : state.restSlots[i] });
  });
  if (items.length > NODE_SLOTS) {
    throw new RangeError(`a field frame holds at most ${NODE_SLOTS} nodes, got ${items.length}`);
  }
  const slots: Array<FieldNodeFrame | null> = [];
  for (let i = 0; i < NODE_SLOTS; i++) slots.push(null);
  for (const item of items) {
    if (item.slot === undefined) continue;
    if (!(Number.isInteger(item.slot) && item.slot >= 0 && item.slot < NODE_SLOTS) || slots[item.slot] !== null) {
      throw new RangeError(`node slot ${item.slot} is out of range or taken twice`);
    }
    slots[item.slot] = item.node;
  }
  for (const item of items) {
    if (item.slot !== undefined) continue;
    slots[slots.indexOf(null)] = item.node;
  }
  const nodes: FieldNodeFrame[] = slots.map((node) => (node === null ? inertNode() : node));

  // Quiet zones in render px, refused above QUIET_SLOTS or when malformed, in every build.
  const quietRects = geometry.quietRects ?? [];
  checkQuietRects(quietRects);
  // The plate's shadows (designer 2.9): outer where plate.depth > 0, inner where it is below 0, in plate
  // units; a shadow with no strength or no blur draws nothing.
  const mode = Math.sign(d.plate.depth);
  const shadowOf = (token: { readonly offsetY: number; readonly blur: number; readonly strength: number }): PlateShadow =>
    token.strength !== 0 && token.blur > 0 && mode !== 0 ? { offset: -token.offsetY / rDp, blur: token.blur / rDp, strength: token.strength, mode } : inertShadow();

  return {
    centrePx: [finite(geometry.centrePx[0], 0), finite(geometry.centrePx[1], 0)],
    radiusPx: geometry.radiusPx,
    ringInner: 1 - bandDp / rDp,
    moatOuter: 1 + d.field.mask.moat / rDp,
    moatFeather: d.field.mask.moatFeather / rDp,
    beadRadius,
    haloRadius: BASE.field.halo.diameter / 2 / rDp,
    mask: d.field.mask,
    grounds: { outside: lab(colours.ground), face: lab(colours.plate.face), ring: lab(colours.plate.ring) },
    vignette: d.plate.face.vignette[face],
    centreLift: d.plate.face.centreLift[face],
    kField,
    kMax: Math.max(d.field.cap[face], face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight),
    haloPeak: face === 'dark' ? BASE.field.halo.peakDark : BASE.field.halo.peakLight,
    kp: d.field.pivot,
    warp: {
      amount: d.field.warp.W0 * (1 - stress.speed * s),
      orbit: d.field.warp.orbit,
      cos: Math.cos(theta),
      sin: Math.sin(theta),
      octaves: state.tier === 'low' ? BASE.field.tiers.low.octaves : BASE.field.tiers.full.octaves,
    },
    shimmer: phi === 0 ? { cos: 1, sin: 0 } : { cos: Math.cos(phi), sin: Math.sin(phi) },
    lambda: BASE.field.graph.lambda,
    lobeCore: BASE.field.lobe.core,
    tripleFade: BASE.field.graph.tripleFade,
    restIntenseWaypoint: d.field.graph.restIntenseRoute === 'waypoint',
    grain: { inside: d.field.grain.inside, ground: d.field.grain.ground },
    dither: BASE.field.dither.amplitude,
    quiet: { rects: quietRects, grow: BASE.quiet.grow * geometry.pxPerDp, feather: d.field.mask.quietFeather * geometry.pxPerDp },
    shadows: [shadowOf(d.plate.shadow[face]), shadowOf(d.plate.shadow2[face])],
    nodes,
  };
}
