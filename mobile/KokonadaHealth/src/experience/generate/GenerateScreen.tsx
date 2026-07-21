import React, { useMemo, useEffect, useState, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Keyboard, AccessibilityInfo, useWindowDimensions } from 'react-native';
import { useStore, useSelector } from 'react-redux';
import { useSharedValue } from 'react-native-reanimated';
import { RadialWheel } from '../wheel/RadialWheel';
import { BioAura } from '../aura/BioAura';
import { LivingAurora } from '../aurora/LivingAurora';
import { AuroraGradientFill } from '../aurora/AuroraGradientFill';
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
import { space, radius, motion, type as typography } from '../../design/tokens';
import { emotionAccentFor, auroraGlow } from '../../design/emotionAccent';
import { auroraCtaStops, onAuroraInk, textScrimFill } from '../../design/auroraSurfaces';
import { fireHaptic } from '../../design/haptics';
import type { Tap } from '../../state/cold/emotionSlice';

// The HERO. Composes the reactive bio-aura + radial wheel (the sacred emotion→socket→playlist core
// loop) over the LIVING AURORA field, with a four-state morphing CTA and the full-bleed Genesis
// takeover while a generation is in flight. THE single writer: committed intent lives in the cold
// emotionSlice (one source of truth), the hot→cold→socket wiring is the unit-tested GenerateController,
// and every store / keyboard / a11y subscription is torn down on unmount (ATTACK-6). AURORA: the field
// is the brand backdrop, the emotion mean becomes the aura's FOCAL glow (auroraGlow, presentation-only —
// never fed back to emotion state, Fork 2A), and every text cluster floats on frosted glass / a scrim
// so it clears AA over the moving gradient. Fully tokenised + reduced-aware.
const WHEEL_MAX = 340;
const MINI_WHEEL = space['4xl'] * 1.75; // ~112dp docked mini-ring while typing
const AURA_SCALE = 1.6;                  // aura canvas ≈ 1.6× wheel so the bloom overspills the disc
const GENESIS_FRACTION = 0.7;
const QUADRANT_RADIUS = 0.66;            // words sit at 0.66r along the diagonals
const CTA_LABEL_SIZE = 19;               // ≥18.66 → WCAG-large, so the adaptive ink is judged at AA-large
const GENESIS_AURORA_OPACITY = 0.5;      // the genesis moment is aurora-tinted, but dimmed under the loader
const ANALYZING_COPY = 'Reading your signal…';
const RESOLVED_COPY = 'Found your sound';
// Once a point is placed the quadrant words LINGER as ambient reference, softened into a genuine
// out-of-focus blur: a transparent fill + a wide gaussian text-shadow (Android BlurMaskFilter /
// iOS gaussian NSShadow), so only the blurred glyph shows. Static → reduced-motion safe, 60fps-cheap.
const FROST_BLUR = 7;                     // gaussian radius — reads as out-of-focus, not a sharp halo
const FROST_OPACITY = 0.55;              // the frosted words recede behind the taps
const FROST_SHADOW_OFFSET = { width: 0, height: 0 } as const; // centred bloom (no directional cast)
const CORNER_INSET = space.xs;           // undo/clear hug the wheel's lower corners (Bug 3)

// Quadrant map (screen diagonals): LR Calm · UR Joyful · UL Intense · LL Reflective.
const QUADRANT_WORDS: Array<{ q: string; label: string; dx: number; dy: number }> = [
  { q: 'calm', label: 'Calm', dx: 1, dy: 1 },
  { q: 'joyful', label: 'Joyful', dx: 1, dy: -1 },
  { q: 'intense', label: 'Intense', dx: -1, dy: -1 },
  { q: 'reflective', label: 'Reflective', dx: -1, dy: 1 },
];

