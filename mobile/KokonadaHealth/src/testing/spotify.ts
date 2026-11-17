// QA-048: a stateful fake of the Spotify App Remote native module (@kokonada/spotify-remote).
//
// The unit project mocks the module once, in one state (not installed, disconnected; jest.setup.js
// :83-103). This fake replaces the members of that mock by capture-and-restore and keeps the state a
// real device has, answering with the codes the native module uses (modules/spotify-remote/android/
// .../SpotifyRemoteModule.kt):
//   · connect(): SPOTIFY_NOT_INSTALLED, NOT_LOGGED_IN (both "no logged-in user" and "this app was
//     never authorised" map to it, :202-211), CONNECTION_FAILED; or it can be held mid-handshake;
//   · authorize(): the login Activity grants (a token) or is cancelled (AUTH_CANCELLED, :116);
//   · every player command while not connected: CONNECTION_FAILED "not connected" (:233-310), and a
//     command can be scripted to fail the same way;
//   · remoteDisconnected and playerStateChanged go to live, counted listeners.
// Skip commands are logged; the track they lead to is the test's to script (playForeign, setPlayer),
// since the fake does not know a context's track list. Capability states the native module has no
// signal for ("no on-demand", "another active device") are not invented here: owed at P2's G0.

import { SpotifyRemote } from '@kokonada/spotify-remote';
import { Patcher } from './patch';

export type SpotifyAccount = 'authorized' | 'not_logged_in' | 'not_authorized';
export interface SpotifyFakeState {
  installed: boolean;
  account: SpotifyAccount;
  authorize: 'grant' | 'cancel';
  connect: 'ok' | 'hold' | 'fail';
}
export interface PlayerSnapshot { trackUri: string | null; isPaused: boolean }

const COMMANDS = ['playUri', 'pause', 'resume', 'skipNext', 'skipPrevious', 'skipToIndex', 'setShuffle', 'setRepeat', 'getPlayerState', 'getTrackImage'] as const;
type Command = (typeof COMMANDS)[number];

const nativeError = (code: string, message: string) => Object.assign(new Error(message), { code });

export interface SpotifyFake {
  set(state: Partial<SpotifyFakeState>): void;
  /** Complete a held connect (connect: 'hold'). */
  completeConnect(): void;
  /** The next call of `command` rejects CONNECTION_FAILED. */
  failNext(command: Command): void;
  /** The native link drops (the Spotify app is killed, or its auth revoked): remoteDisconnected fires. */
  sever(): void;
  /** A track started inside Spotify, not by us. */
  playForeign(uri: string): void;
  setPlayer(snapshot: Partial<PlayerSnapshot>): void;
  player(): PlayerSnapshot;
  connected(): boolean;
  /** How many times a native member was called (attempts, including rejected ones). */
  calls(member: string): number;
  /** The player commands that reached a connected remote, in order. */
  commands(): Array<{ name: string; args: unknown[] }>;
  liveListeners(): { remoteDisconnected: number; playerStateChanged: number };
  assertNoLiveListeners(): void;
  restore(): void;
}

