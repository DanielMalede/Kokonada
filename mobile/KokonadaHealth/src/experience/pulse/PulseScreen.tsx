import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Pressable,
  Animated,
  Easing,
  PixelRatio,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { warmStore } from '../../state/store';
import type { WarmState, BiometricSource, ConnectionStatus } from '../../state/warm/warmStore';
import { pulseStateStore, type PulseStoreState } from './pulseStateStore';
import type { PulseState } from './pulseApi';
import { friendlyStatus } from './statusLabels';
import { getLastSyncCounts, subscribeSyncCounts, type SyncCounts } from '../../health/healthSync';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, elevation, motion, type as typography, type ColorScheme, type EmotionQuadrant } from '../../design/tokens';
import { BreathingGlow } from '../aura/BreathingGlow';
import { EmptyState, Skeleton, useCalmPulse } from '../../design/system';
import {
  GAUGES,
  GAUGE_GROUP_LABELS,
  GAUGE_FILL_HEIGHT,
  GAUGE_TILE_MIN_H,
  AURA_HERO_SCALE,
  fillFraction,
  hrAuraColor,
  honestNote,
  statusQuadrant,
  type GaugeDef,
  type GaugeKey,
  type GaugeGroup,
} from './pulsePresentation';

// Pulse (§8) — the body dashboard, read HONESTLY. Live tiles (HR hero · source · socket) →
// Gauges (Vitals · Last night · Recovery) → the State headline (the payoff). This is a RESKIN +
// honest-empty LANGUAGE only: the /api/pulse/state DTO, the single-flight / stale-while-revalidate
// store, warmStore, friendlyStatus and the sync-counts pipeline are all sacred and untouched.
// Non-negotiables live as code: tokens only, calm-fills are always one accent (never a good/bad
// ramp), the aura PERIOD is always the fixed calm breath (only its HUE carries HR, capped at coral),
// no bare dash (every null metric renders an honest sentence), and state.danger is forbidden here.

// The hero glow field ≈ 2× the numeral — a restrained halo (the aura's star turns are Generate).
const HERO_AURA_SIZE = space['4xl'] * AURA_HERO_SCALE;
// Below a full read the confidence line invites a fuller read.
const LOW_CONFIDENCE = 0.4;
// Above this OS font scale the 2-col grid stacks to 1-col so tiles never crush their sentences.
const ACCESSIBILITY_FONT_SCALE = 1.3;
// Connect §4 is a one-way onboarding gate (connectStore, no unresolve surface), unreachable once
// past. The in-app home of device/wearable connection is the Profile tab — the honest destination.
const CONNECT_ROUTE = 'Profile';
// The connecting-dot breath frames.
const DOT_PULSE = { rest: 0.4, peak: 1, still: 1 } as const;
const GROUP_ORDER: readonly GaugeGroup[] = ['vitals', 'lastNight', 'recovery'];

function gaugeValue(key: GaugeKey, data: PulseState | null): number | null {
  if (!data) return null;
  switch (key) {
    case 'hrv': return data.vitals.hrv;
    case 'restingHeartRate': return data.vitals.restingHeartRate;
    case 'bodyBattery': return data.vitals.bodyBattery;
    case 'dailyReadiness': return data.vitals.dailyReadiness;
    case 'deep': return data.sleep.lastNight.deep;
    case 'rem': return data.sleep.lastNight.rem;
  }
}

function socketChip(connection: ConnectionStatus, c: ColorScheme): { text: string; dot: string; pulsing?: boolean } {
  if (connection === 'connected') return { text: 'Live', dot: c.state.success };
  if (connection === 'connecting') return { text: 'Connecting…', dot: c.accent.glow, pulsing: true };
  return { text: 'Offline', dot: c.content.secondary }; // static, non-alarm — never state.danger
}

