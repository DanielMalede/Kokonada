// PlateEntry (ruling 9, the designer's rulings of 2026-11-25): the plate's TalkBack node, a button that opens the list
// of every place. It replaces PlateTouch's adjustable node: a screen-reader user is never told to tap the plate.
//
//   · A View over the plate's D×D box, first among the plate's children ([PlateEntry, RimLabels, BeadLayer,
//     PlateTouch]). It sits in the plate's entry slot (Plate/readingOrder.ts), so Android, which sorts by place and
//     never by mount order, reads it first: the plate node, the four rim words, then the latest bead.
//   · Role button, labelled and hinted from the page's resolved plate.a11y.label and plate.a11y.hint (the hint's intent:
//     the plate holds up to three points, and a double-tap opens a list of every place). It holds no string of its own.
//   · Its activate action opens the list through the page's required onOpenList (RA-39: a callback, nothing else).
//   · pointerEvents none: every touch goes to PlateTouch. Keyboard-focusable, and it reports its focus (onFocusChange).
//   · Hidden while the consent slot shows (DEC-066): out of the accessibility tree, not focusable, no action.
//   · focus() moves the screen reader's focus to it: PlateTouch calls it when Remove leaves no tap.
//
// Mount it as the first child of the plate's D×D box; it is LTR in every locale (R7, QA-088).

import React, { useImperativeHandle, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { useTokens } from '../../tokens/useTokens.ts';
import type { PlateGeometry } from '../Plate/geometry.ts';
import { plateSlot } from '../Plate/readingOrder.ts';

/** What the page and PlateTouch may do with the plate node. */
export interface PlateEntryHandle {
  /** Move the screen reader's focus to the plate node (nothing while it is hidden). */
  readonly focus: () => void;
}

export interface PlateEntryProps {
  /** The plate's shared geometry (Plate/geometry.ts plateGeometry): the node covers its D×D box. */
  readonly plate: PlateGeometry;
  /** plate.a11y.label and plate.a11y.hint, resolved by the page. */
  readonly label: string;
  readonly hint: string;
  /** Opens the list of every place (RA-39: the page's own; required, so the node can never be a dead button). */
  readonly onOpenList: () => void;
  /** Keyboard focus came (true) or went (false). */
  readonly onFocusChange: (focused: boolean) => void;
  /** The consent slot shows (DEC-066): hidden and inert. */
  readonly inert: boolean;
  readonly ref?: React.Ref<PlateEntryHandle>;
}

export function PlateEntry({ plate, label, hint, onOpenList, onFocusChange, inert, ref }: PlateEntryProps) {
  const tokens = useTokens();
  const slot = plateSlot(tokens, plate, 'entry');
  const node = useRef<View>(null);
  const hidden = useRef(inert);
  hidden.current = inert;
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (!hidden.current && node.current !== null) AccessibilityInfo.sendAccessibilityEvent(node.current, 'focus');
    },
  }), []);
  const onAction = (e: AccessibilityActionEvent) => {
    if (!inert && e.nativeEvent.actionName === 'activate') onOpenList();
  };
  return (
    <View testID="plate.slot.entry" collapsable={false} pointerEvents="none" style={[styles.slot, slot]}>
      <View
        ref={node}
        testID="hero.listEntry"
        pointerEvents="none"
        accessible={!inert}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityActions={inert ? [] : [{ name: 'activate' }]}
        onAccessibilityAction={onAction}
        focusable={!inert}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        importantForAccessibility={inert ? 'no-hide-descendants' : 'yes'}
        accessibilityElementsHidden={inert}
        style={[styles.entry, { left: -slot.left, top: -slot.top, width: plate.diameter, height: plate.diameter }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute' },
  entry: { position: 'absolute' },
});
