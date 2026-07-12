import { KokonadaSocket } from '../../net/socketClient';
import { createBackendSocket } from '../../net/socketFactory';
import { SpotifyPlayerController } from '../player/spotifyController';
import { spotifyRemoteAdapter, getSpotifyReadiness } from '../player/spotifyRemoteAdapter';
import { authSession } from '../../auth/session';
import { playerStatusStore } from '../player/playerStatusStore';
import { store, warmStore } from '../../state/store';
import { PlaybackOrchestrator, type PlaybackSocket } from './playbackOrchestrator';
import { nowPlayingStore } from './nowPlayingStore';
import { CoverArtResolver } from './coverArtResolver';
import { playbackErrorStore } from './playbackErrorStore';
import { generationStatusStore } from '../generate/generationStatusStore';
import { liveModeStore } from '../generate/liveModeStore';

// App-level bootstrap: constructs the session → socket → player → orchestrator
// graph and wires them together. This is the on-device glue; every component it
// composes is unit-tested. Native imports (socket.io, spotify-remote, keychain)
// are stubbed in jest so headless renders don't touch real hardware. The single
// AuthSession token plane lives in ../../auth/session so the login flow can
// populate it without importing this native-heavy graph. (QA4 Suspect #1)

export { authSession };

// The Now Playing cover comes from the LIVE App Remote player state (authoritative for
// what is audible), resolved client-side to a local file — NOT from the queue and NOT via
// the Web API (which 403s in Dev Mode). Fire-and-forget, deduped by imageUri.
const coverResolver = new CoverArtResolver({
  getTrackImage: (imageUri) => spotifyRemoteAdapter.getTrackImage!(imageUri),
  setCover: (coverUri) => nowPlayingStore.getState().setCover(coverUri),
});

export const player = new SpotifyPlayerController({
  remote: spotifyRemoteAdapter,
  getToken: getSpotifyReadiness,
  // Surface every player lifecycle transition into an observable store so the
  // Profile screen can show a live Spotify connection badge. (QA4 Suspect #4)
  onStateChange: (status) => {
    playerStatusStore.getState().set(status);
    // Clear the cover dedupe latch on disconnect (native drives this via remoteDisconnected)
    // so a reconnect re-fetches the current cover instead of being deduped into staleness (M4).
    if (status === 'disconnected') coverResolver.reset();
  },
  // D-1: native PlayerState stream → orchestrator lockstep (auto-advance updates the
  // queue + now-playing; pause/resume in the Spotify app mirrors into our UI).
  // `orchestrator` is declared below — the closure resolves at event time, well after init.
  onRemoteState: (s) => {
    orchestrator.syncToRemote(s.uri, s.isPaused, s.positionMs, s.durationMs);
    // Resolve the current track's cover off the playback path (deduped per track change).
    coverResolver.onImageUri(s.imageUri ?? null);
  },
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
  // Part 2b: tell the server our Live/Manual mode so it only auto-drives Live-mode users.
  getLiveMode: () => liveModeStore.getState().liveMode,
  // A Live-mode cold-buffer recalibration is warming — show the loader ("assembling …").
  onAssembling: (message) => { generationStatusStore.getState().begin(message); },
  // Onboarding (D-6): the profile is still building — keep the loader alive with the
  // building copy (each event re-arms the 30s auto-settle) while the socket auto-retries.
  onBuilding: (message) => { generationStatusStore.getState().begin(message ?? 'Setting up your library…'); },
});

// Adapter: the orchestrator's PlaybackSocket port over the KokonadaSocket. ensureOpen()
// is idempotent — it opens a socket only when there isn't a live one (reviving a
// background-killed/never-opened session) and leaves a live socket untouched. This
// replaces a one-shot `socketStarted` latch that permanently blocked reconnection once
// the first open failed (e.g. a tokenless boot), which stranded the socket at hasSocket=false.
export const playbackSocket: PlaybackSocket & { syncLiveMode(): void } = {
  requestPlaylist: () => { generationStatusStore.getState().begin(); return kokoSocket.requestPlaylist(); },
  requestHeartPlaylist: (hr) => { generationStatusStore.getState().begin(); return kokoSocket.requestHeartPlaylist(hr); },
  ensureConnected: () => kokoSocket.ensureOpen(),
  // Push the freshly-toggled Live/Manual choice to the server (Part 2b).
  syncLiveMode: () => kokoSocket.syncLiveMode(),
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
