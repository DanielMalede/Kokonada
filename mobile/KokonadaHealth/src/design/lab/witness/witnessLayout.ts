// Where the colour-path witness draws its patches (B8-2; the designer's 3c amendment 4), in dp, in the stage's own
// coordinates. Lab only. A pure function of the face, the measured stage and the window's insets, so a report rebuilds it
// from the manifest (the insets are the stage minus READY's region probe).
//
// The capture region (the designer's witness BLOCK, 2026-11-15): the lab window is edge to edge, so the stage runs under
// the system bars, and the capture harness crops every grab to the app region, the screen minus those bars. So the patches
// are laid out in the stage minus the insets, the region the capture keeps; with no insets it is the stage.
//
// The stage is the hero's layout (heroLayout, through the lab's one.joy scene): W1b, the production field, covers it, and
// every other patch is laid over it. Each patch is PATCH_DP square and is sampled over its central SAMPLE_DP square. The
// rules, for every patch and for W1b:
//   · at least GAP_DP from the capture region's edges, from every other patch and from every quiet rect (the hero's text and
//     controls), so no patch sits where a quiet zone dims the field;
//   · away from the ring and the halos: wholly on the plate's face, GAP_DP inside the ring's inner edge, or wholly beyond
//     the moat, GAP_DP outside it; and GAP_DP clear of every bead's halo.
// W1b is the square on the face, on an 8 dp lattice, whose sample has the highest k at its worst point (corners, edge
// midpoints and centre), where the field is (k_field > 0). The other patches take the first free places in reading order,
// kind by kind (PATCH_KINDS), colour by colour (witnessColours). A stage too small for all of them is a RangeError: a
// patch is never dropped, as a missing patch would read as a passing one.

import { lsbDelta, MODEL_SEPARATION_LSB, type Bytes } from '../../v2/color/displayP3';
import type { FieldLayout, LayoutRect } from '../../v2/field/fieldDriver';
import { pixelTerms } from '../../v2/field/fieldLaw';
import type { Face } from '../../v2/tokens/tokens.generated';
import { sceneSpec } from '../fieldScenes';
import { PATCH_KINDS, WITNESS_DIRECTION, WITNESS_HERO, WITNESS_TIER, bytesHex, patchBytes, w1bFrame, witnessColours, type PatchKind, type WitnessColourName } from './witnessFrames';

export const PATCH_DP = 24;
export const GAP_DP = 8;
export const SAMPLE_DP = 16;
/** The reading-order scan's step, and W1b's lattice, in dp. */
const SCAN_DP = 4;
const W1B_STEP_DP = 8;
/** Where W1b's sample is judged, as fractions of it: the centre, then the corners and the edge midpoints. */
const SAMPLE_POINTS: ReadonlyArray<readonly [number, number]> = [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.5], [1, 0.5], [0.5, 1]];

export type Rect = LayoutRect;
/** The window's insets over the stage, in dp: the system bars the capture leaves out. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}
export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface WitnessPatch {
  readonly kind: PatchKind;
  readonly colour: WitnessColourName;
  readonly rect: Rect;
  readonly sample: Rect;
  /** The token's bytes: what W1a, W2 and W3 must show, and what a planted patch must not. */
  readonly token: Bytes;
  /** The hex the patch paints (W2, W3, planted), or null for W1a, which the runtime effect draws. */
  readonly paint: string | null;
  /** A planted patch whose model moves the colour by more than MODEL_SEPARATION_LSB: the witness must see it fail. */
  readonly separates: boolean;
}

export interface WitnessLayout {
  readonly face: Face;
  readonly width: number;
  readonly height: number;
  /** The insets it was laid out with, and the capture region they leave: the stage minus them. */
  readonly insets: Insets;
  readonly region: Rect;
  readonly pxPerDp: number;
  /** The field's renderScale, W1b's and W1a's: the production tier's (field.tiers). */
  readonly renderScale: number;
  /** W1b's layout: the hero's, at the stage's size and font scale. */
  readonly field: FieldLayout;
  readonly w1b: { readonly rect: Rect; readonly sample: Rect };
  readonly patches: readonly WitnessPatch[];
}

/** A patch's central SAMPLE_DP square. */
export function sampleOf(r: Rect): Rect {
  return { x: r.x + (r.width - SAMPLE_DP) / 2, y: r.y + (r.height - SAMPLE_DP) / 2, width: SAMPLE_DP, height: SAMPLE_DP };
}

/** The gap between two rects: negative where they overlap. */
const gapBetween = (a: Rect, b: Rect) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
const nearest = (r: Rect, px: number, py: number) => Math.hypot(Math.max(r.x - px, 0, px - (r.x + r.width)), Math.max(r.y - py, 0, py - (r.y + r.height)));
const farthest = (r: Rect, px: number, py: number) => Math.hypot(Math.max(Math.abs(r.x - px), Math.abs(r.x + r.width - px)), Math.max(Math.abs(r.y - py), Math.abs(r.y + r.height - py)));
const square = (x: number, y: number): Rect => ({ x, y, width: PATCH_DP, height: PATCH_DP });

