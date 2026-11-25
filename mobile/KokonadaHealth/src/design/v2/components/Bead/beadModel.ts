// The bead's pure model (F10 group A, DSN-017, DSN-029; LEDGER §5.5, §7): a placed point's colours, and how
// it enters and leaves. The views (Bead.tsx) draw exactly this. Where it sits is the plate's shared geometry
// (Plate/geometry.ts pointToLocal, held to the field builder there), so the bead sits on its own halo.
//
// Colour (DSN-017): the face's neutral bead inside placement.neutralRadius; otherwise the lightness runs
// from the neutral bead's to the quadrant anchor's (the face's tier: core on dark, deep on light) with the
// placement ramp p, and the chroma is p·bead.chromaScale·anchor.ab. The node and p are the field's own
// (nodeAt, placementRamp), so the bead and its halo always agree.
//
// Motion: the entrance follows motion.placement (scaleFrom, the easing token, the overshoot scaled to the
// token's peak and × (1 − s), LEDGER §2); under reduced motion (the still tier) it is a linear fade over
// motion.fadeReduced with no scale. Battery saver does not change UI motion (LEDGER §7). The exit runs from
// where the bead is, linearly to 0 over the same duration, its scale held (the designer's board, d3).

import { Easing } from 'react-native';
import { mixOklab, srgbToOklab, type Oklab } from '../../color/oklab.ts';
import { NODE_TIER, QUADRANT, nodeAt, placementRamp } from '../../field/fieldFrame.ts';
import { encodeSrgb8 } from '../../field/fieldLaw.ts';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import type { PlatePoint } from '../Plate/geometry.ts';

const WHITE: Oklab = { L: 1, a: 0, b: 0 };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const labOf = (c: { readonly oklab: readonly number[] }): Oklab => ({ L: c.oklab[0], a: c.oklab[1], b: c.oklab[2] });

/**
 * A tap as the field builder reads it for its node and ramp: each non-finite coordinate is 0, and a point outside the
 * unit disc moves onto its rim (fieldFrame.ts; pointToLocal reads a point for its place the same way).
 */
export function readPoint(p: PlatePoint): PlatePoint {
  let x = Number.isFinite(p.x) ? p.x : 0;
  let y = Number.isFinite(p.y) ? p.y : 0;
  const r = Math.hypot(x, y);
  if (r > 1) {
    x /= r;
    y /= r;
  }
  return { x, y };
}

/** DSN-017: the bead's fill for a point, in OKLab. */
export function beadFill(id: DirectionId, face: Face, point: PlatePoint): Oklab {
  const d = DIRECTIONS[id];
  const neutral = labOf(d.color[face].bead.neutral);
  const p = readPoint(point);
  const node = nodeAt(p.x, p.y);
  if (node === 'neutral') return neutral;
  const ramp = placementRamp(p.x, p.y);
  const anchor = labOf(BASE.emotion[QUADRANT[node]][NODE_TIER[face]]);
  const chroma = ramp * d.bead.chromaScale;
  return { L: neutral.L + (anchor.L - neutral.L) * ramp, a: anchor.a * chroma, b: anchor.b * chroma };
}

/** The highlight's centre colour: the fill mixed toward white by bead.highlight.mix. */
export function beadHighlight(id: DirectionId, fill: Oklab): Oklab {
  return mixOklab(fill, WHITE, DIRECTIONS[id].bead.highlight.mix);
}

const byte = (v: number) => {
  const s = Math.round(v).toString(16).toUpperCase();
  return s.length < 2 ? '0' + s : s;
};

/** `#RRGGBB` of the 8-bit sRGB pixel an OKLab colour paints: clamped to the gamut, rounded (fieldLaw encodeSrgb8). */
export function srgbHex(lab: Oklab): string {
  const [r, g, b] = encodeSrgb8(lab);
  return '#' + byte(r) + byte(g) + byte(b);
}

/** `#RRGGBBAA`: a token's `#RRGGBB` with its alpha as a byte. Anything else is a RangeError. */
export function alphaHex(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new RangeError(`"${hex}" is not #RRGGBB`);
  if (!(alpha >= 0 && alpha <= 1)) throw new RangeError(`alpha must be in [0, 1], got ${alpha}`);
  return hex.toUpperCase() + byte(alpha * 255);
}

/** A `#RRGGBB` read back to OKLab (the colour a painted pixel is). */
export function hexLab(hex: string): Oklab {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new RangeError(`"${hex}" is not #RRGGBB`);
  const channel = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return srgbToOklab([channel(1), channel(3), channel(5)]);
}