export function GenerateScreen({ socket = playbackSocket }: { socket?: SocketApi }) {
  const store = useStore() as any;
  const { name, c } = useTheme();
  const { reduced } = useMotion();
  const { width, height } = useWindowDimensions();
  const fullSize = Math.min(width - space.xl * 2, WHEEL_MAX);

  const controller = useMemo(
    () => new GenerateController({
      store, warmStore, socket,
      isLiveMode: () => liveModeStore.getState().liveMode,
    }),
    [store, socket],
  );

  // COLD store is the single source of truth for committed intent — wheel, accent, undo/clear.
  const emotion = useSelector((s: any) => s.emotion);
  const taps: Tap[] = emotion.taps;
  const quadrant = emotionAccentFor(taps);
  const accentInk = c.emotionAccent[quadrant].ink;
  const hasTaps = taps.length > 0;

  // The committed MEAN (presentation-only): the aura's focal glow, the CTA gradient + adaptive ink all
  // travel with it. Empty → the idle brand glow. It never flows back into emotion state (Fork 2A).
  const meanTap = useMemo(() => {
    let sx = 0; let sy = 0; let n = 0;
    for (const t of taps) {
      if (Number.isFinite(t.x) && Number.isFinite(t.y)) { sx += t.x; sy += t.y; n += 1; }
    }
    return n ? { x: sx / n, y: sy / n } : null;
  }, [taps]);
  const focalColor = meanTap ? auroraGlow(meanTap.x, meanTap.y) : c.accent.glowIdle;
  const ctaStops = useMemo(() => auroraCtaStops(meanTap?.x ?? 0, meanTap?.y ?? 0), [meanTap]);
  const ctaInk = useMemo(() => onAuroraInk(ctaStops), [ctaStops]);

  const [hr, setHr] = useState<number | null>(warmStore.getState().liveHr);
  useEffect(() => {
    setHr(warmStore.getState().liveHr);
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
  // primary, the Keyboard listener the fallback — BOTH torn down on unmount).
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setTyping(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setTyping(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // The wheel's list alternative is gated behind a quiet affordance, but AUTO-OPENS under a
  // screen reader so the full a11y path is always reachable. Listener cleaned up on unmount.
  const [listOpen, setListOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isScreenReaderEnabled().then((v) => { if (alive && v) setListOpen(true); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', (v: boolean) => { if (v) setListOpen(true); });
    return () => { alive = false; sub?.remove?.(); };
  }, []);

  // Genesis exit beat: hold the overlay mounted through a brief RESOLVING phase after generating
  // ends so NeuralAnalysisLoader's spring exit can EXHALE (field-expand + fade), THEN unmount.
  // reduced-motion cuts straight out (no exhale).
  const [genesisPhase, setGenesisPhase] = useState<'hidden' | 'active' | 'resolving'>(
    generationStatusStore.getState().generating ? 'active' : 'hidden',
  );
  useEffect(() => {
    if (generating) setGenesisPhase('active');
    else setGenesisPhase((p) => (p === 'hidden' ? 'hidden' : 'resolving'));
  }, [generating]);
  useEffect(() => {
    if (genesisPhase !== 'resolving') return;
    if (reduced) { setGenesisPhase('hidden'); return; }
    const id = setTimeout(() => setGenesisPhase('hidden'), motion.duration.slow);
    return () => clearTimeout(id);
  }, [genesisPhase, reduced]);

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
  const ctaGlyph = mode === 'listen-to-heart' ? '♥' : mode === 'live-tuned' ? '●' : null;
  const ctaDisabled = mode === 'disabled' || mode === 'live-tuned';
  const cta = ctaTreatment(mode, c, ctaStops, ctaInk);

  const wheelSize = typing ? MINI_WHEEL : fullSize;
  const auraSize = wheelSize * AURA_SCALE;
  const auraOffset = (wheelSize - auraSize) / 2; // negative → the halo overspills the hero (no clip)
  const genesisSize = Math.round(Math.min(width, height) * GENESIS_FRACTION);
  const genesisVisible = genesisPhase !== 'hidden';
  const genesisScrim = name === 'light' ? c.surface.overlay : c.surface.base;

  const R = wheelSize / 2;
  const qDiag = QUADRANT_RADIUS * R * Math.SQRT1_2;

  return (
    <View style={[styles.root, { backgroundColor: c.surface.base }]}>
      {/* the LIVING AURORA — the ambient brand field, UI-thread Skia, static under reduce-motion */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <LivingAurora width={width} height={height} reduced={reduced} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { width: wheelSize, height: wheelSize }]}>
          <View pointerEvents="none" style={{ position: 'absolute', width: auraSize, height: auraSize, left: auraOffset, top: auraOffset }}>
            {/* the FOCAL glow: the aura tinted by the committed emotion mean (idle brand glow when empty) */}
            <BioAura hr={hr} size={auraSize} accentColor={focalColor} reduced={reduced} />
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
          {!typing ? (
            // The quadrant words TEACH the map, each on its own AA scrim. Once a point is placed the
            // map is learned — but Daniel wants them to LINGER as ambient reference, so they STAY and
            // soften into a genuine frosted blur (transparent fill + gaussian text-shadow). Decorative
            // once tapped → the AA-over-aura burden is waived. Hidden only while typing (mini-ring).
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {QUADRANT_WORDS.map((qw) => {
                const frosted = hasTaps;
                return (
                  <View
                    key={qw.q}
                    style={[
                      styles.quadrantScrim,
                      {
                        left: R + qw.dx * qDiag - space['3xl'] / 2,
                        top: R + qw.dy * qDiag - space.lg / 2,
                      },
                      frosted
                        ? { opacity: FROST_OPACITY }                    // ambient — receded, no scrim
                        : { backgroundColor: textScrimFill(c, name) },  // teaching — crisp on its AA scrim
                    ]}
                  >
                    <Text
                      testID={`quadrant-word-${qw.q}`}
                      style={[
                        styles.quadrantWord,
                        frosted
                          ? { color: 'transparent', textShadowColor: c.content.muted, textShadowOffset: FROST_SHADOW_OFFSET, textShadowRadius: FROST_BLUR }
                          : { color: c.content.muted },
                      ]}
                    >
                      {qw.label}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* Bug 3: undo/clear are ABSOLUTE overlays anchored to the wheel's bottom corners, so they
              fade in on tap with ZERO layout shift — nothing else on the screen moves. Hidden while typing. */}
          {hasTaps && !typing ? (
            <>
              <Pressable testID="generate-undo" accessibilityRole="button" accessibilityLabel="Undo last tap" onPress={onUndo} style={[styles.cornerControl, styles.cornerLeft, styles.miniPill, { backgroundColor: c.surface.glassFallback, borderColor: c.surface.hairline }]}>
                <Text style={[styles.textControlLabel, { color: c.content.muted }]}>↺ Undo</Text>
              </Pressable>
              <Pressable testID="generate-clear" accessibilityRole="button" accessibilityLabel="Clear all taps" onPress={onClear} style={[styles.cornerControl, styles.cornerRight, styles.miniPill, { backgroundColor: c.surface.glassFallback, borderColor: c.surface.hairline }]}>
                <Text style={[styles.textControlLabel, { color: c.content.muted }]}>Clear</Text>
              </Pressable>
            </>
          ) : null}
        </View>

        <Pressable
          onPress={() => {
            const next = !liveModeStore.getState().liveMode;
            liveModeStore.getState().setLiveMode(next);
            socket.syncLiveMode?.();
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: liveMode }}
          accessibilityLabel="live-mode-toggle"
          style={[styles.toggle, styles.gap16, {
            backgroundColor: c.surface.glassFallback,
            borderColor: liveMode ? c.accent.glow : c.surface.hairline,
          }]}
        >
          <Text style={[styles.toggleLabel, { color: liveMode ? c.content.primary : c.content.muted }]}>
            {liveMode ? '● Live Biometric' : 'Manual'}
          </Text>
        </Pressable>

        <View style={[styles.fullWidth, styles.gap24]}><ActivityChips /></View>
        <View style={[styles.fullWidth, styles.gap16]}><PromptBox onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} /></View>

        <Pressable
          testID="generate-list-toggle"
          accessibilityRole="button"
          accessibilityState={{ expanded: listOpen }}
          accessibilityLabel="Choose how you feel from a list"
          onPress={() => setListOpen((o) => !o)}
          style={[styles.miniPill, styles.gap16, { backgroundColor: c.surface.glassFallback, borderColor: c.surface.hairline }]}
        >
          <Text style={[styles.textControlLabel, { color: c.content.muted }]}>{listOpen ? 'Hide the list' : 'Choose from a list'}</Text>
        </Pressable>
        {listOpen ? <View style={styles.fullWidth}><EmotionListSelector /></View> : null}

        <Pressable
          testID="generate-cta"
          disabled={ctaDisabled}
          onPress={doSubmit}
          accessibilityRole="button"
          accessibilityState={{ disabled: ctaDisabled }}
          style={[styles.cta, styles.gap24, { backgroundColor: cta.fill, borderColor: cta.border }]}
        >
          {cta.gradient ? <AuroraGradientFill colors={cta.gradient} /> : null}
          {ctaGlyph ? <Text style={[styles.ctaLabel, { color: cta.label }]}>{ctaGlyph} </Text> : null}
          <Text testID="generate-cta-label" style={[styles.ctaLabel, { color: cta.label }]}>{ctaLabel}</Text>
        </Pressable>

        {errorMessage && !generating ? (
          <View style={[styles.errorRow, styles.gap16, { backgroundColor: c.surface.glassFallback }]}>
            <Text testID="generate-error" style={[styles.errorText, { color: c.content.secondary }]}>
              That didn’t land — let’s try again.
            </Text>
            <Pressable testID="generate-retry" accessibilityRole="button" accessibilityLabel="Retry generation" onPress={doSubmit} style={styles.textControl}>
              <Text testID="generate-retry-label" style={[styles.textControlLabel, { color: c.content.secondary }]}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      {genesisVisible ? (
        <View
          testID="genesis-overlay"
          pointerEvents="auto"
          accessibilityViewIsModal
          style={[StyleSheet.absoluteFill, styles.genesis, { backgroundColor: genesisScrim }]}
        >
          {/* aurora-tint the takeover (dimmed under the loader); still under reduce-motion */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.genesisAurora]}>
            <LivingAurora width={width} height={height} reduced={reduced} />
          </View>
          <NeuralAnalysisLoader active={genesisPhase === 'active'} engagement={engagement} size={genesisSize} reduced={reduced} />
          <View style={[styles.genesisStatusScrim, { backgroundColor: textScrimFill(c, name) }]}>
            <Text testID="genesis-status" style={[styles.genesisStatus, { color: c.content.secondary }]}>
              {genesisPhase === 'resolving' ? RESOLVED_COPY : (statusMessage ?? ANALYZING_COPY)}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// The morphing CTA treatment (design §5). GENERATE rides the aurora gradient (sky → your emotion glow
// → gold) with the ADAPTIVE ink onAuroraInk chose (AA-large across the label band, label ≥18.66/700);
// its solid `fill` is the gradient's own mid stop, the AA-proven fallback the label sits on until the
// Skia gradient measures itself. The three non-reactive states are frosted-glass pills distinguished by
// border + glyph + label weight (colour is never the sole cue), each AA over the opaque glass.
function ctaTreatment(mode: string, c: any, stops: readonly [string, string, string], ink: string) {
  const glass = c.surface.glassFallback;
  if (mode === 'disabled') return { fill: glass, border: c.surface.hairline, label: c.content.tertiary, gradient: null as readonly string[] | null };
  if (mode === 'listen-to-heart') return { fill: glass, border: c.accent.glow, label: c.content.primary, gradient: null as readonly string[] | null };
  if (mode === 'live-tuned') return { fill: glass, border: c.accent.glow, label: c.content.secondary, gradient: null as readonly string[] | null };
  return { fill: stops[1], border: c.surface.hairlineGold, label: ink, gradient: stops as readonly string[] }; // generate — aurora gradient
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flex: 1 },
  // Vertical rhythm: safe-top 4xl / safe-bottom 3xl, base 16 with 24 breaks (styles.gap24).
  scrollContent: { alignItems: 'center', paddingTop: space['4xl'], paddingBottom: space['3xl'], paddingHorizontal: space.xl },
  gap16: { marginTop: space.lg },
  gap24: { marginTop: space.xl },
  fullWidth: { width: '100%', alignItems: 'center' },
  hero: { alignItems: 'center', justifyContent: 'center' }, // overflow visible → the aura halo overspills
  quadrantScrim: { position: 'absolute', width: space['3xl'], alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingVertical: 2 },
  quadrantWord: { textAlign: 'center', fontSize: typography.size.caption, letterSpacing: typography.tracking.caption },
  // Undo/Clear as absolute overlays on the wheel's lower corners (Bug 3) — appearing on tap can never
  // push a sibling, so the layout stays perfectly still. Same glass mini-pill styling as before.
  cornerControl: { position: 'absolute', bottom: CORNER_INSET },
  cornerLeft: { left: CORNER_INSET },
  cornerRight: { right: CORNER_INSET },
  textControl: { minHeight: space['3xl'], justifyContent: 'center', alignItems: 'center', paddingHorizontal: space.md },
  textControlLabel: { fontSize: typography.size.callout, fontWeight: typography.weight.medium },
  // quiet glass mini-pill (undo / clear / list toggle) — an opaque frosted surface so its muted label
  // clears AA over the moving aurora (the RN glass degrades to surface.glassFallback, which AA judges).
  miniPill: {
    minHeight: space['3xl'], justifyContent: 'center', alignItems: 'center',
    paddingVertical: space.sm, paddingHorizontal: space.lg,
    borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  toggle: {
    minHeight: space['3xl'], justifyContent: 'center',
    paddingVertical: space.sm, paddingHorizontal: space.lg,
    borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
  cta: {
    flexDirection: 'row', minHeight: space['3xl'], justifyContent: 'center', alignItems: 'center',
    paddingVertical: space.md, paddingHorizontal: space['2xl'],
    borderRadius: radius.pill, borderWidth: 1.5, overflow: 'hidden', // clip the gradient fill to the pill
  },
  ctaLabel: { fontSize: CTA_LABEL_SIZE, fontWeight: typography.weight.bold }, // ≥18.66/700 → WCAG-large
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, justifyContent: 'center', paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.md },
  errorText: { fontSize: typography.size.footnote },
  genesis: { alignItems: 'center', justifyContent: 'center', gap: space.xl },
  genesisAurora: { opacity: GENESIS_AURORA_OPACITY },
  genesisStatusScrim: { paddingVertical: space.sm, paddingHorizontal: space.lg, borderRadius: radius.md },
  genesisStatus: { fontSize: typography.size.subheading, letterSpacing: typography.tracking.body, textAlign: 'center' },
});
