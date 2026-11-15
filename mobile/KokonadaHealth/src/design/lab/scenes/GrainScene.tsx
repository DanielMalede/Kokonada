// A lab grain scene (B8-4; UI-092; the grain gate of the second critic, v1b-B4-second-critic.md §3): the hero's rest field,
// drawn three times side by side through FieldSurface (the shipped surface: its render target, the bilinear upscale and the
// sRGB canvas), its grain at ×1, ×0.71 and ×0.5 of the token, left to right (grain/grainFrames.ts). Never FieldView, which
// takes no lab-only knob: the frame is FieldView's first frame of the rest scene, made by the same fieldStep.
//
// The layout, so that one phone screen answers "which grain": three strips, each a third of the view wide (in whole device
// pixels) and its full height, and each showing the SAME window of the field, its left third: the ground, the ring and the
// lens edge under the vignette (the surface the gate names for Abyss), from the top bar to the nav. So the strips are the
// same picture three times, with the same blue-noise pixels, and the only thing that changes from one strip to the next is
// the grain's amplitude; the seams between them are where the window starts again. No labels: the order is fixed and each
// strip is a probe named by its strength (grain.x1.00, grain.x0.71, grain.x0.50).
//
// It measures, and mounts what it draws only once its view has a size (UI-175). The stage and the three strips are its
// probes; no React Native View paints a colour (UI-204). It says which surface drew it (UI-223, shaderReport.ts): `ready`
// while the field effect is ready and the builder takes the scene's layout; otherwise `fallback` with the reason, and it
// draws FieldFallback over the stage instead, as FieldView would.

