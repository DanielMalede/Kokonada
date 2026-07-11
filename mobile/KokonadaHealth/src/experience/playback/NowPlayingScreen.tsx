import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { nowPlayingStore } from './nowPlayingStore';
import { orchestrator } from './playbackServices';
import type { NowPlaying } from './playbackOrchestrator';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation } from '../../design/tokens';

// Now Playing — Wave 2.8 "Bioluminescence" full-screen player. The current track and its
// transport, driven entirely by the unit-tested PlaybackOrchestrator. This is a visual
// reskin on the design-token system only; the playback CONTRACT is untouched:
//   • subscribes to nowPlayingStore with a useEffect cleanup (S10-1 no-leak, pinned),
//   • prev→skipPrev, play/pause→togglePlayPause, next→skipNext,
//   • play/pause disabled with no track, and an empty state when nothing is playing.

const ART_SIZE = 300;   // one-off cover dimension (no token for a hero cover)
const PLAY_SIZE = 72;   // the primary transport affordance

// The one signature, shared with the Auth gate: a single soft cyan bloom that BREATHES
// behind the cover — depth, not neon. Decorative (a11y-hidden) and stilled under reduced
// motion (the breath duration collapses to 0, and the loop is torn down).
function PlaybackAura({ color, reduced, breathMs }: { color: string; reduced: boolean; breathMs: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced || breathMs <= 0) return; // reduced-motion → a still bloom, no loop
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(t, { toValue: 0, duration: breathMs / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, breathMs, t]);

  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.55] });
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.aura, { backgroundColor: color, transform: [{ scale }], opacity: reduced ? 0.35 : opacity }]}
    />
  );
}

export function NowPlayingScreen() {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const [state, setState] = useState<NowPlaying>({
    track: nowPlayingStore.getState().track,
    isPlaying: nowPlayingStore.getState().isPlaying,
  });

  useEffect(() => {
    const sync = (s: any) => setState({ track: s.track, isPlaying: s.isPlaying });
    sync(nowPlayingStore.getState());
    return nowPlayingStore.subscribe(sync); // cleanup returns the unsubscribe (S10-1)
  }, []);

  const { track, isPlaying } = state;

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      {/* Album art — QueueTrack carries no artwork URL, so a token-styled bio panel stands
          in for the cover (no invented track field). The bloom breathes behind it. */}
      <View style={styles.artWrap}>
        <PlaybackAura color={c.accent.glow} reduced={reduced} breathMs={duration.breath} />
        <View style={[styles.art, elevation.e2, { backgroundColor: c.surface.raised, borderColor: c.surface.hairline }]}>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ fontSize: 64, color: c.content.secondary }}
          >
            ♪
          </Text>
        </View>
      </View>

      <View style={styles.meta}>
        <Text
          accessibilityRole="header"
          numberOfLines={2}
          style={{ fontSize: typography.size.title, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.heading, color: c.content.primary, textAlign: 'center' }}
        >
          {track ? track.title : 'Nothing playing yet'}
        </Text>
        <Text
          numberOfLines={1}
          style={{ marginTop: space.sm, fontSize: typography.size.subheading, color: c.content.secondary, textAlign: 'center' }}
        >
          {track ? track.artist : 'Generate a vibe to start'}
        </Text>
      </View>

      <View style={styles.transport}>
        <Pressable
          onPress={() => orchestrator.skipPrev()}
          accessibilityRole="button"
          accessibilityLabel="Previous"
          style={styles.sideBtn}
        >
          <Text style={{ fontSize: typography.size.title, color: c.content.secondary }}>⏮</Text>
        </Pressable>

        <Pressable
          onPress={() => orchestrator.togglePlayPause()}
          disabled={!track}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          accessibilityState={{ disabled: !track }}
          style={[styles.playBtn, elevation.e1, { backgroundColor: c.accent.glowInk, opacity: track ? 1 : 0.4 }]}
        >
          <Text style={{ fontSize: typography.size.heading, color: c.content.onAccent }}>{isPlaying ? '❙❙' : '▶'}</Text>
        </Pressable>

        <Pressable
          onPress={() => orchestrator.skipNext()}
          accessibilityRole="button"
          accessibilityLabel="Next"
          style={styles.sideBtn}
        >
          <Text style={{ fontSize: typography.size.title, color: c.content.secondary }}>⏭</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: 96, paddingBottom: 56 },
  artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  aura: { position: 'absolute', width: ART_SIZE, height: ART_SIZE, borderRadius: radius.pill },
  art: { width: '100%', maxWidth: ART_SIZE, aspectRatio: 1, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  meta: { width: '100%', alignItems: 'center', paddingHorizontal: space.md },
  transport: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space['3xl'], marginTop: space['2xl'] },
  sideBtn: { padding: space.md, alignItems: 'center', justifyContent: 'center' },
  playBtn: { width: PLAY_SIZE, height: PLAY_SIZE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
