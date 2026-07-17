import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Keyboard, useWindowDimensions } from 'react-native';
import { useStore, useSelector } from 'react-redux';
import { useSharedValue } from 'react-native-reanimated';
import { RadialWheel } from '../wheel/RadialWheel';
import { BioAura } from '../aura/BioAura';
import { ActivityChips } from './ActivityChips';
import { PromptBox } from './PromptBox';
import { EmotionListSelector } from './EmotionListSelector';
import { GenerateController, type SocketApi } from './generateController';
import { NeuralAnalysisLoader } from './NeuralAnalysisLoader';
import { generationStatusStore } from './generationStatusStore';
import { liveModeStore } from './liveModeStore';
import { warmStore } from '../../state/store';
import { playbackSocket } from '../playback/playbackServices';
import { playbackErrorStore } from '../playback/playbackErrorStore';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';
import { emotionAccentFor } from '../../design/emotionAccent';
import { fireHaptic } from '../../design/haptics';
import type { Tap } from '../../state/cold/emotionSlice';

// The HERO. Composes the reactive bio-aura + radial wheel (the sacred emotion→socket→playlist
// core loop) over the four-state CTA, with the full-bleed Genesis takeover while a generation is
// in flight. THE single writer: committed intent lives in the cold emotionSlice (one source of
// truth), the hot→cold→socket wiring is the unit-tested GenerateController, and every store /
// keyboard subscription is torn down on unmount (ATTACK-6). Fully tokenised (light + dark) and
// reduced-motion-aware.
const WHEEL_MAX = 340;
const MINI_WHEEL = space['4xl'] * 1.75; // ~112dp docked mini-ring while typing
const GENESIS_FRACTION = 0.7;
const ANALYZING_COPY = 'Reading your signal…';

