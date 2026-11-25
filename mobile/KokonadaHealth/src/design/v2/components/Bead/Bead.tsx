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
// Motion: each phase is one clock on the native driver, the ms since the presence's placedAt (the entrance) or leftAt
// (the exit), run linearly. The bead's opacity, the colour disc's opacity and the scale are interpolations of that
// one clock, sampled from the model (beadModel.ts beadEntrance and beadExit) every STEP_MS and at each of the timeline's
// boundaries, so the three can never part from each other: the colour disc starts in the frame the opacity is 1, and
// the opacity starts down only once the colour is 0. A bead with no entrance (placedAt null: the mount, a restore, the
// still tier) is whole from its first frame. The exit starts from where the bead is, its scale held; onLeft reports its
// end, never an exit cut short. A phase whose effect runs late starts where it is (the clock at now − its origin).
//
// Place it inside the plate's LTR root (BeadLayer, or the plate box with direction 'ltr'): its left and top
// are physical (R7, QA-088), from the plate's shared geometry (pointToLocal: the centre the field lights for the tap).

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import type { DirectionId, DirectionTokens } from '../../tokens/tokens.generated.ts';
import { useTokens } from '../../tokens/useTokens.ts';
import { pointToLocal, type PlateGeometry, type PlatePoint } from '../Plate/geometry.ts';
import { BEAD_WHOLE, beadEntrance, beadExit, beadMotion, beadPaint, beadTwinPaint, type BeadLook } from './beadModel.ts';
import { exitDuration, exitHold, PRESS_MS, RESPOND_MS } from './beadTimeline.ts';

export interface BeadProps {
  /** The tap on the unit disc, y up. */
  readonly point: PlatePoint;
  /** The plate's shared geometry (Plate/geometry.ts plateGeometry), the one the plate and the touch layer use. */
  readonly plate: PlateGeometry;
  /** When its entrance began, on the JS clock (the presence's placedAt); null: whole from its first frame. */
  readonly placedAt: number | null;
  /** When its exit began (the presence's leftAt); null while it is live. */
  readonly leftAt: number | null;
  /** The exit ended: the layer may drop the bead. */
  readonly onLeft: () => void;
}

const now = () => performance.now();
/** The motion a placed bead plays: the low tier plays the same (LEDGER §7); the still tier plays none (beadPresence.ts). */
const PLAYED: MotionTier = 'full';
/** The breakpoints' spacing: piecewise linear on the native driver, within 0.001 of the model's curves (Bead.test.tsx). */
const STEP_MS = 2;

type Channel = Animated.AnimatedInterpolation<number> | number;

interface Phase {
  /** The phase's clock in ms since its origin; null when there is nothing to play. */
  readonly clock: Animated.Value | null;
  readonly origin: number;
  readonly end: number;
  readonly exit: boolean;
  readonly opacity: Channel;
  readonly colour: Channel;
  readonly scale: Channel;
}

/** Every STEP_MS from 0 to `end`, and each boundary inside it: strictly increasing. */
function breakpoints(end: number, boundaries: readonly number[]): number[] {
  const all = [end, ...boundaries.filter((b) => b > 0 && b < end)];
  for (let t = 0; t < end; t += STEP_MS) all.push(t);
  return [...new Set(all)].sort((a, b) => a - b);
}

/** A phase on its own clock: each channel of the model's look, sampled at the breakpoints and clamped past them. */
function phaseOf(origin: number, end: number, exit: boolean, boundaries: readonly number[], look: (ms: number) => BeadLook): Phase {
  const clock = new Animated.Value(Math.min(end, Math.max(0, now() - origin)));
  const inputRange = breakpoints(end, boundaries);
  const looks = inputRange.map(look);
  const channel = (pick: (l: BeadLook) => number): Channel => clock.interpolate({ inputRange, outputRange: looks.map(pick), extrapolate: 'clamp' });
  return { clock, origin, end, exit, opacity: channel((l) => l.opacity), colour: channel((l) => l.colour), scale: exit ? look(0).scale : channel((l) => l.scale) };
}

function phaseFor(id: DirectionId, placedAt: number | null, leftAt: number | null): Phase {
  if (leftAt === null) {
    if (placedAt === null) return { clock: null, origin: 0, end: 0, exit: false, ...BEAD_WHOLE };
    const scaleEnd = beadMotion(id, PLAYED).duration;
    return phaseOf(placedAt, Math.max(PRESS_MS + RESPOND_MS, scaleEnd), false, [PRESS_MS, PRESS_MS + RESPOND_MS, scaleEnd], (t) => beadEntrance(id, PLAYED, t));
  }
  const from = placedAt === null ? BEAD_WHOLE : beadEntrance(id, PLAYED, leftAt - placedAt);
  return phaseOf(leftAt, exitDuration(from.opacity), true, [exitHold(from.opacity)], (t) => beadExit(id, PLAYED, from, t));
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

export function Bead({ point, plate, placedAt, leftAt, onLeft }: BeadProps) {
  const { id, face, direction } = useTokens();
  const g = { bead: plate.beadRadius, setting: direction.bead.setting.width };
  const centre = pointToLocal(point, plate);
  const paint = beadPaint(id, face, point);
  const twin = beadTwinPaint(id, face, point);
  const box = 2 * (g.bead + g.setting);
  const circle = { left: g.setting, top: g.setting, width: 2 * g.bead, height: 2 * g.bead, borderRadius: g.bead };

  // The entrance's stamps are fixed when the bead is placed; the phase changes once, when it starts leaving.
  const phase = useMemo(() => phaseFor(id, placedAt, leftAt), [id, placedAt, leftAt]);
  const reportLeft = useRef(onLeft);
  reportLeft.current = onLeft;
  useEffect(() => {
    const { clock, origin, end, exit } = phase;
    if (clock === null) return undefined;
    const elapsed = Math.max(0, now() - origin);
    if (!(elapsed < end)) {
      clock.setValue(end);
      if (exit) reportLeft.current();
      return undefined;
    }
    clock.setValue(elapsed);
    const animation = Animated.timing(clock, { toValue: end, duration: end - elapsed, easing: Easing.linear, useNativeDriver: true });
    animation.start(({ finished }) => {
      if (finished && exit) reportLeft.current();
    });
    return () => animation.stop();
  }, [phase]);

  const shadow = direction.bead.shadow;
  return (
    <Animated.View
      testID="bead"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.part, { left: centre.x - g.bead - g.setting, top: centre.y - g.bead - g.setting, width: box, height: box, opacity: phase.opacity, transform: [{ scale: phase.scale }] }]}
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
        style={[styles.part, circle, { opacity: phase.colour, backgroundColor: paint.fill, experimental_backgroundImage: [highlight(direction.bead.highlight, g.bead, paint.highlight, paint.fill)] }]}
      />
      <View testID="bead.setting" style={[styles.ring, { width: box, height: box, borderRadius: g.bead + g.setting, borderWidth: g.setting, borderColor: paint.setting }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  part: { position: 'absolute' },
  ring: { position: 'absolute', left: 0, top: 0 },
});
