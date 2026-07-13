import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, Pressable, Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';
import { nowPlayingStore } from './nowPlayingStore';
import { orchestrator } from './playbackServices';
import type { NowPlaying } from './playbackOrchestrator';
import { UpNextSheet } from './UpNextSheet';
import { playerStatusStore } from '../player/playerStatusStore';
import { store } from '../../state/store';
import { emotionAccentFor } from '../../design/emotionAccent';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation } from '../../design/tokens';

// Now Playing — Wave 2.8 "Bioluminescence" full-screen player. The current track and its
// transport, driven entirely by the unit-tested PlaybackOrchestrator. This is a visual
// reskin on the design-token system only; the playback CONTRACT is untouched:
//   • subscribes to nowPlayingStore with a useEffect cleanup (S10-1 no-leak, pinned),
//   • prev→skipPrev, play/pause→togglePlayPause, next→skipNext,
//   • play/pause disabled with no track, and an empty state when nothing is playing.

const ART_SIZE = 300;              // cover maximum on a roomy viewport (no token for a hero cover)
const ART_VIEWPORT_FRACTION = 0.42; // never let the cover eat more than this of the viewport height
const PLAY_SIZE = 72;              // the primary transport affordance

// The one signature, shared with the Auth gate: a single soft cyan bloom that BREATHES
// behind the cover — depth, not neon. Decorative (a11y-hidden) and stilled under reduced
// motion (the breath duration collapses to 0, and the loop is torn down).
function PlaybackAura({ color, reduced, breathMs, size }: { color: string; reduced: boolean; breathMs: number; size: number }) {
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
      style={[styles.aura, { width: size, height: size, backgroundColor: color, transform: [{ scale }], opacity: reduced ? 0.35 : opacity }]}
    />
  );
}

