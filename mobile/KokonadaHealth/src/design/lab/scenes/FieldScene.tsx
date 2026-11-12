// A lab field scene (T14: handoff item 9; the architect's T14 plan at c8ff246): the real FieldView, never FieldSurface
// with known frames, drawing the scene its id names (fieldScenes.ts). The scene is FieldView's composition root, so it
// measures: FieldView mounts only once the view has a size (UI-175 at this root), and the layout, pxPerDp and the font
// scale are read here, never inside FieldView.
//
//   · FieldView takes `scene={id}`: its key holds the scene, so every scene mounts a fresh ledger whose first input is
//     shown at once; the lab never relies on a seq reset (resilience T5 r1 F5). That first reset is not a start
//     (fieldDriver.ts: started is a rise in the ledger's starts, and the reset does not count one).
//   · The clock is the lab's (fixed, stepped or real-time); the breath is FieldView's own fixed breath at the clock's
//     time (no breathPhase), as the dev preview draws it.
//   · The stress, the confidence and genesis are the dev preview's (0, 1, off): the hero scenes name no other.
//   · The stage is the one probe, rendered before and after layout alike. No React Native View paints a colour: the
//     field draws its own ground.

import React, { useCallback, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { FieldView } from '../../v2/field/FieldView';
import { FIELD_SCENES, FIELD_STATICS, fieldSceneLayout, type FieldSceneSpec } from '../fieldScenes';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';

export const FIELD_SCENE_PROBES = ['stage'] as const;

const STRESS = 0;
const CONFIDENCE = 1;
const GENESIS = false;

/** The scene's spec, by the launch's id: a lab scene id that is not in the catalogue is a programming error. */
export function sceneSpec(id: string, kind: FieldSceneSpec['kind']): FieldSceneSpec {
  const spec = Object.prototype.hasOwnProperty.call(FIELD_SCENES, id) ? FIELD_SCENES[id] : undefined;
  if (spec === undefined || spec.kind !== kind) throw new Error(`"${id}" is not a lab ${kind} scene`);
  return spec;
}

/** The measured size of the scene's view in dp, or null until it has one. */
export function useMeasuredView() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize(width > 0 && height > 0 ? { width, height } : null);
  }, []);
  return { size, onLayout };
}

export function FieldScene({ clock, params }: SceneProps) {
  const spec = sceneSpec(params.scene, 'field');
  const { size, onLayout } = useMeasuredView();
  const layout = useMemo(
    () => (size === null ? null : fieldSceneLayout(spec, size.width, size.height, PixelRatio.getFontScale())),
    [spec, size],
  );
  return (
    <Probe id="stage" style={styles.stage}>
      <View testID="field-scene.view" style={styles.stage} onLayout={onLayout}>
        {layout !== null && spec.tier !== null && (
          <FieldView
            direction={spec.direction}
            face={spec.face}
            scene={spec.id}
            statics={FIELD_STATICS}
            taps={spec.taps}
            layout={layout}
            pxPerDp={PixelRatio.get()}
            tier={spec.tier}
            stress={STRESS}
            confidence={CONFIDENCE}
            genesis={GENESIS}
            clock={clock}
          />
        )}
      </View>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
});