// A single supportive chip — a graphic-only dot (a11y-hidden, always paired with text) + a label.
function MetaChip({ text, dotColor, pulsing, reduced, periodMs, c }: {
  text: string; dotColor: string; pulsing?: boolean; reduced: boolean; periodMs: number; c: ColorScheme;
}) {
  const pulse = useCalmPulse(reduced || !pulsing, pulsing ? periodMs : 0, DOT_PULSE);
  return (
    <View accessible accessibilityLabel={text} style={[styles.chip, elevation.e1, { backgroundColor: c.surface.raised }]}>
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.chipDot, { backgroundColor: dotColor, opacity: pulsing ? pulse : 1 }]}
      />
      <Text allowFontScaling style={[styles.chipText, { color: c.content.secondary }]}>{text}</Text>
    </View>
  );
}

// The calm-fill capsule (Mode A). Left-anchored scaleX on the native driver — NEVER a good/bad
// colour ramp; the fill is always the single calm accent and the NUMBER carries the meaning.
function CalmFill({ fraction, color, trackColor, reduced }: { fraction: number; color: string; trackColor: string; reduced: boolean }) {
  const [w, setW] = useState(0);
  const anim = useRef(new Animated.Value(reduced ? fraction : 0)).current;
  useEffect(() => {
    if (reduced) { anim.setValue(fraction); return; }
    const a = Animated.timing(anim, { toValue: fraction, duration: motion.duration.slow, easing: Easing.bezier(...motion.easing.calm), useNativeDriver: true });
    a.start();
    return () => a.stop(); // settles, no perpetual motion; disposed on unmount
  }, [fraction, reduced, anim]);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [-w / 2, 0] });
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onLayout={onLayout} style={[styles.fillTrack, { backgroundColor: trackColor }]}>
      <Animated.View style={[styles.fillBar, { width: w, backgroundColor: color, transform: [{ translateX }, { scaleX: anim }] }]} />
    </View>
  );
}

// The dormant capsule (Mode B) — an unfilled hairline track + a hollow ring at the leading cap:
// "empty but intact", never a broken gauge. No accent, no ramp.
function DormantFill({ trackColor, ringColor }: { trackColor: string; ringColor: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.fillTrack, styles.dormantTrack, { backgroundColor: trackColor }]}>
      <View style={[styles.dormantRing, { borderColor: ringColor }]} />
    </View>
  );
}

// One gauge = one accessible element: value + full-word unit, or the honest sentence. Three modes
// share ONE silhouette + fixed height (GAUGE_TILE_MIN_H) so a refresh mode-switch never reflow-jumps.
function GaugeTile({ def, value, counts, source, reduced, loading, basis, c }: {
  def: GaugeDef; value: number | null; counts: SyncCounts | null; source: BiometricSource; reduced: boolean; loading: boolean; basis: `${number}%`; c: ColorScheme;
}) {
  const hasValue = value != null;
  const note = !loading && !hasValue ? honestNote(def.key, counts, source) : null;
  const a11yLabel = loading
    ? undefined
    : hasValue
      ? `${def.label}, ${value}${def.unitWord ? ` ${def.unitWord}` : ''}`
      : `${def.label}, ${note!.text}${note!.subnote ? `, ${note!.subnote}` : ''}`;

  return (
    <View
      accessible={!loading}
      accessibilityLabel={a11yLabel}
      style={[styles.tile, elevation.e1, { backgroundColor: c.surface.raised, flexBasis: basis }]}
    >
      <Text allowFontScaling style={[styles.tileLabel, { color: c.content.secondary }]}>{def.label}</Text>

      {loading ? (
        <View style={styles.tileValueGap}>
          <Skeleton variant="title" onSurface="raised" width="55%" />
          <Skeleton variant="line" onSurface="raised" width="100%" style={styles.tileFillGap} />
        </View>
      ) : hasValue ? (
        <>
          <Text allowFontScaling style={styles.tileValueGap}>
            <Text style={[styles.tileValue, { color: c.content.primary }]}>{value}</Text>
            {def.unitShort ? <Text style={[styles.tileUnit, { color: c.content.secondary }]}>{` ${def.unitShort}`}</Text> : null}
          </Text>
          <View style={styles.tileFillGap}>
            <CalmFill fraction={fillFraction(def.key, value)} color={c.accent.glow} trackColor={c.surface.overlay} reduced={reduced} />
          </View>
        </>
      ) : (
        <>
          <Text allowFontScaling style={[styles.tileNote, { color: c.content.secondary }]}>{note!.text}</Text>
          {note!.subnote ? <Text allowFontScaling style={[styles.tileSubnote, { color: c.content.secondary }]}>{note!.subnote}</Text> : null}
          <View style={styles.tileFillGap}>
            <DormantFill trackColor={c.surface.hairline} ringColor={c.content.secondary} />
          </View>
        </>
      )}
    </View>
  );
}

