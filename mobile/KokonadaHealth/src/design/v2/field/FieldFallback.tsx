// FieldFallback, the minimal stand-in (T12). FieldView switches to it when the field cannot be drawn: an
// effect that did not compile, or a builder throw on the UI thread (architect T5 r1 §5). It fills the view
// with the direction's ground, so nothing on the screen can read worse than the bare ground.
//
// T13 replaces this body with the real FieldFallback (designer r3 §2, architect law round 2 (c)): the
// gradients from the fallback stops in the statics, the hard clip snapped to whole pixels that excludes
// every grown quiet zone by presence, and §2.5's Skia shadows. The props are already T13's inputs.

import React from 'react';
import { View } from 'react-native';
import { DIRECTIONS, type DirectionId, type Face } from '../tokens/tokens.generated.ts';
import type { FieldStatics } from './fieldFrame.ts';

export interface FieldFallbackProps {
  readonly direction: DirectionId;
  readonly face: Face;
  readonly statics: FieldStatics;
  /** The view in dp. */
  readonly width: number;
  readonly height: number;
  /** Why the field is not drawn (for the lab's manifest; never reported anywhere, REG-066). */
  readonly reason: string;
}

export function FieldFallback({ direction, face, width, height }: FieldFallbackProps) {
  return <View style={{ width, height, backgroundColor: DIRECTIONS[direction].color[face].ground.hex }} />;
}
