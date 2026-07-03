import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { profileController } from './profileServices';
import { playerStatusStore } from '../player/playerStatusStore';
import { warmStore } from '../../state/store';
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

export function ProfileScreen() {
  const [snap, setSnap] = useState<ProfileSnapshot>({ me: null, integrations: null });
  const [spotify, setSpotify] = useState(playerStatusStore.getState().status);
  const [wearable, setWearable] = useState(warmStore.getState().biometricSource);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    void profileController.loadProfile().then((s) => { if (mounted) setSnap(s); });
    const offPlayer = playerStatusStore.subscribe((s) => { if (mounted) setSpotify(s.status); });
    const offWarm = warmStore.subscribe((s) => { if (mounted) setWearable(s.biometricSource); });
    return () => { mounted = false; offPlayer(); offWarm(); };
  }, []);

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
        <Badge label="Spotify" on={spotify === 'connected' || !!integ?.spotifyConnected} />
        <Badge label="Wearable" on={wearable !== 'none' || !!me?.wearableProvider} />
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
