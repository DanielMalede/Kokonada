import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { warmStore } from '../../state/store';
import type { WarmState } from '../../state/warm/warmStore';
import { pulseStateStore, type PulseStoreState } from './pulseStateStore';

// Pulse: the live biometric lane (warm-store HR / source / socket) PLUS the richer
// state-vector snapshot (HRV, body battery, readiness, last-night sleep, and the
// classifier status) fetched from GET /api/pulse/state. Every value is null-safe —
// a missing MedicalProfile renders placeholders, never a crash. Raw HR is display-only.

function Gauge({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <View style={{ flexBasis: '48%', paddingVertical: 12 }}>
      <Text style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>
        {value != null ? value : '—'}
        {value != null && unit ? <Text style={{ fontSize: 13, opacity: 0.6 }}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export function PulseScreen() {
  const [w, setW] = useState<Pick<WarmState, 'liveHr' | 'connection' | 'biometricSource'>>(() => {
    const s = warmStore.getState();
    return { liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource };
  });
  const [pulse, setPulse] = useState<PulseStoreState>(() => pulseStateStore.getState());

  useEffect(() => {
    let mounted = true;
    const syncWarm = (s: WarmState) => { if (mounted) setW({ liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource }); };
    const syncPulse = (s: PulseStoreState) => { if (mounted) setPulse(s); };
    syncWarm(warmStore.getState());
    const offWarm = warmStore.subscribe(syncWarm);
    const offPulse = pulseStateStore.subscribe(syncPulse);
    void pulseStateStore.getState().refresh(); // fetch on tab focus
    return () => { mounted = false; offWarm(); offPulse(); };
  }, []);

  const source = w.biometricSource === 'none' ? 'No biometric source' : w.biometricSource.toUpperCase();
  const data = pulse.data;
  const sv = data?.stateVector;

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 8 }}>
      <View style={{ alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Text style={{ fontSize: 56, fontWeight: '800' }}>{w.liveHr != null ? w.liveHr : '—'}</Text>
        <Text style={{ fontSize: 15, opacity: 0.7 }}>bpm · {source}</Text>
        <Text style={{ fontSize: 12, opacity: 0.4 }}>socket: {w.connection}</Text>
      </View>

      {sv?.status ? (
        <View style={{ alignItems: 'center', paddingVertical: 12, marginBottom: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>{sv.status}</Text>
          {sv.confidence != null ? (
            <Text style={{ fontSize: 12, opacity: 0.5 }}>{Math.round(sv.confidence * 100)}% confidence</Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Gauge label="HRV" value={data?.vitals.hrv ?? null} unit="ms" />
        <Gauge label="Body Battery" value={data?.vitals.bodyBattery ?? null} />
        <Gauge label="Readiness" value={data?.vitals.dailyReadiness ?? null} />
        <Gauge label="Resting HR" value={data?.vitals.restingHeartRate ?? null} unit="bpm" />
        <Gauge label="Deep Sleep" value={data?.sleep.lastNight.deep ?? null} unit="min" />
        <Gauge label="REM Sleep" value={data?.sleep.lastNight.rem ?? null} unit="min" />
      </View>
    </ScrollView>
  );
}
