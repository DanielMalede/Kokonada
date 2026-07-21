import { colors, motion } from '../../design/tokens';

// Pure motion + layout math for the LIVING AURORA — the ambient field that IS the Kokonada brand.
// The field is painted by Skia and driven by a Reanimated clock on the UI thread, so this module is
// what makes it testable: every value that reaches a Skia transform is derived here, from ELAPSED
// MILLISECONDS, and is unit-attacked in auroraField.test.ts (the neuralLoaderMath precedent).
//
// Three properties are deliberate and load-bearing:
//   • FRAME-RATE INDEPENDENCE — the pose is f(elapsed ms), never f(frame count). A 30fps device and
//     a 60fps device sit at the same pose at the same instant, and a dropped frame cannot slow the
//     drift down. This is also what keeps the loop honest at 60fps: the per-frame cost is four
//     Math.sin calls, so the field can never be the reason a frame is missed.
//   • REDUCED MOTION — `null` elapsed returns the IDENTITY pose, forever. The component passes null
//     when useMotion().reduced is set, which also means the worklet never reads the clock at all, so
//     the derived value has no frame dependency and Skia stops re-rendering the field entirely.
//   • TOTALITY — a NaN/∞ clock or a degenerate (first-frame 0×0) viewport can never emit NaN. One
//     NaN in a Skia transform blanks or crashes the whole canvas (the BioAura §B.2 precedent).

export interface AuroraPose {
  translateX: number;
  translateY: number;
  rotate: number; // radians
  scale: number;
}

export type AuroraBlobKey = 'sky' | 'violet' | 'gold' | 'pink';

export interface AuroraBlobNode {
  key: AuroraBlobKey;
  color: string;
  alpha: number;
  cx: number;
  cy: number;
  r: number;
}

// The approved drift envelope (docs/mockups/aurora-interactive.html @keyframes KAf): the field
// slides ±5% of the viewport, tilts ±6° and inflates 1.00→1.10 over one `flow` cycle. Small
// numbers on purpose — the aurora should read as weather, never as an animation.
export const FLOW_TRANSLATE = 0.05;
export const FLOW_ROTATE = (6 * Math.PI) / 180;
export const FLOW_SCALE = { min: 1.0, max: 1.1 } as const;
// The emotion focal glow breathes on its own, faster cycle (aurora.focalGlow).
export const FOCAL_SCALE = { min: 1.0, max: 1.08 } as const;
// The blob field is anchored on a box inflated this far past every edge (the mockup's inset:-45%),
// so no drift, tilt or inflation can ever swing a hard blob rim into view.
export const AURORA_OVERSCAN = 0.45;

const TAU = Math.PI * 2;

// Blob anchors as fractions of the VIEWPORT, converted from the mockup's overscanned layer
// (e.g. sky sits at 30%/22% of a layer spanning −45%…145% → 0.12/−0.03 of the screen). Radii are a
// fraction of the viewport's LONGER edge so a tall phone and a wide tablet both stay covered.
const PLACEMENT: ReadonlyArray<{ key: AuroraBlobKey; fx: number; fy: number; fr: number }> = [
  { key: 'sky', fx: 0.12, fy: -0.03, fr: 0.62 },
  { key: 'violet', fx: 0.96, fy: 0.31, fr: 0.6 },
  { key: 'gold', fx: 0.5, fy: 1.07, fr: 0.68 },
  { key: 'pink', fx: 0.05, fy: 0.78, fr: 0.42 }, // the faintest stop — an accent, never a subject
];

function num(v: unknown): number {
  'worklet';
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** The ambient drift pose at `elapsedMs`. `null` (or any non-finite clock) → the STILL field. */
export function auroraFlowPose(elapsedMs: number | null, width: number, height: number): AuroraPose {
  'worklet';
  const still = { translateX: 0, translateY: 0, rotate: 0, scale: FLOW_SCALE.min };
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return still;

  const w = num(width);
  const h = num(height);
  const p = TAU * (elapsedMs / motion.duration.flow);
  const mid = (FLOW_SCALE.min + FLOW_SCALE.max) / 2;
  const amp = (FLOW_SCALE.max - FLOW_SCALE.min) / 2;
  // Four sinusoids on ONE phase, offset so the field orbits instead of sliding back and forth.
  // Every component shares the period, so the cycle closes seamlessly at `flow`.
  return {
    translateX: FLOW_TRANSLATE * w * Math.sin(p),
    translateY: FLOW_TRANSLATE * h * Math.sin(p + TAU / 3),
    rotate: FLOW_ROTATE * Math.sin(p + TAU / 6),
    scale: mid + amp * Math.sin(p - Math.PI / 2), // starts at rest (1.00), peaks mid-cycle
  };
}

/** The emotion focal glow's breath scale at `elapsedMs`. `null`/non-finite → at rest (1.00). */
export function focalGlowScale(elapsedMs: number | null): number {
  'worklet';
  if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return FOCAL_SCALE.min;
  const mid = (FOCAL_SCALE.min + FOCAL_SCALE.max) / 2;
  const amp = (FOCAL_SCALE.max - FOCAL_SCALE.min) / 2;
  return mid + amp * Math.sin(TAU * (elapsedMs / motion.duration.focalGlow) - Math.PI / 2);
}

/** The four token blobs placed over the overscanned field box, in canvas coordinates. */
export function auroraBlobLayout(width: number, height: number): AuroraBlobNode[] {
  const w = num(width);
  const h = num(height);
  // A degenerate (0×0 / NaN) first-frame layout must still yield a positive radius — a zero-radius
  // Skia circle is a silent blank frame, and a NaN one is a dead canvas.
  const ref = Math.max(Math.abs(w), Math.abs(h), 1);
  const blobs = colors.dark.aurora.blobs; // the aurora hues are shared by BOTH faces (one object)
  return PLACEMENT.map(({ key, fx, fy, fr }) => ({
    key,
    color: blobs[key].color,
    alpha: blobs[key].alpha,
    cx: w * fx,
    cy: h * fy,
    r: ref * fr,
  }));
}
