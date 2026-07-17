import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Dimensions, Alert, Modal, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, type HapticKey } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';
import { BreathingGlow } from '../aura/BreathingGlow';
import { apiGet } from '../../net/apiClient';
import type { IntegrationsStatus } from '../profile/profileController';
import { checkAvailability, requestHealthPermissions, openHealthConnectInStore, openHealthConnectSettings } from '../../health/healthConnect';
import { fetchConsentStatus, grantConsent } from '../../health/consentApi';
import { createConsentFlow, type ConsentFlowStore } from '../../health/consentStore';
import { syncMedicalProfile } from '../../health/healthSync';
import { ConsentSheet } from '../profile/ConsentSheet';
import { providersByKind } from './providers';
import { ProviderRow } from './ProviderRow';
import { WhyAccordion } from './WhyAccordion';
import { MoodOnlyBar } from './MoodOnlyBar';
import { connectStore, type ConnectState } from './connectStore';
import { createConnectController, type ConnectController, type WearableOutcome } from './connectController';
import type { StoreApi } from 'zustand/vanilla';

// SCREENS §4 — Connect Services / Integrations setup. The Privacy-Vault tone starts here: explain
// WHY before asking for anything, and never force a hard gate. Two grouped cards on a static trust
// surface — Music (Spotify/YouTube, honest and action-less today) and Wearable & Health (the one
// live Connect path, which routes through the §11 Art.9 consent wall BEFORE the OS Health Connect
// sheet) — plus a pinned, always-present mood-only escape. Tokens only; fixed brand accent (no
// reactive emotionAccent); light + dark structurally identical.

// The header aura is a WHISPER, not the hero — deliberately smaller than SignIn's 0.66 so the
// choices (cards) stay the focus. Named fraction, not a magic number.
const HEADER_GLOW_FRACTION = 0.42;

// Screen-level subtitles by connect state. NOTE (intentional, do not "fix"): the design's
// "wearable connected" / "mood-only" states specced a gentle header-aura bloom-then-settle
// confirmation dwell. On FIRST RUN that beat is deliberately NOT surfaced — resolving the gate
// (markResolved/setMoodOnly) immediately advances the route to the app (the calmer, no-extra-tap
// choice we adopted), so the screen unmounts before a bloom could linger. These resolved-state
// subtitles/bar copy are kept as pure store-driven derivations so they render correctly for any
// FUTURE re-entry into this screen (e.g. from Profile) — they are not dead code, and the missing
// first-run bloom is a choice, not a gap.
const DEFAULT_SUBTITLE =
  'Connect what you have — or start with just your mood. You can change any of this later.';
const MOOD_ONLY_SUBTITLE = "You're in mood-only mode — that's a great place to start.";
const WEARABLE_SUBTITLE = "Your wearable's connected. You're all set.";

const MUSIC_WHY_TITLE = 'Why connect music?';
const MUSIC_WHY_BODY =
  "Music streaming is where Kokonada plays your set. We'd only ever read what's needed to build and " +
  'play a playlist — never post, never your social graph.';
// Echoes the §11 consent wall's heading/body rhythm; mirrors what permissions.ts actually reads.
const WEARABLE_WHY_TITLE = 'Why we ask for health data';
const WEARABLE_WHY_BODY =
  'Kokonada turns how your body is doing — heart rate, HRV, sleep — into music tuned to you. ' +
  "It's read only with your explicit say-so, kept private (never sold, never ads), and you can " +
  'withdraw anytime. Kokonada works in mood-only mode without it.';

type ConnectStore = StoreApi<ConnectState>;

function useConnectSnapshot(store: ConnectStore): { resolved: boolean; moodOnly: boolean } {
  const [snap, setSnap] = useState(() => {
    const s = store.getState();
    return { resolved: s.resolved, moodOnly: s.moodOnly };
  });
  useEffect(() => {
    const sync = () => { const s = store.getState(); setSnap({ resolved: s.resolved, moodOnly: s.moodOnly }); };
    sync();
    return store.subscribe(sync);
  }, [store]);
  return snap;
}

async function defaultLoadIntegrations(): Promise<IntegrationsStatus | null> {
  const res = await apiGet<IntegrationsStatus>('/api/integrations/status');
  return res.ok ? res.data : null;
}

