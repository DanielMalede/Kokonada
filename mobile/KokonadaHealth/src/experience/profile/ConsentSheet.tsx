import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, Pressable, ScrollView, StyleSheet, Easing } from 'react-native';
import { useTheme, useMotion } from '../../design/theme';
import { space, radius, type as typography, elevation, motion, type HapticKey } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';
import { CONSENT_DATA_CATEGORIES } from '../../health/consentApi';
import type { ConsentFlowStore, ConsentFlowState } from '../../health/consentStore';

// SCREENS §11 — the GDPR Art.9 consent wall (audit H-9). A STATIC surface (no bio-aura, no hero):
// brand mark + title on top, a REAL scrollable consent document in the middle, and a PERSISTENT
// non-scrolling action bar with equal-weight Decline · Agree pinned at the bottom. Shown just-in-time
// immediately before the OS Health Connect permission prompt — the OS sheet (onProceed) fires ONLY on
// a server-acked current grant (ready | granted_ack); every other state keeps it shut. The store owns
// that gate; this component is the surface + the callbacks.

// ── PLACEHOLDER COPY — final legal wording pending compliance-auditor + legal review. ──────────────
// The data-types section is DERIVED from CONSENT_DATA_CATEGORIES so the notice can never drift from
// what is actually sent to (and recorded by) the backend.
const DATA_TYPE_LABELS: Record<(typeof CONSENT_DATA_CATEGORIES)[number], string> = {
  heart_rate: 'Heart rate',
  hrv: 'Heart-rate variability (HRV)',
  sleep: 'Sleep sessions',
  resting_heart_rate: 'Resting heart rate',
  historical_access_182d: 'Historical readings (up to ~6 months back)',
  // Garmin server-to-server lane only — each names its source so a Health-Connect-only user is
  // never told we read something their phone doesn't share.
  spo2: 'Blood oxygen (SpO₂) — from a connected Garmin device',
  respiratory_rate: 'Respiration rate — from a connected Garmin device',
  body_battery: 'Body Battery — from a connected Garmin device',
};

interface Section { heading: string; body: string; }

// PLACEHOLDER COPY — six sections per the designer spec (purpose · data · use · retention · sub-processors
// · your controls). Reasonable, honest placeholder wording; NOT the final legal text.
const CONSENT_SECTIONS: Section[] = [
  {
    heading: 'Why we ask',
    body:
      'Kokonada turns how your body is doing into music tuned to you. To do that we need your explicit ' +
      'permission to read health and biometric data from your wearable. This is special-category data ' +
      'under GDPR Article 9, so we ask you here — clearly and up front — before anything is read.',
  },
  {
    heading: 'What we read',
    body:
      CONSENT_DATA_CATEGORIES.map((k) => `• ${DATA_TYPE_LABELS[k]}`).join('\n'),
  },
  {
    heading: 'How it is used',
    body:
      'These readings personalise your session in the moment and are summarised into a private profile that ' +
      'shapes future recommendations. They are never sold, and never used for advertising.',
  },
  {
    heading: 'How long we keep it',
    body:
      'We keep only what personalisation needs and no longer. Raw samples are minimised over time; withdrawing ' +
      'your consent erases the health data held across your connected wearables.',
  },
  {
    heading: 'Who else processes it',
    body:
      'Music intelligence is generated with Groq (our AI provider), and your readings originate from your ' +
      'wearable/health provider. These sub-processors act only on our instructions to deliver the service.',
  },
  {
    heading: 'Your controls',
    body:
      'Consent is optional — the app works in mood-only mode without it. You can withdraw at any time from ' +
      'your Profile, which stops biometric personalisation and erases the health data held for you.',
  },
];

const ENTER_BEZIER = Easing.bezier(...motion.easing.enter);

function ShieldGlyph({ color }: { color: string }) {
  // The one static ornament (SCREENS §11): a small padlock drawn from tokens so it tints to accent.glow
  // and never becomes a reactive aura. Decorative → hidden from the screen reader so focus lands on the
  // title first. A final vector asset can replace this without touching layout.
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.glyphWrap}
    >
      <View style={[styles.glyphShackle, { borderColor: color }]} />
      <View style={[styles.glyphBody, { backgroundColor: color }]} />
    </View>
  );
}

