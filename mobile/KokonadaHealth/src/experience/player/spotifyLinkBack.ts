import { Linking } from 'react-native';
import { SpotifyRemote } from '@kokonada/spotify-remote';
import { player } from '../playback/playbackServices';

// The link-back wiring behind SpotifyAttribution (compliance C2). Every function is defensive —
// a failure here is a cosmetic link-back miss, never a crash into the UI.

// Where a user without Spotify is sent ("GET SPOTIFY FREE").
const SPOTIFY_DOWNLOAD_URL = 'https://www.spotify.com/download';

// Reuses the EXISTING native install probe (the same one getSpotifyReadiness gates connect on).
export async function isSpotifyInstalled(): Promise<boolean> {
  try {
    return !!(await SpotifyRemote.isSpotifyInstalled());
  } catch {
    return false;
  }
}

// Foreground/wake the Spotify app through the EXISTING App Remote connect/wake path (the
// SpotifyPlayerController singleton) — no new native call. player.connect already swallows its own
// failures, but the extra guard keeps the promise from ever rejecting into a UI handler.
export async function foregroundSpotify(): Promise<void> {
  try {
    await player.connect();
  } catch {
    /* wake is best-effort — never throw into the UI */
  }
}

// Not-installed fallback: open the Spotify download page so the user can get it.
export async function getSpotifyApp(): Promise<void> {
  try {
    await Linking.openURL(SPOTIFY_DOWNLOAD_URL);
  } catch {
    /* best-effort — never throw into the UI */
  }
}
