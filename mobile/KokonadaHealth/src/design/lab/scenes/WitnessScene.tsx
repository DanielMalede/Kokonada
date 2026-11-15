// The colour-path witness scene (B8-2; the architect's B8 plan; B4 fork 2E): known frames and paints on one stage, so a
// device grab can show that the token hex reaches the screen unchanged by every path the app draws with (ADR-0017,
// pending: sRGB-encoded, unmanaged, 8-bit). What it draws and where is witnessFrames.ts and witnessLayout.ts:
//   · W1b, the production one.joy frame, over the whole stage, through FieldSurface;
//   · W1a, each colour's own frame through FieldSurface, in its patch;
//   · W2 and the planted patches, as Skia paints in one sRGB canvas over the stage;
//   · W3, as React Native Views: the only Views here that paint a colour.
// It is its own composition root, as FieldScene is: it measures, and draws only once its view has a size (UI-175). It
// never mounts FieldView (the witness needs no ledger, and FieldView takes no lab-only knob) and never imports scenes.ts,
// so its closure reaches FieldSurface and not FieldView. It reports which surface drew it (UI-223): `ready` while the
// process's one field effect is ready, else `fallback` with the effect's reason, and then it draws no field at all.
//
// Where it draws (the designer's witness BLOCK, dry run 2026-11-15): React Native on Android swaps left and right under
// RTL, which mirrored W1a and W3 onto the canvas's patches, so the stage is laid out left to right whatever the locale
// (`direction: 'ltr'`), as the canvas draws. The patches sit inside the capture region (witnessInsets.ts), and the scene
// proves both on the device: a probe for that region and for every W1a and W3 patch (witnessProbes.ts), placed even when
// it falls back, so READY always comes and says what drew it.

import React, { useContext, useLayoutEffect, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Canvas, Rect } from '@shopify/react-native-skia';
import { useSharedValue } from 'react-native-reanimated';
import { fieldEffect } from '../../v2/field/effect';
import { renderSize } from '../../v2/field/fieldDriver';
import { FieldSurface } from '../../v2/field/FieldSurface';
import { packFrame } from '../../v2/field/uniforms';
import type { LabParams } from '../params';
import { Probe } from '../probe/Probe';
import { ShaderReportContext } from '../shaderReport';
import { w1aFrame, w1bFrame, witnessColours, witnessFace, type WitnessColour } from '../witness/witnessFrames';
import { witnessInsets } from '../witness/witnessInsets';
import { witnessLayout, type Rect as PatchRect, type WitnessLayout, type WitnessPatch } from '../witness/witnessLayout';
import { PROBED_KINDS, WITNESS_PROBES, witnessProbeId } from '../witness/witnessProbes';
import { useMeasuredView } from './useMeasuredView';

export const WITNESS_SCENE_PROBES: readonly string[] = WITNESS_PROBES;

type ReadyEffect = Extract<ReturnType<typeof fieldEffect>, { status: 'ready' }>;

/** A lab scene's props, of which it reads only the launch's params: it never imports scenes.ts. */
export function WitnessScene({ params }: { readonly params: LabParams }) {
  const face = witnessFace(params.scene);
  const { size, onLayout } = useMeasuredView();
  const pxPerDp = PixelRatio.get();
  const fontScale = PixelRatio.getFontScale();
  const [insets] = useState(witnessInsets);
  const layout = useMemo(() => (size === null ? null : witnessLayout(face, size.width, size.height, pxPerDp, fontScale, insets)), [face, size, pxPerDp, fontScale, insets]);
  const report = useContext(ShaderReportContext);
  const [effect] = useState(fieldEffect);
  const reason = effect.status === 'fallback' ? effect.reason : null;
  useLayoutEffect(() => {
    report?.({ status: effect.status, reason });
  }, [report, effect.status, reason]);
  return (
    <Probe id="stage" style={styles.stage}>
      <View testID="witness-scene.view" style={styles.stage} onLayout={onLayout}>
        {layout === null ? <UnplacedProbes /> : <Probe id="region" style={at(layout.region)} />}
        {layout !== null && (effect.status === 'ready' ? <Witness layout={layout} effect={effect} /> : <PatchProbes layout={layout} />)}
      </View>
    </Probe>
  );
}

