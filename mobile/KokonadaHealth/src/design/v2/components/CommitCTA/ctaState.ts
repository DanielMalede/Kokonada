// DEC-174's CTA as a pure machine (F10 group A; DSN-018, DSN-019; the designer's board d3 for the neutral fill):
//
//   · Show: at an admitted start whose target holds a placement live in the store, a CTA that is not shown shows
//     on that crossfade's ramp (the field's incoming u: motion.settle, or motion.fadeReduced under reduced
//     motion), from its current opacity.
//   · Tint: the latest admitted live placement's, changed only at admitted starts, through mixSafe on that ramp;
//     with none, it holds. A quadrant tints with its anchor at the face's tier (core dark, deep light) and the
//     onTint label; a neutral placement with the neutral fill, text.primary, and the onInk label. Settled, the
//     fill is the token's own hex.
//   · Hide: when the store's last tap goes, at once, from the current opacity, over motion.respond (fadeReduced
//     under reduced motion). The hide latches: nothing raises the opacity until the next admitted start.
//   · Press: pressable and exposed only while the store holds a tap and the CTA is shown (from the start of its
//     show ramp) and not hiding. A press commits the store's taps, never the ledger's (the page's onCommit).
//
// Shows and tint changes begin only at admitted starts, at least motion.settle apart, so the CTA makes at most 5
// changes and 2 flashes in any second (E6, ctaStorms.test.ts). The machine knows the store only by its tap count
// and the field only by its admitted starts, each with the target's store-live placements (admittedLive, which
// FieldView can call at a start). PlacementTint is branded: only this module mints one, so the commit button is
// the only tinted control and takes its tint from here alone (R3).

