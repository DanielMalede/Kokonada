import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, useWindowDimensions } from 'react-native';
import { useStore, useSelector } from 'react-redux';
import { RadialWheel } from '../wheel/RadialWheel';
import { BioAura } from '../aura/BioAura';
import { ActivityChips } from './ActivityChips';
import { PromptBox } from './PromptBox';
import { GenerateController, type SocketApi } from './generateController';
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
    () => new GenerateController({ store, warmStore, socket }),
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
  useSelector((s: any) => s.emotion);
  const mode = controller.ctaMode();
  const label = mode === 'listen-to-heart' ? 'Listen to your heart' : 'Generate';

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute' }}><BioAura hr={hr} size={size} /></View>
        <RadialWheel size={size} committedTaps={taps} onCommit={onCommit} />
      </View>
      <ActivityChips />
      <PromptBox />
      <Pressable
        disabled={mode === 'disabled'}
        onPress={() => controller.submit()}
        style={{ opacity: mode === 'disabled' ? 0.4 : 1, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 28, backgroundColor: '#6c5ce7' }}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>{label}</Text>
      </Pressable>
    </View>
  );
}
