import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography, elevation, type HapticKey } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';
import type { WatchPairingStore, WatchPairingState } from './watchPairingStore';

// §10 Watch pairing CARD (audit L-15). Shows the ephemeral 6-digit pairing code to READ + type on
// the Garmin watch — NEVER the long-lived whr_ device token, and deliberately NO clipboard/Copy
// button (you can't paste into a watch bezel; a clipboard would also force a native dep). The code
// is large + selectable, its a11y label SPELLS the digits (so a screen reader says "one two three"
// not "one hundred twenty-three thousand…"), and the countdown is a polite live region.
//
// STATIC trust surface: a fixed brand-accent CTA only — never a reactive emotion re-tint.

const POLL_MS = 4000;    // has the watch exchanged the code yet? (browser/watch round-trip is unseen)
const COUNTDOWN_MS = 1000; // tick the expiry countdown + fire the store's TTL check

function useWatchFlow(store: WatchPairingStore): WatchPairingState {
  const [state, setState] = useState<WatchPairingState>(store.getState());
  useEffect(() => {
    setState(store.getState());
    return store.subscribe(setState);
  }, [store]);
  return state;
}

function groupCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
// "123456" → "1 2 3 4 5 6" so the screen reader spells each digit.
function spellCode(code: string): string {
  return code.split('').join(' ');
}
function relativeLastSeen(iso: string | null): string {
  if (!iso) return 'Never seen';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 1 ? 'just now' : `${mins}m ago`;
}

export interface WatchPairingCardProps {
  store: WatchPairingStore;
  triggerHaptic?: (key: HapticKey) => void;
}

export function WatchPairingCard({ store, triggerHaptic = fireHaptic }: WatchPairingCardProps) {
  const { c } = useTheme();
  const { phase, code, expiresAt, lastSeenAt } = useWatchFlow(store);
  const [now, setNow] = useState(() => Date.now());

  // Hydrate the connection status once on mount (best-effort — the store no-ops on a failed read).
  useEffect(() => { void store.getState().hydrate(); }, [store]);

  // While a code is shown: tick the countdown (+ let the store auto-expire at TTL) and poll for the
  // watch completing the exchange so the card flips to "Connected" without any manual refresh.
  useEffect(() => {
    if (phase !== 'code_shown') return;
    const countdown = setInterval(() => { setNow(Date.now()); store.getState().checkExpiry(); }, COUNTDOWN_MS);
    const poll = setInterval(() => { void store.getState().poll(); }, POLL_MS);
    return () => { clearInterval(countdown); clearInterval(poll); };
  }, [phase, store]);

  const onSetUp = () => { triggerHaptic('selection'); void store.getState().setUp(); };
  const onCancel = () => { store.getState().cancel(); };
  const onDisconnect = () => { void store.getState().disconnect(); };

  const secondsLeft = expiresAt != null ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0;

  return (
    <View style={[styles.card, elevation.e1, { backgroundColor: c.surface.raised }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>Watch heart rate</Text>
      <Text style={[styles.caption, { color: c.content.secondary }]}>Stream live heart rate from your Garmin watch.</Text>

      {phase === 'connected' ? (
        <>
          <View style={styles.statusRow}>
            <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.check, { color: c.state.success }]}>✓</Text>
            <Text style={[styles.statusWord, { color: c.content.secondary }]}>Connected · seen {relativeLastSeen(lastSeenAt)}</Text>
          </View>
          <View style={styles.actionRow}>
            <Pressable
              onPress={onSetUp}
              accessibilityRole="button"
              accessibilityLabel="watch-repair"
              hitSlop={space.sm}
              style={[styles.neutralBtn, { borderColor: c.content.secondary }]}
            >
              <Text style={[styles.neutralLabel, { color: c.content.secondary }]}>Re-pair</Text>
            </Pressable>
            <Pressable
              onPress={onDisconnect}
              accessibilityRole="button"
              accessibilityLabel="watch-disconnect"
              hitSlop={space.sm}
              style={[styles.neutralBtn, { borderColor: c.content.secondary }]}
            >
              <Text style={[styles.neutralLabel, { color: c.content.secondary }]}>Disconnect</Text>
            </Pressable>
          </View>
        </>
      ) : phase === 'code_shown' && code ? (
        <View style={styles.codeZone}>
          <Text
            selectable
            accessibilityLabel={`Pairing code ${spellCode(code)}`}
            style={[styles.code, { color: c.content.primary }]}
          >
            {groupCode(code)}
          </Text>
          <Text accessibilityLiveRegion="polite" style={[styles.expiry, { color: c.content.secondary }]}>
            Expires in {secondsLeft}s · one-time use. Enter it in the Kokonada Health watch app.
          </Text>
          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="watch-cancel"
            hitSlop={space.sm}
            style={styles.textBtn}
          >
            <Text style={[styles.neutralLabel, { color: c.content.secondary }]}>Cancel</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {phase === 'error' ? (
            <Text style={[styles.caption, { color: c.content.secondary }]}>Couldn’t set up the watch — please try again.</Text>
          ) : null}
          <Pressable
            onPress={onSetUp}
            disabled={phase === 'generating'}
            accessibilityRole="button"
            accessibilityLabel="watch-set-up"
            accessibilityState={{ disabled: phase === 'generating' }}
            style={[styles.cta, { backgroundColor: c.accent.glowInk, opacity: phase === 'generating' ? 0.6 : 1 }]}
          >
            <Text style={[styles.ctaLabel, { color: c.content.onAccent }]}>{phase === 'generating' ? 'Setting up…' : 'Set up watch'}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.md },
  title: { fontSize: typography.size.subheading, fontWeight: typography.weight.semibold },
  caption: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  check: { fontSize: typography.size.caption, fontWeight: typography.weight.bold },
  statusWord: { fontSize: typography.size.callout },
  actionRow: { flexDirection: 'row', gap: space.md },
  neutralBtn: { paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  neutralLabel: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
  codeZone: { gap: space.sm, alignItems: 'flex-start' },
  code: { fontSize: typography.size.display, fontWeight: typography.weight.bold, fontFamily: typography.family.mono, letterSpacing: typography.tracking.caption },
  expiry: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  textBtn: { paddingVertical: space.md },
  cta: { width: '100%', paddingVertical: space.lg, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ctaLabel: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
});
