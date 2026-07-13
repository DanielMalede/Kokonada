import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, FlatList, Animated, Easing, StyleSheet, useWindowDimensions, BackHandler } from 'react-native';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, motion } from '../../design/tokens';
import type { EmotionQuadrant } from '../../design/tokens';
import { SpotifyAttribution } from '../player/SpotifyAttribution';
import { fireHaptic } from '../../design/haptics';
import { UpNextRow } from './UpNextRow';
import type { QueueTrack } from './playbackQueue';

// Up-Next queue sheet (SCREENS §7, finally built). A modal over Now Playing that lists the generated
// set with the live cursor — pure typography + accent, NO per-track cover art (compliant + a 60fps
// decision). Tap a row → playback jumps there through the orchestrator (the #130 self-heal path).

const SHEET_MAX_HEIGHT = '88%';

// A stable (non-inline) row separator so the FlatList never re-creates a component type per render.
function HairlineSeparator() {
  const { c } = useTheme();
  return <View style={[styles.separator, { backgroundColor: c.surface.hairline }]} />;
}

export interface UpNextSheetProps {
  visible: boolean;
  onClose: () => void;
  tracks: QueueTrack[];
  // The live cursor (nowPlayingStore.track?.id). Remote is source of truth; the rail follows it.
  currentTrackId: string | null;
  isPlaying: boolean;
  // The session accent quadrant (static per session).
  quadrant: EmotionQuadrant;
  connection: 'connected' | 'connecting' | 'disconnected';
  // Jump playback to a tapped track — wired to orchestrator.jumpToId so the #130 self-heal holds.
  onJump: (track: QueueTrack) => void;
}

