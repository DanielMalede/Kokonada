// FieldView (T12; architect rerule §4 item 12, T5 r1 §5; reconciliation T5 r1): state → frame. It runs the
// placement ledger and the builder on the UI thread, one step per frame (fieldDriver.ts), and hands the
// packed frame to FieldSurface (frame → pixels).
//
// Its contract:
//   · seq is FieldView's (fork B): only its JS side writes the ledger's input, bumping seq when the `taps`
//     prop's reference changes; the ledger reads by value, so a root that rebuilds the array every render
//     changes nothing. Seq and the ledger share one lifetime, so a stale or backwards seq cannot happen;
//   · it is keyed by direction, face and scene: a switch mounts a fresh ledger (its first input is shown at
//     once), never a bumped seq. The face is in the key because the ledger's rest table is the face's;
//   · every frame input is a prop, measured by the root: the layout in dp, pxPerDp, the tier and
//     renderScale (default: the tier's). No Dimensions or PixelRatio reads, no hidden tier logic (fork 2);
//   · the statics come as a prop, memoised by the root, once per direction (fork 1, 1C);
//   · the builder runs exactly once per drawn frame, and the JS thread never reads the ledger per frame: JS hears
//     only of a start (onStart, the CTA's admitted count), the still tier's stop, and a failure;
//   · a builder throw, or an effect that cannot draw, switches to FieldFallback for the mount's life. It draws from the
//     props as given (T13, the designer's Q2 and Q5): the taps, the layout as measured (every quiet rect, no clamp),
//     pxPerDp and each presence unsanitised;
//   · the still tier (reduced motion) draws the still, runs one fadeReduced ramp per change and its frames
//     until the spacing since that start has passed (L19: the next change then starts on its first frame),
//     then stops its frames until an input changes; the moving tiers run every frame. A stop is decided on the UI
//     thread and lands on JS later, so it carries the wake generation it was decided in, and JS drops one from
//     an earlier generation: a change that wakes the field before a stale stop lands is never lost (RA-22);
//   · the frame cap (UI-171): a frame is drawn only when the tier's cap (field.tiers.<tier>.fpsCap) allows it
//     (capFrame); a skipped frame does no work at all. The first frame of the mount, after a tier change or after a
//     wake is always drawn. The field clock runs on its own frame callback and the ledger takes each drawn frame's own
//     timestamp, so a skipped frame's time is never lost and the motion's speed does not depend on the cap.
//
// The breath: the `breathPhase` SharedValue when the root runs the phaser, else the breath at the clock's
// time (fixedFieldBreath), as the lab's fixed clocks draw it.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { runOnJS, useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';
import type { FieldClock } from '../clock/fieldClock.ts';
import type { MotionTier } from '../motion/useMotionPolicy.ts';
import type { DirectionId, Face } from '../tokens/tokens.generated.ts';
import { fieldEffect } from './effect.ts';
import { FieldFallback } from './FieldFallback.tsx';
import { fixedFieldBreath, type FieldGeometry, type FieldStatics } from './fieldFrame.ts';
import { FieldSurface } from './FieldSurface.tsx';
import { capFrame, fieldStep, frameCapStart, renderGeometry, renderScaleFor, renderSize, type FieldLayout, type FrameCap, type FrameParams } from './fieldDriver.ts';
import { emptyLedger, type Ledger, type LedgerInput, type Tap } from './placementLedger.ts';
import { ledgerConfigFor } from './statics.ts';

export interface FieldViewProps {
  readonly direction: DirectionId;
  readonly face: Face;
  /** The lab's scene, or the screen: part of the key, so a switch mounts a fresh ledger. */
  readonly scene?: string;
  /** The direction's statics, memoised by the root (statics.ts). */
  readonly statics: FieldStatics;
  /** The cold lane's taps on the unit disc, y up, oldest first. */
  readonly taps: readonly Tap[];
  readonly layout: FieldLayout;
  /** Device px per dp, measured by the root. */
  readonly pxPerDp: number;
  readonly tier: MotionTier;
  /** Default: the tier's (field.tiers; the still draws at full's). */
  readonly renderScale?: number;
  readonly stress: number;
  readonly confidence: number | null;
  readonly genesis: boolean;
  readonly clock: FieldClock;
  readonly breathPhase?: SharedValue<number>;
  /** Each quiet zone's presence, by slot (QUIET_ZONE). */
  readonly quietPresence?: readonly number[];
  /** A crossfade started: how many changes it admitted. Called on the JS thread, only at starts. */
  readonly onStart?: (admitted: number) => void;
}

interface FrameInputs {
  readonly params: FrameParams;
  readonly geometry: FieldGeometry;
  readonly statics: FieldStatics;
}

