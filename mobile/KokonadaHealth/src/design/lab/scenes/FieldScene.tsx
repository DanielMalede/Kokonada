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
//   · A setting that cannot be read (UI-241): a read the platform refuses, before any change event answered the setting,
//     leaves it unanswered for good (the policy keeps its cautious still), so the tier can never be known. The scene
//     then says which setting and why (SceneFacts.unreadable), once, the first refusal; LabRoot sends an ERROR naming it
//     instead of holding READY until the harness times out. A read that never settles at all is not seen here.

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

/**
 * What a scene observed, for READY (B8-6): the tier FieldView draws at, or null while it is not known yet; and, when a
 * setting the tier needs cannot be read (UI-241), which one and why: the tier will never be known.
 */
export type SceneFacts = { readonly tier: MotionTier | null; readonly unreadable?: string };
/**
 * LabRoot listens: a scene that reports a null tier holds READY, a known tier that changes after READY is an ERROR, and so
 * is a setting the scene says it cannot read.
 */
export const SceneFactsContext = createContext<((facts: SceneFacts) => void) | null>(null);
/** The device's reduced-motion and battery-saver settings as the motion policy's ports; LabRoot provides them, once. */
export const LabMotionPortsContext = createContext<MotionPorts | null>(null);

const STRESS = 0;
const CONFIDENCE = 1;
const GENESIS = false;

type Heard = { reduceMotion: boolean | null; powerSave: boolean | null };
const SETTING_NAMES: Readonly<Record<keyof Heard, string>> = { reduceMotion: 'reduced-motion', powerSave: 'battery-saver' };

/**
 * The ports, passed through to the policy, with what each setting last said. A late read after a change event is not
 * kept, as the policy does not keep it. The policy's tier is known once both settings were heard and it is the tier they
 * give (resolveMotionTier, the policy's own table): a render between a setting's answer and the policy's catching up
 * says not known, never a stale tier.
 */
function observedPorts(ports: MotionPorts, onUnreadable: (why: string) => void) {
  const heard: Heard = { reduceMotion: null, powerSave: null };
  const tap = (key: keyof Heard, source: SignalSource): SignalSource => {
    let changed = false;
    return {
      read: () => {
        const read = source.read();
        // A refusal after a change event answered the setting is ignored, as the policy ignores a late read.
        read.then(undefined, (e: unknown) => {
          if (!changed) onUnreadable(`the device's ${SETTING_NAMES[key]} setting could not be read (${e instanceof Error ? e.message : String(e)})`);
        });
        return read.then((value) => {
          if (!changed) heard[key] = value;
          return value;
        });
      },
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

/**
 * A scene's tier from the app's motion policy on the device's settings (B8-6), as the app's root would take it: the tier
 * to draw at, the tier READY may say (null until the policy has answered), and a setting that could not be read (UI-241).
 * The policy scenes and the hero scene (F10 G8) take their tier this way.
 */
export function usePolicyTier(sceneId: string): { tier: MotionTier; observed: MotionTier | null; unreadable: string | null } {
  const ports = useContext(LabMotionPortsContext);
  if (ports === null) throw new Error(`lab scene "${sceneId}" takes its tier from the motion policy, but no LabRoot gave it the device's settings`);
  // The first setting that could not be read, kept: the tier stays unknown for the mount's life.
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [observed] = useState(() => observedPorts(ports, (why) => setUnreadable((first) => first ?? why)));
  const tier = useMotionPolicy(observed.ports);
  return { tier, observed: observed.known(tier), unreadable };
}

/** A policy scene: the tier is the motion policy's, on the device's settings, as the app's root would take it. */
function PolicyFieldScene({ spec, ...props }: SceneProps & { spec: FieldSceneSpec }) {
  const { tier, observed, unreadable } = usePolicyTier(spec.id);
  return <FieldStage {...props} spec={spec} tier={tier} observed={observed} unreadable={unreadable} />;
}

/**
 * What a scene that draws FieldView tells LabRoot: the tier it observed, or the setting it cannot read (SceneFacts, B8-6
 * and UI-241), and which surface drew it (UI-223): pending until FieldView's first drawn frame of this scene (UI-233,
 * RA-44), then ready, or fallback with the effect's or FieldFallback's reason. Returns the listeners the scene provides:
 * FieldFirstFrameReport's and FieldFallbackReport's. The field scenes and the hero scene (F10 G8) report this way.
 */
export function useFieldSceneReport(sceneId: string, observed: MotionTier | null, unreadable: string | null) {
  const report = useContext(ShaderReportContext);
  const facts = useContext(SceneFactsContext);
  useLayoutEffect(() => {
    facts?.(unreadable === null ? { tier: observed } : { tier: null, unreadable });
  }, [facts, observed, unreadable]);
  const [effect] = useState(fieldEffect);
  // FieldFallback's reason, bound to the scene it fell back in, as the drawn frame is: a scene change mounts a fresh
  // FieldView, and an earlier scene's fallback says nothing about it.
  const [fallen, setFallen] = useState<{ readonly scene: string; readonly reason: string } | null>(null);
  const setFellBack = useCallback((r: string) => setFallen({ scene: sceneId, reason: r }), [sceneId]);
  const fellBack = fallen !== null && fallen.scene === sceneId ? fallen.reason : null;
  const status = fellBack !== null ? 'fallback' : effect.status;
  const reason = fellBack ?? (effect.status === 'fallback' ? effect.reason : null);
  // The scene whose FieldView has drawn its first frame: re-armed by every scene, since the signal is bound to its own.
  const [drawnScene, setDrawnScene] = useState<string | null>(null);
  const onFirstFrame = useCallback(() => setDrawnScene(sceneId), [sceneId]);
  const drawn = drawnScene === sceneId;
  useLayoutEffect(() => {
    if (status === 'ready' && !drawn) {
      report?.({ status: 'pending', reason: null });
      return;
    }
    report?.({ status, reason });
  }, [report, status, reason, drawn]);
  return { onFirstFrame, setFellBack };
}

function FieldStage({ clock, spec, tier, observed, unreadable = null }: SceneProps & {
  spec: FieldSceneSpec;
  /** The tier FieldView draws at. */
  tier: MotionTier | null;
  /** The tier READY may say, or null while it is not known. */
  observed: MotionTier | null;
  /** A setting the tier needs that could not be read, and why (UI-241). */
  unreadable?: string | null;
}) {
  const { size, onLayout } = useMeasuredView();
  const layout = useMemo(
    () => (size === null ? null : fieldSceneLayout(spec, size.width, size.height, PixelRatio.getFontScale())),
    [spec, size],
  );
  const { onFirstFrame, setFellBack } = useFieldSceneReport(spec.id, observed, unreadable);
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
