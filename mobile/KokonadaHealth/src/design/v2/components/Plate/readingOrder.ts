// The plate's TalkBack order (ruling 9; the designer's ruling 1): the plate node (PlateEntry), the rim words top, bottom,
// right, left (RIM_READING_ORDER), then the latest bead (PlateTouch), and only then what follows the plate.
//
// Android never reads a view's children in mount order. ViewGroup.addChildrenForAccessibility sorts each parent's
// children by where they are (ViewLocationHolder, the stripe strategy): one wholly above another comes first, then the
// smaller left (an LTR parent) or the larger right (an RTL one), then the smaller top, then the taller, then the wider.
// React Native 0.86's ReactViewGroup defers to it (its experimental_accessibilityOrder is a no-op while the
// enableAccessibilityOrder feature flag is off, as it is in this build). So at d5479dc TalkBack read the latest bead
// first: the touch surface starts above the plate.
//
// So the order is made structural. Each node sits in a slot of its own, a view that is never flattened (collapsable
// false), takes no touch and is no accessibility element: Android sorts the slots, then reads each slot's node in place.
// The slots of one parent share their left and their right (the touch surface's), so neither direction decides, and
// they all reach the surface's bottom, so none is wholly above another: their tops alone order them, one READING_STEP
// apart in reading order. The slots hold their nodes where they always were; only the slots' edges are new.
//
//   · The plate's children: the entry slot, then the words' slot, then the touch surface (the latest bead's slot, the
//     lowest top: the surface itself, which is where it always was).
//   · Inside the words' slot, a slot per word, in RIM_READING_ORDER.
//   · The Plate's root is never flattened either, so the plate's nodes are sorted among themselves and the plate, as one
//     box, is sorted among the page's views: the step line above it, the Well under it.

import { touchSurface } from '../PlateTouch/plateTouchModel.ts';
import { RIM_READING_ORDER, type RimPosition } from '../RimLabels/arc.ts';
import type { PlateGeometry, PlateTokens } from './geometry.ts';

/** The rise between two slots in reading order, in dp: at least 2 px at any density, so rounding never ties them. */
export const READING_STEP = 2;

/** The plate's slots, in the order TalkBack reads them. */
export const PLATE_READING_ORDER = ['entry', 'words', 'latest'] as const;
export type PlateSlot = (typeof PLATE_READING_ORDER)[number];

/** A slot's box: left, top, width and height in dp, in its parent's coordinates. */
export interface SlotBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A slot among the plate's children, in plate-local dp: the touch surface's left, width and bottom, its top one
 * READING_STEP higher for each slot read after it. 'latest' is the touch surface itself.
 */
export function plateSlot(tokens: PlateTokens, plate: PlateGeometry, slot: PlateSlot): SlotBox {
  const { margin, size } = touchSurface(tokens, plate);
  const rise = (PLATE_READING_ORDER.length - 1 - PLATE_READING_ORDER.indexOf(slot)) * READING_STEP;
  return { left: -margin, top: -margin - rise, width: size, height: size + rise };
}

/**
 * A rim word's slot inside the words' slot, in that slot's own dp: its full width and its bottom, the top one
 * READING_STEP lower for each word read before it (RIM_READING_ORDER).
 */
export function rimWordSlot(tokens: PlateTokens, plate: PlateGeometry, position: RimPosition): SlotBox {
  const words = plateSlot(tokens, plate, 'words');
  const drop = RIM_READING_ORDER.indexOf(position) * READING_STEP;
  return { left: 0, top: drop, width: words.width, height: words.height - drop };
}
