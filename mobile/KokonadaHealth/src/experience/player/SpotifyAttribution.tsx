import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';
import {
  isSpotifyInstalled as defaultIsSpotifyInstalled,
  foregroundSpotify as defaultForegroundSpotify,
  getSpotifyApp as defaultGetSpotifyApp,
} from './spotifyLinkBack';

// Compliance C1 + C2 attribution + link-back mark, reusable across the Up-Next sheet and Now Playing.
// The official Spotify Full logo (theme-aware) + "content from Spotify" (attribution) and a link-back
// that OPENs an installed Spotify (foregrounded via the App Remote wake path) or sends the user to GET
// SPOTIFY FREE otherwise. Kept visually self-contained so it never sits inside recommendation copy —
// nothing here may imply Spotify authored the pick.

// The official Spotify brand assets. White reads on the dark theme; Black reads on light porcelain.
const SPOTIFY_FULL_LOGO = {
  dark: require('../../../assets/brand/spotify/Spotify_Full_Logo_RGB_White.png'),
  light: require('../../../assets/brand/spotify/Spotify_Full_Logo_RGB_Black.png'),
};
// Intrinsic aspect ratio of the Full logo PNG (3432×940) — a property of the asset, not a design
// number. Height rides a spacing token; width derives from the ratio so the mark is never distorted.
const LOGO_ASPECT = 3432 / 940;
const LOGO_HEIGHT = space.xl;
const LOGO_WIDTH = Math.round(LOGO_HEIGHT * LOGO_ASPECT);

export interface SpotifyAttributionProps {
  // All overridable so the mark is reusable/testable; each defaults to the real link-back wiring.
  isSpotifyInstalled?: () => Promise<boolean>;
  onOpenSpotify?: () => void | Promise<unknown>; // installed → foreground via App Remote
  onGetSpotify?: () => void | Promise<unknown>;  // not installed → open the store
}

export function SpotifyAttribution({
  isSpotifyInstalled = defaultIsSpotifyInstalled,
  onOpenSpotify = defaultForegroundSpotify,
  onGetSpotify = defaultGetSpotifyApp,
}: SpotifyAttributionProps) {
  const { name, c } = useTheme();
  // Default to the not-installed label until the async probe answers (safe, non-blocking).
  const [installed, setInstalled] = useState(false);
  const isInstalledRef = useRef(isSpotifyInstalled);
  isInstalledRef.current = isSpotifyInstalled;

  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => isInstalledRef.current())
      .then((v) => { if (alive) setInstalled(!!v); })
      .catch(() => { /* probe failure → keep the safe not-installed default */ });
    return () => { alive = false; };
  }, []);

  const label = installed ? 'OPEN SPOTIFY' : 'GET SPOTIFY FREE';

  // Fire the link-back action WITHOUT ever throwing into the UI: swallow a sync throw and any
  // rejection from an async action (the wiring already guards, this is defence in depth).
  const onPress = () => {
    try {
      Promise.resolve(installed ? onOpenSpotify() : onGetSpotify()).catch(() => {});
    } catch {
      /* never surface a link-back failure */
    }
  };

  return (
    <View testID="spotify-attribution" style={styles.container}>
      <Image
        testID="spotify-attribution-logo"
        source={SPOTIFY_FULL_LOGO[name]}
        resizeMode="contain"
        accessibilityRole="image"
        accessibilityLabel="Spotify"
        style={styles.logo}
      />
      <Text style={[styles.attributionText, { color: c.content.tertiary }]}>content from Spotify</Text>
      <Pressable
        testID="spotify-attribution-linkback"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={space.sm}
        style={styles.linkBack}
      >
        <Text style={[styles.linkBackText, { color: c.content.secondary }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  logo: { width: LOGO_WIDTH, height: LOGO_HEIGHT },
  attributionText: { fontSize: typography.size.caption, letterSpacing: typography.tracking.caption },
  linkBack: { marginLeft: 'auto', paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.pill },
  linkBackText: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
});
