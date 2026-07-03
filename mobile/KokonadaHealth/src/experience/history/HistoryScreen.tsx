import React, { useEffect, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { nowPlayingStore } from '../playback/nowPlayingStore';

// History: the recently-played tracks this session. A persistent server-side
// history feed (GET /api/sessions) lands with the account-history sprint; for now
// this reflects the live session so the tab is real, not empty.
interface Entry { id: string; title: string; artist: string; }

export function HistoryScreen() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(() => {
    const push = (s: any) => {
      const t = s.track;
      if (!t) return;
      setEntries((prev) => (prev[0]?.id === t.id ? prev : [{ id: t.id, title: t.title, artist: t.artist }, ...prev].slice(0, 50)));
    };
    push(nowPlayingStore.getState());
    return nowPlayingStore.subscribe(push);
  }, []);

  if (entries.length === 0) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ opacity: 0.6 }}>Nothing played yet</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={entries}
      keyExtractor={(e, i) => `${e.id}-${i}`}
      contentContainerStyle={{ padding: 20, gap: 12 }}
      renderItem={({ item }) => (
        <View>
          <Text style={{ fontSize: 16, fontWeight: '600' }}>{item.title}</Text>
          <Text style={{ fontSize: 13, opacity: 0.6 }}>{item.artist}</Text>
        </View>
      )}
    />
  );
}
