// The smoke scene (MB-085, OPS-100): the smallest scene that exercises the whole protocol, for the
// harness's own smoke test. A stage that fills the window and one fixed-size mark at its centre, each
// a probe, with the clock's time written in the mark. The mark's opacity follows the field clock on
// the UI thread, so the scene is still on a fixed clock and moves on a running one: that motion is the
// positive control that makes "0 frames under reduced motion" mean something.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';

export const SMOKE_PROBES = ['stage', 'mark'] as const;
export const SMOKE_PERIOD_MS = 6000;

export function SmokeScene({ clock, t }: SceneProps) {
  const pulse = useAnimatedStyle(() => ({
    opacity: 0.6 + 0.4 * Math.sin((2 * Math.PI * clock.t.value) / SMOKE_PERIOD_MS),
  }));
  return (
    <Probe id="stage" style={styles.stage}>
      <Probe id="mark" style={styles.mark}>
        <Animated.View testID="smoke-pulse" style={pulse}>
          <Text>{t === null ? 'smoke' : `smoke ${t}`}</Text>
        </Animated.View>
      </Probe>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
});
