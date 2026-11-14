// A lab fallback scene (T14; the architect's T14 plan at c8ff246): FieldFallback, rendered directly, never FieldView, so
// the fallback is captured without forcing a shader failure. It draws the scene its id names (fieldScenes.ts): its face
// and T13's taps (fallbackScenes.ts), every quiet rect removed, no presence (each zone present).
//
// Its layout is T13's heroLayout, the same hero layout assumption as fallbackScenes.ts: the V1 boards' construction (a
// 24 dp status bar, a 16 dp gesture bar, the AI line at three ui.legal lines, the CTA at most 288 dp wide, left to right,
// no list-entry chip) laid over the lab's measured view, until B6 measures the real hero (UI-207). It measures, and
// mounts FieldFallback only once its view has a size (UI-175). The stage is its one probe; no React Native View paints a
// colour (UI-204): FieldFallback draws the ground. It says it is the fallback by design (`fallback-scene`, UI-223).

import React, { useContext, useLayoutEffect, useMemo } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { FieldFallback } from '../../v2/field/FieldFallback';
import { FIELD_STATICS, fieldSceneLayout, sceneSpec } from '../fieldScenes';
import type { LabParams } from '../params';
import { Probe } from '../probe/Probe';
import { ShaderReportContext } from '../shaderReport';
import { useMeasuredView } from './useMeasuredView';

export const FALLBACK_SCENE_PROBES = ['stage'] as const;

/** Why the field is not drawn, for the lab's manifest (never reported anywhere, REG-066). */
const REASON = 'the lab fallback scene: FieldFallback mounted directly';

/** A lab scene's props, of which it reads only the launch's params: it never imports scenes.ts, so its closure never reaches FieldView. */
export function FallbackScene({ params }: { readonly params: LabParams }) {
  const spec = sceneSpec(params.scene, 'fallback');
  const { size, onLayout } = useMeasuredView();
  const layout = useMemo(
    () => (size === null ? null : fieldSceneLayout(spec, size.width, size.height, PixelRatio.getFontScale())),
    [spec, size],
  );
  const report = useContext(ShaderReportContext);
  useLayoutEffect(() => {
    report?.({ status: 'fallback-scene', reason: REASON });
  }, [report]);
  return (
    <Probe id="stage" style={styles.stage}>
      <View testID="fallback-scene.view" style={styles.stage} onLayout={onLayout}>
        {layout !== null && (
          <FieldFallback
            direction={spec.direction}
            face={spec.face}
            statics={FIELD_STATICS}
            taps={spec.taps}
            layout={layout}
            pxPerDp={PixelRatio.get()}
            reason={REASON}
          />
        )}
      </View>
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
});
