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

// Bring the Spotify app to the foreground ("OPEN SPOTIFY"). On device the App Remote is ALREADY
// connected at boot, so player.connect() no-ops and never foregrounds the app — the URL-scheme launch
// is what actually surfaces Spotify. Both steps are defensive: a link-back miss is cosmetic, never a
// crash into the UI.
export async function foregroundSpotify(): Promise<void> {
  // The foregrounding action — launch/foreground the Spotify app via its URL scheme.
  try {
    await Linking.openURL('spotify:');
  } catch {
    /* link-back is best-effort — never throw into the UI */
  }
  // Keep waking the App Remote for playback continuity (its own guard — connect already swallows).
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
