// The conductor. It receives generated playlists from the socket, plays them
// through the Spotify controller, advances on track-end, and keeps its own model
// in sync with the native Spotify truth. This is where every playback/sync attack
// lands, so its dependencies are injected fakes with real semantics.

import { PlaybackOrchestrator, type PlaybackSocket, type PlaybackPlayer } from '../playbackOrchestrator';
import { PlaybackQueue, type QueueTrack } from '../playbackQueue';

const T = (id: string): QueueTrack => ({ id, uri: `spotify:track:${id}`, title: id, artist: 'x' });
const list = (...ids: string[]) => ids.map(T);

function makeScheduler() {
  let pending: (() => void) | null = null;
  return {
    scheduler: {
      schedule: (fn: () => void) => { pending = fn; return 1; },
      cancel: () => { pending = null; },
    },
    flush: () => { const f = pending; pending = null; f?.(); },
    isPending: () => pending !== null,
  };
}

function makePlayer(): PlaybackPlayer & { played: string[]; paused: number; resumed: number; nextResult: { ok: boolean } } {
  const self: any = {
    played: [], paused: 0, resumed: 0, nextResult: { ok: true },
    play: jest.fn(async (uri: string) => { self.played.push(uri); return self.nextResult; }),
    pause: jest.fn(async () => { self.paused += 1; return { ok: true }; }),
    resume: jest.fn(async () => { self.resumed += 1; return { ok: true }; }),
  };
  return self;
}

function makeSocket(): PlaybackSocket & { generations: number; ensures: number } {
  const self: any = {
    generations: 0, ensures: 0,
    requestPlaylist: jest.fn(() => { self.generations += 1; return self.generations; }),
    requestHeartPlaylist: jest.fn(() => { self.generations += 1; return self.generations; }),
    ensureConnected: jest.fn(() => { self.ensures += 1; }),
  };
  return self;
}

function build() {
  const player = makePlayer();
  const socket = makeSocket();
  const sched = makeScheduler();
  const nowPlaying: Array<{ track: QueueTrack | null; isPlaying: boolean }> = [];
  const orch = new PlaybackOrchestrator({
    player, socket, queue: new PlaybackQueue(), scheduler: sched.scheduler,
    onNowPlaying: (s) => nowPlaying.push(s), coalesceMs: 250,
  });
  return { orch, player, socket, sched, nowPlaying };
}

describe('PlaybackOrchestrator — play a generated playlist', () => {
  it('plays the first track when a playlist arrives', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b', 'c') });
    expect(player.played).toEqual(['spotify:track:a']);
    expect(orch.getNowPlaying().track?.id).toBe('a');
    expect(orch.getNowPlaying().isPlaying).toBe(true);
  });

  it('an empty playlist plays nothing and does not crash', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: [] });
    expect(player.played).toEqual([]);
    expect(orch.getNowPlaying().track).toBeNull();
  });
});

describe('PlaybackOrchestrator — track end auto-advance', () => {
  it('auto-advances to the next track when the current one ends', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b') });
    await orch.onTrackEnded('a');
    expect(player.played).toEqual(['spotify:track:a', 'spotify:track:b']);
    expect(orch.getNowPlaying().track?.id).toBe('b');
  });

  it('at the end of the queue, track-end requests a fresh generation', async () => {
    const { orch, socket } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    await orch.onTrackEnded('a');
    expect(socket.ensureConnected).toHaveBeenCalled();
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);
  });
});

describe('PlaybackOrchestrator — play/pause', () => {
  it('toggles pause then resume through the player', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    await orch.togglePlayPause();
    expect(player.paused).toBe(1);
    expect(orch.getNowPlaying().isPlaying).toBe(false);
    await orch.togglePlayPause();
    expect(player.resumed).toBe(1);
    expect(orch.getNowPlaying().isPlaying).toBe(true);
  });
});

// ═════ ATTACK 1: DESYNC GHOST ════════════════════════════════════════════════
describe('ATTACK 1: reconcile with the native Spotify truth', () => {
  it('reconciles to paused when the user paused inside the Spotify app', async () => {
    const { orch } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    expect(orch.getNowPlaying().isPlaying).toBe(true);
    orch.reconcile({ isPlaying: false }); // Spotify says: actually paused
    expect(orch.getNowPlaying().isPlaying).toBe(false);
  });

  it('reconciles to not-playing (no crash) when the remote is gone on foreground', async () => {
    const { orch } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    expect(() => orch.reconcile('disconnected')).not.toThrow();
    expect(orch.getNowPlaying().isPlaying).toBe(false);
    expect(orch.getNowPlaying().track?.id).toBe('a'); // track identity preserved
  });
});

// ═════ ATTACK 2: RAPID SKIP SPAM (rate limiting) ═════════════════════════════
describe('ATTACK 2: frantic Next spam is coalesced', () => {
  it('10 rapid skips issue exactly ONE play command (the final track), no backlog', async () => {
    const { orch, player, sched } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k') });
    player.played.length = 0; // ignore the initial play

    for (let i = 0; i < 9; i++) orch.skipNext(); // frantic
    expect(player.played).toEqual([]); // nothing fired yet — coalescing
    sched.flush(); // the burst settles
    await Promise.resolve();

    expect(player.played).toHaveLength(1); // ONE command, not 9
    expect(player.played[0]).toBe('spotify:track:j'); // a→...→j (9 skips)
  });
});