function useFlow(store: ConsentFlowStore): ConsentFlowState {
  const [state, setState] = useState<ConsentFlowState>(store.getState());
  useEffect(() => {
    setState(store.getState());
    return store.subscribe(setState);
  }, [store]);
  return state;
}

export interface ConsentSheetProps {
  store: ConsentFlowStore;
  // The OS Health Connect permission request — fired ONLY on a server-acked current grant.
  onProceed: () => void;
  // Dismiss without granting; the caller's mood-only path stays fully functional.
  onDecline: () => void;
  triggerHaptic?: (key: HapticKey) => void;
}

export function ConsentSheet({ store, onProceed, onDecline, triggerHaptic = fireHaptic }: ConsentSheetProps) {
  const { c } = useTheme();
  const { reduced, duration } = useMotion();
  const { flow, status } = useFlow(store);

  // Kick off the status read when mounted un-seeded (the error-pre-check path). A seeded store is
  // already past `idle`, so this never double-fetches the happy path.
  useEffect(() => {
    if (store.getState().flow === 'idle') void store.getState().check();
  }, [store]);

  // THE GATE: proceed to the OS sheet ONLY on the two server-acked states; dismiss on decline. Every
  // other state (checking / consent_required / submitting_grant / submit_error) keeps the OS sheet shut.
  useEffect(() => {
    if (flow === 'ready' || flow === 'granted_ack') onProceed();
    else if (flow === 'declined') onDecline();
  }, [flow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reduced-motion: instant, byte-identical (opacity only — never a layout shift).
  const entry = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { entry.setValue(1); return; }
    entry.setValue(0);
    const anim = Animated.timing(entry, { toValue: 1, duration: duration.base, easing: ENTER_BEZIER, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [reduced, duration.base, entry]);

  const onAgree = () => { triggerHaptic('commit'); void store.getState().submitGrant(); };
  const onRetry = () => { void store.getState().retry(); };
  const onDeclinePress = () => { store.getState().decline(); };

  const root = (children: React.ReactNode) => (
    <Animated.View testID="consent-sheet" style={[styles.root, { backgroundColor: c.surface.base, opacity: entry }]}>
      {children}
    </Animated.View>
  );

  // ready → the wall is never rendered (short-circuit); declined → dismissed. Render nothing.
  if (flow === 'ready' || flow === 'declined') return root(null);

  if (flow === 'idle' || flow === 'checking') {
    return root(
      <View testID="consent-skeleton" style={styles.skeleton} accessibilityLabel="Preparing your consent notice">
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={[styles.skelBlock, { backgroundColor: c.surface.raised, width: i === 0 ? '55%' : '100%' }]} />
        ))}
      </View>,
    );
  }

  if (flow === 'granted_ack') {
    return root(
      <View testID="consent-ack" style={styles.ack}>
        <ShieldGlyph color={c.accent.glow} />
        <Text style={[styles.ackText, { color: c.content.primary }]}>Consent recorded</Text>
      </View>,
    );
  }

  // consent_required | consent_stale | submitting_grant | submit_error → the full wall.
  const stale = !!(status?.granted && status?.staleVersion);
  const submitting = flow === 'submitting_grant';
  const errored = flow === 'submit_error';

  const title = stale ? 'Your consent terms were updated' : 'Your health data, only with your say-so';
  const subtitle = stale
    ? 'Please review the updated notice and re-confirm to continue.'
    : 'Review what we read and why, then choose. You can decline and keep using Kokonada in mood-only mode.';

  const primaryLabel = errored ? 'Try again' : submitting ? 'Recording…' : 'Agree';
  const primaryOnPress = errored ? onRetry : onAgree;

  return root(
    <>
      <View style={styles.header}>
        <ShieldGlyph color={c.accent.glow} />
        <Text style={[styles.wordmark, { color: c.content.tertiary }]}>KOKONADA</Text>
        <Text testID="consent-title" accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>
          {title}
        </Text>
        <Text style={[styles.subtitle, { color: c.content.secondary }]}>{subtitle}</Text>
      </View>

      <ScrollView
        testID="consent-document"
        style={styles.doc}
        contentContainerStyle={styles.docContent}
        showsVerticalScrollIndicator
      >
        {CONSENT_SECTIONS.map((s, i) => (
          <View
            key={s.heading}
            style={[styles.card, elevation.e1, { backgroundColor: c.surface.raised, borderColor: c.surface.hairline, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth }]}
          >
            <Text accessibilityRole="header" style={[styles.cardHeading, { color: c.content.primary }]}>{s.heading}</Text>
            <Text selectable style={[styles.cardBody, { color: c.content.secondary }]}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>

      <Text testID="consent-scroll-cue" style={[styles.scrollCue, { color: c.content.tertiary }]}>Scroll to review the full notice</Text>

      {errored ? (
        <Text testID="consent-error" style={[styles.errorText, { color: c.state.warning }]}>
          We couldn’t record your consent. Check your connection and try again.
        </Text>
      ) : null}

      {/* Persistent, non-scrolling action bar — equal-weight Decline · Agree. Decline is NEVER
          de-emphasised or danger-styled; its border is content.tertiary (a real ≥3:1 boundary,
          unlike the decorative hairline token). Agree keeps the app's fixed brand CTA fill
          (accent.glowInk) — it deliberately does NOT re-tint to the emotion accent, because a
          legal choice must never be emotionally nudged. */}
      <View style={styles.actionBar}>
        <Pressable
          testID="consent-decline"
          onPress={onDeclinePress}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Decline health-data processing"
          accessibilityState={{ disabled: submitting }}
          style={[styles.btn, { borderColor: c.content.tertiary, opacity: submitting ? 0.5 : 1 }]}
        >
          <Text style={[styles.btnText, { color: c.content.primary }]}>Decline</Text>
        </Pressable>

        <Pressable
          testID="consent-agree"
          onPress={primaryOnPress}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Agree and continue to health permissions"
          accessibilityState={{ disabled: submitting }}
          style={[styles.btn, { backgroundColor: c.accent.glowInk, borderColor: c.accent.glowInk, opacity: submitting ? 0.6 : 1 }]}
        >
          <Text style={[styles.btnText, { color: c.content.onAccent }]}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </>,
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: space.xl, paddingTop: space['3xl'], paddingBottom: space.xl },
  header: { alignItems: 'flex-start', gap: space.sm, marginBottom: space.lg },
  wordmark: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
  title: { fontSize: typography.size.title, fontWeight: typography.weight.bold },
  subtitle: { fontSize: typography.size.callout, lineHeight: typography.size.callout * typography.leading.normal },
  doc: { flex: 1 },
  docContent: { gap: space.md, paddingBottom: space.md },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  cardHeading: { fontSize: typography.size.subheading, fontWeight: typography.weight.semibold },
  cardBody: { fontSize: typography.size.callout, lineHeight: typography.size.callout * typography.leading.normal },
  scrollCue: { fontSize: typography.size.footnote, textAlign: 'center', paddingVertical: space.sm },
  errorText: { fontSize: typography.size.callout, textAlign: 'center', paddingBottom: space.sm },
  actionBar: { flexDirection: 'row', gap: space.md, paddingTop: space.sm },
  // Equal-weight buttons: identical geometry (flex, padding, radius, border box). Only the FILL
  // differs (filled primary vs. outlined) — an accessible primary/secondary that keeps Decline an
  // equal, real control.
  btn: { flex: 1, paddingVertical: space.lg, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  skeleton: { flex: 1, gap: space.lg, paddingTop: space.xl },
  skelBlock: { height: space.xl, borderRadius: radius.sm },
  ack: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  ackText: { fontSize: typography.size.heading, fontWeight: typography.weight.semibold },
  glyphWrap: { width: space['2xl'], height: space['2xl'], alignItems: 'center', justifyContent: 'flex-end', paddingBottom: space.xs },
  glyphShackle: { width: space.lg, height: space.md, borderWidth: 2.5, borderBottomWidth: 0, borderTopLeftRadius: radius.pill, borderTopRightRadius: radius.pill },
  glyphBody: { width: space.xl, height: space.lg, borderRadius: radius.xs, marginTop: -1 },
});