export function NowPlayingScreen() {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const { width, height } = useWindowDimensions();
  // H1: bound the hero cover to the LIVE viewport so it can never overflow the non-scrolling
  // artWrap and occlude the meta/transport rows. Responsive on width AND height — so portrait,
  // landscape, split-screen and small phones all stay legible — capped at the design maximum on
  // roomy screens. flexShrink on the art (below) is the final guarantee if space is still tight.
  const artSize = Math.min(width - space.xl * 2, height * ART_VIEWPORT_FRACTION, ART_SIZE);
  const [state, setState] = useState<NowPlaying & { coverUri: string | null }>({
    track: nowPlayingStore.getState().track,
    isPlaying: nowPlayingStore.getState().isPlaying,
    coverUri: nowPlayingStore.getState().coverUri,
  });

  useEffect(() => {
    const sync = (s: any) => setState({ track: s.track, isPlaying: s.isPlaying, coverUri: s.coverUri });
    sync(nowPlayingStore.getState());
    return nowPlayingStore.subscribe(sync); // cleanup returns the unsubscribe (S10-1)
  }, []);

  // Up-Next sheet: a low-emphasis trigger opens the queue over Now Playing. Live connection drives
  // its soft states; the session accent is chosen ONCE (static per session, never per-track).
  const [upNextVisible, setUpNextVisible] = useState(false);
  const [connection, setConnection] = useState(playerStatusStore.getState().status);
  useEffect(() => playerStatusStore.subscribe((s) => setConnection(s.status)), []);
  const quadrant = useMemo(() => emotionAccentFor(store.getState().emotion.taps), []);

  const { track, isPlaying, coverUri } = state;

  // Graceful degradation (L2): a non-null but broken/undecodable cover file must still fall
  // back to the ♪ token placeholder — never a blank panel. The flag is keyed to the current
  // coverUri (resolved from the live App Remote state), so a new track re-attempts its art.
  const [coverFailed, setCoverFailed] = useState(false);
  useEffect(() => { setCoverFailed(false); }, [coverUri]);
  // B1: gate the cover on TRACK metadata too. coverUri is set on its own channel (the
  // resolver), decoupled from the track, so coverUri!=null && track==null is reachable
  // (foreign playback at boot with an empty queue). The cover's a11y label reads
  // track.title, so a cover with no track would null-deref — show the placeholder instead.
  const showCover = !!coverUri && !coverFailed && !!track;

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      {/* Album art — the REAL cover for the CURRENTLY PLAYING track, resolved client-side from
          the live App Remote player state (no Web API). A token-styled bio panel stands in
          whenever coverUri is null (not yet resolved, a non-Spotify track, or a failed fetch).
          The bloom breathes behind it. */}
      <View style={styles.artWrap}>
        <PlaybackAura color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={artSize} />
        <View
          testID="now-playing-art"
          style={[styles.art, elevation.e2, { width: artSize, height: artSize, maxHeight: artSize, backgroundColor: c.surface.raised, borderColor: c.surface.hairline }]}
        >
          {showCover ? (
            <Image
              testID="now-playing-cover"
              source={{ uri: coverUri! }}
              resizeMode="cover"
              onError={() => setCoverFailed(true)}
              accessibilityRole="image"
              accessibilityLabel={`Album art for ${track!.title}`}
              style={[styles.cover, { borderRadius: radius.xl }]}
            />
          ) : (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={{ fontSize: 64, color: c.content.secondary }}
            >
              ♪
            </Text>
          )}
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

        {/* Mix-receipt — the honest "why this track": familiar/discovery role + the mood/heart
            trigger and target tempo, all derived server-side from real signals. Hidden when the
            track carries no receipt (e.g. a legacy payload). */}
        {track?.receipt ? (
          <View
            testID="now-playing-receipt"
            style={[styles.receipt, { backgroundColor: c.surface.raised, borderColor: c.surface.hairline }]}
            accessibilityRole="text"
            accessibilityLabel={`Why this track: ${track.receipt.label}${track.receipt.detail ? `, ${track.receipt.detail}` : ''}`}
          >
            <Text
              numberOfLines={1}
              style={{ fontSize: typography.size.caption, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.heading, color: c.content.primary, textAlign: 'center' }}
            >
              {track.receipt.label}
            </Text>
            {track.receipt.detail ? (
              <Text
                numberOfLines={1}
                style={{ marginTop: space.xs, fontSize: typography.size.caption, color: c.content.secondary, textAlign: 'center' }}
              >
                {track.receipt.detail}
              </Text>
            ) : null}
          </View>
        ) : null}
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

      {/* Low-emphasis "Up next" affordance (SCREENS §7): tap to open the queue sheet over Now
          Playing. Sits beneath the transport without disturbing the art→meta→transport hierarchy. */}
      <Pressable
        onPress={() => setUpNextVisible(true)}
        accessibilityRole="button"
        accessibilityLabel="Up next"
        style={styles.upNext}
      >
        <Text style={{ fontSize: typography.size.subheading, color: c.content.secondary }}>⌃</Text>
        <Text style={{ fontSize: typography.size.footnote, color: c.content.secondary }}>Up next</Text>
      </Pressable>

      <UpNextSheet
        visible={upNextVisible}
        onClose={() => setUpNextVisible(false)}
        tracks={upNextVisible ? orchestrator.getQueueTracks() : []}
        currentTrackId={track?.id ?? null}
        isPlaying={isPlaying}
        quadrant={quadrant}
        connection={connection}
        onJump={(t) => orchestrator.jumpToId(t.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xl, paddingTop: 96, paddingBottom: 56 },
  artWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', width: '100%' },
  aura: { position: 'absolute', borderRadius: radius.pill },
  art: { flexShrink: 1, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  cover: { width: '100%', height: '100%' },
  meta: { width: '100%', alignItems: 'center', paddingHorizontal: space.md },
  receipt: { marginTop: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  transport: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space['3xl'], marginTop: space['2xl'] },
  sideBtn: { padding: space.md, alignItems: 'center', justifyContent: 'center' },
  // ≥44pt a11y tap target via the space['3xl'] (48) token — low-emphasis, centered chevron + label.
  upNext: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: space['3xl'], marginTop: space.lg, paddingHorizontal: space.md },
  playBtn: { width: PLAY_SIZE, height: PLAY_SIZE, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
