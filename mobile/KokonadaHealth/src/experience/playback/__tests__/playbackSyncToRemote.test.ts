// D-1 "phantom track": a native Spotify auto-advance (track end → next) previously never
// reached RN — the queue cursor and now-playing froze on the finished track, skip-next
// replayed the already-playing track and skip-prev couldn't reach it. These tests pin the
// lockstep: syncToRemote adopts the remote's reported track WITHOUT re-commanding play.

import { PlaybackOrchestrator, type NowPlaying } from '../playbackOrchestrator';
import { PlaybackQueue } from '../playbackQueue';
import { SpotifyPlayerController } from '../../player/spotifyController';

const TRACKS = [
  { id: 'a', uri: 'spotify:track:a', title: 'A', artist: '' },
  { id: 'b', uri: 'spotify:track:b', title: 'B', artist: '' },
  { id: 'c', uri: 'spotify:track:c', title: 'C', artist: '' },
];

function makeOrch() {
  const played: string[] = [];
  const emitted: NowPlaying[] = [];
  const player = {
    play: jest.fn(async (uri: string) => { played.push(uri); return { ok: true }; }),
    pause: jest.fn(async () => ({ ok: true })),
    resume: jest.fn(async () => ({ ok: true })),
  };
  const socket = { requestPlaylist: jest.fn(() => 1), requestHeartPlaylist: jest.fn(() => 1), ensureConnected: jest.fn() };
  const orch = new PlaybackOrchestrator({
    player, socket,
    // Microtask-deferred: schedule() must RETURN before its fn runs (a synchronous fn would
    // be overwritten by the handle assignment and wedge pendingPlayHandle non-null).
    scheduler: { schedule: (fn) => { void Promise.resolve().then(fn); return 1; }, cancel: () => {} },
    onNowPlaying: (s) => emitted.push(s),
  });
  return { orch, player, played, emitted };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('PlaybackQueue.seekToUri (D-1)', () => {
  it('moves the cursor to a queued playable uri; leaves it for a foreign uri', () => {
    const q = new PlaybackQueue();
    q.load(TRACKS as any);
    expect(q.seekToUri('spotify:track:b')?.id).toBe('b');
    expect(q.current()?.id).toBe('b');
    expect(q.seekToUri('spotify:track:zz')).toBeNull();
    expect(q.current()?.id).toBe('b'); // untouched on a miss
    expect(q.seekToUri('')).toBeNull();
  });
});

describe('PlaybackOrchestrator.syncToRemote (D-1)', () => {
  it('a native auto-advance moves the cursor + now-playing WITHOUT issuing a new play', async () => {
    const { orch, player, emitted } = makeOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any }); // plays A
    const playsAfterLoad = player.play.mock.calls.length;

    orch.syncToRemote('spotify:track:b', false); // Spotify finished A and advanced to B

    expect(player.play.mock.calls.length).toBe(playsAfterLoad); // NO re-command
    const last = emitted[emitted.length - 1];
    expect(last.track?.id).toBe('b');
    expect(last.isPlaying).toBe(true);
  });

  it('after adoption, skip-prev returns to the auto-advanced-from track (phantom no longer erased)', async () => {
    const { orch, emitted } = makeOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any });
    orch.syncToRemote('spotify:track:b', false); // auto-advance A→B
    orch.skipPrev();                              // user goes back
    await flush();                                // let the coalesced play + emit settle
    const last = emitted[emitted.length - 1];
    expect(last.track?.id).toBe('a');             // reachable again
  });

  it('mirrors an in-Spotify pause/resume of OUR current track', async () => {
    const { orch, emitted } = makeOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any });
    orch.syncToRemote('spotify:track:a', true); // paused inside the Spotify app
    expect(emitted[emitted.length - 1].isPlaying).toBe(false);
    orch.syncToRemote('spotify:track:a', false);
    expect(emitted[emitted.length - 1].isPlaying).toBe(true);
  });

  it('a foreign uri (user drives Spotify directly) reflects not-playing (S11-1 rule)', async () => {
    const { orch, emitted } = makeOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any });
    orch.syncToRemote('spotify:track:foreign', false);
    const last = emitted[emitted.length - 1];
    expect(last.isPlaying).toBe(false);
    expect(last.track?.id).toBe('a'); // cursor untouched
  });

  it('a null uri reflects not-playing without moving anything', async () => {
    const { orch, emitted } = makeOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any });
    orch.syncToRemote(null, true);
    expect(emitted[emitted.length - 1].isPlaying).toBe(false);
  });
});

describe('PlaybackOrchestrator.reconcile adopts a queued remote track (D-1 foreground)', () => {
  it('foreground reconcile seeks the cursor to the remote-reported queued track', async () => {
    const { orch, emitted } = makeOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any });
    orch.reconcile({ isPlaying: true, uri: 'spotify:track:c' }); // drifted while backgrounded
    const last = emitted[emitted.length - 1];
    expect(last.track?.id).toBe('c');
    expect(last.isPlaying).toBe(true);
  });

  it('still marks a truly-foreign remote track as not-playing', async () => {
    const { orch, emitted } = makeOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any });
    orch.reconcile({ isPlaying: true, uri: 'spotify:track:foreign' });
    expect(emitted[emitted.length - 1].isPlaying).toBe(false);
  });
});

describe('SpotifyPlayerController.onRemoteState (D-1 event normalization)', () => {
  it('subscribes to playerStateChanged and normalizes { trackUri, isPaused } → { uri, isPaused }', () => {
    const listeners = new Map<string, (p?: any) => void>();
    const remote: any = {
      connect: jest.fn(), disconnect: jest.fn(), isConnectedAsync: jest.fn(),
      playUri: jest.fn(), pause: jest.fn(), resume: jest.fn(),
      addListener: (e: string, cb: any) => listeners.set(e, cb),
      removeAllListeners: jest.fn(),
    };
    const onRemoteState = jest.fn();
    // eslint-disable-next-line no-new
    new SpotifyPlayerController({ remote, getToken: async () => 'ready', onRemoteState });

    listeners.get('playerStateChanged')?.({ trackUri: 'spotify:track:b', isPaused: false });
    expect(onRemoteState).toHaveBeenCalledWith({ uri: 'spotify:track:b', isPaused: false });
    listeners.get('playerStateChanged')?.({ trackUri: null, isPaused: true });
    expect(onRemoteState).toHaveBeenCalledWith({ uri: null, isPaused: true });
  });
});
