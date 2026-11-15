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
//   · It says which surface drew it (UI-223): `ready` while the process's one field effect (memoised in effect.ts) is
//     ready, else `fallback` with the effect's reason, and `fallback` with FieldFallback's reason once FieldView has
//     switched to it (a builder throw on the UI thread). It listens through FieldFallbackReport: FieldView itself takes
//     no lab-only knob.
//   · `ready` means FieldView drew (UI-233, RA-44): until FieldView's first drawn frame of the current scene (told through
//     FieldFirstFrameReport, once per mount) a ready effect reports `pending`, so a blank stage never passes as the field.
//     The signal names the scene it was given for: a late one from an earlier scene's mount counts for nothing.
//   · The tier (B8-6): an id-tier scene draws at the tier its id names; a policy scene (`….policy`) at the tier the app's
//     motion policy gives, useMotionPolicy on the device's reduced-motion and battery-saver settings (the ports LabRoot
//     provides through LabMotionPortsContext), handed to FieldView through its own `tier` prop, as the app's root gives
//     it: FieldView takes no new prop. The scene tells LabRoot the tier it observed (SceneFactsContext) for READY, and
//     only once the policy has answered: until both settings were heard and the policy's tier is the one they give,
//     the policy's cautious still is not the device's answer, and the scene says the tier is not known yet.

import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { fieldEffect } from '../../v2/field/effect';
import { FieldFallbackReport } from '../../v2/field/fallbackReport';
import { FieldFirstFrameReport } from '../../v2/field/firstFrameReport';
import { FieldView } from '../../v2/field/FieldView';
import type { MotionPorts, SignalSource } from '../../v2/motion/ports';
import { resolveMotionTier, useMotionPolicy, type MotionTier } from '../../v2/motion/useMotionPolicy';
import { FIELD_STATICS, fieldSceneLayout, sceneSpec, type FieldSceneSpec } from '../fieldScenes';
import { Probe } from '../probe/Probe';
import type { SceneProps } from '../scenes';
import { ShaderReportContext } from '../shaderReport';
import { useMeasuredView } from './useMeasuredView';

export const FIELD_SCENE_PROBES = ['stage'] as const;

/** What a scene observed, for READY (B8-6): the tier FieldView draws at, or null while it is not known yet. */
export type SceneFacts = { readonly tier: MotionTier | null };
/** LabRoot listens: a scene that reports a null tier holds READY, and a known tier that changes after READY is an ERROR. */
export const SceneFactsContext = createContext<((facts: SceneFacts) => void) | null>(null);
/** The device's reduced-motion and battery-saver settings as the motion policy's ports; LabRoot provides them, once. */
export const LabMotionPortsContext = createContext<MotionPorts | null>(null);

const STRESS = 0;
const CONFIDENCE = 1;
const GENESIS = false;

type Heard = { reduceMotion: boolean | null; powerSave: boolean | null };

/**
 * The ports, passed through to the policy, with what each setting last said. A late read after a change event is not
 * kept, as the policy does not keep it. The policy's tier is known once both settings were heard and it is the tier they
 * give (resolveMotionTier, the policy's own table): a render between a setting's answer and the policy's catching up
 * says not known, never a stale tier.
 */
function observedPorts(ports: MotionPorts) {
  const heard: Heard = { reduceMotion: null, powerSave: null };
  const tap = (key: keyof Heard, source: SignalSource): SignalSource => {
    let changed = false;
    return {
      read: () => source.read().then((value) => {
        if (!changed) heard[key] = value;
        return value;
      }),
      subscribe: (onChange) => source.subscribe((value) => {
        changed = true;
        heard[key] = value;
        onChange(value);
      }),
    };
  };
  return {
    ports: { reduceMotion: tap('reduceMotion', ports.reduceMotion), powerSave: tap('powerSave', ports.powerSave) } as MotionPorts,
    known(tier: MotionTier): MotionTier | null {
      const { reduceMotion, powerSave } = heard;
      if (reduceMotion === null || powerSave === null) return null;
      return resolveMotionTier({ reduceMotion, powerSave }) === tier ? tier : null;
    },
  };
}

export function FieldScene(props: SceneProps) {
  const spec = sceneSpec(props.params.scene, 'field');
  return spec.policy ? <PolicyFieldScene {...props} spec={spec} /> : <FieldStage {...props} spec={spec} tier={spec.tier} observed={spec.tier} />;
}

/** A policy scene: the tier is the motion policy's, on the device's settings, as the app's root would take it. */
function PolicyFieldScene({ spec, ...props }: SceneProps & { spec: FieldSceneSpec }) {
  const ports = useContext(LabMotionPortsContext);
  if (ports === null) throw new Error(`lab scene "${spec.id}" takes its tier from the motion policy, but no LabRoot gave it the device's settings`);
  const [observed] = useState(() => observedPorts(ports));
  const tier = useMotionPolicy(observed.ports);
  return <FieldStage {...props} spec={spec} tier={tier} observed={observed.known(tier)} />;
}

function FieldStage({ clock, spec, tier, observed }: SceneProps & {
  spec: FieldSceneSpec;
  /** The tier FieldView draws at. */
  tier: MotionTier | null;
  /** The tier READY may say, or null while it is not known. */
  observed: MotionTier | null;
}) {
  const { size, onLayout } = useMeasuredView();
  const layout = useMemo(
    () => (size === null ? null : fieldSceneLayout(spec, size.width, size.height, PixelRatio.getFontScale())),
    [spec, size],
  );
  const report = useContext(ShaderReportContext);
  const facts = useContext(SceneFactsContext);
  useLayoutEffect(() => {
    facts?.({ tier: observed });
  }, [facts, observed]);
  const [effect] = useState(fieldEffect);
  // FieldFallback's reason, bound to the scene it fell back in, as the drawn frame is: a scene change mounts a fresh
  // FieldView, and an earlier scene's fallback says nothing about it.
  const [fallen, setFallen] = useState<{ readonly scene: string; readonly reason: string } | null>(null);
  const setFellBack = useCallback((r: string) => setFallen({ scene: spec.id, reason: r }), [spec.id]);
  const fellBack = fallen !== null && fallen.scene === spec.id ? fallen.reason : null;
  const status = fellBack !== null ? 'fallback' : effect.status;
  const reason = fellBack ?? (effect.status === 'fallback' ? effect.reason : null);
  // The scene whose FieldView has drawn its first frame: re-armed by every scene, since the signal is bound to its own.
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
  const stage = (
    <Probe id="stage" style={styles.stage}>
      <View testID="field-scene.view" style={styles.stage} onLayout={onLayout}>
        {layout !== null && tier !== null && (
          <FieldFirstFrameReport.Provider value={onFirstFrame}>
            <FieldView
              direction={spec.direction}
              face={spec.face}
              scene={spec.id}
              statics={FIELD_STATICS}
              taps={spec.taps}
              layout={layout}
              pxPerDp={PixelRatio.get()}
              tier={tier}
              stress={STRESS}
              confidence={CONFIDENCE}
              genesis={GENESIS}
              clock={clock}
            />
          </FieldFirstFrameReport.Provider>
        )}
      </View>
    </Probe>
  );
  return <FieldFallbackReport.Provider value={setFellBack}>{stage}</FieldFallbackReport.Provider>;
}

const styles = StyleSheet.create({
  stage: { flex: 1 },
});
