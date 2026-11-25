// PlateTouch's pure model (F10 group A; DSN-012, DSN-025, DSN-040, QA-028): the touch surface, what a touch
// means, and the haptic it earns and when. Everything is in the plate box's dp (x right, y down), the plate's
// shared coordinate space (Plate/geometry.ts).
//
// The surface is the plate grown by the margin a rim bead's 48 dp target reaches past the plate's edge
// (bead.hitTarget / 2 − the bead radius), so the latest bead's whole target is touchable wherever the bead
// sits (QA-028: rendered bounds, never hitSlop). A touch that ends inside the surface's inscribed circle
// places at its end, so a tap and a drag to a spot both place; a touch that begins and ends on the latest
// bead's target removes it, and only the latest is removable (DSN-012). The point itself is never computed
// here: the page's screenToCircumplex maps the end, with the plate's wheelLayout (QA-087, DSN-025).

import { BASE } from '../../tokens/tokens.generated.ts';
import type { PlateTokens } from '../Plate/geometry.ts';
import { pointToLocal, type PlateGeometry, type PlatePoint } from '../Plate/geometry.ts';

/** A spot in the plate box, in dp, x right and y down. */
export interface Local {
  readonly x: number;
  readonly y: number;
}

export interface TouchSurface {
  /** How far the surface reaches past the plate box on every side, in dp. */
  readonly margin: number;
  /** The surface's side, in dp: the plate's diameter plus a margin on each side. */
  readonly size: number;
  /** The latest bead's target, square, in dp (bead.hitTarget, at least target.min). */
  readonly hit: number;
  /** How far from the plate's centre a touch still lands on the plate, in dp: R plus the margin. */
  readonly reach: number;
}

export function touchSurface(t: PlateTokens, plate: PlateGeometry): TouchSurface {
  const hit = Math.max(t.base.bead.hitTarget, t.base.target.min);
  const margin = Math.max(0, hit / 2 - plate.beadRadius);
  return { margin, size: plate.diameter + 2 * margin, hit, reach: plate.radius + margin };
}

export type TouchIntent = { readonly kind: 'place'; readonly at: Local } | { readonly kind: 'remove' } | { readonly kind: 'none' };

const finite = (p: Local) => Number.isFinite(p.x) && Number.isFinite(p.y);

function onTarget(p: Local, bead: Local, hit: number): boolean {
  return Math.abs(p.x - bead.x) <= hit / 2 && Math.abs(p.y - bead.y) <= hit / 2;
}

/** A touch from `start` to `end`: remove the latest bead, place at the end, or nothing. */
export function touchIntent(start: Local, end: Local, plate: PlateGeometry, surface: TouchSurface, latest: PlatePoint | null): TouchIntent {
  if (!finite(start) || !finite(end)) return { kind: 'none' };
  if (latest !== null) {
    const bead = pointToLocal(latest, plate);
    if (onTarget(start, bead, surface.hit) && onTarget(end, bead, surface.hit)) return { kind: 'remove' };
  }
  const r = Math.hypot(end.x - plate.centre[0], end.y - plate.centre[1]);
  return r <= surface.reach ? { kind: 'place', at: end } : { kind: 'none' };
}

/** The plate's haptic events (DSN-040; haptics.place, .replace and .remove). */
export type PlateHapticEvent = 'place' | 'replace' | 'remove';

/** The cold lane's ring (emotionSlice MAX_TAPS): a placement on a full plate replaces the oldest. */
const RING = 3;

export function hapticFor(intent: TouchIntent, taps: number): PlateHapticEvent | null {
  if (intent.kind === 'remove') return 'remove';
  if (intent.kind === 'place') return taps >= RING ? 'replace' : 'place';
  return null;
}

/** haptics.minEventGap: two haptics are at least this far apart (DSN-040). */
export const HAPTIC_GAP = BASE.haptics.minEventGap;

/** May a haptic fire at `nowMs`, the last one having fired at `lastMs`? One inside the gap is dropped, never queued. */
export function hapticAllowed(lastMs: number | null, nowMs: number): boolean {
  return lastMs === null || nowMs - lastMs >= HAPTIC_GAP;
}
