import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image, Alert, Linking, AppState, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography, elevation } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';
import { EMPTY_GLOW_OPACITY, Skeleton } from '../../design/system';
import { SoftGlow } from '../aura/SoftGlow';
import { profileController } from './profileServices';
import { playerStatusStore } from '../player/playerStatusStore';
import { warmStore } from '../../state/store';
import { BACKEND_URL } from '../../health/config';
import { checkAvailability, requestHealthPermissions, openHealthConnectSettings, openHealthConnectInStore } from '../../health/healthConnect';
import { syncMedicalProfile, type SyncCounts } from '../../health/healthSync';
import { fetchConsentStatus, grantConsent, withdrawConsent } from '../../health/consentApi';
import { createConsentFlow, type ConsentFlowStore } from '../../health/consentStore';
import { createConnectController, type WearableOutcome } from '../connect/connectController';
import { requestWatchPairing, fetchWatchStatus, revokeWatchPairing } from '../../health/watchPairingClient';
import { clearWatchToken } from '../../health/liveHrClient';
import { createWatchPairingFlow, type WatchPairingStore } from './watchPairingStore';
import { PROVIDERS } from '../connect/providers';
import { ProfileIntegrationRow } from './ProfileIntegrationRow';
import { WatchPairingCard } from './WatchPairingCard';
import { VaultConsentPanel } from './VaultConsentPanel';
import { ConsentSheet } from './ConsentSheet';
import type { ProfileSnapshot } from './profileController';

// SCREENS §10 — Profile / Privacy Vault. Identity, honest integration status, the watch pairing
// panel, the health-data Vault (consent + withdrawal), and the two account actions (logout +
// GDPR account deletion, server-first). A STATIC trust surface: a FIXED brand accent only — the
// emotion accent is deliberately NEVER read here (trust must not re-tint with mood). Aura is at
// most one STILL SoftGlow seal behind the avatar. Tokens only; light + dark flow from useTheme().

// The still glow seal is a halo a little larger than the avatar so it reads as depth, not a disc.
const AVATAR = space['4xl']; // 64
const AVATAR_SEAL_SCALE = 1.6; // seal field / avatar — named, not a magic number

const spotifyProvider = PROVIDERS.find((p) => p.id === 'spotify')!;
const youtubeProvider = PROVIDERS.find((p) => p.id === 'youtube')!;

