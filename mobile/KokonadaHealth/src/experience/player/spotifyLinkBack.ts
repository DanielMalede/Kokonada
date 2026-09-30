import { Linking } from 'react-native';
import { SpotifyRemote } from '@kokonada/spotify-remote';
import { player } from '../playback/playbackServices';
import { parseSpotifyContentUri } from './spotifyContentLink';

// The link-back wiring behind SpotifyAttribution (compliance C2; HX-4). Both actions take the URI
// of the exact item on screen and open that item — or nothing at all when the URI is not a linkable
// track, album or playlist. Every function is defensive: a failure here is a cosmetic link-back
// miss, never a crash into the UI.

// Reuses the EXISTING native install probe (the same one getSpotifyReadiness gates connect on).
export async function isSpotifyInstalled(): Promise<boolean> {
  try {
    return !!(await SpotifyRemote.isSpotifyInstalled());
  } catch {
    return false;
  }
}

// "OPEN SPOTIFY": open the item in the Spotify app. On device the App Remote is ALREADY connected at
// boot, so player.connect() no-ops and never foregrounds the app — the URI launch is what surfaces
// Spotify, on the item itself. An unlinkable URI opens nothing and wakes nothing: without a
// destination there is no trip to Spotify for the wake to follow.
export async function foregroundSpotify(uri: string | null): Promise<void> {
  const link = parseSpotifyContentUri(uri);
  if (!link) return;
  try {
    await Linking.openURL(link.uri);
  } catch {
    // No handler for the app URI: Spotify was uninstalled after the mount-time install probe. Open
    // the same item's web page rather than leave OPEN SPOTIFY a dead control.
    try {
      await Linking.openURL(link.webUrl);
    } catch {
      /* link-back is best-effort — never throw into the UI */
    }
  }
  // Keep waking the App Remote for playback continuity (its own guard — connect already swallows).
  try {
    await player.connect();
  } catch {
    /* wake is best-effort — never throw into the UI */
  }
}

// "GET SPOTIFY FREE": Spotify is not installed, so open the same item's open.spotify.com page —
// Spotify's documented web fallback, which shows the item and offers the app.
export async function openSpotifyWebPage(uri: string | null): Promise<void> {
  const link = parseSpotifyContentUri(uri);
  if (!link) return;
  try {
    await Linking.openURL(link.webUrl);
  } catch {
    /* best-effort — never throw into the UI */
  }
}
