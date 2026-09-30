import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../design/theme';
import { space, radius, type as typography } from '../../design/tokens';
import {
  isSpotifyInstalled as defaultIsSpotifyInstalled,
  foregroundSpotify as defaultForegroundSpotify,
  openSpotifyWebPage as defaultOpenSpotifyWebPage,
} from './spotifyLinkBack';
import { parseSpotifyContentUri } from './spotifyContentLink';

// Compliance C1 + C2 attribution + link-back mark, reusable across the Up-Next sheet and Now Playing.
// The official Spotify Full logo (theme-aware) + "content from Spotify" (attribution) and a link-back
// to the EXACT item on screen (HX-4): OPEN SPOTIFY opens contentUri in the installed app; GET SPOTIFY
// FREE opens the same item's open.spotify.com page. With no linkable contentUri there is no control
// at all — never a dead button — and the logo and attribution words stay. Kept visually
// self-contained so it never sits inside recommendation copy — nothing here may imply Spotify
// authored the pick.

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
  // The Spotify URI of the exact item whose metadata and cover sit beside this mark. Required, so
  // every caller decides what it links to; null (or anything unlinkable) draws no link-back control.
  contentUri: string | null;
  // All overridable so the mark is reusable/testable; each defaults to the real link-back wiring.
  isSpotifyInstalled?: () => Promise<boolean>;
  onOpenSpotify?: (uri: string) => void | Promise<unknown>; // installed → open the item in Spotify
  onGetSpotify?: (uri: string) => void | Promise<unknown>;  // not installed → the item's web page
}

export function SpotifyAttribution({
  contentUri,
  isSpotifyInstalled = defaultIsSpotifyInstalled,
  onOpenSpotify = defaultForegroundSpotify,
  onGetSpotify = defaultOpenSpotifyWebPage,
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
  // The same gate the actions apply: only a track, album or playlist URI earns a control.
  const link = parseSpotifyContentUri(contentUri);

  // Fire the link-back action WITHOUT ever throwing into the UI: swallow a sync throw and any
  // rejection from an async action (the wiring already guards, this is defence in depth).
  const onPress = () => {
    if (!link) return;
    try {
      Promise.resolve(installed ? onOpenSpotify(link.uri) : onGetSpotify(link.uri)).catch(() => {});
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
      {link ? (
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
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  logo: { width: LOGO_WIDTH, height: LOGO_HEIGHT },
  attributionText: { fontSize: typography.size.caption, letterSpacing: typography.tracking.caption },
  linkBack: { marginLeft: 'auto', paddingVertical: space.xs, paddingHorizontal: space.sm, borderRadius: radius.pill },
  linkBackText: { fontSize: typography.size.caption, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.caption },
});
