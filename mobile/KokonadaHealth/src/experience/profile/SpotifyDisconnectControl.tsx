import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, stroke, type as typography, type HapticKey } from '../../design/tokens';
import { fireHaptic } from '../../design/haptics';

// §10 Disconnect Spotify (HX-2 M8, DEC-100). Sits on the Spotify row while Spotify is connected.
// Two taps: a quiet "Disconnect" text action, then an inline confirm on the card (the same
// two-step grammar as the Vault's withdrawal and the account deletion). Disconnecting is a
// destructive act — the confirm's Disconnect wears state.danger — but the first tap stays quiet.
//
// The copy is compliance-cleared and EXACT (M9). Every clause is true of the server purge
// (backend spotifyErasure): if a clause stops being true, the copy changes, never the other way.
// It says nothing about revoking access at Spotify — that is the user's own step, named in line 2.

export const SPOTIFY_DISCONNECT_COPY = Object.freeze({
  trigger: 'Disconnect',
  title: 'Disconnect Spotify?',
  body: 'Kokonada will stop using your Spotify account and delete your Spotify connection, the music profile built from it, and the Spotify tracks listed in History. Your moments stay.',
  // Compliance N1: the hidden session playlist lives in the user's own Spotify account and is not
  // deleted by the disconnect. Always shown.
  sessionPlaylist: 'Kokonada doesn\'t delete the "Kokonada Session" playlist it may have made in your Spotify account. You can delete it in Spotify.',
  removeAccess: 'To remove Kokonada from your Spotify account as well, go to spotify.com/account/apps and choose Remove access.',
  noReconnect: "You can't reconnect Spotify in this version.",
  confirm: 'Disconnect',
  cancel: 'Cancel',
  failureTitle: 'Could not disconnect Spotify',
  failureBody: 'Please try again in a moment.',
});

export interface SpotifyDisconnectControlProps {
  busy: boolean;
  // Line 3 — only while SPOTIFY_BETA_CONNECT is off, when a disconnected account cannot come back.
  showNoReconnectLine: boolean;
  onConfirm: () => void;
  triggerHaptic?: (key: HapticKey) => void;
}

export function SpotifyDisconnectControl({ busy, showNoReconnectLine, onConfirm, triggerHaptic = fireHaptic }: SpotifyDisconnectControlProps) {
  const { c } = useTheme();
  const [confirming, setConfirming] = useState(false);
  const copy = SPOTIFY_DISCONNECT_COPY;

  if (!confirming) {
    return (
      <Pressable
        onPress={() => setConfirming(true)}
        testID="disconnect-spotify"
        accessibilityRole="button"
        accessibilityLabel="Disconnect Spotify"
        hitSlop={space.sm}
        style={styles.trigger}
      >
        <Text style={[styles.triggerLabel, { color: c.content.secondary }]}>{copy.trigger}</Text>
      </Pressable>
    );
  }

  const onConfirmPress = () => { triggerHaptic('warning'); onConfirm(); };

  return (
    <View style={styles.confirm}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.content.primary }]}>{copy.title}</Text>
      <Text style={[styles.body, { color: c.content.secondary }]}>{copy.body}</Text>
      <Text style={[styles.body, { color: c.content.secondary }]}>{copy.sessionPlaylist}</Text>
      <Text style={[styles.body, { color: c.content.secondary }]}>{copy.removeAccess}</Text>
      {showNoReconnectLine ? <Text style={[styles.body, { color: c.content.secondary }]}>{copy.noReconnect}</Text> : null}

      {/* Equal-weight stacked pair (the same geometry as the Profile's other confirms). */}
      <View style={styles.bar}>
        <Pressable
          onPress={() => setConfirming(false)}
          disabled={busy}
          testID="disconnect-spotify-cancel"
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={[styles.barBtn, { borderColor: c.content.tertiary }, busy ? styles.dimmed : null]}
        >
          <Text style={[styles.barBtnText, { color: c.content.primary }]}>{copy.cancel}</Text>
        </Pressable>
        <Pressable
          onPress={onConfirmPress}
          disabled={busy}
          testID="disconnect-spotify-confirm"
          accessibilityRole="button"
          accessibilityLabel="Disconnect Spotify"
          accessibilityState={{ disabled: busy, busy }}
          style={[styles.barBtn, { borderColor: c.state.danger }, busy ? styles.dimmed : null]}
        >
          <Text style={[styles.barBtnText, { color: c.state.danger }]}>{copy.confirm}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Borderless text action like the row's own actions; ≥48dp through padding + hitSlop.
  trigger: { alignSelf: 'flex-end', paddingVertical: space.md, paddingHorizontal: space.sm },
  triggerLabel: { fontSize: typography.size.footnote, fontWeight: typography.weight.semibold },
  confirm: { gap: space.md, paddingVertical: space.md },
  title: { fontSize: typography.size.callout, fontWeight: typography.weight.semibold },
  body: { fontSize: typography.size.footnote, lineHeight: typography.size.footnote * typography.leading.normal },
  bar: { gap: space.md, paddingTop: space.xs },
  barBtn: { paddingVertical: space.lg, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: stroke.control, alignItems: 'center', justifyContent: 'center' },
  barBtnText: { fontSize: typography.size.body, fontWeight: typography.weight.semibold, textAlign: 'center' },
  // While the call runs: dimmed and disabled, never relabelled (no copy beyond the cleared set).
  dimmed: { opacity: 0.6 },
});
