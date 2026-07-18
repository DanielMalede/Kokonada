import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, View, Text, FlatList, RefreshControl, StyleSheet, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, motion } from '../../design/tokens';
import { Skeleton, EmptyState } from '../../design/system';
import { fetchSessions, type SessionItem } from './sessionsApi';
import { SessionsFeed, type SessionsFeedState } from './sessionsFeed';
import { HistoryRow } from './HistoryRow';
import { selectHistoryBody } from './historyFormat';

// §9 History — a QUIET ARCHIVE. The moments are content; the chrome recedes. The frame is STATE-STABLE
// (a pinned "History" header renders identically across loading / empty / error / list — only the body
// swaps). The sacred data layer (SessionsFeed: cursor pagination, single-flight loadMore/refresh) is
// untouched; this file is presentation only. Loading BREATHES (Skeleton, never a spinner); empty and
// error are never-dead-end EmptyStates (never state.danger/red); a failed load-more keeps the list
// intact under a quiet footer note. Tokens only — zero raw hex/px. One container entrance, reduced-safe.

const INITIAL: SessionsFeedState = {
  items: [], cursor: null, loading: false, refreshing: false, reachedEnd: false, error: null,
};
const ENTER_BEZIER = Easing.bezier(...motion.easing.enter);
const MEDALLION = space['2xl']; // 32 — mirrors the real row's leading medallion
const SKELETON_ROWS = 7;        // first-page placeholder count (a count, not a visual token)

export interface HistoryScreenProps {
  // Navigation seams (wired by the shell, out of this presentation task) — safe no-op defaults.
  onGenerate?: () => void;                     // EmptyState CTA → Generate tab
  onOpenSession?: (item: SessionItem) => void; // row tap → replay this moment
}

// One skeleton card, mirroring the real row silhouette. Ghosts read the nearest Skeleton.Group's single
// breath driver, so a group of these pulses in phase (compose from primitives — NOT Skeleton.Row, which
// draws two body lines; the real card has one).
function SkeletonRow() {
  const { c } = useTheme();
  return (
    <View style={[skel.card, elevation.e1, { backgroundColor: c.surface.raised }]}>
      <Skeleton variant="line" onSurface="raised" width={MEDALLION} style={{ height: MEDALLION, borderRadius: radius.md }} />
      <View style={skel.textCol}>
        <Skeleton variant="title" onSurface="raised" width="55%" />
        <Skeleton variant="line" onSurface="raised" width="70%" />
      </View>
    </View>
  );
}

function FirstPageSkeleton() {
  return (
    <Skeleton.Group label="Loading your moments" style={skel.group}>
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => <SkeletonRow key={i} />)}
    </Skeleton.Group>
  );
}

// A quiet, non-alarm footer note (list background = surface.base → content.secondary is AA there).
function FooterNote({ text }: { text: string }) {
  const { c } = useTheme();
  return <Text style={[skel.footerNote, { color: c.content.secondary }]}>{text}</Text>;
}

