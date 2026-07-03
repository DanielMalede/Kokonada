import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { warmStore } from '../../state/store';
import type { WarmState } from '../../state/warm/warmStore';

// Pulse: the live biometric lane at a glance — heart rate, connection, and the
// active biometric source. Reads the warm store with a useEffect cleanup (no
// subscription leak). Raw HR is display-only and never persisted.
export function PulseScreen() {
  const [w, setW] = useState<Pick<WarmState, 'liveHr' | 'connection' | 'biometricSource'>>(() => {
    const s = warmStore.getState();
    return { liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource };
  });

  useEffect(() => {
    const sync = (s: WarmState) => setW({ liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource });
    sync(warmStore.getState());
    return warmStore.subscribe(sync);
  }, []);

  const source = w.biometricSource === 'none' ? 'No biometric source' : w.biometricSource.toUpperCase();

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <Text style={{ fontSize: 56, fontWeight: '800' }}>{w.liveHr != null ? w.liveHr : '—'}</Text>
      <Text style={{ fontSize: 15, opacity: 0.7 }}>bpm · {source}</Text>
      <Text style={{ fontSize: 13, opacity: 0.5 }}>socket: {w.connection}</Text>
    </View>
  );
}
