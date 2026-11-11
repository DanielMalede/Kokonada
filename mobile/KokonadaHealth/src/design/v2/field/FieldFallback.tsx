// FieldFallback (T13; the designer's rulings Q1–Q5 of 2026-11-11, amending r3 §2's DEC "fallback field clip" and
// addendum §2.5's field.fallback). FieldView switches to it when the field cannot be drawn: an effect that did not
// compile, or a builder throw on the UI thread (architect T5 r1 §5). It draws, in one sRGB canvas that is not opaque
// (the contract FieldSurface keeps, fork 2), the ground, the face material, one radial gradient for the newest placement
// that carries a lobe (or the rest state) clipped hard to the field's one region less every grown quiet zone, and the
// opaque ring (fallbackModel.ts: what; fallbackDraw.ts: how). No React Native View paints a colour (UI-204).
//
// It redraws at once on a change of its props, and never crossfades (Q5): a crossfade of two opaque gradients would be
// an alpha mix. Nothing here is reported anywhere (REG-066); `reason` is for the lab's manifest.

import React, { useMemo } from 'react';
import { Canvas, ClipOp, Picture, Skia, TileMode } from '@shopify/react-native-skia';
import type { DirectionId, Face } from '../tokens/tokens.generated.ts';
import { recordFieldFallback, type FallbackSkia } from './fallbackDraw.ts';
import { fallbackPlan } from './fallbackModel.ts';
import type { FieldLayout } from './fieldDriver.ts';
import type { FieldStatics } from './fieldFrame.ts';
import type { Tap } from './placementLedger.ts';

export interface FieldFallbackProps {
  readonly direction: DirectionId;
  readonly face: Face;
  readonly statics: FieldStatics;
  /** The cold lane's taps, oldest first: the fallback draws the newest that carries a lobe (Q5). */
  readonly taps: readonly Tap[];
  /** The view's layout in dp, as the root measured it: every quiet rect is removed, with no clamp (Q2). */
  readonly layout: FieldLayout;
  /** Device px per dp: the clip's pixels are the device's. */
  readonly pxPerDp: number;
  /** Each quiet zone's presence, by slot, as given: a zone escapes removal only at exactly 0 (Q2). */
  readonly quietPresence?: readonly number[];
  /** Why the field is not drawn (for the lab's manifest; never reported anywhere, REG-066). */
  readonly reason: string;
}

const SKIA: FallbackSkia = { Skia, ClipOp, TileMode };

export function FieldFallback({ direction, face, statics, taps, layout, pxPerDp, quietPresence }: FieldFallbackProps) {
  const picture = useMemo(
    () => recordFieldFallback(SKIA, fallbackPlan({ direction, face, statics, taps, layout, pxPerDp, quietPresence }), layout.width, layout.height),
    [direction, face, statics, taps, layout, pxPerDp, quietPresence],
  );
  return (
    <Canvas style={{ width: layout.width, height: layout.height }} colorSpace="srgb">
      <Picture picture={picture} />
    </Canvas>
  );
}
