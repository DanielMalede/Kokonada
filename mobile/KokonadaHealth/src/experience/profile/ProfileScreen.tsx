import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Alert, Linking, AppState, Modal } from 'react-native';
import { profileController } from './profileServices';
import { playerStatusStore } from '../player/playerStatusStore';
import { warmStore } from '../../state/store';
import { BACKEND_URL } from '../../health/config';
import { requestHealthPermissions, openHealthConnectSettings, checkAvailability, openHealthConnectInStore } from '../../health/healthConnect';
import { syncMedicalProfile, type SyncCounts } from '../../health/healthSync';
import { fetchConsentStatus, grantConsent, withdrawConsent } from '../../health/consentApi';
import { createConsentFlow, type ConsentFlowStore } from '../../health/consentStore';
import { ConsentSheet } from './ConsentSheet';
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
  // GDPR Art.9 consent (audit H-9). `consentGranted` drives the Withdraw action's visibility; a
  // non-null `consentStore` means the consent wall is presented (just-in-time, before the OS sheet).
  const [consentGranted, setConsentGranted] = useState(false);
  const [consentStore, setConsentStore] = useState<ConsentFlowStore | null>(null);
  const [withdrawConfirm, setWithdrawConfirm] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refreshConsent = () => { void fetchConsentStatus().then((res) => { if (mounted && res.ok) setConsentGranted(res.data.granted); }); };
    const reload = () => { void profileController.loadProfile().then((s) => { if (mounted) setSnap(s); }); refreshConsent(); };
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

  // D-4a: the Health Connect → MedicalProfile ingestion. One-tap permission sheet; if Android's
  // deny-throttle suppresses the sheet (request resolves with no grants), deep-link straight into
  // Health Connect's permission screen. Per-type counts make the result diagnosable. UNCHANGED —
  // but now only reachable AFTER the Art.9 consent gate (onSyncHealth) confirms a current grant.
  const countsLine = (c?: SyncCounts) => c
    ? `${c.heartRate} heart-rate · ${c.hrv} HRV · ${c.sleep} sleep · ${c.restingHeartRate} resting-HR`
    : '';
  const runHealthSync = async () => {
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
    }
  };

  // T8 — the GDPR Art.9 consent gate in front of the OS health sheet. (1) Pre-check Health Connect
  // is actually available (the designer's flow-ordering fix: never wall for a device that can't
  // deliver — route to install instead). (2) Read the consent status: a CURRENT grant short-circuits
  // straight to the sync (invisible for an already-consented user); otherwise present the consent
  // wall, seeded with the status just read so it does not re-fetch. The OS sheet is reached only via
  // the wall's onProceed (below) — never optimistically here.
  const onSyncHealth = async () => {
    setHcBusy(true);
    try {
      const avail = await checkAvailability();
      if (avail !== 'available') {
        Alert.alert(
          'Health Connect needed',
          'Install or update Health Connect from the Play Store, then try again.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Play Store', onPress: () => openHealthConnectInStore() },
          ],
        );
        return;
      }
      const status = await fetchConsentStatus();
      if (status.ok && status.data.granted && !status.data.staleVersion) {
        await runHealthSync(); // invisible short-circuit for an already-consented user
        return;
      }
      const store = createConsentFlow({ fetchStatus: fetchConsentStatus, grant: grantConsent });
      if (status.ok) store.getState().hydrate(status.data); // seed → no redundant round trip
      setConsentStore(store);
    } finally {
      setHcBusy(false);
    }
  };

  // Reached ONLY on a server-acked current grant (the ConsentSheet fires this on ready | granted_ack).
  // Dismiss the wall, mark granted (enables Withdraw), then run the unchanged sync.
  const onConsentProceed = async () => {
    setConsentStore(null);
    setConsentGranted(true);
    setHcBusy(true);
    try { await runHealthSync(); } finally { setHcBusy(false); }
  };

  // T9 — withdraw consent. Two-step (see the confirm panel); erases the wearable footprint
  // server-side and flips the local granted flag so the Withdraw action disappears.
  const onWithdrawConsent = async () => {
    setBusy(true);
    try {
      const res = await withdrawConsent();
      if (res.ok) { setConsentGranted(false); setWithdrawConfirm(false); }
      else Alert.alert('Could not withdraw consent', 'Please try again when you have a connection.');
    } finally {
      setBusy(false);
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
    <>
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

        {/* T9 — Withdraw health-data consent (audit H-9). Shown only when a grant is on file.
            Two-step confirm modelled on the delete flow but NEUTRAL/informational, never danger-red:
            withdrawal is a right, not a punishment. */}
        {consentGranted ? (
          !withdrawConfirm ? (
            <Pressable onPress={() => setWithdrawConfirm(true)} disabled={busy} accessibilityRole="button" accessibilityLabel="withdraw-consent"
              style={{ paddingVertical: 10 }}>
              <Text style={{ fontSize: 13, color: '#4f8cff' }}>Withdraw health-data consent</Text>
            </Pressable>
          ) : (
            <View style={{ gap: 10, padding: 16, borderRadius: 12, backgroundColor: 'rgba(79,140,255,0.08)' }}>
              <Text style={{ fontWeight: '600' }}>Withdraw consent to health-data processing?</Text>
              <Text style={{ fontSize: 13, opacity: 0.7 }}>This erases the health data held across your connected wearables and stops biometric personalisation. You can turn it back on anytime.</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <Pressable onPress={() => setWithdrawConfirm(false)} disabled={busy} accessibilityRole="button" accessibilityLabel="withdraw-cancel"
                  style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#ccc' }}>
                  <Text>Cancel</Text>
                </Pressable>
                <Pressable onPress={onWithdrawConsent} disabled={busy} accessibilityRole="button" accessibilityLabel="withdraw-confirm"
                  style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 10, backgroundColor: '#4f8cff', opacity: busy ? 0.6 : 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '600' }}>Withdraw</Text>
                </Pressable>
              </View>
            </View>
          )
        ) : null}
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

    {/* T7/T8 — the Art.9 consent wall, presented just-in-time before the OS health sheet. Reaching
        the OS sheet (onProceed) requires a server-acked current grant; Decline/back just dismisses. */}
    {consentStore ? (
      <Modal visible transparent statusBarTranslucent animationType="slide" onRequestClose={() => setConsentStore(null)}>
        <ConsentSheet store={consentStore} onProceed={onConsentProceed} onDecline={() => setConsentStore(null)} />
      </Modal>
    ) : null}
    </>
  );
}
