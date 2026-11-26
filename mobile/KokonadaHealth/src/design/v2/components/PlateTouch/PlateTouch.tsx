// PlateTouch (F10 group A): the plate's gesture surface, and every input the plate takes.
//
//   · Touch: a tap, or a drag released on the plate, places at its end; a tap on the latest bead's 48 dp target
//     removes it, and only the latest is removable (DSN-012). The surface is the plate grown by the margin a rim
//     bead's target reaches past the plate (plateTouchModel.ts), so the target's rendered bounds are touchable
//     wherever the bead sits (QA-028), and its view HIT_EDGE further, so Android's half-open box never cuts the reach.
//     A scroll view may take a touch over, so a vertical drag scrolls (LEDGER §6);
//     a second finger cancels. Built on React Native's responder system: no gesture-handler root is needed.
//   · The point: the page's screenToCircumplex (wheelGeometry.ts), passed in as toPoint and handed the plate's
//     wheelLayout, maps the touch's end (QA-087, DSN-025: never mirrored or reimplemented in v2).
//   · TalkBack (ruling 9): the latest bead is a 48 dp button whose activate removes it; it is the plate's last node: the
//     surface is the plate's latest slot (Plate/readingOrder.ts), the slot with the lowest top, never flattened. The
//     plate's own node is PlateEntry, the list's button, first among the plate's children. When Remove leaves no tap,
//     focus moves to it first (its handle, passed in as entry), so the screen reader never loses its place.
//   · Haptics: place, replace (a placement on a full plate) and remove, through the page's haptics port (F8),
//     at least haptics.minEventGap apart (DSN-040). Never while inert.
//   · Inert while the consent slot shows (DEC-066): no touch, no action, no haptic, out of the accessibility tree.
//
// It takes callbacks only (RA-39): a placement goes to onPlace and nowhere else. It imports no store, socket,
// storage or permission module (plateTouchClosure.test.ts). It holds no string and paints nothing (R2). Mount it
// as a child of the plate's D×D box; it is LTR in every locale (R7, QA-088).

import React, { useRef } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';
import { useTokens } from '../../tokens/useTokens.ts';
import { pointToLocal, wheelLayout, type PlateGeometry, type PlatePoint, type PlateWheelLayout } from '../Plate/geometry.ts';
import { plateSlot } from '../Plate/readingOrder.ts';
import type { PlateEntryHandle } from './PlateEntry.tsx';
import { hapticAllowed, hapticFor, touchIntent, touchSurface, type Local, type PlateHapticEvent, type TouchIntent } from './plateTouchModel.ts';

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
  /** The page's PlateEntry (its ref): focus goes back to it when Remove leaves no tap. */
  readonly entry: React.RefObject<PlateEntryHandle | null>;
  /** bead.latest.*, resolved: the latest bead's label and its Remove action's label. */
  readonly latestLabel: string;
  readonly removeLabel: string;
}

interface Gesture {
  readonly start: Local;
  readonly cancelled: boolean;
}

export function PlateTouch({ plate, taps, toPoint, onPlace, onRemoveLatest, haptics, inert, entry, latestLabel, removeLabel }: PlateTouchProps) {
  const tokens = useTokens();
  const surface = touchSurface(tokens, plate);
  const m = surface.outset;
  const slot = plateSlot(tokens, plate, 'latest');
  const latest = taps.length > 0 ? taps[taps.length - 1] : null;

  const gesture = useRef<Gesture | null>(null);
  const lastHaptic = useRef<number | null>(null);

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

  /** The touch's spot in the plate box: the surface is the box grown by its outset on every side. */
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

  const onLatestAction = (e: AccessibilityActionEvent) => {
    if (inert || latest === null || e.nativeEvent.actionName !== 'activate') return;
    // The last tap's node is about to go: the plate node takes the focus first.
    if (taps.length === 1) entry.current?.focus();
    perform({ kind: 'remove' }, () => latest);
  };

  const bead = latest === null ? null : pointToLocal(latest, plate);
  return (
    <View
      testID="hero.plate.touch"
      collapsable={false}
      accessible={false}
      importantForAccessibility={inert ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={inert}
      style={[styles.surface, slot]}
      onStartShouldSetResponder={() => !inert}
      onResponderTerminationRequest={() => true}
      onResponderGrant={onResponderGrant}
      onResponderStart={onResponderStart}
      onResponderMove={onResponderMove}
      onResponderRelease={onResponderRelease}
      onResponderTerminate={onResponderTerminate}
    >
      {bead !== null && (
        <View
          testID="hero.plate.bead.latest.a11y"
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