function subtitleFor(resolved: boolean, moodOnly: boolean): string {
  if (moodOnly) return MOOD_ONLY_SUBTITLE;
  if (resolved) return WEARABLE_SUBTITLE;
  return DEFAULT_SUBTITLE;
}

// The production controller, bound so its markResolved targets the SAME connect store the screen
// renders. Overridable in tests with a real controller built from stateful fakes.
function defaultController(connect: ConnectStore): ConnectController {
  return createConnectController({
    checkAvailability,
    fetchConsentStatus,
    grantConsent,
    requestHealthPermissions,
    syncMedicalProfile: (d) => syncMedicalProfile(d),
    createConsentFlow,
    markResolved: () => connect.getState().markResolved(),
  });
}

export interface ConnectServicesScreenProps {
  connect?: ConnectStore;
  loadIntegrations?: () => Promise<IntegrationsStatus | null>;
  controller?: ConnectController;
  // Chosen mood-only or forwarded after resolving — the route is DERIVED from the store in AppFlow,
  // so these default to no-ops (the store flip does the routing). Overridable for tests.
  onContinue?: () => void;
  triggerHaptic?: (key: HapticKey) => void;
}

export function ConnectServicesScreen({
  connect = connectStore,
  loadIntegrations = defaultLoadIntegrations,
  controller,
  onContinue = () => {},
  triggerHaptic = fireHaptic,
}: ConnectServicesScreenProps = {}) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const insets = useSafeAreaInsets();
  const { resolved, moodOnly } = useConnectSnapshot(connect);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
  // A non-null consentStore means the §11 Art.9 wall is presented (just-in-time, before the OS sheet).
  const [consentStore, setConsentStore] = useState<ConsentFlowStore | null>(null);
  const [hcBusy, setHcBusy] = useState(false);

  const ctrl = useMemo(() => controller ?? defaultController(connect), [controller, connect]);

  useEffect(() => {
    let mounted = true;
    void loadIntegrations().then((s) => { if (mounted) setIntegrations(s); }).catch(() => {});
    return () => { mounted = false; };
  }, [loadIntegrations]);

  const musicProviders = providersByKind('music');
  const connectedFor = (id: string): boolean =>
    (id === 'spotify' && !!integrations?.spotifyConnected) ||
    (id === 'youtube' && !!integrations?.youtubeConnected);

  const onMoodOnly = () => { triggerHaptic('commit'); connect.getState().setMoodOnly(); };

  // Translate a controller outcome into UI. The wall (consent) is the only branch that renders a
  // surface; every other branch is a guiding Alert or a silent success (markResolved has already
  // flipped the route). Decline / background / offline never reach here with a resolved gate.
  const dispatchOutcome = (outcome: WearableOutcome) => {
    switch (outcome.kind) {
      case 'unsupported':
        Alert.alert('Available on Android', 'Connecting a wearable uses Health Connect, available on Android. You can start in mood-only mode anywhere.');
        break;
      case 'install-required':
        Alert.alert('Health Connect needed', 'Install or update Health Connect from the Play Store, then try again.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Play Store', onPress: () => openHealthConnectInStore() },
        ]);
        break;
      case 'consent':
        setConsentStore(outcome.store); // present the §11 wall; the OS sheet is reached only via onProceed
        break;
      case 'permission-blocked':
        Alert.alert('Permission needed', 'Android blocked the permission popup (it does this after repeated denials). Grant Kokonada access in Health Connect instead.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Health Connect', onPress: () => openHealthConnectSettings() },
        ]);
        break;
      case 'connected':
        triggerHaptic('success'); // a wearable is linked — the forward gate is resolved (route advances)
        break;
      case 'sync-failed':
        Alert.alert('Wearable connected', 'Your wearable is linked, but we could not sync its data just now. It will retry — check your connection.');
        break;
    }
  };

  const onConnectWearable = async () => {
    triggerHaptic('selection');
    setHcBusy(true);
    try { dispatchOutcome(await ctrl.begin()); } finally { setHcBusy(false); }
  };

  // Reached ONLY on a server-acked current grant (the ConsentSheet fires onProceed on ready |
  // granted_ack). Dismiss the wall, then run the OS sheet + sync via the controller.
  const onConsentProceed = async () => {
    setConsentStore(null);
    setHcBusy(true);
    try { dispatchOutcome(await ctrl.runSync()); } finally { setHcBusy(false); }
  };

  const glowSize = Dimensions.get('window').width * HEADER_GLOW_FRACTION;

  return (
    <View style={[styles.screen, { backgroundColor: c.surface.base }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + space['3xl'] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* A — Header zone (disjoint from the cards; the aura never sits behind body text) */}
        <View style={styles.header}>
          <BreathingGlow color={c.accent.glow} reduced={reduced} breathMs={duration.breath} size={glowSize} style={styles.headerGlow} />
          <Text style={[styles.wordmark, { color: c.content.tertiary }]}>KOKONADA</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>Set up your sound.</Text>
          <Text style={[styles.subtitle, { color: c.content.secondary }]}>{subtitleFor(resolved, moodOnly)}</Text>
        </View>

        {/* B — Music card (the quiet, secondary block: states its truth and stops) */}
        <View style={[styles.card, elevation.e1, { backgroundColor: c.surface.raised }]}>
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: c.content.primary }]}>Music</Text>
          <Text style={[styles.cardCaption, { color: c.content.secondary }]}>Where your soundtrack plays.</Text>
          {musicProviders.map((p, i) => (
            <View key={p.id}>
              {i > 0 ? <View style={[styles.divider, { backgroundColor: c.surface.hairline }]} /> : null}
              <ProviderRow provider={p} connected={connectedFor(p.id)} />
            </View>
          ))}
          <WhyAccordion title={MUSIC_WHY_TITLE} body={MUSIC_WHY_BODY} />
        </View>

        {/* C — Wearable & Health card (the protagonist: the ONE live filled CTA) */}
        <View style={[styles.card, elevation.e1, { backgroundColor: c.surface.raised }]}>
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: c.content.primary }]}>Wearable &amp; Health</Text>
          <Text style={[styles.cardCaption, { color: c.content.secondary }]}>Let your body shape the music. Optional, always.</Text>
          <Pressable
            onPress={onConnectWearable}
            disabled={hcBusy}
            accessibilityRole="button"
            accessibilityLabel="connect-wearable"
            accessibilityState={{ disabled: hcBusy }}
            style={[styles.wearableCta, { backgroundColor: c.accent.glowInk, opacity: hcBusy ? 0.6 : 1 }]}
          >
            <Text style={[styles.wearableCtaLabel, { color: c.content.onAccent }]}>Connect a wearable</Text>
          </Pressable>
          <WhyAccordion title={WEARABLE_WHY_TITLE} body={WEARABLE_WHY_BODY} />
        </View>
      </ScrollView>

      {/* D — pinned mood-only escape (outside the scroll, always visible) */}
      <MoodOnlyBar connect={connect} onMoodOnly={onMoodOnly} onContinue={onContinue} />

      {/* The §11 Art.9 consent wall, presented just-in-time before the OS Health Connect sheet.
          Reaching the OS sheet (onProceed) requires a server-acked current grant; Decline / back
          / background just dismisses — the mood-only path stays fully intact (resolved unchanged). */}
      {consentStore ? (
        <Modal visible transparent statusBarTranslucent animationType="slide" onRequestClose={() => setConsentStore(null)}>
          <ConsentSheet store={consentStore} onProceed={onConsentProceed} onDecline={() => setConsentStore(null)} />
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: space.xl, paddingBottom: space.xl },
  header: { alignItems: 'flex-start', gap: space.sm, marginBottom: space.xl },
  headerGlow: { top: -space['2xl'], alignSelf: 'center' },
  wordmark: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
  title: { fontSize: typography.size.title, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.heading },
  subtitle: { fontSize: typography.size.callout, lineHeight: typography.size.callout * typography.leading.normal },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md, marginBottom: space.lg },
  cardTitle: { fontSize: typography.size.subheading, fontWeight: typography.weight.semibold },
  cardCaption: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  divider: { height: StyleSheet.hairlineWidth },
  wearableCta: { width: '100%', paddingVertical: space.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  wearableCtaLabel: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
});
