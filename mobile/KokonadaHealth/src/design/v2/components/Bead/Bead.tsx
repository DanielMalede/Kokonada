// One bead (F10 group A; DSN-029): the placed point, drawn over the field from views only. It is purely visual: never
// a touch target and never an accessibility node. PlateTouch owns the latest bead's 48 dp target and its Remove
// action, so the touch and the label cannot disagree about where the bead is.
//
// F1 (P0, the designer's rulings of 2026-11-25): a bead is never translucent in colour over the field. It is two discs
// under its setting ring (the ring sits outside them, the designer's board, d3):
//   · the grey disc, its achromatic twin (beadModel.ts beadTwinPaint: the fill at its own OKLab L with chroma 0 and the
//     highlight drawn from it), with the token shadow (the bead's depth, the only tactile part of Abyss; LEDGER §2);
//   · the colour disc over it, the same circle: the DSN-017 fill and its highlight's radial gradient, no shadow.
// The bead's opacity fades only the grey disc's world: the colour disc's own opacity is above 0 only while the bead's
// opacity is 1 (beadTimeline.ts). The setting ring and the shadow are as before.
//
// Motion (F1 as amended, the designer's rulings of 2026-11-26): every channel of the bead's look (its opacity, its
// colour disc's opacity, its scale) is computed off the JS thread from one clock per bead and written in the same frame
// (beadDriver.ts, run by useBeadClock.ts); no frame's look waits on JS. The bead only reads its own look from the
// driver's shared value, in two animated styles of one UI frame. A bead with no look is at rest: whole when it has no
// entrance (the mount, a restore, the still tier), and not drawn (opacity 0, at the entrance's first scale) when it was
// placed with one and its first UI frame has not come: a bead is never whole in its first frame. A late motion is
// compressed, never skipped, the scale on the same clock.
//
// Place it inside the plate's LTR root (BeadLayer, or the plate box with direction 'ltr'): its left and top
// are physical (R7, QA-088), from the plate's shared geometry (pointToLocal: the centre the field lights for the tap).

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import type { DirectionTokens } from '../../tokens/tokens.generated.ts';
import { useTokens } from '../../tokens/useTokens.ts';
import { pointToLocal, type PlateGeometry, type PlatePoint } from '../Plate/geometry.ts';
import { restLook, type BeadLooks } from './beadDriver.ts';
import { beadMotion, beadPaint, beadTwinPaint } from './beadModel.ts';

export interface BeadProps {
  /** Its id in the presence: the key of its look. */
  readonly id: number;
  /** The tap on the unit disc, y up. */
  readonly point: PlatePoint;
  /** The plate's shared geometry (Plate/geometry.ts plateGeometry), the one the plate and the touch layer use. */
  readonly plate: PlateGeometry;
  /** It was placed with an entrance (the presence's placedAt is not null): until its first look it is not drawn. */
  readonly entered: boolean;
  /** The looks the beads' driver writes (useBeadClock). */
  readonly looks: SharedValue<BeadLooks>;
  /** Its element ID (F2): hero.plate.bead.<slot> while live, its place among the live beads oldest first (0 to 2), with
   *  .setting on its ring; hero.plate.bead.leaving while it leaves, its ring then claiming no hero ID. */
  readonly slot: number | 'leaving';
}

/** The highlight (bead.highlight): a radial gradient from its colour to the fill, its centre up and to the left. */
function highlight(tokens: DirectionTokens['bead']['highlight'], rb: number, from: string, to: string) {
  const radius = tokens.radius * rb;
  return {
    type: 'radial-gradient' as const,
    shape: 'ellipse' as const,
    size: { x: radius, y: radius },
    position: { left: rb * (1 + tokens.offsetX), top: rb * (1 + tokens.offsetY) },
    colorStops: [
      { color: from, positions: ['0%'] },
      { color: to, positions: ['100%'] },
    ],
  };
}

export function Bead({ id: bead, point, plate, entered, looks, slot }: BeadProps) {
  const { id, face, direction } = useTokens();
  const g = { bead: plate.beadRadius, setting: direction.bead.setting.width };
  const centre = pointToLocal(point, plate);
  const paint = beadPaint(id, face, point);
  const twin = beadTwinPaint(id, face, point);
  const box = 2 * (g.bead + g.setting);
  const circle = { left: g.setting, top: g.setting, width: 2 * g.bead, height: 2 * g.bead, borderRadius: g.bead };

  // With no look yet: whole, or out when it has an entrance to play.
  const rest = useMemo(() => restLook(entered, beadMotion(id, 'full')), [entered, id]);
  // Both styles read the one look the driver wrote this frame: the colour can never be a frame ahead of the opacity.
  const body = useAnimatedStyle(() => {
    const look = looks.value[bead] ?? rest;
    return { opacity: look.opacity, transform: [{ scale: look.scale }] };
  }, [looks, bead, rest]);
  const colour = useAnimatedStyle(() => ({ opacity: (looks.value[bead] ?? rest).colour }), [looks, bead, rest]);

  const shadow = direction.bead.shadow;
  return (
    <Animated.View
      testID={'hero.plate.bead.' + slot}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.part, { left: centre.x - g.bead - g.setting, top: centre.y - g.bead - g.setting, width: box, height: box }, body]}
    >
      <View
        testID="bead.disc"
        style={[
          styles.part,
          circle,
          {
            backgroundColor: twin.fill,
            boxShadow: [{ offsetX: 0, offsetY: shadow.offsetY, blurRadius: shadow.blur, color: paint.shadow }],
            experimental_backgroundImage: [highlight(direction.bead.highlight, g.bead, twin.highlight, twin.fill)],
          },
        ]}
      />
      <Animated.View
        testID="bead.colour"
        pointerEvents="none"
        style={[styles.part, circle, { backgroundColor: paint.fill, experimental_backgroundImage: [highlight(direction.bead.highlight, g.bead, paint.highlight, paint.fill)] }, colour]}
      />
      <View testID={slot === 'leaving' ? 'bead.setting' : 'hero.plate.bead.' + slot + '.setting'} style={[styles.ring, { width: box, height: box, borderRadius: g.bead + g.setting, borderWidth: g.setting, borderColor: paint.setting }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  part: { position: 'absolute' },
  ring: { position: 'absolute', left: 0, top: 0 },
});
