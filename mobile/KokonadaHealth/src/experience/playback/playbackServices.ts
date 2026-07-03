import * as Keychain from 'react-native-keychain';
import { KokonadaSocket } from '../../net/socketClient';
import { createBackendSocket } from '../../net/socketFactory';
import { SpotifyPlayerController } from '../player/spotifyController';
import { spotifyRemoteAdapter, getSpotifyAccessToken } from '../player/spotifyRemoteAdapter';
import { AuthSession, type TokenPair } from '../../auth/authSession';
import { store } from '../../state/store';
import { BACKEND_URL } from '../../health/config';
import { PlaybackOrchestrator, type PlaybackSocket } from './playbackOrchestrator';
import { nowPlayingStore } from './nowPlayingStore';
import { playbackErrorStore } from './playbackErrorStore';

// App-level bootstrap: constructs the session → socket → player → orchestrator
// graph and wires them together. This is the on-device glue; every component it
// composes is unit-tested. Native imports (socket.io, spotify-remote, keychain)
// are stubbed in jest so headless renders don't touch real hardware.

const SESSION_SERVICE = 'com.kokonadahealth.session';

const keychainSession = {
  loadTokens: async (): Promise<TokenPair | null> => {
    const creds = await Keychain.getGenericPassword({ service: SESSION_SERVICE });
    if (!creds || !creds.password) return null;
    try { return JSON.parse(creds.password) as TokenPair; } catch { return null; }
  },
  saveTokens: async (t: TokenPair) => {
    await Keychain.setGenericPassword('session', JSON.stringify(t), { service: SESSION_SERVICE });
  },
  clearTokens: async () => { await Keychain.resetGenericPassword({ service: SESSION_SERVICE }); },
  refreshEndpoint: async (refreshToken: string): Promise<TokenPair | null> => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const { token, refreshToken: nextRefresh } = await res.json();
      return { access: token, refresh: nextRefresh };
    } catch {
      return null;
    }
  },
};

export const authSession = new AuthSession(keychainSession);

export const player = new SpotifyPlayerController({
  remote: spotifyRemoteAdapter,
  getToken: getSpotifyAccessToken,
});

export const kokoSocket = new KokonadaSocket({
  createSocket: createBackendSocket,
  getAccessToken: () => authSession.getAccessToken(),
  refreshToken: () => authSession.refresh(),
  getEmotionIntent: () => {
    const e = store.getState().emotion;
    return { taps: e.taps, textPrompt: e.textPrompt, activity: e.activity };
  },
  onPlaylist: (payload) => { playbackErrorStore.getState().clear(); void orchestrator.handlePlaylist(payload); },
  onLoggedOut: () => { void authSession.clear(); },
  onGenerationError: (message) => {
    orchestrator.onGenerationError();                                  // unblock the generation guard
    playbackErrorStore.getState().set(message ?? 'Could not generate a playlist — try again');
  },
});

// Adapter: the orchestrator's PlaybackSocket port over the KokonadaSocket. Transient
// reconnection is socket.io's job; ensureConnected only performs the initial open
// (idempotent) so a background-killed socket is revived on the next generation.
let socketStarted = false;
export const playbackSocket: PlaybackSocket = {
  requestPlaylist: () => kokoSocket.requestPlaylist(),
  requestHeartPlaylist: (hr) => kokoSocket.requestHeartPlaylist(hr),
  ensureConnected: () => { if (!socketStarted) { socketStarted = true; kokoSocket.connect(); } },
};

export const orchestrator = new PlaybackOrchestrator({
  player,
  socket: playbackSocket,
  onNowPlaying: (state) => nowPlayingStore.getState().set(state),
});

// Called once at app entry (after login). Restores the session, connects the socket
// and the Spotify remote. Fire-and-forget; failures degrade gracefully.
export async function startPlayback(): Promise<void> {
  const ok = await authSession.bootstrap();
  if (ok) playbackSocket.ensureConnected();
  void player.connect();
}
