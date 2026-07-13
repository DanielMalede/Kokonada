import React from 'react';
import { View, Text, Pressable, Animated, StyleSheet } from 'react-native';
import { space, radius, type as typography } from '../../design/tokens';
import type { EmotionQuadrant, EmotionQuadrantColor, ColorScheme } from '../../design/tokens';
import { DiscoveryBadge } from '../../design/components/DiscoveryBadge';
import type { QueueTrack } from './playbackQueue';

// One Up-Next row, memoized so an unrelated re-render of the sheet (a cursor move, a connection
// blip) only re-renders the rows that actually changed (L3/V2). Keyed off the effective cursor via
// the `isCursor` boolean, so exactly the two rows whose cursor state flips re-render.
//
// M1/L1: a data-only (uri:null) row — an unresolved YouTube discovery track — is a TRUE no-op. It is
// non-interactive (no Pressable, no onPress, no button role) and carries a plain, non-"Play" label,
// so a tap can never move the rail onto a non-playable row and strand the real cursor.

// The 3px cursor rail (spec §2.b) — a design value with no design token (the ART_SIZE precedent).
const CURSOR_RAIL_WIDTH = 3;

export interface UpNextRowProps {
  item: QueueTrack;
  index: number;
  n: number;
  isCursor: boolean;
  isPlaying: boolean;
  disconnected: boolean;
  quadrant: EmotionQuadrant;
  accent: EmotionQuadrantColor;
  // Opacity of the cursor rail + wash — driven by the sheet so the optimistic move and the reconcile
  // both SETTLE rather than blink (R2). Same stable Animated.Value for every row → never busts memo.
  railOpacity: Animated.Value;
  c: ColorScheme;
  // Stable tap handler (the sheet passes one memoized fn); the row binds the item.
  onPress: (t: QueueTrack) => void;
}

function rowLabel(item: QueueTrack, index: number, n: number, isCursor: boolean, isPlaying: boolean, interactive: boolean): string {
  // A playable row is a "Play …" button; a data-only row is plain static text (never "Play", never a button).
  let s = interactive ? `Play ${item.title} by ${item.artist}` : `${item.title} by ${item.artist}`;
  if (item.recordingKey != null) s += ', new discovery';
  if (interactive && isCursor) s += isPlaying ? ', now playing' : ', paused';
  return `${s}, track ${index + 1} of ${n}`;
}

function UpNextRowBase({ item, index, n, isCursor, isPlaying, disconnected, quadrant, accent, railOpacity, c, onPress }: UpNextRowProps) {
  const isDiscovery = item.recordingKey != null;
  const interactive = typeof item.uri === 'string' && item.uri.length > 0;
  const titleColor = disconnected ? c.content.tertiary : c.content.primary;
  const artistColor = disconnected ? c.content.tertiary : c.content.secondary;

  const body = (
    <>
      {/* Cursor wash — fades with railOpacity so a jump settles, never teleports (R2). */}
      {isCursor ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: accent.wash, opacity: railOpacity, borderRadius: radius.md }]}
        />
      ) : null}
      {isCursor ? (
        <Animated.View testID="upnext-cursor-rail" style={[styles.rail, { backgroundColor: accent.ink, opacity: railOpacity }]} />
      ) : (
        <View style={[styles.rail, { backgroundColor: 'transparent' }]} />
      )}
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
    </>
  );

  // A data-only row is static, non-interactive text — never a button, never tappable (M1/L1).
  if (!interactive) {
    return (
      <View testID={`upnext-row-${item.id}`} accessible accessibilityRole="text" accessibilityLabel={rowLabel(item, index, n, false, false, false)} style={styles.row}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={`upnext-row-${item.id}`}
      onPress={() => onPress(item)}
      accessibilityRole="button"
      accessibilityLabel={rowLabel(item, index, n, isCursor, isPlaying, true)}
      style={styles.row}
    >
      {body}
    </Pressable>
  );
}

// Default shallow memo: the sheet passes per-row-stable props (stable item + accent + onPress + a
// stable railOpacity ref), so only the rows whose isCursor flips actually re-render (V2).
export const UpNextRow = React.memo(UpNextRowBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingRight: space.sm, borderRadius: radius.md, overflow: 'hidden' },
  rail: { width: CURSOR_RAIL_WIDTH, alignSelf: 'stretch', borderRadius: radius.pill },
  rowText: { flex: 1 },
});