/** What the bead's views paint, as colour strings. */
export interface BeadPaint {
  readonly fill: string;
  readonly highlight: string;
  /** The setting ring (bead.setting). */
  readonly setting: string;
  /** The shadow, the token at its own alpha (bead.shadow). */
  readonly shadow: string;
}

export function beadPaint(id: DirectionId, face: Face, point: PlatePoint): BeadPaint {
  const c = DIRECTIONS[id].color[face].bead;
  const fill = beadFill(id, face, point);
  return { fill: srgbHex(fill), highlight: srgbHex(beadHighlight(id, fill)), setting: c.setting.hex, shadow: alphaHex(c.shadow.hex, c.shadow.alpha) };
}

/** A direction's motion.placement: where the scale starts, how far it may overshoot, and the easing token it names. */
export interface PlacementMotion {
  readonly scaleFrom: number;
  readonly overshoot: number;
  readonly easing: string;
}

/** The entrance as the views play it. */
export interface BeadMotion {
  readonly duration: number;
  /** The cubic-bezier, or null for linear (the still tier). */
  readonly easing: readonly number[] | null;
  readonly scaleFrom: number;
  /** The easing curve's highest value (1 for a curve that does not overshoot). */
  readonly peak: number;
  /** The scale at the curve's peak, before × (1 − s): motion.placement.overshoot where the curve overshoots, else 1. */
  readonly overshootScale: number;
  readonly linear: boolean;
}

type Curve = (x: number) => number;
const curveOf = (easing: readonly number[]): Curve => Easing.bezier(easing[0], easing[1], easing[2], easing[3]);

/** The highest value a cubic-bezier easing reaches over [0, 1], sampled at 1/1000. */
function peakOf(curve: Curve): number {
  let peak = 1;
  for (let i = 0; i <= 1000; i++) peak = Math.max(peak, curve(i / 1000));
  return peak;
}

function easingToken(name: string): { readonly duration: number; readonly easing: readonly number[] } {
  const key = name.startsWith('motion.') ? name.slice('motion.'.length) : name;
  const token = (BASE.motion as Record<string, unknown>)[key] as { duration?: number; easing?: readonly number[] } | undefined;
  if (token === undefined || typeof token.duration !== 'number' || !Array.isArray(token.easing)) {
    throw new RangeError(`motion.placement.easing names no easing token: ${name}`);
  }
  return { duration: token.duration, easing: token.easing };
}

export function beadMotion(id: DirectionId, tier: MotionTier, placement: PlacementMotion = DIRECTIONS[id].motion.placement): BeadMotion {
  if (tier === 'still') {
    return { duration: BASE.motion.fadeReduced.duration, easing: null, scaleFrom: 1, peak: 1, overshootScale: 1, linear: true };
  }
  const token = easingToken(placement.easing);
  const peak = peakOf(curveOf(token.easing));
  return { duration: token.duration, easing: token.easing, scaleFrom: placement.scaleFrom, peak, overshootScale: peak > 1 ? placement.overshoot : 1, linear: false };
}

/** What the bead looks like at a moment. */
export interface BeadLook {
  readonly opacity: number;
  readonly scale: number;
}

/**
 * The look for an eased value e of the entrance: opacity min(1, e); scale scaleFrom + (1 − scaleFrom)·min(1, e),
 * plus, past e = 1, the overshoot scaled to the curve's peak and × (1 − s).
 */
export function lookAt(m: BeadMotion, e: number, stress = 0): BeadLook {
  const s = clamp01(Number.isFinite(stress) ? stress : 0);
  const over = m.peak > 1 ? (Math.max(0, e - 1) / (m.peak - 1)) * (m.overshootScale - 1) * (1 - s) : 0;
  return { opacity: clamp01(e), scale: m.scaleFrom + (1 - m.scaleFrom) * Math.min(1, Math.max(0, e)) + over };
}

/** The entrance `elapsedMs` after the bead was placed. */
export function beadEntrance(id: DirectionId, tier: MotionTier, elapsedMs: number, stress = 0, placement?: PlacementMotion): BeadLook {
  const m = beadMotion(id, tier, placement);
  const x = clamp01(m.duration > 0 ? elapsedMs / m.duration : 1);
  const e = m.easing === null ? x : x >= 1 ? 1 : curveOf(m.easing)(x);
  return lookAt(m, e, stress);
}

/** The exit `elapsedMs` after it began from `from`: linear to 0 over the entrance's duration, the scale held. */
export function beadExit(id: DirectionId, tier: MotionTier, from: BeadLook, elapsedMs: number): BeadLook {
  const m = beadMotion(id, tier);
  const x = clamp01(m.duration > 0 ? elapsedMs / m.duration : 1);
  return { opacity: from.opacity * (1 - x), scale: from.scale };
}