export function FieldView(props: FieldViewProps) {
  return <FieldViewMount key={`${props.direction}|${props.face}|${props.scene ?? ''}`} {...props} />;
}

function FieldViewMount(props: FieldViewProps) {
  const { direction, face, statics, taps, layout, pxPerDp, tier, stress, confidence, genesis, clock, breathPhase, quietPresence, onStart } = props;
  const renderScale = props.renderScale ?? renderScaleFor(tier);
  const geometry = renderGeometry(layout, pxPerDp, renderScale);
  const size = renderSize(layout, pxPerDp, renderScale);
  const params: FrameParams = { direction, face, stress, confidence, genesis, tier, quietPresence };

  const [effect] = useState(fieldEffect);
  const [failure, setFailure] = useState<string | null>(effect.status === 'fallback' ? effect.reason : null);
  const [awake, setAwake] = useState(true);

  // The ledger lives on the UI thread for the mount's life; JS makes it once and never reads it again.
  const [first] = useState<Ledger>(() => emptyLedger(ledgerConfigFor(direction, face, statics, geometry)));
  const ledger = useSharedValue<Ledger>(first);
  const input = useSharedValue<LedgerInput>({ seq: 0, taps });
  const inputs = useSharedValue<FrameInputs>({ params, geometry, statics });
  const uniforms = useSharedValue<readonly number[] | null>(null);
  const asleep = useSharedValue(false);
  const cap = useSharedValue<FrameCap>(frameCapStart());
  // The wake generation (resilience T10 RA-22): wake() moves it on, here and on the UI thread. A stop carries the
  // generation the UI thread decided it in and is applied only while that is still the current one.
  const generation = useSharedValue(0);
  const currentGeneration = useRef(0);

  const wake = useCallback(() => {
    currentGeneration.current += 1;
    generation.value = currentGeneration.current;
    asleep.value = false;
    setAwake(true);
  }, [asleep, generation]);

  const sleep = useCallback((decidedIn: number) => {
    if (decidedIn === currentGeneration.current) setAwake(false);
  }, []);

  // Fork B: a new taps reference bumps seq; the ledger decides by value whether anything changed.
  const seq = useRef(0);
  const shownTaps = useRef(taps);
  useEffect(() => {
    if (shownTaps.current === taps) return;
    shownTaps.current = taps;
    seq.current += 1;
    input.value = { seq: seq.current, taps };
    wake();
  }, [taps, input, wake]);

  // Every other input, written when a prop changes (never per frame), and the still woken to redraw. Keyed
  // on the props themselves: FieldView's own re-renders (the still's stop) must not wake it again.
  const mounted = useRef(false);
  useEffect(() => {
    inputs.value = { params, geometry, statics };
    if (mounted.current) wake();
    mounted.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params and geometry are made from exactly these props
  }, [direction, face, stress, confidence, genesis, tier, quietPresence, statics, layout, pxPerDp, renderScale, inputs, wake]);

  const onFrame = useCallback((info: FrameInfo) => {
    'worklet';
    const f = inputs.value;
    const gate = capFrame(cap.value, info.timestamp, f.params.tier, generation.value);
    cap.value = gate.cap;
    if (!gate.draw) return;
    const tMs = clock.t.value;
    const phase = breathPhase === undefined ? fixedFieldBreath(f.params.direction, f.params.stress, tMs).phase : breathPhase.value;
    const step = fieldStep(ledger.value, input.value, info.timestamp, f.params, f.geometry, f.statics, tMs, phase);
    ledger.value = step.ledger;
    if (step.error !== null) {
      uniforms.value = null;
      runOnJS(setFailure)(step.error);
      return;
    }
    uniforms.value = step.uniforms;
    if (step.started && onStart !== undefined) runOnJS(onStart)(step.ledger.admitted);
    if (step.idle && !asleep.value) {
      asleep.value = true;
      runOnJS(sleep)(generation.value);
    }
  }, [inputs, cap, clock, breathPhase, ledger, input, uniforms, asleep, generation, sleep, onStart]);

  const frame = useFrameCallback(onFrame, false);
  const running = failure === null && (tier !== 'still' || awake);
  useEffect(() => {
    frame.setActive(running);
  }, [frame, running]);

  if (failure !== null || effect.status !== 'ready') {
    return (
      <FieldFallback
        direction={direction}
        face={face}
        statics={statics}
        taps={taps}
        layout={layout}
        pxPerDp={pxPerDp}
        quietPresence={quietPresence}
        reason={failure ?? 'the field effect is not ready'}
      />
    );
  }
  return (
    <FieldSurface
      uniforms={uniforms}
      effect={effect.effect}
      blueNoise={effect.blueNoiseShader}
      width={layout.width}
      height={layout.height}
      renderSize={size}
      pxPerDp={pxPerDp}
      renderScale={renderScale}
    />
  );
}
