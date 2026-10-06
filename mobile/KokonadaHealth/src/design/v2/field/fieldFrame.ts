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
//   the still t = t*, b = 0.5, no shimmer.
//
// The drift tables and the rest lobes live in the token extensions, which app code may not import
// (extensionsBoundary.test.ts); the caller passes them in as FieldStatics, as the never-red sweeps
// take the graph's edges.

import type { Oklab } from '../color/oklab.ts';
import { breathCycles, breathLevel } from '../motion/breathLaw.ts';
import type { MotionTier } from '../motion/useMotionPolicy.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import { NODE, NODE_SLOTS, type FieldFrame, type FieldNodeFrame } from './fieldLaw.ts';

export type PlacementNode = 'J' | 'C' | 'R' | 'I' | 'neutral';

export interface Placement {
  readonly node: PlacementNode;
  /** The bead on the unit disc (the plate's layout radius, R minus the bead), y up. */
  readonly x: number;
  readonly y: number;
  /** Its lobe's and halo's fade in, 0..1 (placement settles in over motion.settle). Default 1. */
  readonly fade?: number;
}

export interface FieldState {
  readonly direction: DirectionId;
  readonly face: Face;
  /** Oldest first; only the latest three are drawn (a fourth replaces the oldest). */
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
  /** The rest lobes' fade while beads exist (the rest-to-placement transition). Default 0. */
  readonly restFade?: number;
}

export interface FieldGeometry {
  /** The plate centre and radius R, in pixels, and pixels per dp. */
  readonly centrePx: readonly [number, number];
  readonly radiusPx: number;
  readonly pxPerDp: number;
  /** The OS font scale: the label band grows with it. */
  readonly fontScale: number;
}

export interface FieldStatics {
  /** Rest-lobe centres, × R from the plate centre. */
  readonly restLobes: ReadonlyArray<readonly [number, number]>;
  /** Per lobe slot: [kx, ky] harmonics of 1/T, and [φx, φy] phases in radians. */
  readonly drift: {
    readonly harmonics: ReadonlyArray<readonly [number, number]>;
    readonly phases: ReadonlyArray<readonly [number, number]>;
  };
}

interface ExtensionsShape {
  readonly base: { readonly 'field.clock': { readonly drift: { readonly harmonics: Record<string, readonly [number, number]>; readonly phases: Record<string, readonly [number, number]> } } };
}

/** The statics for a direction, read from the extensions object the caller holds (the lab, a test). */
export function staticsFor(id: DirectionId, extensions: ExtensionsShape): FieldStatics {
  const drift = extensions.base['field.clock'].drift;
  const lobes = ['lobe0', 'lobe1', 'lobe2'];
  const own = (extensions as unknown as Record<string, Record<string, { lobes: ReadonlyArray<readonly [number, number]> }>>)[id]['field.rest'];
  return {
    restLobes: own.lobes,
    drift: { harmonics: lobes.map((l) => drift.harmonics[l]), phases: lobes.map((l) => drift.phases[l]) },
  };
}

const finite = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lab = (c: { readonly oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });
const QUADRANT = { J: 'joy', C: 'calm', R: 'reflective', I: 'intense' } as const;

/** The breath at a fixed time (captures, stills, sweeps): n(s) in JS, a whole number, and its phase. */
export function fixedFieldBreath(id: DirectionId, stress: number, tMs: number): { n: number; phase: number } {
  const breath = DIRECTIONS[id].field.breath;
  const T = BASE.field.clock.T;
  const n = breathCycles({ masterPeriodMs: T, nRest: breath.nRest, nStress: breath.nStress, inhale: breath.inhale }, stress);
  const wrapped = ((finite(tMs, 0) % T) + T) % T;
  return { n, phase: ((n * wrapped) % T) / T };
}

export function buildFieldFrame(state: FieldState, geometry: FieldGeometry, statics: FieldStatics): FieldFrame {
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
  const tier = face === 'dark' ? 'core' : 'deep';
  const restGlow = lab(colours.field.restGlow);

  const placements = state.placements.slice(-3);
  const nodes: FieldNodeFrame[] = placements.map((placement, slot) => {
    let x = finite(placement.x, 0);
    let y = finite(placement.y, 0);
    const r = Math.hypot(x, y);
    if (r > 1) {
      x /= r;
      y /= r;
    }
    const p = Math.min(1, Math.hypot(x, y));
    const bead: [number, number] = [x * (1 - beadRadius), y * (1 - beadRadius)];
    const along = Math.hypot(bead[0], bead[1]);
    const unit: [number, number] = along > 0 ? [bead[0] / along, bead[1] / along] : [0, 0];
    const [ox, oy] = offset(slot);
    const centre: [number, number] = [
      d.field.lobe.centreAlpha * bead[0] + d.field.lobe.centreBeta * unit[0] + ox,
      d.field.lobe.centreAlpha * bead[1] + d.field.lobe.centreBeta * unit[1] + oy,
    ];
    const fade = clamp01(finite(placement.fade ?? 1, 1));
    if (placement.node === 'neutral') {
      return { id: NODE.R0, fade, centre, radius: d.field.lobe.neutralLobe > 0 ? radius : 0, field: tense(restGlow), halo: restGlow, bead };
    }
    const anchor = lab(BASE.emotion[QUADRANT[placement.node]][tier]);
    const scale = p * d.bead.chromaScale;
    const halo = { L: anchor.L, a: anchor.a * scale, b: anchor.b * scale };
    return { id: NODE[placement.node], fade, centre, radius, field: tense(halo), halo, bead };
  });

  // Before any placement the rest glow shows on the rest lobes; once a bead is placed they fade out.
  const restFade = placements.length === 0 ? 1 : clamp01(finite(state.restFade ?? 0, 0));
  statics.restLobes.slice(0, NODE_SLOTS - nodes.length).forEach(([rx, ry], i) => {
    const [ox, oy] = offset(i);
    nodes.push({ id: NODE.R0, fade: restFade, centre: [rx + ox, ry + oy], radius, field: tense(restGlow), halo: restGlow, bead: null });
  });
  while (nodes.length < NODE_SLOTS) {
    nodes.push({ id: NODE.R0, fade: 0, centre: [0, 0], radius: 0, field: restGlow, halo: restGlow, bead: null });
  }

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
    restIntenseWaypoint: d.field.graph.restIntenseRoute === 'waypoint',
    grain: { inside: d.field.grain.inside, ground: d.field.grain.ground },
    dither: BASE.field.dither.amplitude,
    nodes,
  };
}
