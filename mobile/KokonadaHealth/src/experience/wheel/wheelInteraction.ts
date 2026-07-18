import { circumplexToScreen, type WheelLayout } from './wheelGeometry';
import type { Point } from '../../state/hot/laneCommit';
import type { Tap } from '../../state/cold/emotionSlice';

// §5 "tap a placed dot to remove". Fork 1b (orchestrator-locked): the interactive target is the
// MOST-RECENT dot only — tapping it undoes it (remove-most-recent), which keeps the cold reducer
// set sealed (undoTap only, no removeTapAt). A generous ≥44dp remove-radius makes the small
// painted dot a finger-friendly target; a tap outside it falls through to the normal add path.
// Pure + finite-guarded: a non-finite pointer fails closed (never a phantom remove).

export const REMOVE_HIT_RADIUS = 44; // a11y minimum touch target (dp), the dot is painted smaller

export function hitsMostRecentDot(
  point: Point,
  taps: readonly Tap[] | null | undefined,
  layout: WheelLayout,
  removeRadiusPx: number = REMOVE_HIT_RADIUS,
): boolean {
  if (!taps || taps.length === 0) return false;
  const at = circumplexToScreen(taps[taps.length - 1], layout);
  const d = Math.hypot(point.x - at.x, point.y - at.y);
  return Number.isFinite(d) && d <= removeRadiusPx;
}
