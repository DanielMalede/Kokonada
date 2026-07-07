import React, { useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable } from 'react-native';
import { fetchSessions, type SessionItem } from './sessionsApi';
import { SessionsFeed, type SessionsFeedState } from './sessionsFeed';

// History: the persistent server-side feed (GET /api/sessions, A11). Replaces the old
// live-only in-memory list. Infinite scroll + pull-to-refresh, both single-flight via
// SessionsFeed; the feed callback is guarded against a post-unmount setState (the S10-1
// parity lesson — React 18 removed the unmounted-setState warning).

const INITIAL: SessionsFeedState = {
  items: [], cursor: null, loading: false, refreshing: false, reachedEnd: false, error: null,
};

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function Row({ item }: { item: SessionItem }) {
  // Friendly title + Manual/Live · activity subtext (D-3). Fall back for pre-D-3 cached rows.
  const title = item.title ?? item.moodKey ?? 'Session';
  const sourceLabel = (item.source ?? (item.moodKey?.startsWith('bio:') ? 'live' : 'manual')) === 'live' ? 'Live' : 'Manual';
  const meta = [sourceLabel, item.activityLabel].filter(Boolean).join(' · ');
  const sub = item.tracks.length
    ? `${item.tracks[0].title} — ${item.tracks[0].artist}${item.trackCount > 1 ? ` +${item.trackCount - 1}` : ''}`
    : `${item.trackCount} track${item.trackCount === 1 ? '' : 's'}`;
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 15, fontWeight: '600' }}>{title}{item.isFallback ? ' · fallback' : ''}</Text>
      <Text style={{ fontSize: 12, opacity: 0.55 }}>{meta}</Text>
      <Text style={{ fontSize: 13, opacity: 0.7 }}>{sub}</Text>
      {item.contextPrompt ? <Text style={{ fontSize: 12, opacity: 0.5, fontStyle: 'italic' }}>“{item.contextPrompt}”</Text> : null}
      <Text style={{ fontSize: 11, opacity: 0.4 }}>{timeLabel(item.createdAt)}</Text>
    </View>
  );
}

export function HistoryScreen() {
  const [state, setState] = useState<SessionsFeedState>(INITIAL);
  const feedRef = useRef<SessionsFeed | null>(null);

  useEffect(() => {
    let mounted = true;
    const feed = new SessionsFeed((c) => fetchSessions(c), (s) => { if (mounted) setState(s); });
    feedRef.current = feed;
    void feed.loadMore();
    return () => { mounted = false; };
  }, []);

  if (state.error && state.items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text style={{ opacity: 0.6 }}>{state.error}</Text>
        <Pressable onPress={() => feedRef.current?.loadMore()} accessibilityRole="button">
          <Text style={{ color: '#4f8cff' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!state.loading && state.items.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ opacity: 0.6 }}>Nothing yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={state.items}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 20, gap: 16 }}
      renderItem={({ item }) => <Row item={item} />}
      onEndReachedThreshold={0.4}
      onEndReached={() => feedRef.current?.loadMore()}
      refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={() => feedRef.current?.refresh()} />}
      ListFooterComponent={state.loading ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null}
    />
  );
}
