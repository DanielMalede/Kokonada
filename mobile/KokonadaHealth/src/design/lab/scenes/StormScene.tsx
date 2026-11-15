// A lab storm scene (B8-7; the architect's B8 plan at 199b138; QA-068's S7 and UI-190): the real FieldView, Abyss dark at
// the case's tier, whose taps change on a JS timer by the case's script (storm/stormScript.ts), and a lab marker View in
// the window's top-left corner (storm/stormMarker.ts) whose colour comes from the same count in the same render, so a
// recording sees the marker change on the frame the change was committed and flashTrace.mts measures the latency in
// frames from there to the first changed field cell.
//
//   · It measures its view as FieldScene does: FieldView mounts only once the view has a size, and the script's timer
//     starts with it, so every case begins with IDLE_MS at rest whatever the layout took.
//   · The clock is the lab's (a recording runs on the real-time clock); the breath is FieldView's own fixed breath; the
//     stress, the confidence and genesis are the dev preview's (0, 1, off), as in FieldScene.
//   · Two probes, rendered before and after layout alike: the stage and the marker. The marker's rect in READY places it
//     on a recording exactly.
//   · It says which surface drew it as FieldScene does (UI-223, UI-233): `pending` until FieldView's first drawn frame
//     of this scene, then the effect's status; `fallback` with FieldFallback's reason once FieldView has switched to it.
//   · Nothing here sends a lab line: no tap coordinate and no emotion value leaves the scene.

import React, { useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { fieldEffect } from '../../v2/field/effect';
import { FieldFallbackReport } from '../../v2/field/fallbackReport';
import { FieldFirstFrameReport } from '../../v2/field/firstFrameReport';
import { FieldView } from '../../v2/field/FieldView';
import { FIELD_STATICS } from '../fieldScenes';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';
import { ShaderReportContext } from '../shaderReport';
import { STORM_MARKER_DP, stormMarkerColour } from '../storm/stormMarker';
import { stormSceneLayout, stormSceneSpec } from '../storm/stormScenes';
import { stormTapsAt } from '../storm/stormScript';
import { useStormCount } from '../storm/useStormCount';
import { useMeasuredView } from './useMeasuredView';

export const STORM_SCENE_PROBES = ['stage', 'marker'] as const;

const STRESS = 0;
const CONFIDENCE = 1;
const GENESIS = false;

export function StormScene({ clock, params }: SceneProps) {
  const spec = stormSceneSpec(params.scene);
  const { size, onLayout } = useMeasuredView();
  const layout = useMemo(
    () => (size === null ? null : stormSceneLayout(spec, size.width, size.height, PixelRatio.getFontScale())),
    [spec, size],
  );
  const count = useStormCount(spec.script, layout !== null);
  const taps = stormTapsAt(spec.script, count);

  const report = useContext(ShaderReportContext);
  const [effect] = useState(fieldEffect);
  const [fallen, setFallen] = useState<{ readonly scene: string; readonly reason: string } | null>(null);
  const setFellBack = useCallback((r: string) => setFallen({ scene: spec.id, reason: r }), [spec.id]);
  const fellBack = fallen !== null && fallen.scene === spec.id ? fallen.reason : null;
  const status = fellBack !== null ? 'fallback' : effect.status;
  const reason = fellBack ?? (effect.status === 'fallback' ? effect.reason : null);
  const [drawnScene, setDrawnScene] = useState<string | null>(null);
  const onFirstFrame = useCallback(() => setDrawnScene(spec.id), [spec.id]);
  const drawn = drawnScene === spec.id;
  useLayoutEffect(() => {
    if (status === 'ready' && !drawn) {
      report?.({ status: 'pending', reason: null });
      return;
    }
    report?.({ status, reason });
  }, [report, status, reason, drawn]);

  return (
    <FieldFallbackReport.Provider value={setFellBack}>
      <Probe id="stage" style={styles.stage}>
        <View testID="storm-scene.view" style={styles.stage} onLayout={onLayout}>
          {layout !== null && (
            <FieldFirstFrameReport.Provider value={onFirstFrame}>
              <FieldView
                direction={spec.direction}
                face={spec.face}
                scene={spec.id}
                statics={FIELD_STATICS}
                taps={taps}
                layout={layout}
                pxPerDp={PixelRatio.get()}
                tier={spec.tier}
                stress={STRESS}
                confidence={CONFIDENCE}
                genesis={GENESIS}
                clock={clock}
              />
            </FieldFirstFrameReport.Provider>
          )}
        </View>
        <Probe id="marker" style={[styles.marker, { backgroundColor: stormMarkerColour(count) }]} />
      </Probe>
    </FieldFallbackReport.Provider>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  marker: {
    position: 'absolute',
    left: STORM_MARKER_DP.left,
    top: STORM_MARKER_DP.top,
    width: STORM_MARKER_DP.size,
    height: STORM_MARKER_DP.size,
  },
});