import { mixSafe } from '../../color/mixSafe.ts';
import type { Oklab } from '../../color/oklab.ts';
import type { RedBand } from '../../color/redBand.ts';
import { progress, rampProgress } from '../../field/crossfade.ts';
import { NODE_TIER, QUADRANT, nodeAt, type PlacementNode } from '../../field/fieldFrame.ts';
import type { Ledger } from '../../field/placementLedger.ts';
import { BASE, DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { readPoint, srgbHex } from '../Bead/beadModel.ts';

export type CtaMode = 'settle' | 'reduced';

/** The direction and face the CTA paints in. */
export interface CtaPaint {
  readonly id: DirectionId;
  readonly face: Face;
}

/** A placement in an admitted start's target that is live in the store: its ledger id and its point. */
export interface CtaPlacement {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

export type CtaEvent =
  /** The store changed: how many taps it holds now. */
  | { readonly kind: 'store'; readonly taps: number }
  /** The field admitted a crossfade: its target's placements that are live in the store, in any order. */
  | { readonly kind: 'start'; readonly live: readonly CtaPlacement[] };

/** Every tint the CTA can take: the four quadrants and the neutral fill. */
export const CTA_NODES: readonly PlacementNode[] = ['J', 'C', 'R', 'I', 'neutral'];

/** The design band (DEC-081): mixSafe routes a tint change around it (route R2). */
const DESIGN_BAND: RedBand = { hueFrom: BASE.neverRed.design.hueStart, hueTo: BASE.neverRed.design.hueEnd, chromaFloor: BASE.neverRed.design.chromaFloor };

export interface CtaColours {
  readonly fill: Oklab;
  /** The token's own `#RRGGBB`. */
  readonly fillHex: string;
  /** The label's ink on that fill. */
  readonly label: string;
}

/** DSN-018: a node's CTA fill and label on a face. */
export function ctaColours(paint: CtaPaint, node: PlacementNode): CtaColours {
  const c = DIRECTIONS[paint.id].color[paint.face];
  const token = node === 'neutral' ? c.text.primary : BASE.emotion[QUADRANT[node]][NODE_TIER[paint.face]];
  return { fill: { L: token.oklab[0], a: token.oklab[1], b: token.oklab[2] }, fillHex: token.hex, label: node === 'neutral' ? c.text.onInk.hex : c.text.onTint.hex };
}

declare const PLACEMENT_TINT: unique symbol;

/** The CTA's tint at a moment. Branded: only ctaState mints one (R3). */
export interface PlacementTint {
  readonly [PLACEMENT_TINT]: true;
  readonly fill: string;
  readonly label: string;
  /** The node it is (or is turning to). */
  readonly node: PlacementNode;
  /** The id of the admitted live placement it belongs to. */
  readonly owner: number;
}

const mint = (fill: string, label: string, node: PlacementNode, owner: number) => ({ fill, label, node, owner }) as PlacementTint;

interface OpacityRamp {
  readonly kind: 'show' | 'hide';
  readonly from: number;
  readonly at: number;
  readonly mode: CtaMode;
}

interface TintRamp {
  readonly node: PlacementNode;
  readonly owner: number;
  /** The colour it turns from, or null when it was taken at once. */
  readonly from: Oklab | null;
  readonly at: number;
  readonly mode: CtaMode;
  readonly paint: CtaPaint;
}

export interface CtaMachine {
  /** The store's tap count, as last heard. */
  readonly taps: number;
  /** The latest opacity ramp; null before the first show. */
  readonly opacity: OpacityRamp | null;
  /** The tint and its latest change; null before the first show. */
  readonly tint: TintRamp | null;
  /** Admitted starts heard. */
  readonly starts: number;
}

export type CtaPhase = 'hidden' | 'showing' | 'shown' | 'hiding';

export interface CtaView {
  readonly opacity: number;
  readonly tint: PlacementTint | null;
  readonly pressable: boolean;
  readonly accessible: boolean;
  readonly phase: CtaPhase;
  /** A ramp is moving a value: the view needs frames until it ends. */
  readonly animating: boolean;
}

function opacityAt(m: CtaMachine, t: number): number {
  const r = m.opacity;
  if (r === null) return 0;
  if (r.kind === 'show') {
    const u = progress(r.mode, t - r.at);
    return u >= 1 ? 1 : r.from + (1 - r.from) * u;
  }
  const respond = BASE.motion.respond;
  const v = r.mode === 'reduced' ? rampProgress(t - r.at, BASE.motion.fadeReduced.duration, null) : rampProgress(t - r.at, respond.duration, respond.easing);
  return v >= 1 ? 0 : r.from * (1 - v);
}

/** The tint's colour at t in `paint`: a change in another face, or none in flight, is the target's token. */
function tintAt(s: TintRamp, t: number, paint: CtaPaint): { readonly lab: Oklab; readonly hex: string; readonly moving: boolean } {
  const to = ctaColours(paint, s.node);
  const samePaint = s.paint.id === paint.id && s.paint.face === paint.face;
  if (s.from === null || !samePaint) return { lab: to.fill, hex: to.fillHex, moving: false };
  const u = progress(s.mode, t - s.at);
  if (u >= 1) return { lab: to.fill, hex: to.fillHex, moving: false };
  const lab = mixSafe(s.from, to.fill, u, DESIGN_BAND);
  return { lab, hex: srgbHex(lab), moving: true };
}

const latestOf = (live: readonly CtaPlacement[]) => live.reduce((a, b) => (b.id > a.id ? b : a));
const nodeOf = (p: CtaPlacement): PlacementNode => {
  const read = readPoint(p);
  return nodeAt(read.x, read.y);
};

/**
 * The machine at a mount. The field shows a fresh mount's taps at once (the ledger's reset, with no start), so a
 * store that holds taps the field shows starts the CTA shown and settled, tinted by the latest of them.
 */
export function ctaInitial(paint: CtaPaint, live: readonly CtaPlacement[], taps: number, nowMs: number): CtaMachine {
  if (taps <= 0 || live.length === 0) return { taps: Math.max(0, taps), opacity: null, tint: null, starts: 0 };
  const latest = latestOf(live);
  return {
    taps,
    opacity: { kind: 'show', from: 1, at: nowMs, mode: 'settle' },
    tint: { node: nodeOf(latest), owner: latest.id, from: null, at: nowMs, mode: 'settle', paint },
    starts: 0,
  };
}

export function ctaReduce(m: CtaMachine, event: CtaEvent, nowMs: number, mode: CtaMode, paint: CtaPaint): CtaMachine {
  if (event.kind === 'store') {
    const taps = Math.max(0, event.taps);
    // Hide: the store's last tap removed while shown; at once, from where it is. It latches: only a start shows again.
    if (taps === 0 && m.opacity !== null && m.opacity.kind === 'show') {
      return { ...m, taps, opacity: { kind: 'hide', from: opacityAt(m, nowMs), at: nowMs, mode } };
    }
    return { ...m, taps };
  }
  const starts = m.starts + 1;
  if (event.live.length === 0 || m.taps <= 0) return { ...m, starts };
  const latest = latestOf(event.live);
  const node = nodeOf(latest);
  const visible = opacityAt(m, nowMs);
  const shown = m.opacity !== null && m.opacity.kind === 'show';
  const opacity = shown ? m.opacity : { kind: 'show' as const, from: visible, at: nowMs, mode };
  let tint: TintRamp;
  if (m.tint === null || visible === 0 || m.tint.paint.id !== paint.id || m.tint.paint.face !== paint.face) {
    tint = { node, owner: latest.id, from: null, at: nowMs, mode, paint };
  } else if (m.tint.node === node) {
    tint = { ...m.tint, owner: latest.id };
  } else {
    tint = { node, owner: latest.id, from: tintAt(m.tint, nowMs, paint).lab, at: nowMs, mode, paint };
  }
  return { taps: m.taps, opacity, tint, starts };
}

/** What the CTA shows at `nowMs`, painted in `paint`. */
export function ctaState(m: CtaMachine, nowMs: number, paint: CtaPaint): CtaView {
  const opacity = opacityAt(m, nowMs);
  const phase: CtaPhase = m.opacity === null ? 'hidden' : m.opacity.kind === 'show' ? (opacity >= 1 ? 'shown' : 'showing') : opacity <= 0 ? 'hidden' : 'hiding';
  const exposed = m.taps > 0 && (phase === 'showing' || phase === 'shown');
  const moving = m.tint === null ? null : tintAt(m.tint, nowMs, paint);
  const tint = m.tint === null || moving === null ? null : mint(moving.hex, ctaColours(paint, m.tint.node).label, m.tint.node, m.tint.owner);
  return { opacity, tint, pressable: exposed, accessible: exposed, phase, animating: phase === 'showing' || phase === 'hiding' || (moving !== null && moving.moving) };
}

/**
 * An admitted start's target, read from the ledger: the placements it shows (not leaving) that are live in the
 * store, oldest first. What the CTA hears at a start (DEC-174; FieldView's onStart can carry it).
 */
export function admittedLive(ledger: Ledger): CtaPlacement[] {
  'worklet';
  const live: CtaPlacement[] = [];
  for (const s of ledger.shown) {
    if (s.phase === 'out') continue;
    let inStore = false;
    for (const p of ledger.store) if (p.id === s.id) inStore = true;
    if (inStore) live.push({ id: s.id, x: s.x, y: s.y });
  }
  live.sort((a, b) => a.id - b.id);
  return live;
}