export function installSpotifyFake(initial: Partial<SpotifyFakeState> = {}): SpotifyFake {
  const patcher = new Patcher();
  const state: SpotifyFakeState = { installed: true, account: 'authorized', authorize: 'grant', connect: 'ok', ...initial };
  let isConnected = false;
  let player: PlayerSnapshot = { trackUri: null, isPaused: true };
  let held: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  const failing = new Set<string>();
  const callCounts = new Map<string, number>();
  const commandLog: Array<{ name: string; args: unknown[] }> = [];
  const listeners = { remoteDisconnected: new Set<() => void>(), playerStateChanged: new Set<(s: PlayerSnapshot & Record<string, unknown>) => void>() };

  const count = (name: string) => callCounts.set(name, (callCounts.get(name) ?? 0) + 1);
  const emitState = () => { for (const l of [...listeners.playerStateChanged]) l({ ...player, positionMs: 0, durationMs: 0, imageUri: undefined }); };
  const remote = SpotifyRemote as unknown as Record<string, unknown>;

  const members: Record<string, unknown> = {
    configure: () => { count('configure'); },
    isSpotifyInstalled: async () => { count('isSpotifyInstalled'); return state.installed; },
    isConnected: async () => { count('isConnected'); return isConnected; },
    authorize: async () => {
      count('authorize');
      if (!state.installed) throw nativeError('AUTH_ERROR', 'authorization failed');
      if (state.authorize === 'cancel') throw nativeError('AUTH_CANCELLED', 'authorization cancelled');
      state.account = 'authorized';
      return 'token';
    },
    connect: () => {
      count('connect');
      if (!state.installed) return Promise.reject(nativeError('SPOTIFY_NOT_INSTALLED', 'Spotify is not installed'));
      if (state.account === 'not_logged_in') return Promise.reject(nativeError('NOT_LOGGED_IN', 'The user is not logged in'));
      if (state.account === 'not_authorized') return Promise.reject(nativeError('NOT_LOGGED_IN', 'Explicit user authorization is required to use Spotify'));
      if (state.connect === 'fail') return Promise.reject(nativeError('CONNECTION_FAILED', 'Result was not delivered on time.'));
      if (state.connect === 'hold') {
        return new Promise<void>((resolve, reject) => {
          held.push({ resolve: () => { isConnected = true; resolve(); }, reject });
        });
      }
      isConnected = true;
      return Promise.resolve();
    },
    disconnect: async () => { count('disconnect'); isConnected = false; },
    onRemoteDisconnected: (cb: () => void) => {
      count('onRemoteDisconnected');
      listeners.remoteDisconnected.add(cb);
      return () => { listeners.remoteDisconnected.delete(cb); };
    },
    onPlayerStateChanged: (cb: (s: PlayerSnapshot & Record<string, unknown>) => void) => {
      count('onPlayerStateChanged');
      listeners.playerStateChanged.add(cb);
      return () => { listeners.playerStateChanged.delete(cb); };
    },
  };

  const command = (name: Command, apply: (...args: any[]) => unknown) => async (...args: unknown[]) => {
    count(name);
    if (!isConnected) throw nativeError('CONNECTION_FAILED', 'not connected');
    if (failing.has(name)) { failing.delete(name); throw nativeError('CONNECTION_FAILED', `${name} failed`); }
    commandLog.push({ name, args });
    return apply(...args);
  };
  members.playUri = command('playUri', (uri: string) => { player = { trackUri: uri, isPaused: false }; emitState(); });
  members.pause = command('pause', () => { player = { ...player, isPaused: true }; emitState(); });
  members.resume = command('resume', () => { player = { ...player, isPaused: false }; emitState(); });
  members.skipNext = command('skipNext', () => undefined);
  members.skipPrevious = command('skipPrevious', () => undefined);
  members.skipToIndex = command('skipToIndex', () => undefined);
  members.setShuffle = command('setShuffle', () => undefined);
  members.setRepeat = command('setRepeat', () => undefined);
  members.getPlayerState = command('getPlayerState', () => ({ isPaused: player.isPaused, trackUri: player.trackUri }));
  members.getTrackImage = command('getTrackImage', (imageUri: string) => {
    if (!imageUri) throw nativeError('IMAGE_FETCH_FAILED', 'empty imageUri');
    return `file:///fake-spotify-cache/${encodeURIComponent(imageUri)}.jpg`;
  });
  for (const [k, v] of Object.entries(members)) patcher.set(remote, k, v);

  return {
    set(next) { Object.assign(state, next); },
    completeConnect() { for (const h of held.splice(0)) h.resolve(); },
    failNext(name) { failing.add(name); },
    sever() {
      if (!isConnected) return;
      isConnected = false;
      for (const l of [...listeners.remoteDisconnected]) l();
    },
    playForeign(uri) { player = { trackUri: uri, isPaused: false }; emitState(); },
    setPlayer(snapshot) { player = { ...player, ...snapshot }; emitState(); },
    player: () => ({ ...player }),
    connected: () => isConnected,
    calls: (member) => callCounts.get(member) ?? 0,
    commands: () => commandLog.map((c) => ({ name: c.name, args: [...c.args] })),
    liveListeners: () => ({ remoteDisconnected: listeners.remoteDisconnected.size, playerStateChanged: listeners.playerStateChanged.size }),
    assertNoLiveListeners() {
      const live = Object.entries({ remoteDisconnected: listeners.remoteDisconnected.size, playerStateChanged: listeners.playerStateChanged.size }).filter(([, n]) => n > 0);
      if (live.length) throw new Error(`QA-048: Spotify native listeners still live: ${live.map(([k, n]) => `${k}: ${n}`).join(', ')}`);
    },
    restore() {
      for (const h of held.splice(0)) h.reject(nativeError('CONNECTION_FAILED', 'fake restored'));
      held = [];
      patcher.restore();
    },
  };
}
