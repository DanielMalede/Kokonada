// A lab cost scene (B8-3; the architect's B8 plan, F2 at A): the fieldCost bench's composition root. It draws nothing but
// its stage: the bench renders offscreen only, and FieldView is never mounted here (no probe in FieldView).
//
//   · It measures its view, as FieldScene does, and the bench starts only once the view has a size: the config is the
//     field scene's layout at the device's pxPerDp and font scale, at the tier's render size (cost/costBench.ts).
//   · The bench runs one frame per frame callback on the UI thread, its state in a SharedValue that only the UI thread
//     touches after it is made there. When it is done the body goes to the lab through CostReportContext, once, and the
//     frames stop; a failure (no performance.now, a builder throw, no offscreen surface, an effect that cannot draw) goes
//     the same way as an ERROR, never a RESULT.
//   · It says which surface it measures (UI-223): `ready` while the field effect, and for .heavy and .empty the
//     calibration effect, is ready; else `fallback` with the reason.
//   · Why it waits for no first-draw signal (RA-50, which the witness and grain scenes answer through FieldSurfaceDrawReport):
//     it mounts no FieldSurface and no FieldView, so there is no on-screen field that could fail to draw, and its stage is
//     blank by design. A cost shot is judged by its RESULT (the plan's `result` proof, costCapturePlan.test.ts), and a
//     RESULT exists only after the bench rendered every recorded frame offscreen and read pixels back; a surface that
//     never draws is "no offscreen surface", an ERROR. surfaceFirstDraw.test.tsx pins both.
// Informational only: DEC-082 is open, and nothing here judges a number.

import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { runOnJS, useFrameCallback, useSharedValue, type FrameInfo } from 'react-native-reanimated';
import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { fieldEffect } from '../../v2/field/effect';
import { benchBody, benchFrame, benchStart, costBenchConfig, type BenchState } from '../cost/costBench';
import { CostReportContext, type CostResultBody } from '../cost/costResult';
import { costSceneSpec } from '../cost/costScenes';
import { makeCalibrationEffect } from '../cost/heavyShader';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';
import { ShaderReportContext } from '../shaderReport';
import { useMeasuredView } from './useMeasuredView';

export const COST_SCENE_PROBES = ['stage'] as const;

type Measured = { readonly status: 'ready'; readonly effect: SkRuntimeEffect } | { readonly status: 'fallback'; readonly reason: string };

export function CostScene({ params }: SceneProps) {
  const spec = costSceneSpec(params.scene);
  const { size, onLayout } = useMeasuredView();
  const report = useContext(ShaderReportContext);
  const sink = useContext(CostReportContext);
  const [field] = useState(fieldEffect);
  const [measured] = useState<Measured>(() => {
    if (field.status !== 'ready') return { status: 'fallback', reason: field.reason };
    if (spec.variant === 'heavy' || spec.variant === 'empty') return makeCalibrationEffect(Skia, spec.variant);
    return { status: 'ready', effect: field.effect };
  });
  const reason = measured.status === 'fallback' ? measured.reason : null;
  useLayoutEffect(() => {
    report?.({ status: measured.status, reason });
  }, [report, measured.status, reason]);

  // One report per mount: the body, or the reason there is none.
  const [ended, setEnded] = useState(false);
  const reported = useRef(false);
  const onError = useCallback((message: string) => {
    if (reported.current) return;
    reported.current = true;
    setEnded(true);
    sink?.error(message);
  }, [sink]);
  const onDone = useCallback((body: CostResultBody) => {
    if (reported.current) return;
    reported.current = true;
    setEnded(true);
    sink?.result(body);
  }, [sink]);
  useEffect(() => {
    if (measured.status === 'fallback') onError(measured.reason);
  }, [measured, onError]);

  const config = useMemo(() => {
    if (size === null || measured.status !== 'ready' || field.status !== 'ready') return null;
    return costBenchConfig({
      spec, width: size.width, height: size.height, pxPerDp: PixelRatio.get(), fontScale: PixelRatio.getFontScale(),
      skia: Skia, effect: measured.effect, blueNoise: field.blueNoiseShader,
    });
  }, [spec, size, measured, field]);

  const bench = useSharedValue<BenchState | null>(null);
  const finished = useSharedValue(false);
  // A new config (a new layout) starts the bench again.
  useEffect(() => {
    bench.value = null;
  }, [bench, config]);

  const onFrame = useCallback((info: FrameInfo) => {
    'worklet';
    if (config === null || finished.value) return;
    let s = bench.value;
    if (s === null) {
      s = benchStart(config);
      bench.value = s;
    }
    benchFrame(s, config, info.timestamp);
    if (s.phase === 'error') {
      finished.value = true;
      runOnJS(onError)(s.error ?? 'the bench failed');
    } else if (s.phase === 'done') {
      finished.value = true;
      let body: CostResultBody | null = null;
      let failure = '';
      try {
        body = benchBody(s);
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      if (body === null) runOnJS(onError)(failure);
      else runOnJS(onDone)(body);
    }
  }, [config, bench, finished, onDone, onError]);

  const frame = useFrameCallback(onFrame, false);
  const running = config !== null && !ended;
  useEffect(() => {
    frame.setActive(running);
  }, [frame, running]);

  return (
    <Probe id="stage" style={styles.stage}>
      <View testID="cost-scene.view" style={styles.stage} onLayout={onLayout} />
    </Probe>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
});