// ═════ ATTACK 3: BACKGROUND SOCKET ASSASSINATION ═════════════════════════════
describe('ATTACK 3: socket killed in background, track ends', () => {
  it('re-establishes the socket and fetches the next track with no user action', async () => {
    const { orch, socket, player } = build();
    await orch.handlePlaylist({ tracks: list('a') }); // one-track queue
    // OS killed the socket while backgrounded; the track now ends
    await orch.onTrackEnded('a');
    expect(socket.ensureConnected).toHaveBeenCalled();   // socket revived
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);

    // the freshly-generated playlist arrives on the revived socket and auto-plays
    await orch.handlePlaylist({ tracks: list('z') });
    expect(player.played).toContain('spotify:track:z');
  });
});

// ═════ D-7 / D-8: track-mode auto-advance (no Spotify context) ═══════════════
// Root cause (device+Railway evidence): when session-playlist creation 403s, the
// server sends contextUri=null, so Spotify plays ONE track and never walks our queue.
// Manual playback stops at track end (D-7); each biometric re-serve plays one track
// then silence (D-8). Fix: detect the finished track from the native PlayerState's
// playback position and drive the SAME onTrackEnded advance context mode gets for free.
describe('D-7/D-8: track-mode auto-advance when there is no Spotify context', () => {
  it('a track finishing (paused at its end) auto-advances to the next track', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b') }); // no contextUri → track mode
    orch.syncToRemote('spotify:track:a', false, 1000, 200000);   // A is actively playing
    orch.syncToRemote('spotify:track:a', true, 200000, 200000);  // A finished (paused at end)
    await Promise.resolve();
    expect(player.played).toEqual(['spotify:track:a', 'spotify:track:b']);
    expect(orch.getNowPlaying().track?.id).toBe('b');
    expect(orch.getNowPlaying().isPlaying).toBe(true);
  });

  it('also advances when Spotify resets position to 0 at end (after having played)', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b') });
    orch.syncToRemote('spotify:track:a', false, 120000, 200000); // played most of A
    orch.syncToRemote('spotify:track:a', true, 0, 200000);       // reset to 0 + paused = ended
    await Promise.resolve();
    expect(player.played).toEqual(['spotify:track:a', 'spotify:track:b']);
    expect(orch.getNowPlaying().track?.id).toBe('b');
  });

  it('a mid-track pause is mirrored, NOT mistaken for track-end (no false advance)', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b') });
    orch.syncToRemote('spotify:track:a', false, 1000, 200000);
    orch.syncToRemote('spotify:track:a', true, 90000, 200000); // user paused mid-track
    await Promise.resolve();
    expect(player.played).toEqual(['spotify:track:a']); // still just A
    expect(orch.getNowPlaying().track?.id).toBe('a');
    expect(orch.getNowPlaying().isPlaying).toBe(false);
  });

  it('the last track finishing requests a fresh generation (never dead-ends)', async () => {
    const { orch, socket } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    orch.syncToRemote('spotify:track:a', false, 1000, 200000);
    orch.syncToRemote('spotify:track:a', true, 200000, 200000);
    await Promise.resolve();
    expect(socket.ensureConnected).toHaveBeenCalled();
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);
  });

  it('degrades safely on a legacy native build (no position) — mirrors pause, no advance', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b') });
    orch.syncToRemote('spotify:track:a', false); // old 2-arg native event
    orch.syncToRemote('spotify:track:a', true);  // paused, no position/duration
    await Promise.resolve();
    expect(player.played).toEqual(['spotify:track:a']); // no phantom advance
    expect(orch.getNowPlaying().isPlaying).toBe(false);
  });

  it('does not double-advance in CONTEXT mode (Spotify owns auto-advance there)', async () => {
    const { orch, player } = build();
    // A context is present → Spotify walks the queue; our end-detection must stay out.
    await orch.handlePlaylist({ tracks: list('a', 'b'), contextUri: 'spotify:playlist:ctx' });
    player.played.length = 0;
    orch.syncToRemote('spotify:track:a', true, 200000, 200000); // would look "ended"
    await Promise.resolve();
    expect(player.played).toEqual([]); // we issued no advance command
  });
});

// ═════ ATTACK 4 (autonomous): stale track-end racing a manual skip ═══════════
describe('ATTACK 4 (autonomous): a late track-end event must not double-skip', () => {
  it('ignores a track-end for a track the user already skipped past', async () => {
    const { orch, player, sched } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b', 'c') });
    player.played.length = 0;

    orch.skipNext();      // user skips a → b (play coalesced)
    sched.flush();
    await Promise.resolve();
    expect(orch.getNowPlaying().track?.id).toBe('b');
    expect(player.played).toEqual(['spotify:track:b']);

    // track A's end event finally fires (buffered) — it must be IGNORED, not
    // auto-advance b→c behind the user's back
    await orch.onTrackEnded('a');
    expect(orch.getNowPlaying().track?.id).toBe('b'); // still on b
    expect(player.played).toEqual(['spotify:track:b']); // no extra play
  });

  it('a failed play (Spotify severed mid-skip) degrades to not-playing, never throws', async () => {
    const { orch, player, sched } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b') });
    player.nextResult = { ok: false }; // Spotify severed
    orch.skipNext();
    sched.flush();
    await Promise.resolve();
    expect(orch.getNowPlaying().isPlaying).toBe(false); // truthful state
    expect(orch.getNowPlaying().track?.id).toBe('b');
  });
});