export function ProfileScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();

  const [snap, setSnap] = useState<ProfileSnapshot>({ me: null, integrations: null });
  const [loaded, setLoaded] = useState(false);
  const [spotify, setSpotify] = useState(playerStatusStore.getState().status);
  const [wearable, setWearable] = useState(warmStore.getState().biometricSource);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);      // logout / delete (account zone)
  const [ytBusy, setYtBusy] = useState(false);
  const [hcBusy, setHcBusy] = useState(false);  // health sync
  const [withdrawing, setWithdrawing] = useState(false);
  // GDPR Art.9 consent (audit H-9). `consentGranted` drives the Withdraw affordance; a non-null
  // `consentStore` means the §11 wall is presented just-in-time, before the OS sheet.
  const [consentGranted, setConsentGranted] = useState(false);
  const [consentStore, setConsentStore] = useState<ConsentFlowStore | null>(null);

  const mountedRef = useRef(true);

  // The watch pairing flow, bound once to the real client + Keychain seams. The card drives it.
  const watchStore = useMemo<WatchPairingStore>(() => createWatchPairingFlow({
    requestPairing: requestWatchPairing,
    fetchStatus: fetchWatchStatus,
    revoke: revokeWatchPairing,
    clearToken: clearWatchToken,
    now: () => Date.now(),
  }), []);

  // T5 — Profile Sync rebuilt on the SAME §4 controller as ConnectServices (dedup), so the ONE
  // compliance invariant (OS health sheet only after a server-acked grant) lives in one place. A
  // Profile-specific markResolved flips consentGranted (which reveals Withdraw). The real
  // consentStore/ConsentSheet are delegated to, never re-implemented.
  const ctrl = useMemo(() => createConnectController({
    checkAvailability,
    fetchConsentStatus,
    grantConsent,
    requestHealthPermissions,
    syncMedicalProfile: (d) => syncMedicalProfile(d),
    createConsentFlow,
    markResolved: () => setConsentGranted(true),
  }), []);

  const reload = useCallback(() => {
    void profileController.loadProfile().then((s) => { if (mountedRef.current) { setSnap(s); setLoaded(true); } });
    void fetchConsentStatus().then((res) => { if (mountedRef.current && res.ok) setConsentGranted(res.data.granted); });
    void watchStore.getState().hydrate();
  }, [watchStore]);

  useEffect(() => {
    mountedRef.current = true;
    reload();
    const offPlayer = playerStatusStore.subscribe((s) => { if (mountedRef.current) setSpotify(s.status); });
    const offWarm = warmStore.subscribe((s) => { if (mountedRef.current) setWearable(s.biometricSource); });
    // Returning from the Spotify OAuth browser (or any resume) re-pulls status so badges refresh.
    const appSub = AppState.addEventListener('change', (st) => { if (st === 'active') reload(); });
    return () => { mountedRef.current = false; offPlayer(); offWarm(); appSub?.remove?.(); };
  }, [reload]);

  // A stored Spotify token keeps the badge "Connected", but a newly-added scope only lands on a
  // fresh grant — so an already-connected account keeps a Reconnect that re-runs OAuth in place.
  const onConnectSpotify = async () => {
    const ct = await profileController.getSpotifyConnectToken();
    if (!ct) { Alert.alert('Could not start Spotify sign-in', 'Please try again in a moment.'); return; }
    const url = `${BACKEND_URL}/api/integrations/spotify/connect?ct=${encodeURIComponent(ct)}&returnTo=app`;
    Linking.openURL(url).catch(() => Alert.alert('Could not open Spotify', 'No browser is available to complete sign-in.'));
  };

  const onDisconnectYouTube = async () => {
    setYtBusy(true);
    try {
      const res = await profileController.disconnectYouTube();
      if (res.ok) {
        Alert.alert('YouTube disconnected', `Rebuilt your Spotify library (${res.data.library} tracks).`);
        const s = await profileController.loadProfile();
        if (mountedRef.current) setSnap(s);
      } else {
        Alert.alert('Could not disconnect YouTube', 'Please try again in a moment.');
      }
    } finally {
      if (mountedRef.current) setYtBusy(false);
    }
  };

  const countsLine = (c2?: SyncCounts) => c2
    ? `${c2.heartRate} heart-rate · ${c2.hrv} HRV · ${c2.sleep} sleep · ${c2.restingHeartRate} resting-HR`
    : '';

  // Translate a controller outcome into UI. The §11 wall (consent) is the only branch that renders
  // a surface; every other branch is an honest Alert. The health-synced counts stay diagnosable.
  const dispatchOutcome = (outcome: WearableOutcome) => {
    switch (outcome.kind) {
      case 'unsupported':
        Alert.alert('Available on Android', 'Connecting a wearable uses Health Connect, available on Android.');
        break;
      case 'install-required':
        Alert.alert('Health Connect needed', 'Install or update Health Connect from the Play Store, then try again.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Play Store', onPress: () => openHealthConnectInStore() },
        ]);
        break;
      case 'consent':
        setConsentStore(outcome.store); // present the §11 wall — the OS sheet is reached only via onProceed
        break;
      case 'permission-blocked':
        Alert.alert('Permission needed', 'Android blocked the permission popup (it does this after repeated denials). Grant Kokonada access in Health Connect instead.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Health Connect', onPress: () => openHealthConnectSettings() },
        ]);
        break;
      case 'connected': {
        const r = outcome.result;
        if (r.synced) Alert.alert('Health data synced', `${countsLine(r.counts)}\nPulse will reflect them after the next analysis (~1 min).`);
        else Alert.alert('No health data found', 'Open Garmin Connect → Settings → Health Connect and turn on sharing, then sync your watch and try again.');
        break;
      }
      case 'sync-failed': {
        const r = outcome.result;
        const readLine = r.counts && (r.counts.heartRate + r.counts.sleep + r.counts.restingHeartRate) > 0
          ? `\n\nYour watch shared ${countsLine(r.counts)}, but the upload didn't complete.`
          : '';
        Alert.alert('Sync failed', `${r.error ?? 'Please try again in a moment.'}${readLine}`);
        break;
      }
    }
  };

  const onSync = async () => {
    setHcBusy(true);
    try { dispatchOutcome(await ctrl.begin()); } finally { if (mountedRef.current) setHcBusy(false); }
  };

  // Reached ONLY on a server-acked current grant (ConsentSheet fires onProceed on ready | granted_ack).
  const onConsentProceed = async () => {
    setConsentStore(null);
    setHcBusy(true);
    try { dispatchOutcome(await ctrl.runSync()); } finally { if (mountedRef.current) setHcBusy(false); }
  };

  // Withdraw consent — the VaultConsentPanel owns the two-step confirm; this calls the UNCHANGED
  // endpoint and, on success, flips granted so the Withdraw affordance disappears.
  const onWithdraw = async () => {
    setWithdrawing(true);
    try {
      const res = await withdrawConsent();
      if (res.ok) { if (mountedRef.current) setConsentGranted(false); }
      else Alert.alert('Could not withdraw consent', 'Please try again when you have a connection.');
    } finally {
      if (mountedRef.current) setWithdrawing(false);
    }
  };

  const onLogout = async () => {
    setBusy(true);
    try { await profileController.logout(); } finally { if (mountedRef.current) setBusy(false); }
  };

  const onDelete = async () => {
    fireHaptic('warning');
    setBusy(true);
    try {
      const res = await profileController.deleteAccount();
      if (!res.ok) Alert.alert('Could not delete account', 'Please try again when you have a connection.');
    } finally {
      if (mountedRef.current) { setBusy(false); setConfirming(false); }
    }
  };

  const me = snap.me;
  const integ = snap.integrations;
  const spotifyConnected = spotify === 'connected' || !!integ?.spotifyConnected;
  const youtubeConnected = !!integ?.youtubeConnected;
  const wearableConnected = !!integ?.biometricProvider || wearable !== 'none' || !!me?.wearableProvider;

  const frame = {
    paddingHorizontal: space.xl,
    paddingTop: insets.top + space['3xl'],
    paddingBottom: insets.bottom + space['3xl'],
    gap: space.xl,
  };

  // Load → calm skeleton (never a spinner). me still null after load → an honest inline retry
  // (not a crash). Both sit on surface.base and never wear red.
  if (!loaded) {
    return (
      <ScrollView style={{ backgroundColor: c.surface.base }} contentContainerStyle={frame}>
        <Skeleton variant="title" width="60%" label="Loading your profile" />
        <Skeleton.Row />
        <Skeleton.Row />
      </ScrollView>
    );
  }

  if (!me) {
    return (
      <ScrollView style={{ backgroundColor: c.surface.base }} contentContainerStyle={[frame, styles.centered]}>
        <Text style={[styles.retryTitle, { color: c.content.primary }]}>Couldn’t load your profile</Text>
        <Pressable
          onPress={reload}
          accessibilityRole="button"
          accessibilityLabel="retry-profile"
          style={[styles.retryBtn, { borderColor: c.content.tertiary }]}
        >
          <Text style={[styles.retryLabel, { color: c.content.primary }]}>Retry</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <>
      <ScrollView style={{ backgroundColor: c.surface.base }} contentContainerStyle={frame} showsVerticalScrollIndicator={false}>
        {/* Identity header — the ONE still SoftGlow seal sits behind the avatar only (a11y-hidden). */}
        <View style={styles.header}>
          <View style={styles.avatarWrap}>
            <View style={styles.sealWrap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
              <SoftGlow color={c.accent.glow} size={AVATAR * AVATAR_SEAL_SCALE} opacity={EMPTY_GLOW_OPACITY} />
            </View>
            {me.avatarUrl ? (
              <Image source={{ uri: me.avatarUrl }} style={[styles.avatar, { backgroundColor: c.surface.raised }]} />
            ) : (
              <View style={[styles.avatar, styles.monogram, elevation.e1, { backgroundColor: c.surface.raised }]}>
                <Text style={[styles.monogramText, { color: c.content.secondary }]}>{(me.displayName ?? '—').charAt(0)}</Text>
              </View>
            )}
          </View>
          <Text accessibilityRole="header" style={[styles.name, { color: c.content.primary }]}>{me.displayName ?? '—'}</Text>
          <Text style={[styles.email, { color: c.content.secondary }]}>{me.email ?? ''}</Text>
        </View>

        {/* Integration rows ×4 — driven by the §4 registry × live status. Spotify is HALTED, so a
            not-connected user sees the honest "Unavailable" WORD, never a dead Connect pill. */}
        <View style={[styles.card, elevation.e1, { backgroundColor: c.surface.raised }]}>
          <ProfileIntegrationRow
            label={spotifyProvider.label}
            reason={spotifyConnected ? 'Playing your library.' : spotifyProvider.why}
            statusWord={spotifyConnected ? 'Connected' : 'Unavailable'}
            connected={spotifyConnected}
            action={spotifyConnected ? { label: 'Reconnect', a11yLabel: 'reconnect-spotify', onPress: onConnectSpotify } : undefined}
          />
          <View style={[styles.divider, { backgroundColor: c.surface.hairline }]} />
          <ProfileIntegrationRow
            label={youtubeProvider.label}
            reason={youtubeConnected ? 'Kokonada plays it natively.' : youtubeProvider.why}
            statusWord={youtubeConnected ? 'Connected' : 'Not yet available'}
            connected={youtubeConnected}
            action={youtubeConnected ? { label: 'Disconnect', busyLabel: 'Rebuilding…', a11yLabel: 'disconnect-youtube', onPress: onDisconnectYouTube, busy: ytBusy } : undefined}
          />
          <View style={[styles.divider, { backgroundColor: c.surface.hairline }]} />
          <ProfileIntegrationRow
            label="Wearable"
            reason={wearableConnected ? 'Shaping music to your body.' : 'Pair your watch below to stream live heart rate.'}
            statusWord={wearableConnected ? 'Connected' : 'Not connected'}
            connected={wearableConnected}
          />
          <View style={[styles.divider, { backgroundColor: c.surface.hairline }]} />
          <ProfileIntegrationRow
            label="Health data"
            reason={consentGranted ? 'Reading your body, with your consent.' : 'Off — you’re in mood-only mode.'}
            statusWord={consentGranted ? 'On' : 'Off'}
            connected={consentGranted}
          />
        </View>

        {/* Watch pairing — the ephemeral 6-digit code flow (never the whr_ device token). */}
        <WatchPairingCard store={watchStore} />

        {/* Health-data Vault — consent summary, "what we read", Sync, and the neutral withdrawal. */}
        <VaultConsentPanel
          consentGranted={consentGranted}
          syncing={hcBusy}
          withdrawing={withdrawing}
          onSync={onSync}
          onWithdraw={onWithdraw}
        />

        {/* Account zone — sits on surface.base (content.tertiary + the danger affordance are only
            AA-proven here, never on a raised card). */}
        <View style={styles.account}>
          <Pressable
            onPress={onLogout}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="log-out"
            accessibilityState={{ disabled: busy }}
            style={[styles.logout, { borderColor: c.content.tertiary, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={[styles.logoutLabel, { color: c.content.primary }]}>Log out</Text>
          </Pressable>

          {!confirming ? (
            <Pressable
              onPress={() => setConfirming(true)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="delete-account"
              hitSlop={space.sm}
              style={styles.deleteLink}
            >
              <Text style={[styles.deleteLinkText, { color: c.state.danger }]}>Delete account</Text>
            </Pressable>
          ) : (
            <View style={[styles.deleteConfirm, { borderColor: c.state.danger }]}>
              <Text accessibilityRole="header" style={[styles.deleteTitle, { color: c.content.primary }]}>Permanently delete your account?</Text>
              <Text style={[styles.deleteBody, { color: c.content.secondary }]}>This erases all your data and cannot be undone.</Text>
              <View style={styles.deleteBar}>
                <Pressable
                  onPress={() => setConfirming(false)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="delete-cancel"
                  style={[styles.deleteBtn, { borderColor: c.content.tertiary }]}
                >
                  <Text style={[styles.deleteBtnText, { color: c.content.primary }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={onDelete}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel="delete-confirm"
                  accessibilityState={{ disabled: busy }}
                  style={[styles.deleteBtn, { borderColor: c.state.danger, opacity: busy ? 0.6 : 1 }]}
                >
                  <Text style={[styles.deleteBtnText, { color: c.state.danger }]}>Delete forever</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* The §11 Art.9 consent wall, just-in-time before the OS health sheet. Reaching the OS sheet
          (onProceed) requires a server-acked current grant; Decline / back just dismisses. */}
      {consentStore ? (
        <Modal visible transparent statusBarTranslucent animationType="slide" onRequestClose={() => setConsentStore(null)}>
          <ConsentSheet store={consentStore} onProceed={onConsentProceed} onDecline={() => setConsentStore(null)} />
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space.sm },
  avatarWrap: { width: AVATAR * AVATAR_SEAL_SCALE, height: AVATAR * AVATAR_SEAL_SCALE, alignItems: 'center', justifyContent: 'center' },
  sealWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: radius.pill },
  monogram: { alignItems: 'center', justifyContent: 'center' },
  monogramText: { fontSize: typography.size.heading, fontWeight: typography.weight.semibold },
  name: { fontSize: typography.size.title, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.heading, textAlign: 'center' },
  email: { fontSize: typography.size.callout },
  card: { borderRadius: radius.lg, padding: space.lg },
  divider: { height: StyleSheet.hairlineWidth },
  account: { gap: space.md, marginTop: space['3xl'] },
  logout: { width: '100%', paddingVertical: space.lg, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  logoutLabel: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  deleteLink: { paddingVertical: space.md, alignItems: 'center' },
  deleteLinkText: { fontSize: typography.size.callout, fontWeight: typography.weight.semibold },
  deleteConfirm: { gap: space.md, padding: space.lg, borderRadius: radius.lg, borderWidth: 1.5 },
  deleteTitle: { fontSize: typography.size.callout, fontWeight: typography.weight.semibold },
  deleteBody: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  deleteBar: { flexDirection: 'row', gap: space.md },
  deleteBtn: { flex: 1, paddingVertical: space.md, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  centered: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  retryTitle: { fontSize: typography.size.subheading, fontWeight: typography.weight.semibold, textAlign: 'center' },
  retryBtn: { marginTop: space.lg, paddingVertical: space.md, paddingHorizontal: space.xl, borderRadius: radius.pill, borderWidth: 1.5 },
  retryLabel: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
});
