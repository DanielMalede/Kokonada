// The plate's geometry (DSN-025, DSN-026; V1 directions §1.5; the designer's D6-1): one coordinate space for the hero's
// instrument. The field paints the ring, the face and each bead's halo; the plate's own layers (the rim keyline, the rim
// words, the beads and the touch layer) are drawn over it in the plate's box, in dp. So every circle and every point
// here is the field's (fieldFrame.ts), and geometry.test.ts holds them to its builder.
//
// Pure, with the tokens passed in: a component reads them once through useTokens (F10 R1), and the tests run the very
// same numbers. Each function is a worklet, so the touch layer may call it on the UI thread. The input mapping, from a
// touch to a point, is never here: the touch layer goes through wheelGeometry's screenToCircumplex with wheelLayout's
// layout (DSN-025: never mirrored or reimplemented).

import type { Tap } from '../../field/placementLedger.ts';
import type { Tokens } from '../../tokens/useTokens.ts';

/**
 * A point on the plate: on the unit disc, x to the right (pleasant), y up (more energy), the disc drawn at the layout
 * radius (R less the bead radius, DSN-025). It is the cold lane's tap and the field's Tap, by type, so a bead, a touch
 * and the field can never mean different points.
 */
export type PlatePoint = Tap;

/** The tokens the plate's geometry reads: useTokens()'s base and direction. */
export type PlateTokens = Pick<Tokens, 'base' | 'direction'>;

export interface PlateGeometry {
  /** The plate's diameter and its radius R, in dp. R is the rim's centre line, the field's d = 1. */
  readonly diameter: number;
  readonly radius: number;
  /** The plate's centre in its own box, in dp, x right and y down: [R, R]. */
  readonly centre: readonly [number, number];
  /** The label band (the ring), in dp: max(labelBand.min, labelBand.min × fontScale), as the field lays it. */
  readonly band: number;
  /** The ring's inner edge, where the face ends, in dp from the centre: R − band. */
  readonly ringInner: number;
  /** The ring's centre line, where the rim words sit, in dp from the centre: R − band / 2. */
  readonly ringMid: number;
  /** The bead's radius, in dp. */
  readonly beadRadius: number;
  /** The radius a PlatePoint's unit disc is drawn at, in dp: R − the bead radius (DSN-025). */
  readonly layoutRadius: number;
  /** The rim keyline's width, in dp, centred on R (D6-1). */
  readonly rimWidth: number;
}

/** The layout wheelGeometry's screenToCircumplex takes (its WheelLayout), in the plate's own dp. */
export interface PlateWheelLayout {
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

/**
 * The geometry of a plate `diameter` dp across at the OS `fontScale` (the one the page gives the field). A font scale that
 * is not a number reads as 1, as the field reads it. A diameter that is not a finite size, or a band that leaves no face
 * inside the plate, is a RangeError: a plate drawn at a guess would part from the field's.
 */
export function plateGeometry(t: PlateTokens, diameter: number, fontScale: number): PlateGeometry {
  'worklet';
  if (!(Number.isFinite(diameter) && diameter > 0)) {
    throw new RangeError(`a plate needs a finite diameter above 0 dp, got ${diameter}`);
  }
  const radius = diameter / 2;
  const min = t.base.plate.labelBand.min;
  const band = Math.max(min, min * (Number.isFinite(fontScale) ? fontScale : 1));
  if (!(band < radius)) {
    throw new RangeError(`the label band (${band} dp) leaves no face inside the plate's radius (${radius} dp)`);
  }
  const beadRadius = t.direction.bead.diameter / 2;
  return {
    diameter,
    radius,
    centre: [radius, radius],
    band,
    ringInner: radius - band,
    ringMid: radius - band / 2,
    beadRadius,
    layoutRadius: radius - beadRadius,
    rimWidth: t.base.plate.rim.width,
  };
}

/**
 * Where a point sits in the plate's box, in dp, x right and y down: the bead's centre, the field's halo's centre. As the
 * field reads it, a coordinate that is not a number is 0, and a point outside the unit disc moves onto its rim.
 */
export function pointToLocal(point: PlatePoint, g: PlateGeometry): { readonly x: number; readonly y: number } {
  'worklet';
  let x = Number.isFinite(point.x) ? point.x : 0;
  let y = Number.isFinite(point.y) ? point.y : 0;
  const r = Math.hypot(x, y);
  if (r > 1) {
    x /= r;
    y /= r;
  }
  return { x: g.centre[0] + x * g.layoutRadius, y: g.centre[1] - y * g.layoutRadius };
}

/** The layout the touch layer hands to screenToCircumplex: the plate's centre, at the layout radius (DSN-025). */
export function wheelLayout(g: PlateGeometry): PlateWheelLayout {
  'worklet';
  return { cx: g.centre[0], cy: g.centre[1], radius: g.layoutRadius };
}
