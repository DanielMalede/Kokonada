import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, Pressable, StyleSheet, Easing, AccessibilityInfo } from 'react-native';
import { useTheme, useMotion } from '../theme';
import { space, radius, type as typography, elevation, motion } from '../tokens';
import { useCalmPulse } from './useCalmPulse';
import { SKELETON_PULSE } from './Skeleton';

// "The music never stops." A calm, NON-ALARM status bar: it never wears danger/red, its message
// carries the meaning (state colour is decorative), and it debounces transient blips so a 200ms
// hiccup never flashes anything. DISPLAY-ONLY — it takes a `status` prop and NEVER calls
// connect()/disconnect(); socketClient owns reconnection (a shell wires this to warmStore in E2).
// Tokens only. Reduced motion snaps every transition and stills the dot.

// Appear debounce (swallow transient disconnect/connecting blips) and the hold on "Back online".
export const OFFLINE_GRACE_MS = 1400;
export const BACK_ONLINE_HOLD_MS = 1600;

const ENTER_BEZIER = Easing.bezier(...motion.easing.enter);

export type BannerStatus = 'disconnected' | 'connecting' | 'connected';
type Phase = 'hidden' | 'offline' | 'connecting' | 'recovered';

export interface OfflineBannerProps {
  status: BannerStatus;
  onRetry?: () => void;
}

const COPY: Record<Exclude<Phase, 'hidden'>, string> = {
  offline: 'Offline — playing from your saved moments.',
  connecting: 'Reconnecting…',
  recovered: 'Back online',
};
const ANNOUNCE: Partial<Record<Phase, string>> = {
  offline: 'Offline, playing from saved moments',
  recovered: 'Back online',
};

export function OfflineBanner({ status, onRetry }: OfflineBannerProps) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();

  const [phase, setPhase] = useState<Phase>('hidden');
  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearGrace = () => { if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; } };
  const clearHold = () => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } };

  // The transition machine. connected → confirm-and-recede (no grace); disconnected/connecting →
  // appear, debounced by the grace window only when coming from hidden (blip suppression).
  useEffect(() => {
    if (status === 'connected') {
      clearGrace(); // a pending appear was a blip — cancel it
      if (phaseRef.current !== 'hidden' && phaseRef.current !== 'recovered') {
        clearHold();
        setPhase('recovered');
        holdRef.current = setTimeout(() => { holdRef.current = null; setPhase('hidden'); }, BACK_ONLINE_HOLD_MS);
      }
      return;
    }
    clearHold();
    const target: Phase = status === 'disconnected' ? 'offline' : 'connecting';
    if (phaseRef.current === 'hidden') {
      clearGrace();
      graceRef.current = setTimeout(() => { graceRef.current = null; setPhase(target); }, OFFLINE_GRACE_MS);
    } else {
      clearGrace();
      setPhase(target); // already visible → switch copy immediately, no re-grace
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearGrace(); clearHold(); }, []);

  // Announce on transition ONLY (polite), debounced so a re-render never re-announces the same state.
  const lastAnnounced = useRef<Phase | null>(null);
  useEffect(() => {
    if (phase === 'hidden') { lastAnnounced.current = null; return; }
    const message = ANNOUNCE[phase];
    if (message && lastAnnounced.current !== phase) {
      lastAnnounced.current = phase;
      AccessibilityInfo.announceForAccessibility(message);
    }
  }, [phase]);

  // Appear fade (opacity only → no layout shift). Reduced motion snaps to 1. Keyed on the VISIBLE
  // edge, not on `phase`: a copy switch between two visible states (offline↔connecting) must NOT
  // re-run the fade — that would blink the banner. It fades once on appear and holds.
  const visible = phase !== 'hidden';
  const entry = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (!visible) return;
    if (reduced) { entry.setValue(1); return; }
    entry.setValue(0);
    const anim = Animated.timing(entry, { toValue: 1, duration: duration.base, easing: ENTER_BEZIER, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [visible, reduced, duration.base, entry]);

  // The supportive dot: static tertiary while offline, breathing accent while connecting, steady
  // accent on the "Back online" confirm. accent.glow (not state.success) is the confirm hue because
  // it clears the ≥3:1 non-text-contrast floor on surface.overlay in BOTH themes.
  const pulsing = phase === 'connecting';
  const dotOpacity = useCalmPulse(reduced || !pulsing, pulsing ? duration.breath : 0, SKELETON_PULSE);
  const dotColor = phase === 'offline' ? c.content.tertiary : c.accent.glow;

  if (phase === 'hidden') return null;

  return (
    <Animated.View
      testID="offline-banner"
      accessibilityLiveRegion="polite"
      style={[styles.banner, elevation.e2, { backgroundColor: c.surface.overlay, opacity: entry }]}
    >
      <Animated.View testID="offline-dot" style={[styles.dot, { backgroundColor: dotColor, opacity: dotOpacity }]} />
      <Text style={[styles.message, { color: c.content.primary }]}>{COPY[phase]}</Text>
      {onRetry && phase === 'offline' ? (
        <Pressable
          testID="offline-retry"
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry connection"
          style={[styles.retry, { borderColor: c.content.tertiary }]}
        >
          <Text style={[styles.retryText, { color: c.content.primary }]}>Retry</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Edge-to-edge, no rounding — a floating pill would read as a toast/alert (the opposite of calm).
  // The radius scale has no `none` member, so square edges are expressed by omitting borderRadius
  // (the default 0) rather than inventing a token or a magic number.
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    width: '100%',
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  dot: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  message: { flex: 1, fontSize: typography.size.callout, fontWeight: typography.weight.medium },
  retry: { paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1 },
  retryText: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
});
