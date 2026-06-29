import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  checkAvailability,
  openHealthConnectInStore,
  requestHealthPermissions,
} from '../health/healthConnect';
import { hasGrantedRecord } from '../health/permissions';
import { fetchSixMonthHistory } from '../health/fetchHistory';
import { summarizeSleep, toBackendSamples } from '../health/mapToBackend';
import { uploadSamples } from '../health/uploadClient';
import { isLoggedIn, signInWithGoogle, signOut, type KokonadaUser } from '../auth/auth';

type Phase =
  | 'checking'
  | 'install-required'
  | 'signed-out'
  | 'idle'
  | 'working'
  | 'needs-garmin'
  | 'done'
  | 'error';

export default function ConnectHealthScreen() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [status, setStatus] = useState('Checking Health Connect…');
  const [user, setUser] = useState<KokonadaUser | null>(null);
  const [result, setResult] = useState<{ accepted: number; inserted: number; metrics: Record<string, number> } | null>(null);
  const [sleep, setSleep] = useState<ReturnType<typeof summarizeSleep> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const avail = await checkAvailability();
        if (avail === 'install-required') return setPhase('install-required');
        if (avail === 'unsupported') { setError('Android only.'); return setPhase('error'); }
        setPhase((await isLoggedIn()) ? 'idle' : 'signed-out');
      } catch (e: any) {
        setError(String(e?.message ?? e));
        setPhase('error');
      }
    })();
  }, []);

  async function onSignIn() {
    setPhase('working');
    setStatus('Signing in…');
    try {
      const u = await signInWithGoogle();
      setUser(u);
      setPhase('idle');
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPhase('error');
    }
  }

  async function onSignOut() {
    await signOut();
    setUser(null);
    setResult(null);
    setPhase('signed-out');
  }

  async function onConnect() {
    setPhase('working');
    try {
      setStatus('Requesting Health Connect permissions…');
      const granted = await requestHealthPermissions();
      if (!hasGrantedRecord(granted, 'HeartRate')) {
        setError('Heart-rate permission was not granted.');
        return setPhase('error');
      }

      setStatus('Reading up to 6 months of history…');
      const history = await fetchSixMonthHistory();
      const samples = toBackendSamples(history);
      setSleep(summarizeSleep(history.sleep));

      if (samples.length === 0) return setPhase('needs-garmin');

      setStatus(`Uploading ${samples.length} samples…`);
      const up = await uploadSamples(samples);
      setResult({ accepted: up.accepted, inserted: up.inserted, metrics: up.profileMetrics ?? {} });
      setPhase('done');
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setPhase('error');
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Build your medical profile</Text>
      <Text style={styles.sub}>
        Kokonada reads your Garmin health history from Google Health Connect to learn your
        baselines. It reaches a full 6 months as your data accrues over time.
      </Text>

      {phase === 'checking' && <Spinner label={status} />}

      {phase === 'install-required' && (
        <Card>
          <Text style={styles.cardTitle}>Health Connect needed</Text>
          <Text style={styles.body}>Install or update Health Connect to continue.</Text>
          <Button label="Open Play Store" onPress={openHealthConnectInStore} />
        </Card>
      )}

      {phase === 'signed-out' && (
        <Button label="Sign in with Google" onPress={onSignIn} />
      )}

      {(phase === 'idle' || phase === 'needs-garmin' || phase === 'error' || phase === 'done') && (
        <Button label="Build my medical profile" onPress={onConnect} />
      )}

      {phase === 'working' && <Spinner label={status} />}

      {phase === 'needs-garmin' && (
        <Card>
          <Text style={styles.cardTitle}>No Garmin data found yet</Text>
          <Text style={styles.body}>
            Open Garmin Connect → Settings → Health Connect and turn on sharing, then sync your
            watch. Come back and tap the button again.
          </Text>
          <Button
            label="Open Garmin Connect"
            onPress={() => Linking.openURL('market://details?id=com.garmin.android.apps.connectmobile')}
          />
        </Card>
      )}

      {phase === 'done' && result && (
        <Card>
          <Text style={styles.cardTitle}>Profile updated ✓</Text>
          <Text style={styles.body}>
            {result.inserted > 0
              ? `${result.inserted} new readings ingested.`
              : 'Already up to date — no new readings since last sync.'}
          </Text>
          {Object.entries(result.metrics).map(([k, v]) => (
            <Text key={k} style={styles.metric}>• {k}: {v}</Text>
          ))}
          {sleep && (
            <Text style={styles.body}>
              Sleep (last 6 mo): {sleep.sessions} nights · deep {sleep.deepMinutes}m · light{' '}
              {sleep.lightMinutes}m · REM {sleep.remMinutes}m
            </Text>
          )}
          <Text style={styles.note}>
            Profile matures toward 6 months as data accrues. Garmin-proprietary metrics
            (Body Battery, Readiness) are not shared via Health Connect.
          </Text>
        </Card>
      )}

      {phase === 'error' && !!error && <Text style={styles.error}>{error}</Text>}

      {(user || phase === 'idle' || phase === 'done') && (
        <Pressable onPress={onSignOut}>
          <Text style={styles.signout}>{user ? `Signed in as ${user.displayName} · ` : ''}Sign out</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const Spinner = ({ label }: { label: string }) => (
  <View style={styles.spinner}>
    <ActivityIndicator />
    <Text style={styles.body}>{label}</Text>
  </View>
);

const Card = ({ children }: { children: React.ReactNode }) => <View style={styles.card}>{children}</View>;

const Button = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Pressable style={styles.button} onPress={onPress}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 14, color: '#444', lineHeight: 20 },
  card: { backgroundColor: '#f4f4f5', borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 14, color: '#333', lineHeight: 20 },
  metric: { fontSize: 14, color: '#111' },
  note: { fontSize: 12, color: '#777', marginTop: 4 },
  spinner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#b91c1c', fontSize: 14 },
  signout: { color: '#666', fontSize: 13, textAlign: 'center', marginTop: 8 },
});