export function UpNextSheet({ visible, onClose, tracks, currentTrackId, isPlaying, quadrant, connection, onJump }: UpNextSheetProps) {
  const { c } = useTheme();
  const { reduced } = useMotion();
  const { height: windowHeight } = useWindowDimensions();
  const accent = c.emotionAccent[quadrant];

  // Optimistic cursor: a tap moves the rail immediately, then the real orchestrator state (arriving
  // via currentTrackId) RECONCILES it — if the jump lands elsewhere (dead-track skip / disconnect),
  // the rail follows reality with no error. Reset whenever the real cursor changes.
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  useEffect(() => { setOptimisticId(null); }, [currentTrackId]);
  const effectiveCursorId = optimisticId ?? currentTrackId;

  // R1: keep the sheet MOUNTED across a dismiss so it can animate OUT (slide down + scrim fade) with
  // the gentle spring, unmounting only on completion — no more "slides in, snaps out". Reduced motion
  // keeps the instant path. `present` drives both the sheet translateY and the scrim opacity.
  const [mounted, setMounted] = useState(visible);
  const shownRef = useRef(visible); // is the sheet currently presented? (guards a pointless exit anim)
  const present = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (visible) {
      shownRef.current = true;
      setMounted(true);
      if (reduced) { present.setValue(1); return; }
      present.setValue(0);
      const anim = Animated.spring(present, { toValue: 1, ...motion.spring.gentle, useNativeDriver: true });
      anim.start();
      return () => anim.stop();
    }
    if (!shownRef.current) return; // never presented → nothing to animate out
    shownRef.current = false;
    if (reduced) { present.setValue(0); setMounted(false); return; }
    const anim = Animated.spring(present, { toValue: 0, ...motion.spring.gentle, useNativeDriver: true });
    anim.start(({ finished }) => { if (finished) setMounted(false); }); // unmount only when the exit settles
    return () => anim.stop();
  }, [visible, reduced, present]);

  // R3: hardware/system Back must dismiss through the SAME animated exit as a scrim tap. On Android the
  // native Modal auto-dismisses its own window on Back — snapping the sheet shut and bypassing the R1
  // slide-down (onRequestClose alone can't stop that native teardown, which races the JS animation).
  // Intercept Back here while the sheet is shown: run onClose (→ the R1 animated exit via the parent's
  // visible flip) and return true to CONSUME the event so the native window is not torn down mid-anim.
  // onRequestClose stays wired below as a belt-and-suspenders path; onClose is idempotent. The ref keeps
  // the latest onClose without re-registering the listener on every parent re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!visible) return; // only intercept Back while the sheet is actually presented
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseRef.current();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  // R2: the cursor rail + wash settle on a move — an optimistic jump OR the reconcile fade their
  // opacity in rather than teleporting the rail across the list (a dead-track skip snapped twice
  // before). Reduced motion → instant (opacity pinned to 1).
  const railOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) { railOpacity.setValue(1); return; }
    railOpacity.setValue(0);
    const anim = Animated.timing(railOpacity, {
      toValue: 1, duration: motion.duration.base, easing: Easing.bezier(...motion.easing.calm), useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [effectiveCursorId, reduced, railOpacity]);

  // Present/dismiss TRAVEL is derived from the MEASURED sheet height, so a taller sheet fully clears
  // the screen at the animation start instead of peeking. Until measured (jest has no layout), the
  // full viewport height is a safe fallback that always clears on any device.
  const [sheetHeight, setSheetHeight] = useState<number | null>(null);
  const travel = sheetHeight ?? windowHeight;

  // Stable tap handler: a fresh per-row closure here would bust every row's React.memo on any
  // unrelated re-render (L3/V2). One memoized fn; the row binds its own item.
  const onRowPress = useCallback((t: QueueTrack) => {
    if (!t.uri) return;        // M1/L1: a data-only row is never a jump target (defense in depth)
    fireHaptic('selection');   // commit
    setOptimisticId(t.id);     // optimistic rail
    onJump(t);                 // → orchestrator.jumpToId (real state reconciles the rail)
  }, [onJump]);

  // Memoized row renderer feeding stable, per-row props — only the rows whose isCursor flips re-render.
  const renderRow = useCallback(({ item, index }: { item: QueueTrack; index: number }) => (
    <UpNextRow
      item={item}
      index={index}
      n={tracks.length}
      isCursor={item.id === effectiveCursorId}
      isPlaying={isPlaying}
      disconnected={connection === 'disconnected'}
      quadrant={quadrant}
      accent={accent}
      railOpacity={railOpacity}
      c={c}
      onPress={onRowPress}
    />
  ), [tracks, effectiveCursorId, isPlaying, connection, quadrant, accent, railOpacity, c, onRowPress]);

  if (!mounted) return null;

  const n = tracks.length;
  const newCount = tracks.filter((t) => t.recordingKey != null).length;
  const cursorIndex = tracks.findIndex((t) => t.id === effectiveCursorId);
  const lastPlayableId = [...tracks].reverse().find((t) => typeof t.uri === 'string' && t.uri.length > 0)?.id ?? null;

  const disconnected = connection === 'disconnected';
  const foreign = connection === 'connected' && effectiveCursorId != null && cursorIndex === -1;
  const atEnd = effectiveCursorId != null && effectiveCursorId === lastPlayableId;
  const softNote = disconnected ? 'Reconnecting…' : foreign ? 'Playing from Spotify' : null;

  const translateY = present.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] });

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable testID="upnext-scrim" style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close up next" onPress={onClose}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.surface.scrim, opacity: present }]} />
        </Pressable>

        <Animated.View
          testID="upnext-sheet"
          accessibilityViewIsModal
          onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
          style={[styles.sheet, elevation.e3, { backgroundColor: c.surface.overlay, transform: [{ translateY }] }]}
        >
          {/* The grabber doubles as an in-trap "Close" button so SR users have a dismiss INSIDE the
              focus trap (the scrim's Close sits outside accessibilityViewIsModal). */}
          <Pressable
            testID="upnext-grabber"
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close up next"
            hitSlop={space.md}
            style={styles.grabberHit}
          >
            <View style={[styles.grabber, { backgroundColor: c.surface.hairline }]} />
          </Pressable>

          <View style={styles.header}>
            <Text testID="upnext-header" style={{ fontSize: typography.size.subheading, color: c.content.secondary }}>
              {n} tracks · <Text testID="upnext-newcount" style={{ color: accent.ink, fontWeight: typography.weight.semibold }}>{newCount} new</Text> for you
            </Text>
            <View style={styles.attribution}>
              <SpotifyAttribution />
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: c.surface.hairline }]} />

          {softNote ? (
            <Text testID="upnext-note" style={[styles.note, { color: c.content.secondary }]}>{softNote}</Text>
          ) : null}

          <FlatList
            style={styles.list}
            data={tracks}
            keyExtractor={(t) => t.id}
            renderItem={renderRow}
            ItemSeparatorComponent={HairlineSeparator}
            ListFooterComponent={atEnd ? (
              <Text testID="upnext-footer" style={[styles.footer, { color: c.content.tertiary }]}>End of set · finding more…</Text>
            ) : null}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: SHEET_MAX_HEIGHT,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.lg,
    paddingBottom: space.xl,
  },
  grabberHit: { alignSelf: 'center', paddingVertical: space.sm, paddingHorizontal: space.xl, marginTop: space.xs, marginBottom: space.sm },
  grabber: { width: space['2xl'], height: space.xs, borderRadius: radius.pill },
  header: { gap: space.md, paddingBottom: space.md },
  attribution: { alignSelf: 'stretch' },
  divider: { height: StyleSheet.hairlineWidth },
  note: { paddingTop: space.md, fontSize: typography.size.footnote },
  list: { flexShrink: 1, marginTop: space.sm },
  separator: { height: StyleSheet.hairlineWidth },
  footer: { textAlign: 'center', paddingVertical: space.xl, fontSize: typography.size.footnote },
});
