// PlateTouch (F10 group A): the plate's gesture surface, and every input the plate takes.
//
//   · Touch: a tap, or a drag released on the plate, places at its end; a tap on the latest bead's 48 dp target
//     removes it, and only the latest is removable (DSN-012). The surface is the plate grown by the margin a rim
//     bead's target reaches past the plate (plateTouchModel.ts), so the target's rendered bounds are touchable
//     wherever the bead sits (QA-028). A scroll view may take a touch over, so a vertical drag scrolls (LEDGER §6);
//     a second finger cancels. Built on React Native's responder system: no gesture-handler root is needed.
//   · The point: the page's screenToCircumplex (wheelGeometry.ts), passed in as toPoint and handed the plate's
//     wheelLayout, maps the touch's end (QA-087, DSN-025: never mirrored or reimplemented in v2).
//   · TalkBack: the plate is one adjustable node, labelled and hinted from resolved copy, whose value is the
//     cursor's cell; increment and decrement step the cursor over the cells the page gives (the list sheet's
//     cells, so both offer the same points, QA-127), and activate places at the cursor's cell. The latest bead
//     is a 48 dp button whose activate removes it. Order: the plate, then the latest bead.
//   · Haptics: place, replace (a placement on a full plate) and remove, through the page's haptics port (F8),
//     at least haptics.minEventGap apart (DSN-040). Never while inert.
//   · Inert while the consent slot shows (DEC-066): no touch, no action, no haptic, out of the accessibility tree.
//
// It takes callbacks only (RA-39): a placement goes to onPlace and nowhere else. It imports no store, socket,
// storage or permission module (plateTouchClosure.test.ts). It holds no string and paints nothing (R2). Mount it
// as a child of the plate's D×D box; it is LTR in every locale (R7, QA-088).

