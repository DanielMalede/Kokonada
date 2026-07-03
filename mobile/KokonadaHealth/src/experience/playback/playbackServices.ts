import { KokonadaSocket } from '../../net/socketClient';
import { createBackendSocket } from '../../net/socketFactory';
import { SpotifyPlayerController } from '../player/spotifyController';
import { spotifyRemoteAdapter, getSpotifyAccessToken } from '../player/spotifyRemoteAdapter';
import { authSession } from '../../auth/session';
import { playerStatusStore } from '../player/playerStatusStore';
import { store } from '../../state/store';
import { PlaybackOrchestrator, type PlaybackSocket } from './playbackOrchestrator';
import { nowPlayingStore } from './nowPlayingStore';
import { playbackErrorStore } from './playbackErrorStore';

// App-level bootstrap: constructs the session → socket → player → orchestrator
// graph and wires them together. This is the on-device glue; every component it
// composes is unit-tested. Native imports (socket.io, spotify-remote, keychain)
// are stubbed in jest so headless renders don't touch real hardware. The single
// AuthSession token plane lives in ../../auth/session so the login flow can
// populate it without importing this native-heavy graph. (QA4 Suspect #1)

export { authSession };

export const player = new SpotifyPlayerController({
  remote: spotifyRemoteAdapter,
  getToken: getSpotifyAccessToken,
  // Surface every player lifecycle transition into an observable store so the
  // Profile screen can show a live Spotify connection badge. (QA4 Suspect #4)
  onStateChange: (status) => playerStatusStore.getState().set(status),
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
