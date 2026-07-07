import { SpotifyRemote } from '@kokonada/spotify-remote';
import type { SpotifyRemoteLike } from './spotifyController';
import { SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI } from '../../health/config';

// Configure the native module once with app identity (dashboard-registered client +
// redirect). App Remote authorizes on-device; there is no access token — connect()
// takes none and the token passed by the controller is intentionally ignored.
SpotifyRemote.configure(SPOTIFY_CLIENT_ID, SPOTIFY_REDIRECT_URI);

// Track event unsubscribers so removeAllListeners can detach them.
let offDisconnect: (() => void) | null = null;
let offPlayerState: (() => void) | null = null;

export const spotifyRemoteAdapter: SpotifyRemoteLike = {
  connect: async (_token: string) => {
    // AUTHORIZE-ONCE (D-1): a silent connect first — the native handshake authenticates
    // against Spotify's cached grant with NO UI. Only a NOT_LOGGED_IN failure (no grant
    // yet, or revoked) runs the one-time authorize Activity. The old unconditional
    // authorize() launched Spotify's login Activity on EVERY connect — that was the
    // foreground steal the device QA caught.
    try {
      await SpotifyRemote.connect();
    } catch (err: any) {
      if (err?.code === 'NOT_LOGGED_IN' || /NOT_LOGGED_IN/i.test(String(err?.message ?? ''))) {
        await SpotifyRemote.authorize();
        await SpotifyRemote.connect();
      } else {
        throw err;
      }
    }
  },
  disconnect: async () => { await SpotifyRemote.disconnect(); },
  isConnectedAsync: () => SpotifyRemote.isConnected(),
  playUri: async (uri: string) => { await SpotifyRemote.playUri(uri); },
  // D-1 context playback: start the session-playlist context at a position, deterministic
  // (shuffle/repeat forced off, best-effort — a failure must not kill playback).
  playContext: async (contextUri: string, index: number) => {
    await SpotifyRemote.playUri(contextUri);
    if (index > 0) await SpotifyRemote.skipToIndex(contextUri, index);
    try { await SpotifyRemote.setShuffle(false); await SpotifyRemote.setRepeat(0); } catch { /* cosmetic */ }
  },
  skipToIndex: async (contextUri: string, index: number) => { await SpotifyRemote.skipToIndex(contextUri, index); },
  skipNext: async () => { await SpotifyRemote.skipNext(); },
  skipPrevious: async () => { await SpotifyRemote.skipPrevious(); },
  pause: async () => { await SpotifyRemote.pause(); },
  resume: async () => { await SpotifyRemote.resume(); },
  getPlayerState: async () => {
    const s = await SpotifyRemote.getPlayerState();
    return { isPaused: !!s?.isPaused, track: s?.trackUri ? { uri: s.trackUri } : undefined };
  },
  addListener: (event: string, cb: (...args: any[]) => void) => {
    if (event === 'remoteDisconnected') offDisconnect = SpotifyRemote.onRemoteDisconnected(cb);
    // D-1: native PlayerState stream (auto-advance / pause / in-Spotify jumps).
    if (event === 'playerStateChanged') offPlayerState = SpotifyRemote.onPlayerStateChanged(cb);
  },
  removeAllListeners: () => {
    offDisconnect?.(); offDisconnect = null;
    offPlayerState?.(); offPlayerState = null;
  },
};

// Readiness gate replacing the old token fetch: App Remote can only connect when the
// Spotify app is installed. Returns a non-null sentinel so the controller's getToken
// gate passes; null (not installed / error) makes the controller stay disconnected.
export async function getSpotifyReadiness(): Promise<string | null> {
  try {
    return (await SpotifyRemote.isSpotifyInstalled()) ? 'ready' : null;
  } catch {
    return null;
  }
}
