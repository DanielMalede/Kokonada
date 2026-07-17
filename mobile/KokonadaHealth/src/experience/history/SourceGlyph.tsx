import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius } from '../../design/tokens';
import type { SourceKind } from './historyFormat';

// The Manual/Live silhouette (§9 SOURCE SIGNAL). WCAG 1.4.1: the TEXT label carries the primary
// signal; this abstract, token-drawn mark reinforces it by SHAPE — Live is a bold concentric ring with
// a CENTRED dot (radially symmetric); Manual is a thin ring with the dot pushed OFF-CENTRE. They differ
// in silhouette, not merely tint, so a colour-blind eye still tells them apart. No third-party marks;
// decorative → hidden from assistive tech (the row's composed label speaks the source).

// A glyph stroke has no design token (the CURSOR_RAIL_WIDTH / ShieldGlyph art-value precedent): the bold
// Live ring is 2px; the quiet Manual ring degrades to the platform hairline.
const GLYPH_STROKE = 2;

export function SourceGlyph({ source }: { source: SourceKind }) {
  const { c } = useTheme();
  const live = source === 'live';
  const tint = live ? c.accent.glow : c.content.secondary;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.wrap}
    >
      <View
        testID="source-glyph-ring"
        style={[styles.ring, { borderColor: tint, borderWidth: live ? GLYPH_STROKE : StyleSheet.hairlineWidth }]}
      >
        <View
          testID="source-glyph-dot"
          style={[styles.dot, live ? styles.dotCentered : styles.dotOffset, { backgroundColor: tint }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  ring: { width: space.lg, height: space.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dot: { width: space.xs, height: space.xs, borderRadius: radius.pill },
  dotCentered: {}, // centred by the ring's own centering — radially symmetric
  dotOffset: { position: 'absolute', top: space.none }, // pushed to the top edge — off-centre silhouette
});
