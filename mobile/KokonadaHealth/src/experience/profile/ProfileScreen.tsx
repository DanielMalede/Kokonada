import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Linking, AppState } from 'react-native';
import { profileController } from './profileServices';
import { playerStatusStore } from '../player/playerStatusStore';
import { warmStore } from '../../state/store';
import { BACKEND_URL } from '../../health/config';
import { requestHealthPermissions, openHealthConnectSettings } from '../../health/healthConnect';
import { syncMedicalProfile, type SyncCounts } from '../../health/healthSync';
import type { ProfileSnapshot } from './profileController';

// The 5th tab: identity, integration status (Spotify via the live player state +
// server status; wearable via /me), and the two account actions — logout and the
// GDPR account deletion (server-first, two-step confirm).

function Badge({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 }}>
      <Text style={{ fontSize: 15 }}>{label}</Text>
      <Text style={{ fontSize: 14, color: on ? '#3ecf8e' : '#999' }}>{on ? 'Connected' : 'Not connected'}</Text>
    </View>
  );
}

// Spotify integration row. A "Connect" action starts OAuth when unlinked; a "Reconnect"
// action is ALWAYS reachable when linked, because a stored token keeps the badge green
// while a newly-added scope (e.g. playlist-modify-private) only lands on a fresh grant —
// re-running OAuth overwrites the token in place (it does NOT wipe the taste profile the
// way Disconnect does). Both routes call the same onConnect handler.
function SpotifyRow({ connected, onConnect }: { connected: boolean; onConnect: () => void }) {
  // Connected → a single "Connected" status with a small, muted "Reconnect" text-link
  // beneath it (a secondary action, not a competing button). Not connected → the primary
  // green Connect pill.
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 }}>
      <Text style={{ fontSize: 15 }}>Spotify</Text>
      {connected ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 14, color: '#3ecf8e' }}>Connected</Text>
          <Pressable onPress={onConnect} accessibilityRole="button" accessibilityLabel="reconnect-spotify" hitSlop={8}>
            <Text style={{ fontSize: 12, color: '#888', marginTop: 2, textDecorationLine: 'underline' }}>Reconnect</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onConnect} accessibilityRole="button" accessibilityLabel="connect-spotify"
          style={{ paddingVertical: 6, paddingHorizontal: 18, borderRadius: 999, backgroundColor: '#1DB954' }}>
          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Connect</Text>
        </Pressable>
      )}
    </View>
  );
}

// YouTube Music integration row: shown only when YouTube is connected as a data source.
// Disconnecting clears it, purges the cached YouTube library, and rebuilds a Spotify-only
// profile server-side (so the library becomes natively playable on Spotify).
function YouTubeRow({ onDisconnect, busy }: { onDisconnect: () => void; busy: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 }}>
      <Text style={{ fontSize: 15 }}>YouTube Music</Text>
      <Pressable onPress={onDisconnect} disabled={busy} accessibilityRole="button" accessibilityLabel="disconnect-youtube"
        style={{ paddingVertical: 6, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: '#ccc', opacity: busy ? 0.6 : 1 }}>
        <Text style={{ fontSize: 13 }}>{busy ? 'Rebuilding…' : 'Disconnect'}</Text>
      </Pressable>
    </View>
  );
}

