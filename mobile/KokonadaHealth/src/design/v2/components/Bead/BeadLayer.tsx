// The beads for the page's presence (F10 group A): one Bead per entry, on the plate's LTR root (R7, QA-088), entering
// when placed and leaving when a fourth tap, an undo or a clear takes them. Leaving beads draw under the live ones (the
// designer's board, d3). The layer is inert: no touch and no accessibility node; PlateTouch owns both.
//
// Ruling 2 (2026-11-25): the page owns the presence (useBeadPresence: the store's taps and the motion tier) and shares
// it with hero A's rim words; the layer only draws its beads, each from its own entry's stamps, and reports each exit
// that ends to onGone with that bead's id. Mount it as a child of the plate's D×D box. The taps are the page's own
// (P10: page state, never the cold lane, RA-39; P2: the cold lane through its port).

import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { PlateGeometry } from '../Plate/geometry.ts';
import { Bead } from './Bead.tsx';
import type { PresentBead } from './beadPresence.ts';

export interface BeadLayerProps {
  /** The presence's beads (useBeadPresence), oldest first, the leaving ones included. */
  readonly beads: readonly PresentBead[];
  /** The plate's shared geometry (Plate/geometry.ts plateGeometry). */
  readonly plate: PlateGeometry;
  /** A leaving bead's exit ended (the presence's onGone). */
  readonly onGone: (id: number) => void;
}

export function BeadLayer({ beads, plate, onGone }: BeadLayerProps) {
  const order = [...beads.filter((b) => b.leaving), ...beads.filter((b) => !b.leaving)];
  return (
    <View
      testID="bead.layer"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.layer, { width: plate.diameter, height: plate.diameter }]}
    >
      {order.map((bead) => (
        <Bead key={bead.id} point={bead.point} plate={plate} placedAt={bead.placedAt} leftAt={bead.leftAt} onLeft={() => onGone(bead.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0, direction: 'ltr' },
});
