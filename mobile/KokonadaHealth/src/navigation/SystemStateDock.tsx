import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMotion } from '../design/theme';
import { space, motion } from '../design/tokens';
import { OfflineBanner } from '../design/system/OfflineBanner';
import { warmStore as singletonWarmStore } from '../state/store';
import type { WarmStore, WarmState } from '../state/warm/warmStore';

// The E2 system-state shell: it mounts the E1 OfflineBanner ONCE, at the very top of the app, so
// "the music never stops" is a single global truth rather than a per-screen concern. It is
// DISPLAY-ONLY — it SEEDS + SUBSCRIBES to the warm lane's `connection` signal and passes it to the
// banner, but never mutates it and never opens/closes the socket (socketClient owns reconnection;
// onRetry is the injected entry to it). The banner already owns its OFFLINE_GRACE_MS blip debounce,
// so the connection is passed RAW — double-debouncing would compound the grace to ~2.8s.
//
// It docks at the TOP safe-area inset, full-width, above every screen header, and PARTICIPATES in
// layout (content shifts down, is never occluded). The calm appear/recede slide lives HERE (not in
// the banner) — driven off the banner's onVisibleChange visible edge, so a copy switch never
// re-slides. Reduced motion snaps it in place; the layout is byte-identical either way.

const SLIDE_BEZIER = Easing.bezier(...motion.easing.calm);

export interface SystemStateDockProps {
  // Injectable for tests (a real, isolated warm store); production uses the app singleton.
  store?: WarmStore;
  // The socket reconnect entry (socketClient owns connect/disconnect — the dock never does).
  onRetry?: () => void;
}

export function SystemStateDock({ store = singletonWarmStore, onRetry }: SystemStateDockProps) {
  const insets = useSafeAreaInsets();
  const { reduced, duration } = useMotion();
  const [connection, setConnection] = useState(() => store.getState().connection);

  // Seed + subscribe (PulseScreen warm-lane pattern); dispose on unmount so a backgrounded shell
  // never leaks a listener into the long-lived singleton store.
  useEffect(() => {
    let mounted = true;
    const sync = (s: WarmState) => { if (mounted) setConnection(s.connection); };
    sync(store.getState());
    const off = store.subscribe(sync);
    return () => { mounted = false; off(); };
  }, [store]);

  // CF-1: the calm slide. 0 = tucked up + transparent, 1 = seated + opaque. Fired only on the
  // banner's VISIBLE edge (hidden↔shown), never on an offline↔connecting copy switch.
  const slide = useRef(new Animated.Value(0)).current;
  const onVisibleChange = (visible: boolean) => {
    const to = visible ? 1 : 0;
    if (reduced) { slide.setValue(to); return; }
    Animated.timing(slide, { toValue: to, duration: duration.base, easing: SLIDE_BEZIER, useNativeDriver: true }).start();
  };

  return (
    <View testID="system-state-dock" style={{ paddingTop: insets.top }}>
      <Animated.View
        style={{
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-space.md, 0] }) }],
        }}
      >
        <OfflineBanner status={connection} onRetry={onRetry} onVisibleChange={onVisibleChange} />
      </Animated.View>
    </View>
  );
}
