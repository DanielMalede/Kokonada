import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, FlatList, Animated, StyleSheet } from 'react-native';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, motion } from '../../design/tokens';
import type { EmotionQuadrant } from '../../design/tokens';
import { DiscoveryBadge } from '../../design/components/DiscoveryBadge';
import { SpotifyAttribution } from '../player/SpotifyAttribution';
import { fireHaptic } from '../../design/haptics';
import type { QueueTrack } from './playbackQueue';

// Up-Next queue sheet (SCREENS §7, finally built). A modal over Now Playing that lists the generated
// set with the live cursor — pure typography + accent, NO per-track cover art (compliant + a 60fps
// decision). Tap a row → playback jumps there through the orchestrator (the #130 self-heal path).

// Design values with no design token (following the ART_SIZE precedent): a 3px cursor rail (spec
// §2.b) and the slide-in travel of the present animation.
const CURSOR_RAIL_WIDTH = 3;
const SHEET_PRESENT_TRAVEL = 480;
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
  const accent = c.emotionAccent[quadrant];

  // Optimistic cursor: a tap moves the rail immediately, then the real orchestrator state (arriving
  // via currentTrackId) RECONCILES it — if the jump lands elsewhere (dead-track skip / disconnect),
  // the rail follows reality with no error. Reset whenever the real cursor changes.
  const [optimisticId, setOptimisticId] = useState<string | null>(null);
  useEffect(() => { setOptimisticId(null); }, [currentTrackId]);
  const effectiveCursorId = optimisticId ?? currentTrackId;

  // Present/dismiss motion: gentle spring slide + scrim fade; reduced motion → instant, scrim toggles
  // instantly (matches PlaybackAura's still-under-reduce convention — the slide is torn down).
  const present = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) return;
    if (reduced) { present.setValue(1); return; }
    present.setValue(0);
    const anim = Animated.spring(present, { toValue: 1, ...motion.spring.gentle, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [visible, reduced, present]);

  if (!visible) return null;

  const n = tracks.length;
  const newCount = tracks.filter((t) => t.recordingKey != null).length;
  const cursorIndex = tracks.findIndex((t) => t.id === effectiveCursorId);
  const lastPlayableId = [...tracks].reverse().find((t) => typeof t.uri === 'string' && t.uri.length > 0)?.id ?? null;

  const disconnected = connection === 'disconnected';
  const foreign = connection === 'connected' && effectiveCursorId != null && cursorIndex === -1;
  const atEnd = effectiveCursorId != null && effectiveCursorId === lastPlayableId;
  const softNote = disconnected ? 'Reconnecting…' : foreign ? 'Playing from Spotify' : null;

  const translateY = present.interpolate({ inputRange: [0, 1], outputRange: [SHEET_PRESENT_TRAVEL, 0] });

  const onRowPress = (t: QueueTrack) => {
    fireHaptic('selection');   // commit
    setOptimisticId(t.id);     // optimistic rail
    onJump(t);                 // → orchestrator.jumpToId (real state reconciles the rail)
  };

  const rowLabel = (t: QueueTrack, index: number) => {
    let s = `Play ${t.title} by ${t.artist}`;
    if (t.recordingKey != null) s += ', new discovery';
    if (t.id === effectiveCursorId) s += isPlaying ? ', now playing' : ', paused';
    return `${s}, track ${index + 1} of ${n}`;
  };

  const renderRow = ({ item, index }: { item: QueueTrack; index: number }) => {
    const isCursor = item.id === effectiveCursorId;
    const isDiscovery = item.recordingKey != null;
    const titleColor = disconnected ? c.content.tertiary : c.content.primary;
    const artistColor = disconnected ? c.content.tertiary : c.content.secondary;
    return (
      <Pressable
        testID={`upnext-row-${item.id}`}
        onPress={() => onRowPress(item)}
        accessibilityRole="button"
        accessibilityLabel={rowLabel(item, index)}
        style={[styles.row, { backgroundColor: isCursor ? accent.wash : 'transparent' }]}
      >
        <View
          {...(isCursor ? { testID: 'upnext-cursor-rail' } : {})}
          style={[styles.rail, { backgroundColor: isCursor ? accent.ink : 'transparent' }]}
        />
        <View style={styles.rowText}>
          <Text
            numberOfLines={1}
            style={{ fontSize: typography.size.callout, fontWeight: isCursor ? typography.weight.semibold : typography.weight.regular, color: titleColor }}
          >
            {item.title}
          </Text>
          <Text numberOfLines={1} style={{ marginTop: space.xs, fontSize: typography.size.footnote, color: artistColor }}>
            {item.artist}
          </Text>
        </View>
        {isCursor ? (
          <Text testID="upnext-cursor-glyph" style={{ fontSize: typography.size.footnote, color: accent.ink }}>
            {isPlaying ? '▶' : '❙❙'}
          </Text>
        ) : null}
        {isDiscovery ? <DiscoveryBadge quadrant={quadrant} /> : null}
      </Pressable>
    );
  };

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.fill}>
        <Pressable testID="upnext-scrim" style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close up next" onPress={onClose}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.surface.scrim, opacity: present }]} />
        </Pressable>

        <Animated.View
          testID="upnext-sheet"
          accessibilityViewIsModal
          style={[styles.sheet, elevation.e3, { backgroundColor: c.surface.overlay, transform: [{ translateY }] }]}
        >
          <View style={[styles.grabber, { backgroundColor: c.surface.hairline }]} importantForAccessibility="no-hide-descendants" />

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
  grabber: { width: space['2xl'], height: space.xs, borderRadius: radius.pill, alignSelf: 'center', marginTop: space.sm, marginBottom: space.md },
  header: { gap: space.md, paddingBottom: space.md },
  attribution: { alignSelf: 'stretch' },
  divider: { height: StyleSheet.hairlineWidth },
  note: { paddingTop: space.md, fontSize: typography.size.footnote },
  list: { flexShrink: 1, marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingRight: space.sm, borderRadius: radius.md },
  rail: { width: CURSOR_RAIL_WIDTH, alignSelf: 'stretch', borderRadius: radius.pill },
  rowText: { flex: 1 },
  separator: { height: StyleSheet.hairlineWidth },
  footer: { textAlign: 'center', paddingVertical: space.xl, fontSize: typography.size.footnote },
});
