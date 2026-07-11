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
    scheduler: makeCancellableScheduler(),
    onNowPlaying: (s) => emitted.push(s),
  });
  return { orch, player, played, emitted };
}

const flush = () => new Promise((r) => setImmediate(r));

// Microtask-deferred AND cancellable — schedule() must return before its fn runs, and
// cancel() must actually stop it (the coalescer relies on it, like prod clearTimeout).
function makeCancellableScheduler() {
  let seq = 0;
  const cancelled = new Set<number>();
  return {
    schedule: (fn: () => void) => { const id = ++seq; void Promise.resolve().then(() => { if (!cancelled.has(id)) fn(); }); return id; },
    cancel: (id: number) => { cancelled.add(id); },
  };
}

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

  it('forwards the current track imageUri from the native event (Now Playing cover source)', () => {
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

    listeners.get('playerStateChanged')?.({ trackUri: 'spotify:track:c', isPaused: false, imageUri: 'spotify:image:cc' });
    expect(onRemoteState).toHaveBeenCalledWith({ uri: 'spotify:track:c', isPaused: false, imageUri: 'spotify:image:cc' });
  });
});

// ── D-1 Option A: context playback (the session playlist owns the queue) ────────

function makeContextOrch() {
  const emitted: NowPlaying[] = [];
  const player = {
    play: jest.fn(async () => ({ ok: true })),
    pause: jest.fn(async () => ({ ok: true })),
    resume: jest.fn(async () => ({ ok: true })),
    playContext: jest.fn(async () => ({ ok: true })),
    skipToIndex: jest.fn(async () => ({ ok: true })),
  };
  const socket = { requestPlaylist: jest.fn(() => 1), requestHeartPlaylist: jest.fn(() => 1), ensureConnected: jest.fn() };
  const orch = new PlaybackOrchestrator({
    player, socket,
    scheduler: makeCancellableScheduler(),
    onNowPlaying: (s) => emitted.push(s),
  });
  return { orch, player, emitted };
}

describe('PlaybackOrchestrator — context playback (D-1 Option A)', () => {
  const CTX = 'spotify:playlist:koko-session';

  it('a playlist WITH contextUri starts the context at row 0 — no loose track play', async () => {
    const { orch, player } = makeContextOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any, contextUri: CTX });
    expect(player.playContext).toHaveBeenCalledWith(CTX, 0);
    expect(player.play).not.toHaveBeenCalled();
  });

  it('a skip burst coalesces into ONE absolute skipToIndex at the final cursor row', async () => {
    const { orch, player } = makeContextOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any, contextUri: CTX });
    orch.skipNext();
    orch.skipNext(); // burst: a → c
    await flush();
    expect(player.skipToIndex).toHaveBeenCalledTimes(1);
    expect(player.skipToIndex).toHaveBeenCalledWith(CTX, 2);
    expect(player.play).not.toHaveBeenCalled(); // never a context-destroying track play
  });

  it('data-only (uri:null) tracks are excluded from the playlist row index', async () => {
    const { orch, player } = makeContextOrch();
    const mixed = [
      { id: 'a', uri: 'spotify:track:a', title: 'A', artist: '' },
      { id: 'y', uri: null, title: 'YT-only', artist: '' },        // in queue, NOT in playlist
      { id: 'b', uri: 'spotify:track:b', title: 'B', artist: '' },
    ];
    await orch.handlePlaylist({ tracks: mixed as any, contextUri: CTX });
    orch.skipNext(); // cursor lands on b (queue idx 2) = playlist ROW 1
    await flush();
    expect(player.skipToIndex).toHaveBeenCalledWith(CTX, 1);
  });

  it('without a contextUri (attach failed server-side) playback falls back to track URIs', async () => {
    const { orch, player } = makeContextOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any });
    expect(player.play).toHaveBeenCalledWith('spotify:track:a');
    expect(player.playContext).not.toHaveBeenCalled();
  });

  it('a native auto-advance in context mode still syncs the cursor without ANY command', async () => {
    const { orch, player, emitted } = makeContextOrch();
    await orch.handlePlaylist({ tracks: TRACKS as any, contextUri: CTX });
    const cmds = () => player.playContext.mock.calls.length + player.skipToIndex.mock.calls.length + player.play.mock.calls.length;
    const before = cmds();
    orch.syncToRemote('spotify:track:b', false); // Spotify walked OUR playlist to row 1
    expect(cmds()).toBe(before);                 // pure adoption — no re-command
    expect(emitted[emitted.length - 1].track?.id).toBe('b');
  });
});