function Witness({ layout, effect }: { layout: WitnessLayout; effect: ReadyEffect }) {
  const colours = witnessColours(layout.face);
  const colourOf = (name: string) => colours.find((c) => c.name === name) as WitnessColour;
  const painted = layout.patches.filter((p) => p.kind !== 'W1a' && p.kind !== 'W3');
  return (
    <>
      <W1b layout={layout} effect={effect} />
      {layout.patches.filter((p) => p.kind === 'W1a').map((p) => (
        <PatchProbe key={p.colour} patch={p}>
          <W1a rect={p.rect} colour={colourOf(p.colour)} layout={layout} effect={effect} />
        </PatchProbe>
      ))}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Canvas style={styles.fill} colorSpace="srgb">
          {painted.map((p) => <Rect key={`${p.kind}.${p.colour}`} x={p.rect.x} y={p.rect.y} width={p.rect.width} height={p.rect.height} color={p.paint as string} />)}
        </Canvas>
      </View>
      {layout.patches.filter((p) => p.kind === 'W3').map((p) => (
        <PatchProbe key={p.colour} patch={p}>
          <View testID={`witness.W3.${p.colour}`} pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colourOf(p.colour).hex }]} />
        </PatchProbe>
      ))}
    </>
  );
}

/** A probed patch's own View, where the layout puts it: what READY's probe of the patch measures. */
function PatchProbe({ patch, children }: { patch: WitnessPatch; children?: React.ReactNode }) {
  return <Probe id={witnessProbeId(patch.kind, patch.colour)} style={at(patch.rect)}>{children}</Probe>;
}

/** The fallback draws no patch, yet places every probe, so READY is sent and says the shader did not draw. */
function PatchProbes({ layout }: { layout: WitnessLayout }) {
  const probed = layout.patches.filter((p) => (PROBED_KINDS as readonly string[]).includes(p.kind));
  return <>{probed.map((p) => <PatchProbe key={`${p.kind}.${p.colour}`} patch={p} />)}</>;
}

/** Every declared probe is rendered at all times (READY waits for each, scenes.test.tsx): 0 × 0 until the layout places it. */
function UnplacedProbes() {
  return <>{WITNESS_PROBES.filter((id) => id !== 'stage').map((id) => <Probe key={id} id={id} style={at(UNPLACED)} />)}</>;
}

function W1b({ layout, effect }: { layout: WitnessLayout; effect: ReadyEffect }) {
  const w1b = useMemo(() => w1bFrame(layout.face, layout.field, layout.pxPerDp, layout.renderScale), [layout]);
  const uniforms = useSharedValue<readonly number[] | null>(w1b.uniforms);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <FieldSurface
        uniforms={uniforms}
        effect={effect.effect}
        blueNoise={effect.blueNoiseShader}
        width={layout.width}
        height={layout.height}
        renderSize={renderSize(layout.field, layout.pxPerDp, w1b.renderScale)}
        pxPerDp={layout.pxPerDp}
        renderScale={w1b.renderScale}
      />
    </View>
  );
}

function W1a({ rect, colour, layout, effect }: { rect: PatchRect; colour: WitnessColour; layout: WitnessLayout; effect: ReadyEffect }) {
  const renderScale = layout.renderScale;
  const size = renderSize({ ...layout.field, width: rect.width, height: rect.height }, layout.pxPerDp, renderScale);
  const uniforms = useSharedValue<readonly number[] | null>(packFrame(w1aFrame(layout.face, colour, size)));
  return (
    <View testID={`witness.W1a.${colour.name}`} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <FieldSurface
        uniforms={uniforms}
        effect={effect.effect}
        blueNoise={effect.blueNoiseShader}
        width={rect.width}
        height={rect.height}
        renderSize={size}
        pxPerDp={layout.pxPerDp}
        renderScale={renderScale}
      />
    </View>
  );
}

const UNPLACED: PatchRect = { x: 0, y: 0, width: 0, height: 0 };
const at = (r: PatchRect) => ({ position: 'absolute' as const, left: r.x, top: r.y, width: r.width, height: r.height });

const styles = StyleSheet.create({
  // Left to right whatever the locale: React Native would mirror every `left` under RTL, and the canvas never mirrors.
  stage: { flex: 1, direction: 'ltr' },
  fill: { flex: 1 },
});
