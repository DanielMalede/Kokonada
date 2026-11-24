// One bead (F10 group A; DSN-029): the placed point, drawn over the field from views only. The disc is the
// DSN-017 fill with the highlight's radial gradient and the token shadow (the bead's depth, the only tactile
// part of Abyss; LEDGER §2); the setting ring sits outside the disc (the designer's board, d3). It is purely
// visual: never a touch target and never an accessibility node. PlateTouch owns the latest bead's 48 dp
// target and its Remove action, so the touch and the label cannot disagree about where the bead is.
//
// Motion (beadModel.ts): the entrance plays the eased value of motion.placement's token on the native
// driver, mapped through the model's own breakpoints (0, 1 and the curve's peak), so the views draw exactly
// the model's look; under reduced motion it is a linear fade over motion.fadeReduced and the scale is never
// animated. The exit starts from where the bead is (its entrance read from the elapsed time) and fades
// linearly to 0 over the same duration; onLeft reports its end, never an exit cut short.
//
// Place it inside the plate's LTR root (BeadLayer, or the plate box with direction 'ltr'): its left and top
// are physical (R7, QA-088), from the plate's shared geometry (pointToLocal: the halo's own centre).

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { DirectionTokens } from '../../tokens/tokens.generated.ts';
import { useTokens } from '../../tokens/useTokens.ts';
import { pointToLocal, type PlateGeometry, type PlatePoint } from '../Plate/geometry.ts';
import { beadEntrance, beadMotion, beadPaint, type BeadLook, type BeadMotion } from './beadModel.ts';

export interface BeadProps {
  /** The tap on the unit disc, y up. */
  readonly point: PlatePoint;
  /** The plate's shared geometry (Plate/geometry.ts plateGeometry), the one the plate and the touch layer use. */
  readonly plate: PlateGeometry;
  readonly tier: MotionTier;
  /** Playing its exit (a fourth tap, an undo, a clear). */
  readonly leaving: boolean;
  /** Shown at the mount (a restore, the page's first frame): it has no entrance. */
  readonly initial: boolean;
  /** The exit ended: the layer may drop the bead. */
  readonly onLeft: () => void;
}

const now = () => performance.now();

/** The entrance's opacity and scale, as interpolations of its eased value e over the model's breakpoints. */
function entranceLook(value: Animated.Value, m: BeadMotion) {
  const overshoots = m.peak > 1;
  const input = overshoots ? [0, 1, m.peak] : [0, 1];
  const opacity = value.interpolate({ inputRange: input, outputRange: overshoots ? [0, 1, 1] : [0, 1], extrapolate: 'clamp' });
  if (m.linear) return { opacity, scale: 1 };
  const scale = value.interpolate({ inputRange: input, outputRange: overshoots ? [m.scaleFrom, 1, m.overshootScale] : [m.scaleFrom, 1], extrapolate: 'clamp' });
  return { opacity, scale };
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

export function Bead({ point, plate, tier, leaving, initial, onLeft }: BeadProps) {
  const { id, face, direction } = useTokens();
  const g = { bead: plate.beadRadius, setting: direction.bead.setting.width };
  const centre = pointToLocal(point, plate);
  const paint = beadPaint(id, face, point);
  const box = 2 * (g.bead + g.setting);

  // The entrance's motion is fixed when the bead is placed; a tier change later does not restart it.
  const [entrance] = useState(() => beadMotion(id, tier));
  const [enter] = useState(() => new Animated.Value(initial ? 1 : 0));
  const placedAt = useRef(now());
  useEffect(() => {
    if (initial) return undefined;
    const easing = entrance.easing === null ? Easing.linear : Easing.bezier(entrance.easing[0], entrance.easing[1], entrance.easing[2], entrance.easing[3]);
    const animation = Animated.timing(enter, { toValue: 1, duration: entrance.duration, easing, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
    // The entrance runs once, at the mount: `initial`, `enter` and `entrance` are fixed for the bead's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The exit: from the look the entrance has reached, linearly to 0.
  const [exit, setExit] = useState<{ readonly value: Animated.Value; readonly from: BeadLook } | null>(null);
  const reportLeft = useRef(onLeft);
  reportLeft.current = onLeft;
  useEffect(() => {
    if (!leaving || exit !== null) return;
    const from = initial ? { opacity: 1, scale: 1 } : beadEntrance(id, tier, now() - placedAt.current);
    setExit({ value: new Animated.Value(0), from });
  }, [leaving, exit, initial, id, tier]);
  useEffect(() => {
    if (exit === null) return undefined;
    enter.stopAnimation();
    const animation = Animated.timing(exit.value, { toValue: 1, duration: beadMotion(id, tier).duration, easing: Easing.linear, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished) reportLeft.current();
    });
    return () => animation.stop();
    // The exit starts once, from the look fixed when it began.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exit]);

  const look =
    exit === null
      ? entranceLook(enter, entrance)
      : { opacity: exit.value.interpolate({ inputRange: [0, 1], outputRange: [exit.from.opacity, 0], extrapolate: 'clamp' }), scale: exit.from.scale };
  const shadow = direction.bead.shadow;

  return (
    <Animated.View
      testID="bead"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.part, { left: centre.x - g.bead - g.setting, top: centre.y - g.bead - g.setting, width: box, height: box, opacity: look.opacity, transform: [{ scale: look.scale }] }]}
    >
      <View
        testID="bead.disc"
        style={[
          styles.part,
          {
            left: g.setting,
            top: g.setting,
            width: 2 * g.bead,
            height: 2 * g.bead,
            borderRadius: g.bead,
            backgroundColor: paint.fill,
            boxShadow: [{ offsetX: 0, offsetY: shadow.offsetY, blurRadius: shadow.blur, color: paint.shadow }],
            experimental_backgroundImage: [highlight(direction.bead.highlight, g.bead, paint.highlight, paint.fill)],
          },
        ]}
      />
      <View testID="bead.setting" style={[styles.ring, { width: box, height: box, borderRadius: g.bead + g.setting, borderWidth: g.setting, borderColor: paint.setting }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  part: { position: 'absolute' },
  ring: { position: 'absolute', left: 0, top: 0 },
});
