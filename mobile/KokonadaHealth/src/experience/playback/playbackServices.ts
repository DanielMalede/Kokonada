import { KokonadaSocket } from '../../net/socketClient';
import { createBackendSocket } from '../../net/socketFactory';
import { SpotifyPlayerController } from '../player/spotifyController';
import { spotifyRemoteAdapter, getSpotifyReadiness } from '../player/spotifyRemoteAdapter';
import { authSession } from '../../auth/session';
import { playerStatusStore } from '../player/playerStatusStore';
import { store, warmStore } from '../../state/store';
import { PlaybackOrchestrator, type PlaybackSocket } from './playbackOrchestrator';
import { nowPlayingStore } from './nowPlayingStore';
import { playbackErrorStore } from './playbackErrorStore';
import { generationStatusStore } from '../generate/generationStatusStore';

// App-level bootstrap: constructs the session → socket → player → orchestrator
// graph and wires them together. This is the on-device glue; every component it
// composes is unit-tested. Native imports (socket.io, spotify-remote, keychain)
// are stubbed in jest so headless renders don't touch real hardware. The single
// AuthSession token plane lives in ../../auth/session so the login flow can
// populate it without importing this native-heavy graph. (QA4 Suspect #1)

export { authSession };

export const player = new SpotifyPlayerController({
  remote: spotifyRemoteAdapter,
  getToken: getSpotifyReadiness,
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
  onPlaylist: (payload) => { generationStatusStore.getState().settle(); playbackErrorStore.getState().clear(); void orchestrator.handlePlaylist(payload); },
  onLoggedOut: () => { void authSession.clear(); },
  onGenerationError: (message) => {
    generationStatusStore.getState().settle();                         // stop the analysis loader
    orchestrator.onGenerationError();                                  // unblock the generation guard
    playbackErrorStore.getState().set(message ?? 'Could not generate a playlist — try again');
  },
  // Drive the (previously dead) Pulse connection badge from the real socket lifecycle.
  onConnectionChange: (status) => { warmStore.getState().setConnection(status); },
});

// Adapter: the orchestrator's PlaybackSocket port over the KokonadaSocket. ensureOpen()
// is idempotent — it opens a socket only when there isn't a live one (reviving a
// background-killed/never-opened session) and leaves a live socket untouched. This
// replaces a one-shot `socketStarted` latch that permanently blocked reconnection once
// the first open failed (e.g. a tokenless boot), which stranded the socket at hasSocket=false.
export const playbackSocket: PlaybackSocket = {
  requestPlaylist: () => { generationStatusStore.getState().begin(); return kokoSocket.requestPlaylist(); },
  requestHeartPlaylist: (hr) => { generationStatusStore.getState().begin(); return kokoSocket.requestHeartPlaylist(hr); },
  ensureConnected: () => kokoSocket.ensureOpen(),
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