import React, { useRef, useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';
import { useTokens } from '../../tokens/useTokens.ts';
import { pointToLocal, wheelLayout, type PlateGeometry, type PlatePoint, type PlateWheelLayout } from '../Plate/geometry.ts';
import { hapticAllowed, hapticFor, stepCell, touchIntent, touchSurface, type Local, type PlateHapticEvent, type TouchIntent } from './plateTouchModel.ts';

/** A cell the adjustable steps over: a point on the plate and its resolved label (the list sheet's placement words). */
export interface PlateCell {
  readonly point: PlatePoint;
  readonly label: string;
}

/** The haptics port (F8): it fires the direction's haptics.<event> composition. */
export interface PlateHaptics {
  readonly fire: (event: PlateHapticEvent) => void;
}

/** wheelGeometry's screenToCircumplex: a spot in the plate box and the plate's wheel, to a point on the unit disc. */
export type ToPoint = (point: Local, layout: PlateWheelLayout) => PlatePoint;

export interface PlateTouchProps {
  /** The plate's shared geometry (Plate/geometry.ts plateGeometry). */
  readonly plate: PlateGeometry;
  /** The page's taps on the unit disc, oldest first; the last is the latest bead. */
  readonly taps: readonly PlatePoint[];
  /** screenToCircumplex, passed by the page (QA-087). */
  readonly toPoint: ToPoint;
  readonly onPlace: (point: PlatePoint) => void;
  readonly onRemoveLatest: () => void;
  readonly haptics: PlateHaptics;
  /** The consent slot shows: the plate takes nothing (DEC-066). */
  readonly inert: boolean;
  /** plate.a11y.label and plate.a11y.hint, resolved. */
  readonly label: string;
  readonly hint: string;
  /** The adjustable's steps, in order. */
  readonly cells: readonly PlateCell[];
  /** bead.latest.*, resolved: the latest bead's label and its Remove action's label. */
  readonly latestLabel: string;
  readonly removeLabel: string;
}

interface Gesture {
  readonly start: Local;
  readonly cancelled: boolean;
}

export function PlateTouch({ plate, taps, toPoint, onPlace, onRemoveLatest, haptics, inert, label, hint, cells, latestLabel, removeLabel }: PlateTouchProps) {
  const tokens = useTokens();
  const surface = touchSurface(tokens, plate);
  const m = surface.margin;
  const latest = taps.length > 0 ? taps[taps.length - 1] : null;

  const gesture = useRef<Gesture | null>(null);
  const lastHaptic = useRef<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const cell = cells.length > 0 ? cells[stepCell(cursor, 0, cells.length)] : null;

  const haptic = (event: PlateHapticEvent | null) => {
    const now = performance.now();
    if (event === null || !hapticAllowed(lastHaptic.current, now)) return;
    lastHaptic.current = now;
    haptics.fire(event);
  };
  const perform = (intent: TouchIntent, place: (at: Local) => PlatePoint) => {
    if (inert || intent.kind === 'none') return;
    haptic(hapticFor(intent, taps.length));
    if (intent.kind === 'remove') onRemoveLatest();
    else onPlace(place(intent.at));
  };

  /** The touch's spot in the plate box: the surface is the box grown by the margin on every side. */
  const local = (e: GestureResponderEvent): Local => ({ x: e.nativeEvent.locationX - m, y: e.nativeEvent.locationY - m });
  const onResponderGrant = (e: GestureResponderEvent) => {
    gesture.current = { start: local(e), cancelled: e.nativeEvent.touches.length > 1 };
  };
  const onResponderStart = (e: GestureResponderEvent) => {
    if (gesture.current !== null && e.nativeEvent.touches.length > 1) gesture.current = { ...gesture.current, cancelled: true };
  };
  const onResponderMove = (e: GestureResponderEvent) => {
    if (gesture.current !== null && e.nativeEvent.touches.length > 1) gesture.current = { ...gesture.current, cancelled: true };
  };
  const onResponderRelease = (e: GestureResponderEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (g === null || g.cancelled) return;
    perform(touchIntent(g.start, local(e), plate, surface, latest), (at) => toPoint(at, wheelLayout(plate)));
  };
  const onResponderTerminate = () => {
    gesture.current = null;
  };

  const onPlateAction = (e: AccessibilityActionEvent) => {
    if (inert || cell === null) return;
    const name = e.nativeEvent.actionName;
    if (name === 'increment' || name === 'decrement') setCursor((c) => stepCell(c, name === 'increment' ? 1 : -1, cells.length));
    else if (name === 'activate') perform({ kind: 'place', at: { x: 0, y: 0 } }, () => cell.point);
  };
  const onLatestAction = (e: AccessibilityActionEvent) => {
    if (!inert && latest !== null && e.nativeEvent.actionName === 'activate') perform({ kind: 'remove' }, () => latest);
  };

  const bead = latest === null ? null : pointToLocal(latest, plate);
  return (
    <View
      testID="plate.touch"
      accessible={false}
      importantForAccessibility={inert ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={inert}
      style={[styles.surface, { left: -m, top: -m, width: surface.size, height: surface.size }]}
      onStartShouldSetResponder={() => !inert}
      onResponderTerminationRequest={() => true}
      onResponderGrant={onResponderGrant}
      onResponderStart={onResponderStart}
      onResponderMove={onResponderMove}
      onResponderRelease={onResponderRelease}
      onResponderTerminate={onResponderTerminate}
    >
      <View
        testID="plate.touch.plate"
        pointerEvents="none"
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityValue={cell === null ? undefined : { text: cell.label }}
        accessibilityActions={cell === null ? [] : [{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
        onAccessibilityAction={onPlateAction}
        style={StyleSheet.absoluteFill}
      />
      {bead !== null && (
        <View
          testID="plate.touch.latest"
          pointerEvents="none"
          accessible
          accessibilityRole="button"
          accessibilityLabel={latestLabel}
          accessibilityActions={[{ name: 'activate', label: removeLabel }]}
          onAccessibilityAction={onLatestAction}
          style={[styles.latest, { left: bead.x - surface.hit / 2 + m, top: bead.y - surface.hit / 2 + m, width: surface.hit, height: surface.hit }]}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { position: 'absolute', direction: 'ltr' },
  latest: { position: 'absolute' },
});
