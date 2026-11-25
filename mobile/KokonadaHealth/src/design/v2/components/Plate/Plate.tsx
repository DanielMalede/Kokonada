// The Plate (F10 group A, G8-2a; DSN-025, DSN-026): the hero's instrument root. The field (FieldView) paints the moat, the
// ring, the face and the halos; the Plate is the box over them, `diameter` dp square, that draws the rim keyline
// (rim.ts) and holds the plate's own layers as its children, in plate-local dp: RimLabels, the beads, the touch layer.
//
//   · The page owns the size: it computes the diameter by its plate law and gives the field the same centre, radius and
//     font scale (FieldLayout), so the keyline lands on the field's d = 1 and the band the rim words lie in is the
//     field's ring (geometry.test.ts holds the two to each other).
//   · Left to right in every locale (F10 R7, QA-088): the root is `direction: 'ltr'`, so every layer placed by its
//     sides inside it lands where it lands on a left-to-right phone, and the plate is never mirrored.
//   · The keyline's canvas reaches `pad` beyond the box on every side, so its outer half is never cut; it is inert to
//     touch and hidden from accessibility (a frame, not content). The root is no accessibility element itself: TalkBack
//     reaches its layers one by one, in the plate's reading order (readingOrder.ts: the plate node, the rim words, the
//     latest bead). The root is never flattened (collapsable false), so Android sorts the plate's nodes among themselves
//     and the plate, as one box, among the page's views.
//   · Static in every tier: nothing here moves, so reduced motion is the plate as drawn, with no frame work. No colour
//     but the face's rim tokens (R3, R4), no elevation (R9). Each picture is freed once it is replaced, and on unmount
//     (RA-31), as FieldFallback frees its own.

import React, { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Canvas, PaintStyle, Picture, Skia, TileMode } from '@shopify/react-native-skia';
import { useTokens } from '../../tokens/useTokens.ts';
import { plateGeometry } from './geometry.ts';
import { recordPlateRim, rimPlan, type RimSkia } from './rim.ts';

export interface PlateProps {
  /** The plate's diameter in dp, from the page's plate law: the same R the page gives the field. */
  readonly diameter: number;
  /** The OS font scale, as the page measured it and gave it to the field (FieldLayout.fontScale). */
  readonly fontScale: number;
  /** The plate's layers, in plate-local dp, drawn over the rim in this order: RimLabels, the beads, the touch layer. */
  readonly children?: ReactNode;
}

const SKIA: RimSkia = { Skia, PaintStyle, TileMode };

export function Plate({ diameter, fontScale, children }: PlateProps) {
  const tokens = useTokens();
  const plan = useMemo(() => rimPlan(tokens, plateGeometry(tokens, diameter, fontScale)), [tokens, diameter, fontScale]);
  const picture = useMemo(() => recordPlateRim(SKIA, plan), [plan]);
  useEffect(() => () => picture.dispose(), [picture]);
  const canvasBox = { left: -plan.pad, top: -plan.pad, width: plan.size, height: plan.size };
  return (
    <View testID="hero.plate" collapsable={false} style={[styles.root, { width: diameter, height: diameter }]}>
      <Canvas
        testID="hero.plate.rim"
        style={[styles.layer, canvasBox]}
        colorSpace="srgb"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Picture picture={picture} />
      </Canvas>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { direction: 'ltr', overflow: 'visible' },
  layer: { position: 'absolute' },
});
