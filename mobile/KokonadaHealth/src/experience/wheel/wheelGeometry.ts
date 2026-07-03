import { clampToDisc, type Point } from '../../state/hot/laneCommit';

// Pure geometry for the Skia radial wheel. The gesture worklet computes a finger
// position on the canvas and calls screenToCircumplex to get the emotion payload;
// committed dots are drawn back with circumplexToScreen. Screen Y grows downward,
// arousal grows upward — the mapping flips Y. All outputs are finite and clamped
// to the unit disc no matter how frantic or out-of-bounds the raw pointer is.

export interface WheelLayout {
  cx: number;
  cy: number;
  radius: number;
}

// Touch is treated as "on the wheel" up to this fraction beyond the rim, so a
// fingertip landing a few px outside still registers (fat-finger slop).
const HIT_SLOP = 0.12;

function finite(n: number): number {
  return Number.isFinite(n) ? n : NaN;
}

export function screenToCircumplex(point: Point, layout: WheelLayout): { x: number; y: number } {
  const px = finite(point.x);
  const py = finite(point.y);
  const r = layout.radius;
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(r) || r <= 0) {
    return { x: 0, y: 0 };
  }
  const x = (px - layout.cx) / r;
  const y = -(py - layout.cy) / r; // flip: screen-down → arousal-up
  const c = clampToDisc({ x, y });
  // Normalize signed zero (the flip yields -0 at center) so the payload is clean.
  return { x: c.x + 0, y: c.y + 0 };
}

export function circumplexToScreen(tap: Point, layout: WheelLayout): { x: number; y: number } {
  const t = clampToDisc({ x: finite(tap.x), y: finite(tap.y) });
  return {
    x: layout.cx + t.x * layout.radius,
    y: layout.cy - t.y * layout.radius, // flip back
  };
}

// Distance from center as a fraction of radius (0 = center, 1 = rim). Non-finite
// input or a zero-radius layout yields Infinity so hit tests fail closed.
export function radialFraction(point: Point, layout: WheelLayout): number {
  const px = finite(point.x);
  const py = finite(point.y);
  if (!Number.isFinite(px) || !Number.isFinite(py) || layout.radius <= 0) return Infinity;
  return Math.hypot(px - layout.cx, py - layout.cy) / layout.radius;
}

export function isOnWheel(point: Point, layout: WheelLayout): boolean {
  return radialFraction(point, layout) <= 1 + HIT_SLOP;
}