export function HistoryScreen({ onGenerate = () => {}, onOpenSession = () => {} }: HistoryScreenProps = {}) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const insets = useSafeAreaInsets();

  const [state, setState] = useState<SessionsFeedState>(INITIAL);
  const [hasLoaded, setHasLoaded] = useState(false); // true once the FIRST page RESOLVES — guards the empty-flash
  const feedRef = useRef<SessionsFeed | null>(null);
  const nowRef = useRef(new Date()).current; // stable per mount → memoized rows never churn on scroll

  useEffect(() => {
    let mounted = true;
    const feed = new SessionsFeed((cur) => fetchSessions(cur), (s) => { if (mounted) setState(s); });
    feedRef.current = feed;
    void feed.loadMore().then(() => { if (mounted) setHasLoaded(true); });
    return () => { mounted = false; };
  }, []);

  // Single-container entrance — fade + rise the WHOLE list once, when the first items paint. Guarded by a
  // ref so pagination/refresh never re-fire it. Reduced motion snaps to rest (opacity 1, translateY 0) —
  // opacity/transform only, so the layout is byte-identical to the animated path.
  const entered = useRef(false);
  const entryOpacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const entryTranslate = useRef(new Animated.Value(reduced ? 0 : space.md)).current;
  useEffect(() => {
    if (entered.current || state.items.length === 0) return;
    entered.current = true;
    if (reduced) { entryOpacity.setValue(1); entryTranslate.setValue(0); return; }
    Animated.parallel([
      Animated.timing(entryOpacity, { toValue: 1, duration: duration.slow, easing: ENTER_BEZIER, useNativeDriver: true }),
      Animated.timing(entryTranslate, { toValue: 0, duration: duration.slow, easing: ENTER_BEZIER, useNativeDriver: true }),
    ]).start();
  }, [state.items.length, reduced, duration.slow, entryOpacity, entryTranslate]);

  const onRowPress = useCallback((it: SessionItem) => onOpenSession(it), [onOpenSession]);
  const retry = useCallback(() => { void feedRef.current?.refresh(); }, []);

  const renderFooter = () => {
    if (state.items.length === 0) return null;
    if (state.loading) return <Skeleton.Group label="Loading more moments" style={skel.footerGroup}><SkeletonRow /></Skeleton.Group>;
    if (state.error) return <FooterNote text="Couldn’t load more — pull to retry" />;
    if (state.reachedEnd) return <FooterNote text="You’re all caught up" />;
    return null;
  };

  // The body is chosen by the PURE selector (unit-pinned in historyFormat.test) — the screen only paints
  // the chosen state. This keeps the load-bearing empty-flash gate honest in isolation, out of reach of a
  // mount effect the render test can't rewind.
  const view = selectHistoryBody({
    hasLoaded,
    items: state.items.length,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
  });
  let body: React.ReactNode;
  if (view === 'skeleton') {
    body = <FirstPageSkeleton />; // first page / retry in flight — never the empty flash
  } else if (view === 'error') {
    body = (
      <EmptyState
        title="We couldn't load your moments"
        body="Check your connection and try again."
        action={{ label: 'Try again', onPress: retry }}
      />
    );
  } else if (view === 'empty') {
    body = (
      <EmptyState
        title="Your moments will live here"
        body="Generate a soundtrack and it'll be saved here to revisit anytime."
        action={{ label: 'Generate a soundtrack', onPress: onGenerate }}
      />
    );
  } else {
    body = (
      <Animated.View testID="history-list-container" style={[styles.fill, { opacity: entryOpacity, transform: [{ translateY: entryTranslate }] }]}>
        <FlatList
          testID="history-list"
          data={state.items}
          keyExtractor={(e) => e.id}
          renderItem={({ item }) => <HistoryRow item={item} now={nowRef} onPress={onRowPress} />}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + space['3xl'] }]}
          onEndReachedThreshold={0.4}
          onEndReached={() => feedRef.current?.loadMore()}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={state.refreshing}
              onRefresh={() => feedRef.current?.refresh()}
              tintColor={c.accent.glow}
              colors={[c.accent.glow]}
              progressBackgroundColor={c.surface.raised}
            />
          }
          ListFooterComponent={renderFooter()}
        />
      </Animated.View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      <View style={[styles.header, { paddingTop: insets.top + space.md }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>History</Text>
      </View>
      <View style={styles.fill}>{body}</View>
    </View>
  );
}

function Separator() { return <View style={styles.separator} />; }

const styles = StyleSheet.create({
  screen: { flex: 1 },
  fill: { flex: 1 },
  header: { paddingHorizontal: space.xl, paddingBottom: space.lg },
  title: { fontSize: typography.size.title, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.heading },
  listContent: { paddingHorizontal: space.xl, paddingTop: space.md },
  separator: { height: space.md },
});

// Skeleton + footer geometry (the group's base padding is overridden to match the list gutter/rhythm).
const skel = StyleSheet.create({
  group: { padding: 0, paddingHorizontal: space.xl, paddingTop: space.md, gap: space.md },
  footerGroup: { padding: 0, paddingTop: space.md, gap: space.md }, // inside the list → inherits the gutter
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, padding: space.lg, overflow: 'hidden' },
  textCol: { flex: 1, gap: space.xs },
  footerNote: { textAlign: 'center', paddingVertical: space.lg, fontSize: typography.size.footnote, fontWeight: typography.weight.medium },
});