import React, { useContext, useLayoutEffect, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import type { FieldClock } from '../../v2/clock/fieldClock';
import { fieldEffect } from '../../v2/field/effect';
import { heroLayout } from '../../v2/field/fallbackScenes';
import { FieldFallback } from '../../v2/field/FieldFallback';
import { renderGeometry, renderSize, type FieldLayout, type FrameParams } from '../../v2/field/fieldDriver';
import type { FieldGeometry } from '../../v2/field/fieldFrame';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { emptyLedger, type Ledger } from '../../v2/field/placementLedger';
import { ledgerConfigFor } from '../../v2/field/statics';
import { FIELD_STATICS } from '../fieldScenes';
import { GRAIN_FACTORS, grainBase, grainParams, grainProbeId, grainSpec, scaleGrain, stripWidth } from '../grain/grainFrames';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';
import { ShaderReportContext } from '../shaderReport';
import { useMeasuredView } from './useMeasuredView';

export const GRAIN_SCENE_PROBES: readonly string[] = ['stage', ...GRAIN_FACTORS.map(grainProbeId)];

const NO_TAPS: [] = [];

interface Setup {
  readonly layout: FieldLayout;
  readonly geometry: FieldGeometry;
  readonly ledger: Ledger;
  readonly params: FrameParams;
  /** A strip's width in dp, and its render target in render px: the view's left third. */
  readonly width: number;
  readonly target: { readonly width: number; readonly height: number };
  /** The builder's throw on this layout, or null. */
  readonly error: string | null;
}

export function GrainScene({ clock, params }: SceneProps) {
  const spec = grainSpec(params.scene);
  const { size, onLayout } = useMeasuredView();
  const pxPerDp = PixelRatio.get();
  const fontScale = PixelRatio.getFontScale();
  const [effect] = useState(fieldEffect);
  const setup = useMemo((): Setup | null => {
    if (size === null) return null;
    const layout = heroLayout(spec.direction, size.width, size.height, fontScale);
    const geometry = renderGeometry(layout, pxPerDp, spec.renderScale);
    const ledger = emptyLedger(ledgerConfigFor(spec.direction, spec.face, FIELD_STATICS, geometry));
    const frameParams = grainParams(spec);
    const width = stripWidth(size.width, pxPerDp);
    const target = renderSize({ ...layout, width }, pxPerDp, spec.renderScale);
    // The rest scene's frame depends on t only through its motion, never its validity: one build on the JS thread says
    // whether the builder takes this layout at all.
    const error = grainBase(ledger, frameParams, geometry, FIELD_STATICS, 0).error;
    return { layout, geometry, ledger, params: frameParams, width, target, error };
  }, [spec, size, pxPerDp, fontScale]);

  const report = useContext(ShaderReportContext);
  const reason = effect.status !== 'ready' ? effect.reason : (setup?.error ?? null);
  const status = reason === null ? 'ready' : 'fallback';
  useLayoutEffect(() => {
    report?.({ status, reason });
  }, [report, status, reason]);

  // Every declared probe is rendered at all times (READY waits for each, scenes.test.tsx): the strips are 0 wide until the
  // view is measured, and empty while the scene falls back, so READY still comes and says `fallback`.
  let strips: React.ReactNode = <StripProbes width={setup?.width ?? 0} height={setup?.layout.height ?? 0} />;
  let fallback: React.ReactNode = null;
  if (setup !== null && effect.status === 'ready' && setup.error === null) {
    strips = <GrainStrips clock={clock} setup={setup} effect={effect} pxPerDp={pxPerDp} renderScale={spec.renderScale} />;
  } else if (setup !== null) {
    fallback = (
      <View style={StyleSheet.absoluteFill}>
        <FieldFallback
          direction={spec.direction}
          face={spec.face}
          statics={FIELD_STATICS}
          taps={NO_TAPS}
          layout={setup.layout}
          pxPerDp={pxPerDp}
          reason={reason ?? 'the field effect is not ready'}
        />
      </View>
    );
  }
  return (
    <Probe id="stage" style={styles.stage}>
      <View testID="grain-scene.view" style={styles.stage} onLayout={onLayout}>
        {fallback}
        {strips}
      </View>
    </Probe>
  );
}

/** The three strip probes, left to right by strength, each holding what it draws (nothing until the scene is ready). */
function StripProbes({ width, height, children }: { width: number; height: number; children?: readonly React.ReactNode[] }) {
  return (
    <View style={styles.row}>
      {GRAIN_FACTORS.map((k, i) => (
        <Probe key={grainProbeId(k)} id={grainProbeId(k)} style={{ width, height }}>
          {children?.[i] ?? null}
        </Probe>
      ))}
    </View>
  );
}

type ReadyEffect = Extract<ReturnType<typeof fieldEffect>, { status: 'ready' }>;

interface StripsProps {
  readonly clock: FieldClock;
  readonly setup: Setup;
  readonly effect: ReadyEffect;
  readonly pxPerDp: number;
  readonly renderScale: number;
}

/** One frame at the clock's time, on the UI thread, and a strip of it at each strength: all four from one t. */
function GrainStrips({ clock, setup, effect, pxPerDp, renderScale }: StripsProps) {
  const { ledger, params, geometry } = setup;
  const statics = FIELD_STATICS;
  const base = useDerivedValue(() => grainBase(ledger, params, geometry, statics, clock.t.value).uniforms, [ledger, params, geometry, statics, clock]);
  const strips = [useStrip(base, GRAIN_FACTORS[0]), useStrip(base, GRAIN_FACTORS[1]), useStrip(base, GRAIN_FACTORS[2])];
  return (
    <StripProbes width={setup.width} height={setup.layout.height}>
      {strips.map((uniforms, i) => (
        <FieldSurface
          key={grainProbeId(GRAIN_FACTORS[i])}
          uniforms={uniforms}
          effect={effect.effect}
          blueNoise={effect.blueNoiseShader}
          width={setup.width}
          height={setup.layout.height}
          renderSize={setup.target}
          pxPerDp={pxPerDp}
          renderScale={renderScale}
        />
      ))}
    </StripProbes>
  );
}

function useStrip(base: Readonly<SharedValue<number[] | null>>, factor: number): SharedValue<readonly number[] | null> {
  return useDerivedValue(() => {
    const u = base.value;
    return u === null ? null : scaleGrain(u, factor);
  }, [base, factor]) as SharedValue<readonly number[] | null>;
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
  row: { flexDirection: 'row' },
});
