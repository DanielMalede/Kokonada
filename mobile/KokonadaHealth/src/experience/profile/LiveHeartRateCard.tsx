import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, stroke, type as typography, elevation, type HapticKey } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';
import type { ApiResult } from '../../net/apiClient';
import type { WatchStatus } from '../../health/watchPairingClient';

// §10 LIVE HEART RATE — the credential card that replaced the watch PAIRING-CODE card when the
// Connect IQ app was retired. The pairing seam is gone, but the whr_ device token it shared is
// still live: the PHONE mints it (liveHrClient.getWatchToken → POST /watch/token) for both live-HR
// tiers — BLE via react-native-ble-plx and the 3-minute Health Connect fallback — and every reading
// rides it to POST /watch/hr.
//
// This card exists for ONE reason: Disconnect. Revoking that long-lived health credential was
// reachable only from the retired card, and dropping it with the pairing flow would have left a
// user unable to revoke it at all. Status is read-only context around that affordance.
//
// Honest-empty by default (SCREENS §8): a failed status read renders "not connected" rather than
// asserting a connection we could not confirm, and a failed revoke keeps the affordance on screen
// rather than pretending the credential is gone.

function relativeLastSeen(iso: string | null): string {
  if (!iso) return 'never seen';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return mins < 1 ? 'just now' : `${mins}m ago`;
}

export interface LiveHeartRateCardProps {
  fetchStatus: () => Promise<ApiResult<WatchStatus>>;
  revoke: () => Promise<ApiResult<{ message: string }>>;
  triggerHaptic?: (key: HapticKey) => void;
}

export function LiveHeartRateCard({ fetchStatus, revoke, triggerHaptic = fireHaptic }: LiveHeartRateCardProps) {
  const { c } = useTheme();
  const [connected, setConnected] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Best-effort hydrate on mount. A failed read leaves the card honest-empty — never "Connected".
  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetchStatus();
      if (!alive || !res.ok || !res.data) return;
      setConnected(res.data.connected);
      setLastSeenAt(res.data.lastSeenAt);
    })();
    return () => { alive = false; };
  }, [fetchStatus]);

  const onDisconnect = useCallback(async () => {
    triggerHaptic('selection');
    setBusy(true);
    const res = await revoke();
    setBusy(false);
    // Only claim the credential is gone when the server said so.
    if (res.ok) { setConnected(false); setLastSeenAt(null); }
  }, [revoke, triggerHaptic]);

  return (
    <View style={[styles.card, elevation.e1, { backgroundColor: c.surface.raised }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>Live heart rate</Text>
      <Text style={[styles.caption, { color: c.content.secondary }]}>
        Streamed from your phone — a paired heart-rate strap, or Health Connect.
      </Text>

      {connected ? (
        <>
          <View style={styles.statusRow}>
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.check, { color: c.state.success }]}
            >
              ✓
            </Text>
            <Text style={[styles.statusWord, { color: c.content.secondary }]}>
              Connected · {relativeLastSeen(lastSeenAt)}
            </Text>
          </View>
          <Pressable
            onPress={onDisconnect}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="live-hr-disconnect"
            accessibilityState={{ disabled: busy }}
            hitSlop={space.sm}
            style={[styles.neutralBtn, { borderColor: c.content.secondary, opacity: busy ? 0.6 : 1 }]}
          >
            <Text style={[styles.neutralLabel, { color: c.content.secondary }]}>
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </Text>
          </Pressable>
        </>
      ) : (
        <Text style={[styles.caption, { color: c.content.secondary }]}>
          Not connected — live heart rate starts on its own once a source is available.
        </Text>
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
  neutralBtn: { alignSelf: 'flex-start', paddingVertical: space.md, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: stroke.control, alignItems: 'center', justifyContent: 'center' },
  neutralLabel: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
});
