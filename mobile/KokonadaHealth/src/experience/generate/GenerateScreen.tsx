import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useStore, useSelector } from 'react-redux';
import { RadialWheel } from '../wheel/RadialWheel';
import { BioAura } from '../aura/BioAura';
import { ActivityChips } from './ActivityChips';
import { PromptBox } from './PromptBox';
import { GenerateController, type SocketApi } from './generateController';
import { NeuralAnalysisLoader } from './NeuralAnalysisLoader';
import { generationStatusStore } from './generationStatusStore';
import { useSharedValue } from 'react-native-reanimated';
import { liveModeStore } from './liveModeStore';
import { warmStore } from '../../state/store';
import { playbackSocket } from '../playback/playbackServices';
import type { Tap } from '../../state/cold/emotionSlice';

// The Context & Emotion Input Suite. Composes the bio-aura + radial wheel (hero)
// over the CTA. The hot→cold→socket wiring is the unit-tested GenerateController;
// this component is the surface. submit() now drives the LIVE playbackSocket, so a
// generated playlist flows to the orchestrator and starts playing.
export function GenerateScreen({ socket = playbackSocket }: { socket?: SocketApi }) {
  const store = useStore() as any;
  const { width } = useWindowDimensions();
  const size = Math.min(width - 48, 340);

  const controller = useMemo(
    () => new GenerateController({
      store, warmStore, socket,
      // Live mode owns the queue (band shifts serve the buffer), so the manual CTA yields.
      isLiveMode: () => liveModeStore.getState().liveMode,
    }),
    [store, socket],
  );

  const [taps, setTaps] = useState<Tap[]>([]);
  const [hr, setHr] = useState<number | null>(warmStore.getState().liveHr);
  // Subscribe to live HR in an effect so the subscription is torn down on unmount
  // (a subscribe in render would leak a dead closure on every tab switch — S10-1).
  useEffect(() => {
    setHr(warmStore.getState().liveHr); // reconcile any HR that arrived before mount
    const unsubscribe = warmStore.subscribe((s) => setHr(s.liveHr));
    return unsubscribe;
  }, []);

  const onCommit = useCallback((c: Tap) => {
    controller.commitTap(c);
    setTaps([...store.getState().emotion.taps]);
  }, [controller, store]);

  // Re-render the CTA whenever committed intent changes (activity chip / prompt),
  // so its Generate ↔ Listen-to-heart ↔ disabled state stays truthful.
  const emotion = useSelector((s: any) => s.emotion);
  const mode = controller.ctaMode();

  // The Neural-Analysis Loader overlays the hero while a generation is in flight.
  // `engagement` (0..1 prompt richness) lives in a SharedValue so the animation reads
  // it on the UI thread without a React re-render each keystroke.
  const [generating, setGenerating] = useState(generationStatusStore.getState().generating);
  // Loader copy — set for a Live-mode cold-buffer recalibration ("assembling your live
  // biometric soundscape") so the wait is never silent; null for a normal manual generation.
  const [statusMessage, setStatusMessage] = useState(generationStatusStore.getState().message);
  useEffect(() => {
    const sync = (s: { generating: boolean; message: string | null }) => {
      setGenerating(s.generating);
      setStatusMessage(s.message);
    };
    sync(generationStatusStore.getState());
    return generationStatusStore.subscribe(sync);
  }, []);
  const engagement = useSharedValue(0);
  useEffect(() => {
    const len = emotion.textPrompt?.length ?? 0;
    const base = Math.pow(len / 60, 0.8);
    const extra = (emotion.activity ? 0.2 : 0) + Math.min(0.2, (emotion.taps?.length ?? 0) * 0.08);
    engagement.value = Math.min(1, base + extra);
  }, [emotion, engagement]);

  // Dual-path preference (Part 2b). Manual → this screen drives generation; Live Biometric
  // → HR band shifts drive it from the precompiled buffer. Persisted in liveModeStore.
  const [liveMode, setLiveMode] = useState(liveModeStore.getState().liveMode);
  useEffect(() => {
    setLiveMode(liveModeStore.getState().liveMode);
    return liveModeStore.subscribe((s) => setLiveMode(s.liveMode));
  }, []);
  const label = mode === 'live-tuned'
    ? 'Live-tuned'
    : mode === 'listen-to-heart'
      ? 'Listen to your heart'
      : 'Generate';
  // In Live mode the CTA is a passive indicator — HR band shifts drive the queue, so the
  // manual button must not (both driving at once would fight over the queue).
  const ctaDisabled = mode === 'disabled' || mode === 'live-tuned';

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute' }}><BioAura hr={hr} size={size} /></View>
        <RadialWheel size={size} committedTaps={taps} onCommit={onCommit} />
        {generating ? (
          <View style={{ position: 'absolute' }} pointerEvents="none">
            <NeuralAnalysisLoader active={generating} engagement={engagement} size={size} />
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={() => {
          const next = !liveModeStore.getState().liveMode;
          liveModeStore.getState().setLiveMode(next);
          socket.syncLiveMode?.(); // tell the server so it (only) auto-drives Live-mode users
        }}
        accessibilityRole="switch"
        accessibilityState={{ checked: liveMode }}
        accessibilityLabel="live-mode-toggle"
        style={{ paddingVertical: 8, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, backgroundColor: liveMode ? 'rgba(49,225,196,0.13)' : 'transparent', borderColor: liveMode ? '#31e1c4' : '#8886' }}
      >
        <Text style={{ color: liveMode ? '#31e1c4' : '#999', fontSize: 13, fontWeight: '600', letterSpacing: 0.3 }}>
          {liveMode ? '● Live Biometric' : 'Manual'}
        </Text>
      </Pressable>
      {generating && statusMessage ? (
        <Text style={{ color: '#31e1c4', fontSize: 13, letterSpacing: 0.3 }}>{statusMessage}</Text>
      ) : null}
      <ActivityChips />
      <PromptBox />
      <Pressable
        disabled={ctaDisabled}
        onPress={() => controller.submit()}
        style={{ opacity: ctaDisabled ? 0.4 : 1, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 28, backgroundColor: mode === 'live-tuned' ? '#31e1c4' : '#6c5ce7' }}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>{label}</Text>
      </Pressable>
    </View>
  );
}
