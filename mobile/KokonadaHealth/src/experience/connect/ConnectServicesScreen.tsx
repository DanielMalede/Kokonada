import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Dimensions, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, type HapticKey } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';
import { BreathingGlow } from '../aura/BreathingGlow';
import { apiGet } from '../../net/apiClient';
import type { IntegrationsStatus } from '../profile/profileController';
import { providersByKind } from './providers';
import { ProviderRow } from './ProviderRow';
import { WhyAccordion } from './WhyAccordion';
import { MoodOnlyBar } from './MoodOnlyBar';
import { connectStore, type ConnectState } from './connectStore';
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

export interface ConnectServicesScreenProps {
  connect?: ConnectStore;
  loadIntegrations?: () => Promise<IntegrationsStatus | null>;
  // Chosen mood-only or forwarded after resolving — the route is DERIVED from the store in AppFlow,
  // so these default to no-ops (the store flip does the routing). Overridable for tests.
  onContinue?: () => void;
  onConnectWearable?: () => void; // real §11-consent flow is wired in T6
  triggerHaptic?: (key: HapticKey) => void;
}

export function ConnectServicesScreen({
  connect = connectStore,
  loadIntegrations = defaultLoadIntegrations,
  onContinue = () => {},
  onConnectWearable = () => {},
  triggerHaptic = fireHaptic,
}: ConnectServicesScreenProps = {}) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const insets = useSafeAreaInsets();
  const { resolved, moodOnly } = useConnectSnapshot(connect);
  const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);

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
            accessibilityRole="button"
            accessibilityLabel="connect-wearable"
            style={[styles.wearableCta, { backgroundColor: c.accent.glowInk }]}
          >
            <Text style={[styles.wearableCtaLabel, { color: c.content.onAccent }]}>Connect a wearable</Text>
          </Pressable>
          <WhyAccordion title={WEARABLE_WHY_TITLE} body={WEARABLE_WHY_BODY} />
        </View>
      </ScrollView>

      {/* D — pinned mood-only escape (outside the scroll, always visible) */}
      <MoodOnlyBar connect={connect} onMoodOnly={onMoodOnly} onContinue={onContinue} />
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