// The payoff: friendlyStatus over the body's decorative wash (the ONE reactive accent on Pulse).
// Text stays content.primary for AA over the wash — never accent ink at body size; violet never red.
function StateCard({ loading, status, confidence, quadrant, reduced, onConnect, c }: {
  loading: boolean; status: string | null; confidence: number | null; quadrant: EmotionQuadrant; reduced: boolean; onConnect: () => void; c: ColorScheme;
}) {
  const entry = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { entry.setValue(1); return; }
    entry.setValue(0);
    const a = Animated.timing(entry, { toValue: 1, duration: motion.duration.base, easing: Easing.bezier(...motion.easing.enter), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reduced, entry, status, loading]);
  const animStyle = reduced ? null : { opacity: entry, transform: [{ translateY: entry.interpolate({ inputRange: [0, 1], outputRange: [space.sm, 0] }) }] };

  return (
    <Animated.View style={[styles.stateCard, elevation.e1, { backgroundColor: c.surface.raised }, animStyle]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.stateWash, { backgroundColor: c.emotionAccent[quadrant].wash }]} />
      {loading ? (
        <Skeleton variant="line" onSurface="raised" width="70%" />
      ) : status ? (
        <>
          <Text accessibilityRole="header" allowFontScaling style={[styles.stateHeadline, { color: c.content.primary }]}>{status}</Text>
          {confidence != null ? (
            <Text allowFontScaling style={[styles.stateConfidence, { color: c.content.secondary }]}>
              {`${Math.round(confidence * 100)}% read confidence`}
              {confidence < LOW_CONFIDENCE ? ' · connect a wearable for a fuller read.' : ''}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text allowFontScaling style={[styles.statePlaceholder, { color: c.content.primary }]}>Your state will appear once your body&apos;s being read</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Connect a device" onPress={onConnect} hitSlop={space.sm} style={styles.stateLink}>
            <Text allowFontScaling style={[styles.stateLinkText, { color: c.content.primary }]}>Connect a device</Text>
          </Pressable>
        </>
      )}
    </Animated.View>
  );
}

export function PulseScreen() {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<{ navigate: (name: string) => void }>();

  const [w, setW] = useState<Pick<WarmState, 'liveHr' | 'connection' | 'biometricSource'>>(() => {
    const s = warmStore.getState();
    return { liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource };
  });
  const [pulse, setPulse] = useState<PulseStoreState>(() => pulseStateStore.getState());
  const [counts, setCounts] = useState<SyncCounts | null>(() => getLastSyncCounts());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let mounted = true;
    const syncWarm = (s: WarmState) => { if (mounted) setW({ liveHr: s.liveHr, connection: s.connection, biometricSource: s.biometricSource }); };
    const syncPulse = (s: PulseStoreState) => { if (mounted) setPulse(s); };
    syncWarm(warmStore.getState());
    const offWarm = warmStore.subscribe(syncWarm);
    const offPulse = pulseStateStore.subscribe(syncPulse);
    const offCounts = subscribeSyncCounts((cnt) => { if (mounted) setCounts(cnt); });
    return () => { mounted = false; offWarm(); offPulse(); offCounts(); };
  }, []);

  // Re-fetch on EVERY tab focus (sacred): a bottom-tab screen stays mounted, so a Sync on another
  // tab must reflect on return. Unchanged from the shipped pipeline.
  useFocusEffect(useCallback(() => {
    void pulseStateStore.getState().refresh();
    setCounts(getLastSyncCounts());
  }, []));

  const goConnect = useCallback(() => { navigation.navigate(CONNECT_ROUTE); }, [navigation]);

  // Pull-to-refresh is the platform GESTURE affordance (distinct from the "never a spinner"
  // content-loading rule). Single-flight lives in the store; stale-while-revalidate keeps the
  // good numbers visible. Re-read sync counts — the natural place to reflect a wearable re-sync.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setCounts(getLastSyncCounts());
      await pulseStateStore.getState().refresh();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const data = pulse.data;
  const sv = data?.stateVector;
  const status = friendlyStatus(sv?.status);
  const confidence = sv?.confidence ?? null;
  const quadrant = statusQuadrant(sv?.status);
  const anyVital = data
    ? [data.vitals.hrv, data.vitals.restingHeartRate, data.vitals.bodyBattery, data.vitals.dailyReadiness, data.sleep.lastNight.deep, data.sleep.lastNight.rem].some((v) => v != null)
    : false;

  const isSyncing = pulse.loading && data == null;
  const isEmpty = w.biometricSource === 'none' && w.liveHr == null && counts == null && !anyVital && !status;

  const oneCol = PixelRatio.getFontScale() > ACCESSIBILITY_FONT_SCALE;
  const tileBasis: `${number}%` = oneCol ? '100%' : '48%';

  const scrollStyle = { backgroundColor: c.surface.base };
  const contentStyle = { paddingHorizontal: space.xl, paddingTop: insets.top + space.xl, paddingBottom: space['3xl'] };
  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent.glow} colors={[c.accent.glow]} />
  );

  // ── The dashboard body, shared by the syncing skeleton and the live states. ──
  const heroA11y = w.liveHr != null ? `Heart rate, ${w.liveHr} beats per minute, live` : 'Heart rate, no live reading';
  const sourceText = w.biometricSource === 'ble' ? 'Heart-rate sensor' : w.biometricSource === 'health-connect' ? 'Health Connect' : 'No live source';
  const sourceDot = w.biometricSource === 'none' ? c.content.secondary : c.accent.glow;
  const socket = socketChip(w.connection, c);

  const body = (loading: boolean) => (
    <View style={styles.stack}>
      {/* HR hero — floats on base with the breathing halo behind (no card). The aura PERIOD is the
          fixed calm breath regardless of HR; only its HUE warms with the body, capped at coral. */}
      <View style={styles.hero}>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <BreathingGlow color={hrAuraColor(w.liveHr)} reduced={reduced} breathMs={duration.breath} size={HERO_AURA_SIZE} style={styles.relGlow} />
        </View>
        <View accessible accessibilityLabel={heroA11y} style={styles.center}>
          {loading && w.liveHr == null ? (
            <Skeleton variant="title" onSurface="base" width={space['4xl']} />
          ) : w.liveHr != null ? (
            <>
              <Text allowFontScaling style={[styles.heroNumeral, { color: c.content.primary }]}>{w.liveHr}</Text>
              <Text allowFontScaling style={[styles.heroUnit, { color: c.content.secondary }]}>bpm</Text>
            </>
          ) : (
            <Text allowFontScaling style={[styles.heroHushed, { color: c.content.secondary }]}>No live reading</Text>
          )}
        </View>
      </View>

      {/* Source + socket chips. Both dots are graphic-only and non-alarm (offline is a static
          content.secondary dot, never state.danger). */}
      <View style={styles.metaRow}>
        <MetaChip text={sourceText} dotColor={sourceDot} reduced={reduced} periodMs={duration.breath} c={c} />
        <MetaChip text={socket.text} dotColor={socket.dot} pulsing={socket.pulsing} reduced={reduced} periodMs={duration.breath} c={c} />
      </View>

      {/* Gauges, grouped Vitals · Last night · Recovery. */}
      {GROUP_ORDER.map((group) => (
        <View key={group} style={styles.section}>
          <Text allowFontScaling style={[styles.sectionLabel, { color: c.content.secondary }]}>{GAUGE_GROUP_LABELS[group]}</Text>
          <View style={styles.grid}>
            {GAUGES.filter((g) => g.group === group).map((def) => (
              <GaugeTile
                key={def.key}
                def={def}
                value={gaugeValue(def.key, data)}
                counts={counts}
                source={w.biometricSource}
                reduced={reduced}
                loading={loading}
                basis={tileBasis}
                c={c}
              />
            ))}
          </View>
        </View>
      ))}

      <StateCard loading={loading} status={status} confidence={confidence} quadrant={quadrant} reduced={reduced} onConnect={goConnect} c={c} />
    </View>
  );

  if (isSyncing) {
    // First load, no prior data: skeletons breathe (never a spinner), announced once as a sentence.
    // Checked BEFORE the empty state — a cold start is "reading", not yet "nothing to read".
    return (
      <ScrollView style={scrollStyle} contentContainerStyle={contentStyle}>
        <Skeleton.Group label="Reading your body…" style={styles.syncGroup}>
          {body(true)}
        </Skeleton.Group>
      </ScrollView>
    );
  }

  if (isEmpty) {
    // Settled with nothing connected: never a dead end — one clear way forward.
    return (
      <ScrollView style={scrollStyle} contentContainerStyle={[styles.emptyContent, contentStyle]} refreshControl={refreshControl}>
        <EmptyState
          title="Your body isn't in the picture yet"
          body="Connect a wearable or start a live heart-rate session, and Kokonada will read your state here."
          action={{ label: 'Connect a device', onPress: goConnect }}
          tone="brand"
          accentQuadrant="calm"
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={scrollStyle} contentContainerStyle={contentStyle} refreshControl={refreshControl}>
      {body(false)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  emptyContent: { flexGrow: 1 },
  syncGroup: { padding: 0, gap: 0, width: '100%' },
  stack: { gap: space.xl },

  hero: { minHeight: HERO_AURA_SIZE, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  relGlow: { position: 'relative' },
  heroNumeral: { fontSize: typography.size.display, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.display },
  heroUnit: { marginTop: space.xs, fontSize: typography.size.callout },
  heroHushed: { fontSize: typography.size.callout },

  metaRow: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.pill },
  chipDot: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  chipText: { fontSize: typography.size.footnote },

  section: { gap: space.sm },
  sectionLabel: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

  tile: { minHeight: GAUGE_TILE_MIN_H, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md },
  tileLabel: { fontSize: typography.size.footnote },
  tileValueGap: { marginTop: space.xs },
  tileValue: { fontSize: typography.size.heading, fontWeight: typography.weight.bold },
  tileUnit: { fontSize: typography.size.footnote },
  tileNote: { marginTop: space.xs, fontSize: typography.size.callout, lineHeight: typography.size.callout * typography.leading.normal },
  tileSubnote: { marginTop: space.xs, fontSize: typography.size.footnote },
  tileFillGap: { marginTop: space.sm },

  fillTrack: { height: GAUGE_FILL_HEIGHT, borderRadius: radius.pill, overflow: 'hidden' },
  fillBar: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.pill },
  dormantTrack: { flexDirection: 'row', alignItems: 'center' },
  dormantRing: { width: GAUGE_FILL_HEIGHT, height: GAUGE_FILL_HEIGHT, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },

  stateCard: { borderRadius: radius.xl, padding: space.xl, overflow: 'hidden' },
  stateWash: { borderRadius: radius.xl },
  stateHeadline: { fontSize: typography.size.subheading, fontWeight: typography.weight.semibold },
  stateConfidence: { marginTop: space.xs, fontSize: typography.size.footnote },
  statePlaceholder: { fontSize: typography.size.callout, lineHeight: typography.size.callout * typography.leading.normal },
  stateLink: { marginTop: space.sm, alignSelf: 'flex-start' },
  stateLinkText: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold, textDecorationLine: 'underline' },
});
