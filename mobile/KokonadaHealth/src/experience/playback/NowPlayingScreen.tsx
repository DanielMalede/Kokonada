import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { nowPlayingStore } from './nowPlayingStore';
import { orchestrator } from './playbackServices';
import type { NowPlaying } from './playbackOrchestrator';

// Now Playing: the current track + transport controls, driven entirely by the
// unit-tested PlaybackOrchestrator. Subscribes to the nowPlaying observable with a
// useEffect cleanup (no subscription leak — the S10-1 lesson is pinned).
export function NowPlayingScreen() {
  const [state, setState] = useState<NowPlaying>({
    track: nowPlayingStore.getState().track,
    isPlaying: nowPlayingStore.getState().isPlaying,
  });

  useEffect(() => {
    const sync = (s: any) => setState({ track: s.track, isPlaying: s.isPlaying });
    sync(nowPlayingStore.getState());
    return nowPlayingStore.subscribe(sync);
  }, []);

  const { track, isPlaying } = state;

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, padding: 24 }}>
      <Text style={{ fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
        {track ? track.title : 'Nothing playing yet'}
      </Text>
      <Text style={{ fontSize: 15, opacity: 0.7 }}>{track ? track.artist : 'Generate a vibe to start'}</Text>
      <View style={{ flexDirection: 'row', gap: 20, marginTop: 12 }}>
        <Pressable onPress={() => orchestrator.skipPrev()}><Text style={{ fontSize: 22 }}>⏮</Text></Pressable>
        <Pressable disabled={!track} onPress={() => orchestrator.togglePlayPause()}>
          <Text style={{ fontSize: 28 }}>{isPlaying ? '⏸' : '▶️'}</Text>
        </Pressable>
        <Pressable onPress={() => orchestrator.skipNext()}><Text style={{ fontSize: 22 }}>⏭</Text></Pressable>
      </View>
    </View>
  );
}