export function GenerateScreen({ socket = playbackSocket }: { socket?: SocketApi }) {
  const store = useStore() as any;
  const { c } = useTheme();
  const { reduced } = useMotion();
  const { width, height } = useWindowDimensions();
  const fullSize = Math.min(width - space.xl * 2, WHEEL_MAX);

  const controller = useMemo(
    () => new GenerateController({
      store, warmStore, socket,
      // Live mode owns the queue (band shifts serve the buffer), so the manual CTA yields.
      isLiveMode: () => liveModeStore.getState().liveMode,
    }),
    [store, socket],
  );

  // COLD store is the single source of truth for committed intent — the wheel, the accent, and
  // undo/clear all read/write it. (No shadow copy that could diverge from a list-selector tap.)
  const emotion = useSelector((s: any) => s.emotion);
  const taps: Tap[] = emotion.taps;
  const quadrant = emotionAccentFor(taps);
  const accentInk = c.emotionAccent[quadrant].ink;
  const accentWash = c.emotionAccent[quadrant].wash;
  const hasTaps = taps.length > 0;

  const [hr, setHr] = useState<number | null>(warmStore.getState().liveHr);
  useEffect(() => {
    setHr(warmStore.getState().liveHr); // reconcile any HR that arrived before mount
    return warmStore.subscribe((s) => setHr(s.liveHr));
  }, []);

  const [generating, setGenerating] = useState(generationStatusStore.getState().generating);
  const [statusMessage, setStatusMessage] = useState(generationStatusStore.getState().message);
  useEffect(() => {
    const sync = (s: { generating: boolean; message: string | null }) => {
      setGenerating(s.generating);
      setStatusMessage(s.message);
    };
    sync(generationStatusStore.getState());
    return generationStatusStore.subscribe(sync);
  }, []);

  const [liveMode, setLiveMode] = useState(liveModeStore.getState().liveMode);
  useEffect(() => {
    setLiveMode(liveModeStore.getState().liveMode);
    return liveModeStore.subscribe((s) => setLiveMode(s.liveMode));
  }, []);

  // Generation failure is honest + retryable ON the surface (Fork 4A) — never a toast.
  const [errorMessage, setErrorMessage] = useState(playbackErrorStore.getState().message);
  useEffect(() => {
    setErrorMessage(playbackErrorStore.getState().message);
    return playbackErrorStore.subscribe((s) => setErrorMessage(s.message));
  }, []);

  // Keyboard focus collapses the wheel to a display-only mini-ring (Fork 3A: onFocus/onBlur is
  // primary, the Keyboard listener is the fallback — BOTH torn down on unmount).
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // `engagement` (0..1 prompt richness) lives in a SharedValue so the Genesis animation reads it
  // on the UI thread without a React re-render each keystroke.
  const engagement = useSharedValue(0);
  useEffect(() => {
    const len = emotion.textPrompt?.length ?? 0;
    const base = Math.pow(len / 60, 0.8);
    const extra = (emotion.activity ? 0.2 : 0) + Math.min(0.2, (emotion.taps?.length ?? 0) * 0.08);
    engagement.value = Math.min(1, base + extra);
  }, [emotion, engagement]);

  const onCommit = useCallback((committed: Tap) => {
    if (typing) { Keyboard.dismiss(); return; } // mini-ring is display-only — a tap dismisses it
    controller.commitTap(committed);
    fireHaptic('selection');
  }, [controller, typing]);
  const onUndo = useCallback(() => { controller.undoTap(); fireHaptic('selection'); }, [controller]);
  const onClear = useCallback(() => { controller.clearTaps(); fireHaptic('selection'); }, [controller]);

  const doSubmit = useCallback(() => {
    playbackErrorStore.getState().clear();
    const r = controller.submit();
    if (r) fireHaptic('commit');
  }, [controller]);

  const mode = controller.ctaMode();
  const ctaLabel = mode === 'live-tuned' ? 'Live-tuned'
    : mode === 'listen-to-heart' ? 'Listen to your heart'
      : 'Generate';
  const ctaDisabled = mode === 'disabled' || mode === 'live-tuned';
  const cta = ctaTreatment(mode, c, accentInk, accentWash);

  const wheelSize = typing ? MINI_WHEEL : fullSize;
  const genesisSize = Math.round(Math.min(width, height) * GENESIS_FRACTION);

  return (
    <View style={[styles.root, { backgroundColor: c.surface.base }]}>
      {/* decorative reactive wash — pairs with nothing (no text over it); baked-alpha token */}
      {hasTaps ? (
        <View pointerEvents="none" style={[styles.wash, { backgroundColor: accentWash }]} />
      ) : null}

      <View style={[styles.hero, { width: wheelSize, height: wheelSize }]}>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <BioAura hr={hr} size={wheelSize} accentColor={hasTaps ? accentInk : undefined} reduced={reduced} />
        </View>
        <RadialWheel
          size={wheelSize}
          committedTaps={taps}
          onCommit={onCommit}
          onRemoveLast={typing ? undefined : onUndo}
          onClear={typing ? undefined : onClear}
          accentInk={accentInk}
          reduced={reduced}
        />
      </View>

      {hasTaps && !typing ? (
        <View style={styles.undoRow}>
          <Pressable testID="generate-undo" accessibilityRole="button" accessibilityLabel="Undo last tap" onPress={onUndo} style={styles.textControl}>
            <Text style={[styles.textControlLabel, { color: c.content.secondary }]}>↺ Undo</Text>
          </Pressable>
          <Pressable testID="generate-clear" accessibilityRole="button" accessibilityLabel="Clear all taps" onPress={onClear} style={styles.textControl}>
            <Text style={[styles.textControlLabel, { color: c.content.secondary }]}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          const next = !liveModeStore.getState().liveMode;
          liveModeStore.getState().setLiveMode(next);
          socket.syncLiveMode?.();
        }}
        accessibilityRole="switch"
        accessibilityState={{ checked: liveMode }}
        accessibilityLabel="live-mode-toggle"
        style={[styles.toggle, {
          backgroundColor: liveMode ? c.emotionAccent.calm.wash : 'transparent',
          borderColor: liveMode ? c.accent.glow : c.surface.hairline,
        }]}
      >
        <Text style={[styles.toggleLabel, { color: liveMode ? c.content.primary : c.content.secondary }]}>
          {liveMode ? '● Live Biometric' : 'Manual'}
        </Text>
      </Pressable>

      <ActivityChips />
      <PromptBox onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />
      <EmotionListSelector />

      <Pressable
        testID="generate-cta"
        disabled={ctaDisabled}
        onPress={doSubmit}
        accessibilityRole="button"
        accessibilityState={{ disabled: ctaDisabled }}
        style={[styles.cta, { backgroundColor: cta.fill, borderColor: cta.border }]}
      >
        <Text testID="generate-cta-label" style={[styles.ctaLabel, { color: cta.label }]}>{ctaLabel}</Text>
      </Pressable>

      {errorMessage && !generating ? (
        <View style={styles.errorRow}>
          <Text testID="generate-error" style={[styles.errorText, { color: c.content.secondary }]}>
            That didn’t land — let’s try again.
          </Text>
          <Pressable testID="generate-retry" accessibilityRole="button" accessibilityLabel="Retry generation" onPress={doSubmit} style={styles.textControl}>
            <Text style={[styles.textControlLabel, { color: c.accent.glow }]}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {generating ? (
        <View
          testID="genesis-overlay"
          pointerEvents="auto"
          accessibilityViewIsModal
          style={[StyleSheet.absoluteFill, styles.genesis, { backgroundColor: c.surface.base }]}
        >
          <NeuralAnalysisLoader active={generating} engagement={engagement} size={genesisSize} reduced={reduced} />
          <Text testID="genesis-status" style={[styles.genesisStatus, { color: c.content.secondary }]}>
            {statusMessage ?? ANALYZING_COPY}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// The AA-safe reactive CTA treatment (design §5): ink LABEL + wash FILL + ink BORDER for the
// generate state (an emotionAccent ink-on-surface pairing, AA-proven). disabled is an inert
// tertiary outline; the HR + Live states wear the brand accent glow as border/graphic with an
// AA-safe content label — never content.onAccent on an emotion ink as a solid fill (gated).
function ctaTreatment(mode: string, c: any, accentInk: string, accentWash: string) {
  if (mode === 'disabled') return { fill: 'transparent', border: c.content.tertiary, label: c.content.tertiary };
  if (mode === 'listen-to-heart') return { fill: c.emotionAccent.calm.wash, border: c.accent.glow, label: c.content.primary };
  if (mode === 'live-tuned') return { fill: c.emotionAccent.calm.wash, border: c.accent.glow, label: c.content.secondary };
  return { fill: accentWash, border: accentInk, label: accentInk }; // generate — reactive
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingHorizontal: space.xl },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%' },
  hero: { alignItems: 'center', justifyContent: 'center' },
  undoRow: { flexDirection: 'row', gap: space.xl, justifyContent: 'center' },
  textControl: { minHeight: space['3xl'], justifyContent: 'center', paddingHorizontal: space.md },
  textControlLabel: { fontSize: typography.size.callout, fontWeight: typography.weight.medium },
  toggle: {
    minHeight: space['3xl'], justifyContent: 'center',
    paddingVertical: space.sm, paddingHorizontal: space.lg,
    borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
  cta: {
    minHeight: space['3xl'], justifyContent: 'center', alignItems: 'center',
    paddingVertical: space.md, paddingHorizontal: space['2xl'],
    borderRadius: radius.pill, borderWidth: 1.5,
  },
  ctaLabel: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, justifyContent: 'center' },
  errorText: { fontSize: typography.size.footnote },
  genesis: { alignItems: 'center', justifyContent: 'center', gap: space.xl },
  genesisStatus: { fontSize: typography.size.subheading, letterSpacing: typography.tracking.body, textAlign: 'center' },
});
