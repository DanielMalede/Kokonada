import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, ScrollView } from 'react-native';
import { warmStore } from '../../state/store';
import type { WarmState } from '../../state/warm/warmStore';
import { pulseStateStore, type PulseStoreState } from './pulseStateStore';
import { friendlyStatus } from './statusLabels';
import { getLastSyncCounts, subscribeSyncCounts, type SyncCounts } from '../../health/healthSync';

// Pulse: the live biometric lane (warm-store HR / source / socket) PLUS the richer
// state-vector snapshot (HRV, body battery, readiness, last-night sleep, and the
// classifier status) fetched from GET /api/pulse/state. Every value is null-safe —
// a missing MedicalProfile renders placeholders, never a crash. Raw HR is display-only.

function Gauge({ label, value, unit, note }: { label: string; value: number | null; unit?: string; note?: string }) {
  return (
    <View style={{ flexBasis: '48%', paddingVertical: 12 }}>
      <Text style={{ fontSize: 12, opacity: 0.5, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 24, fontWeight: '700' }}>
        {value != null ? value : '—'}
        {value != null && unit ? <Text style={{ fontSize: 13, opacity: 0.6 }}> {unit}</Text> : null}
      </Text>
      {/* Honest note for metrics with no data source (not a broken gauge). Body Battery &
          Readiness are Garmin-proprietary — unavailable via Health Connect (defect D-4b). */}
      {value == null && note ? <Text style={{ fontSize: 11, opacity: 0.4 }}>{note}</Text> : null}
    </View>
  );
}

export function PulseScreen() {
  const [w, setW] = useState<Pick<WarmState, 'liveHr' | 'connection' | 'biometricSource'>>(() => {
    const s = warmStore.getState();
    return { liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource };
  });
  const [pulse, setPulse] = useState<PulseStoreState>(() => pulseStateStore.getState());
  const [counts, setCounts] = useState<SyncCounts | null>(() => getLastSyncCounts());

  useEffect(() => {
    let mounted = true;
    const syncWarm = (s: WarmState) => { if (mounted) setW({ liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource }); };
    const syncPulse = (s: PulseStoreState) => { if (mounted) setPulse(s); };
    syncWarm(warmStore.getState());
    const offWarm = warmStore.subscribe(syncWarm);
    const offPulse = pulseStateStore.subscribe(syncPulse);
    const offCounts = subscribeSyncCounts((c) => { if (mounted) setCounts(c); });
    return () => { mounted = false; offWarm(); offPulse(); offCounts(); };
  }, []);

  // Re-fetch on EVERY tab focus, not just first mount. A bottom-tab screen stays MOUNTED
  // after its first visit, so a mount-only fetch left Pulse showing a stale snapshot after a
  // health sync — the vitals had landed server-side (/api/pulse/state returns them) but Pulse
  // never re-read it. Refreshing on focus makes a Sync on the Profile tab reflect on return.
  useFocusEffect(useCallback(() => {
    void pulseStateStore.getState().refresh();
    setCounts(getLastSyncCounts());
  }, []));

  // Honest gauge note (D-4a v2 / #90): distinguish the three reasons a gauge is blank.
  //   • the watch never shared this metric (last sync read 0 of it) → say so
  //   • the watch DID share it but it isn't in the profile yet (upload lag/failure — the
  //     #90 symptom) → don't pretend it's missing; point the user at a re-sync
  //   • no sync evidence at all this session → a bare "—" (nothing to explain yet)
  const gaugeNote = (read?: number) => {
    if (!counts) return undefined;
    if (read === 0) return 'Not shared by your watch';
    return 'Not in your profile yet — re-sync';
  };

  const source = w.biometricSource === 'none' ? 'No biometric source' : w.biometricSource.toUpperCase();
  const data = pulse.data;
  const sv = data?.stateVector;
  const status = friendlyStatus(sv?.status);

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 8 }}>
      <View style={{ alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Text style={{ fontSize: 56, fontWeight: '800' }}>{w.liveHr != null ? w.liveHr : '—'}</Text>
        <Text style={{ fontSize: 15, opacity: 0.7 }}>bpm · {source}</Text>
        <Text style={{ fontSize: 12, opacity: 0.4 }}>socket: {w.connection}</Text>
      </View>

      {status ? (
        <View style={{ alignItems: 'center', paddingVertical: 12, marginBottom: 4 }}>
          <Text style={{ fontSize: 18, fontWeight: '600' }}>{status}</Text>
          {sv?.confidence != null ? (
            <Text style={{ fontSize: 12, opacity: 0.5 }}>{Math.round(sv.confidence * 100)}% confidence</Text>
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Gauge label="HRV" value={data?.vitals.hrv ?? null} unit="ms" note={gaugeNote(counts?.hrv)} />
        <Gauge label="Body Battery" value={data?.vitals.bodyBattery ?? null} note="Garmin only" />
        <Gauge label="Readiness" value={data?.vitals.dailyReadiness ?? null} note="Garmin only" />
        <Gauge label="Resting HR" value={data?.vitals.restingHeartRate ?? null} unit="bpm" note={gaugeNote(counts?.restingHeartRate)} />
        <Gauge label="Deep Sleep" value={data?.sleep.lastNight.deep ?? null} unit="min" note={gaugeNote(counts?.sleep)} />
        <Gauge label="REM Sleep" value={data?.sleep.lastNight.rem ?? null} unit="min" note={gaugeNote(counts?.sleep)} />
      </View>
    </ScrollView>
  );
}
