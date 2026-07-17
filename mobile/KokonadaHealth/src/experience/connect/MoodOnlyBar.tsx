import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';
import type { ConnectState } from './connectStore';
import type { StoreApi } from 'zustand/vanilla';

// The pinned bottom action bar — the mood-only escape, ALWAYS one tap away (anti-dark-pattern
// stance: a wearable is never a hard gate). Its treatment is driven only by the connect store:
//   • not resolved → "Continue with mood only" as a confident glow-OUTLINE secondary (an equal,
//     legitimate choice — a filled brand CTA here would nudge users PAST connecting). Sub-copy
//     reminds them Profile can add a wearable later.
//   • resolved     → a single filled "Continue" (the positive confirm treatment); no re-nag.
// Tokens only, fixed brand accent (accent.glow / accent.glowInk) — never the reactive emotionAccent.

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

export interface MoodOnlyBarProps {
  connect: ConnectStore;
  onMoodOnly: () => void; // choose mood-only (persist + commit haptic + route flip)
  onContinue: () => void; // already resolved → forward
}

export function MoodOnlyBar({ connect, onMoodOnly, onContinue }: MoodOnlyBarProps) {
  const { c } = useTheme();
  const { resolved } = useConnectSnapshot(connect);

  if (resolved) {
    return (
      <View style={[styles.bar, { backgroundColor: c.surface.base, borderTopColor: c.surface.hairline }]}>
        <Pressable
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="continue-forward"
          style={[styles.button, { backgroundColor: c.accent.glowInk, borderColor: c.accent.glowInk }]}
        >
          <Text style={[styles.label, { color: c.content.onAccent }]}>Continue</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.bar, { backgroundColor: c.surface.base, borderTopColor: c.surface.hairline }]}>
      <Pressable
        onPress={onMoodOnly}
        accessibilityRole="button"
        accessibilityLabel="continue-mood-only"
        style={[styles.button, styles.outline, { borderColor: c.accent.glow }]}
      >
        <Text style={[styles.label, { color: c.accent.glow }]}>Continue with mood only</Text>
      </Pressable>
      <Text style={[styles.subtext, { color: c.content.tertiary }]}>
        You can connect a wearable anytime in Profile.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xl, borderTopWidth: StyleSheet.hairlineWidth },
  button: { width: '100%', paddingVertical: space.lg, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  outline: { backgroundColor: 'transparent' },
  label: { fontSize: typography.size.body, fontWeight: typography.weight.semibold },
  subtext: { fontSize: typography.size.footnote, textAlign: 'center', marginTop: space.sm },
});
