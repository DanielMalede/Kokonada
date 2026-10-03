// The smoke scene (MB-085): the smallest scene that exercises the whole protocol, for the harness's
// own smoke test (OPS-100). A stage that fills the window and one fixed-size mark at its centre,
// each a probe, with the clock's time written in the mark.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';

export const SMOKE_PROBES = ['stage', 'mark'] as const;

export function SmokeScene({ t }: SceneProps) {
  return (
    <Probe id="stage" style={styles.stage}>
      <Probe id="mark" style={styles.mark}>
        <Text>{t === null ? 'smoke' : `smoke ${t}`}</Text>
      </Probe>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
});
