// The beads for the store's taps (F10 group A): one Bead per tap, on the plate's LTR root (R7, QA-088),
// entering when placed and leaving when a fourth tap, an undo or a clear takes them (beadPresence.ts). Leaving
// beads draw under the live ones (the designer's board, d3). The layer is inert: no touch and no
// accessibility node; PlateTouch owns both.
//
// Mount it as a child of the plate's D×D box. The taps are the page's own (P10: page state, never the cold
// lane, RA-39; P2: the cold lane through its port): the layer only reads them.

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { MotionTier } from '../../motion/useMotionPolicy.ts';
import { Bead } from './Bead.tsx';
import { presenceGone, presenceOf, presenceUpdate, type BeadPresence } from './beadPresence.ts';
import type { PlatePoint } from './platePoint.ts';

export interface BeadLayerProps {
  /** The store's taps on the unit disc, y up, oldest first. */
  readonly taps: readonly PlatePoint[];
  /** The plate's diameter, in dp. */
  readonly diameter: number;
  readonly tier: MotionTier;
}

export function BeadLayer({ taps, diameter, tier }: BeadLayerProps) {
  const [presence, setPresence] = useState<BeadPresence>(() => presenceOf(taps));
  // A new taps array is read by value at once, in the same render (React's "adjust state on a prop change").
  const [seen, setSeen] = useState(taps);
  let shown = presence;
  if (seen !== taps) {
    shown = presenceUpdate(presence, taps);
    setSeen(taps);
    if (shown !== presence) setPresence(shown);
  }
  const gone = useCallback((id: number) => setPresence((p) => presenceGone(p, id)), []);
  const order = [...shown.beads.filter((b) => b.leaving), ...shown.beads.filter((b) => !b.leaving)];
  return (
    <View
      testID="bead.layer"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.layer, { width: diameter, height: diameter }]}
    >
      {order.map((bead) => (
        <Bead key={bead.id} point={bead.point} diameter={diameter} tier={tier} leaving={bead.leaving} initial={bead.initial} onLeft={() => gone(bead.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0, direction: 'ltr' },
});
