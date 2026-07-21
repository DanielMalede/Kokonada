import React, { useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Canvas, Fill, LinearGradient, vec } from '@shopify/react-native-skia';

// A self-measuring horizontal (90°) Skia gradient that fills its parent — an absolute-fill layer
// painted BEHIND a label (the aurora CTA + the selected activity chip). Skia gradient coordinates are
// ABSOLUTE, so the fill needs its own measured width; until onLayout fires (and under the headless
// jest render, which never lays out) it paints nothing and the parent's SOLID fallback colour shows —
// so a text label always sits on a known, AA-proven backdrop, never a transparent flash.
export function AuroraGradientFill({ colors: stops }: { colors: readonly string[] }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {size && size.w > 0 ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <LinearGradient start={vec(0, 0)} end={vec(size.w, 0)} colors={stops as string[]} />
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
}