/** The witness layout of a face on a measured stage (dp), at the device's px per dp and font scale, inside the insets. */
export function witnessLayout(face: Face, width: number, height: number, pxPerDp: number, fontScale: number, insets: Insets = NO_INSETS): WitnessLayout {
  const edges = [insets.top, insets.right, insets.bottom, insets.left];
  const region = { x: insets.left, y: insets.top, width: width - insets.left - insets.right, height: height - insets.top - insets.bottom };
  if (!edges.every((v) => Number.isFinite(v) && v >= 0) || !(region.width > 0 && region.height > 0)) {
    throw new RangeError(`witness layout: insets ${JSON.stringify(insets)} leave no capture region on a ${width}×${height} dp stage`);
  }
  const field = sceneSpec(`field.${WITNESS_DIRECTION}.${face}.${WITNESS_HERO}.${WITNESS_TIER}`, 'field').layout(width, height, fontScale);
  const { frame, renderScale } = w1bFrame(face, field, pxPerDp);
  const R = field.radius;
  const [cx, cy] = field.centre;
  const faceDp = frame.ringInner * R - GAP_DP;
  const moatDp = frame.moatOuter * R + GAP_DP;
  const haloDp = frame.haloRadius * R + GAP_DP;
  const beads = frame.nodes.filter((n) => n.fade > 0 && n.bead !== null).map((n) => [cx + n.bead![0] * R, cy - n.bead![1] * R] as const);
  const quiet = field.quietRects ?? [];

  const inRegion = (r: Rect) =>
    r.x >= region.x + GAP_DP && r.y >= region.y + GAP_DP && r.x + r.width <= region.x + region.width - GAP_DP && r.y + r.height <= region.y + region.height - GAP_DP;
  const onFace = (r: Rect) => farthest(r, cx, cy) <= faceDp;
  const clear = (r: Rect) =>
    inRegion(r) && quiet.every((q) => gapBetween(r, q) >= GAP_DP) && (onFace(r) || nearest(r, cx, cy) >= moatDp) && beads.every(([bx, by]) => nearest(r, bx, by) >= haloDp);

  // W1b: the face's square whose sample's worst point has the highest k, where the field is.
  const k = pxPerDp * renderScale;
  let w1b: { rect: Rect; score: number } | null = null;
  for (let y = Math.ceil((cy - faceDp) / W1B_STEP_DP) * W1B_STEP_DP; y + PATCH_DP <= cy + faceDp; y += W1B_STEP_DP) {
    for (let x = Math.ceil((cx - faceDp) / W1B_STEP_DP) * W1B_STEP_DP; x + PATCH_DP <= cx + faceDp; x += W1B_STEP_DP) {
      const rect = square(x, y);
      if (!onFace(rect) || !clear(rect)) continue;
      const s = sampleOf(rect);
      // The centre first: the worst point is no better than it, so a square whose centre cannot win is skipped.
      let worst = Infinity;
      for (const [fx, fy] of SAMPLE_POINTS) {
        const t = pixelTerms(frame, (s.x + fx * s.width) * k, (s.y + fy * s.height) * k);
        worst = Math.min(worst, t.kField > 0 ? t.k : -1);
        if (worst <= 0 || (w1b !== null && worst <= w1b.score)) break;
      }
      if (worst > 0 && (w1b === null || worst > w1b.score)) w1b = { rect, score: worst };
    }
  }
  if (w1b === null) throw new RangeError(`witness layout: no place on the ${face} face for W1b on a ${width}×${height} dp stage`);

  // The patches, in reading order. Every patch has the same size and the rules only grow as patches are placed, so a
  // place refused for one patch is refused for the next: each scan resumes where the last patch went.
  const taken: Rect[] = [w1b.rect];
  const patches: WitnessPatch[] = [];
  const colours = witnessColours(face);
  const total = PATCH_KINDS.length * colours.length;
  const cols = Math.floor((width - 2 * GAP_DP - PATCH_DP) / SCAN_DP) + 1;
  const rows = Math.floor((height - 2 * GAP_DP - PATCH_DP) / SCAN_DP) + 1;
  let at = 0;
  for (const kind of PATCH_KINDS) {
    for (const colour of colours) {
      let rect: Rect | null = null;
      for (; at < rows * cols; at++) {
        const candidate = square(GAP_DP + (at % cols) * SCAN_DP, GAP_DP + Math.floor(at / cols) * SCAN_DP);
        if (clear(candidate) && taken.every((t) => gapBetween(candidate, t) >= GAP_DP)) {
          rect = candidate;
          break;
        }
      }
      if (rect === null) throw new RangeError(`witness layout: only ${patches.length} of ${total} patches fit on a ${width}×${height} dp stage`);
      taken.push(rect);
      const bytes = patchBytes(kind, colour);
      const planted = kind !== 'W1a' && kind !== 'W2' && kind !== 'W3';
      patches.push({
        kind, colour: colour.name, rect, sample: sampleOf(rect), token: colour.bytes,
        paint: kind === 'W1a' ? null : bytesHex(bytes),
        separates: planted && lsbDelta(bytes, colour.bytes) > MODEL_SEPARATION_LSB,
      });
    }
  }
  return { face, width, height, insets: { ...insets }, region, pxPerDp, renderScale, field, w1b: { rect: w1b.rect, sample: sampleOf(w1b.rect) }, patches };
}