export function ProfileScreen() {
  const [snap, setSnap] = useState<ProfileSnapshot>({ me: null, integrations: null });
  const [spotify, setSpotify] = useState(playerStatusStore.getState().status);
  const [wearable, setWearable] = useState(warmStore.getState().biometricSource);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ytBusy, setYtBusy] = useState(false);
  const [hcBusy, setHcBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const reload = () => { void profileController.loadProfile().then((s) => { if (mounted) setSnap(s); }); };
    reload();
    const offPlayer = playerStatusStore.subscribe((s) => { if (mounted) setSpotify(s.status); });
    const offWarm = warmStore.subscribe((s) => { if (mounted) setWearable(s.biometricSource); });
    // Returning from the Spotify OAuth browser (or any resume): re-pull integration
    // status so the Spotify badge flips to Connected without a manual refresh.
    const appSub = AppState.addEventListener('change', (st) => { if (st === 'active') reload(); });
    return () => { mounted = false; offPlayer(); offWarm(); appSub?.remove?.(); };
  }, []);

  const onConnectSpotify = async () => {
    const ct = await profileController.getSpotifyConnectToken();
    if (!ct) { Alert.alert('Could not start Spotify sign-in', 'Please try again in a moment.'); return; }
    // returnTo=app tells the backend callback to deep-link back into this app (kokonada://…)
    // instead of stranding the user on the website after they grant access.
    const url = `${BACKEND_URL}/api/integrations/spotify/connect?ct=${encodeURIComponent(ct)}&returnTo=app`;
    Linking.openURL(url).catch(() => Alert.alert('Could not open Spotify', 'No browser is available to complete sign-in.'));
  };

  // Disconnect YouTube → server clears the token, purges the cached YouTube pool, and
  // rebuilds a Spotify-native profile. Reload status so the row disappears + the badge updates.
  const onDisconnectYouTube = async () => {
    setYtBusy(true);
    try {
      const res = await profileController.disconnectYouTube();
      if (res.ok) {
        Alert.alert('YouTube disconnected', `Rebuilt your Spotify library (${res.data.library} tracks).`);
        const s = await profileController.loadProfile();
        setSnap(s);
      } else {
        Alert.alert('Could not disconnect YouTube', 'Please try again in a moment.');
      }
    } finally {
      setYtBusy(false);
    }
  };

  // D-4a: the reachable entry point for the (previously orphaned) Health Connect →
  // MedicalProfile ingestion. One-tap permission sheet; if Android's deny-throttle
  // suppresses the sheet (request resolves with no grants), deep-link straight into
  // Health Connect's permission screen. Per-type counts make the result diagnosable.
  const countsLine = (c?: SyncCounts) => c
    ? `${c.heartRate} heart-rate · ${c.hrv} HRV · ${c.sleep} sleep · ${c.restingHeartRate} resting-HR`
    : '';
  const onSyncHealth = async () => {
    setHcBusy(true);
    try {
      const granted = await requestHealthPermissions();
      if (!granted || granted.length === 0) {
        Alert.alert(
          'Permission needed',
          'Android blocked the permission popup (it does this after repeated denials). Grant Kokonada access in Health Connect instead.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Health Connect', onPress: () => openHealthConnectSettings() },
          ],
        );
        return;
      }
      const res = await syncMedicalProfile({ minIntervalMs: 0 });
      if (res.synced) {
        Alert.alert('Health data synced', `${countsLine(res.counts)}\nPulse will reflect them after the next analysis (~1 min).`);
      } else if (res.reason === 'no-data') {
        Alert.alert('No health data found', 'Open Garmin Connect → Settings → Health Connect and turn on sharing, then sync your watch and try again.');
      } else {
        // Surface WHAT failed (#90): the read counts prove the watch shared data, so a
        // persistent failure is an upload problem — show the status instead of hiding it.
        const readLine = res.counts && (res.counts.heartRate + res.counts.sleep + res.counts.restingHeartRate) > 0
          ? `\n\nYour watch shared ${countsLine(res.counts)}, but the upload didn't complete.`
          : '';
        Alert.alert('Sync failed', `${res.error ?? 'Please try again in a moment.'}${readLine}`);
      }
    } catch {
      Alert.alert('Health Connect unavailable', 'Install/update Health Connect from the Play Store and try again.');
    } finally {
      setHcBusy(false);
    }
  };

  const onLogout = async () => {
    setBusy(true);
    try { await profileController.logout(); } finally { setBusy(false); }
    // clearCurrentUser inside the teardown flips the auth gate back to SignIn.
  };

  const onDelete = async () => {
    setBusy(true);
    try {
      const res = await profileController.deleteAccount();
      if (!res.ok) Alert.alert('Could not delete account', 'Please try again when you have a connection.');
      // On success the teardown flips the gate; nothing else to do here.
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const me = snap.me;
  const integ = snap.integrations;

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 24, fontWeight: '700' }}>{me?.displayName ?? '—'}</Text>
        <Text style={{ opacity: 0.6 }}>{me?.email ?? ''}</Text>
      </View>

      <View>
        <Text style={{ fontSize: 13, opacity: 0.5, marginBottom: 4 }}>INTEGRATIONS</Text>
        <SpotifyRow connected={spotify === 'connected' || !!integ?.spotifyConnected} onConnect={onConnectSpotify} />
        {integ?.youtubeConnected ? <YouTubeRow onDisconnect={onDisconnectYouTube} busy={ytBusy} /> : null}
        <Badge label="Wearable" on={wearable !== 'none' || !!me?.wearableProvider} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 }}>
          <Text style={{ fontSize: 15 }}>Health data</Text>
          <Pressable onPress={onSyncHealth} disabled={hcBusy} accessibilityRole="button" accessibilityLabel="sync-health"
            style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#4f8cff', opacity: hcBusy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{hcBusy ? 'Syncing…' : 'Sync'}</Text>
          </Pressable>
        </View>
      </View>

      <Pressable onPress={onLogout} disabled={busy} accessibilityRole="button" accessibilityLabel="log-out"
        style={{ paddingVertical: 14, alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#ccc', opacity: busy ? 0.6 : 1 }}>
        <Text style={{ fontSize: 16 }}>Log out</Text>
      </Pressable>

      {!confirming ? (
        <Pressable onPress={() => setConfirming(true)} disabled={busy} accessibilityRole="button" accessibilityLabel="delete-account"
          style={{ paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ color: '#ff5a5a' }}>Delete account</Text>
        </Pressable>
      ) : (
        <View style={{ gap: 10, padding: 16, borderRadius: 12, backgroundColor: 'rgba(255,90,90,0.08)' }}>
          <Text style={{ fontWeight: '600' }}>Permanently delete your account?</Text>
          <Text style={{ fontSize: 13, opacity: 0.7 }}>This erases all your data and cannot be undone.</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={() => setConfirming(false)} disabled={busy} accessibilityRole="button" accessibilityLabel="delete-cancel" style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#ccc' }}>
              <Text>Cancel</Text>
            </Pressable>
            <Pressable onPress={onDelete} disabled={busy} accessibilityRole="button" accessibilityLabel="delete-confirm" style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: '#ff5a5a', opacity: busy ? 0.6 : 1 }}>
              <Text style={{ color: '#fff', fontWeight: '600' }}>Delete forever</Text>
            </Pressable>
          </View>
        </View>
      )}
    </ScrollView>
  );
}
