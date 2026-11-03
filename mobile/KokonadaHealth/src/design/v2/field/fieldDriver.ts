// FieldView's per-frame work (T12; architect rerule §4 item 12, T5 r1 §5; law round 2 D7), as pure
// worklets: FieldView runs one fieldStep per frame on the UI thread, and the tests run the same step.
//
// The boundary (architect sequencing §4, "one coordinate space"): the composition root measures in dp,
// in the field view's own coordinates. Every px value the builder takes (centre, R, the quiet rects) is in
// the field canvas's render px, after renderScale, converted here once. The shipped clamp of the quiet
// rects to QUIET_SLOTS lives here too (architect T5 r1 §5), never in the builder, which throws above it in
// every build so the tests run the shipped path. A non-finite presence becomes 1 here, safe for legibility,
// before the law's RangeError can fire (architect law round 2 (c), UI-152's update).
//
// One step (resilience T5 r1 Q5): reconcile the ledger, read its fades, build the frame once, pack it once.
// The placements come from the ledger alone (F13). A throw from the builder or the packing is caught and
// named: on the UI thread an uncaught throw would take the app down, so FieldView switches to
// FieldFallback instead, the rule effect.ts follows.
//
// Every function here is a worklet (workletSafe.test.ts).

import type { MotionTier } from '../motion/useMotionPolicy.ts';
import { BASE, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import type { FadeMode } from './crossfade.ts';
import { buildFieldFrame, type FieldGeometry, type FieldState, type FieldStatics } from './fieldFrame.ts';
import { QUIET_SLOTS, type QuietRect } from './fieldLaw.ts';
import { fades, needsFrames, reconcile, type Ledger, type LedgerFades, type LedgerInput } from './placementLedger.ts';
import { packFrame } from './uniforms.ts';

/** A measured bound, in dp, in the field view's own coordinates (its top left is 0, 0). */
export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The field view's layout, in dp: its size, the plate's centre and radius, the OS font scale, and the quiet zones by slot (QUIET_ZONE). */
export interface FieldLayout {
  readonly width: number;
  readonly height: number;
  readonly centre: readonly [number, number];
  readonly radius: number;
  readonly fontScale: number;
  readonly quietRects?: readonly LayoutRect[];
}

/** What a frame is drawn with, besides the ledger, the clock and the breath. */
export interface FrameParams {
  readonly direction: DirectionId;
  readonly face: Face;
  readonly stress: number;
  readonly confidence: number | null;
  readonly genesis: boolean;
  readonly tier: MotionTier;
  /** Each quiet zone's presence, by slot; omitted: 1 for each rect (the builder's default). */
  readonly quietPresence?: readonly number[];
}

/** The field canvas's renderScale for a tier: field.tiers; the still is the full tier's law drawn once (designer 2.8). */
export function renderScaleFor(tier: MotionTier): number {
  'worklet';
  return tier === 'low' ? BASE.field.tiers.low.renderScale : BASE.field.tiers.full.renderScale;
}

/** The crossfade mode: reduced motion is the still tier, and takes motion.fadeReduced (designer 2.6). */
export function modeFor(tier: MotionTier): FadeMode {
  'worklet';
  return tier === 'still' ? 'reduced' : 'settle';
}

/** The render target: the view in render px, rounded up so it covers the view, at least 1 × 1. */
export function renderSize(layout: FieldLayout, pxPerDp: number, renderScale: number): { width: number; height: number } {
  'worklet';
  const k = pxPerDp * renderScale;
  return { width: Math.max(1, Math.ceil(layout.width * k)), height: Math.max(1, Math.ceil(layout.height * k)) };
}

/** The builder's geometry, in render px, with the quiet rects clamped to the first QUIET_SLOTS. */
export function renderGeometry(layout: FieldLayout, pxPerDp: number, renderScale: number): FieldGeometry {
  'worklet';
  const k = pxPerDp * renderScale;
  const measured = layout.quietRects ?? [];
  const quietRects: QuietRect[] = [];
  for (let i = 0; i < measured.length && i < QUIET_SLOTS; i++) {
    const r = measured[i];
    quietRects.push({ cx: (r.x + r.width / 2) * k, cy: (r.y + r.height / 2) * k, hx: (r.width / 2) * k, hy: (r.height / 2) * k });
  }
  return {
    centrePx: [layout.centre[0] * k, layout.centre[1] * k],
    radiusPx: layout.radius * k,
    pxPerDp: k,
    fontScale: layout.fontScale,
    quietRects,
  };
}

/** Presence as the builder takes it: a non-finite value is 1, and the list follows the rect clamp. Omitted stays omitted. */
export function sanitisePresence(presence: readonly number[] | undefined, count: number): readonly number[] | undefined {
  'worklet';
  if (presence === undefined) return undefined;
  const out: number[] = [];
  for (let i = 0; i < presence.length && i < count; i++) out.push(Number.isFinite(presence[i]) ? presence[i] : 1);
  return out;
}

/** The frame's state, its placements and rest lobes from the ledger alone. */
export function stateFromLedger(f: LedgerFades, params: FrameParams, tMs: number, breathPhase: number): FieldState {
  'worklet';
  return {
    direction: params.direction,
    face: params.face,
    placements: f.placements.map((p) => ({ x: p.x, y: p.y, fade: p.fade, ordinal: p.ordinal, driftKey: p.driftKey, slot: p.slot, role: p.role })),
    restFade: f.restFades,
    restSlots: f.restSlots,
    stress: params.stress,
    confidence: params.confidence,
    genesis: params.genesis,
    tMs,
    breathPhase,
    tier: params.tier,
  };
}

export interface FieldStep {
  readonly ledger: Ledger;
  /** The packed frame, or null when the builder or the packing threw. */
  readonly uniforms: number[] | null;
  /** The throw, named, or null. */
  readonly error: string | null;
  /** A crossfade started on this frame. */
  readonly started: boolean;
  /** The still tier has nothing left to draw and no start to wait for (needsFrames): its frames may stop until an input changes. */
  readonly idle: boolean;
}

/** One frame: the ledger reconciled on the frame's time, its fades, one build, one pack. */
export function fieldStep(
  prev: Ledger,
  input: LedgerInput,
  nowMs: number,
  params: FrameParams,
  geometry: FieldGeometry,
  statics: FieldStatics,
  tMs: number,
  breathPhase: number,
): FieldStep {
  'worklet';
  const ledger = reconcile(prev, input, nowMs, modeFor(params.tier));
  const started = ledger.starts > prev.starts;
  const idle = params.tier === 'still' && !needsFrames(ledger);
  const count = geometry.quietRects === undefined ? 0 : geometry.quietRects.length;
  const state: FieldState = { ...stateFromLedger(fades(ledger), params, tMs, breathPhase), quietPresence: sanitisePresence(params.quietPresence, count) };
  try {
    const uniforms = packFrame(buildFieldFrame(state, geometry, statics));
    return { ledger, uniforms, error: null, started, idle };
  } catch (e) {
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    return { ledger, uniforms: null, error, started, idle };
  }
}
