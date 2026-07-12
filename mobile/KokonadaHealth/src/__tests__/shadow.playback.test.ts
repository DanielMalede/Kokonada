// ═══════════════════════════════════════════════════════════════════════════
// SHADOW AUDIT — Sprint A9 (Playback Orchestration) — STATE-SYNC ATTACK
// The truth lives in THREE places: Kokonada's model, the socket server, and the
// native Spotify app. This suite attacks every seam between them, plus the auth
// refresh storm and the generation-request backlog. Real orchestrator + queue +
// authSession; stateful fakes for player/socket.
// ═══════════════════════════════════════════════════════════════════════════

import { PlaybackOrchestrator, type PlaybackSocket, type PlaybackPlayer } from '../experience/playback/playbackOrchestrator';
import { PlaybackQueue, type QueueTrack } from '../experience/playback/playbackQueue';
import { AuthSession } from '../auth/authSession';

const T = (id: string): QueueTrack => ({ id, uri: `spotify:track:${id}`, title: id, artist: 'x', receipt: null });
const list = (...ids: string[]) => ids.map(T);

function makeScheduler() {
  let pending: (() => void) | null = null;
  return {
    scheduler: { schedule: (fn: () => void) => { pending = fn; return 1; }, cancel: () => { pending = null; } },
    flush: () => { const f = pending; pending = null; f?.(); },
  };
}
function makePlayer() {
  const self: any = {
    played: [] as string[], nextResult: { ok: true },
    play: jest.fn(async (uri: string) => { self.played.push(uri); return self.nextResult; }),
    pause: jest.fn(async () => ({ ok: true })),
    resume: jest.fn(async () => ({ ok: true })),
  };
  return self as PlaybackPlayer & { played: string[]; nextResult: { ok: boolean } };
}
function makeSocket() {
  const self: any = {
    plays: 0, ensures: 0,
    requestPlaylist: jest.fn(() => { self.plays += 1; return self.plays; }),
    requestHeartPlaylist: jest.fn(() => 0),
    ensureConnected: jest.fn(() => { self.ensures += 1; }),
  };
  return self as PlaybackSocket & { plays: number; ensures: number };
}
function build() {
  const player = makePlayer();
  const socket = makeSocket();
  const sched = makeScheduler();
  const orch = new PlaybackOrchestrator({ player, socket, queue: new PlaybackQueue(), scheduler: sched.scheduler, coalesceMs: 250 });
  return { orch, player, socket, sched };
}
const tick = () => Promise.resolve();

// ═════ ATTACK 1: THE DESYNC GHOST ════════════════════════════════════════════
describe('ATTACK 1: the desync ghost — Spotify playing a FOREIGN track', () => {
  it('reconciles to not-playing-ours when Spotify is on a track Kokonada did not queue', async () => {
    const { orch } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b') });
    expect(orch.getNowPlaying().isPlaying).toBe(true);

    // The user opened Spotify directly and played a totally different song, then
    // backgrounded+locked Kokonada. On unlock we reconcile against the remote truth.
    orch.reconcile({ isPlaying: true, uri: 'spotify:track:SOMETHING_ELSE' });

    // Kokonada must NOT keep claiming our track 'a' is playing — that's the ghost.
    expect(orch.getNowPlaying().isPlaying).toBe(false);
  });

  it('stays playing when the remote confirms OUR current track is the one playing', async () => {
    const { orch } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    orch.reconcile({ isPlaying: true, uri: 'spotify:track:a' });
    expect(orch.getNowPlaying().isPlaying).toBe(true);
  });

  it('reconciles paused when the user paused inside Spotify (same track)', async () => {
    const { orch } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    orch.reconcile({ isPlaying: false, uri: 'spotify:track:a' });
    expect(orch.getNowPlaying().isPlaying).toBe(false);
    expect(orch.getNowPlaying().track?.id).toBe('a');
  });
});

// ═════ ATTACK 2: RAPID SKIP SPAM (rate limiting) ═════════════════════════════
describe('ATTACK 2: skip spam does not backlog commands', () => {
  it('spamming Next WITHIN the queue coalesces to one play command', async () => {
    const { orch, player, sched } = build();
    await orch.handlePlaylist({ tracks: list('a', 'b', 'c', 'd', 'e') });
    player.played.length = 0;
    for (let i = 0; i < 4; i++) orch.skipNext();
    sched.flush();
    await tick();
    expect(player.played).toEqual(['spotify:track:e']);
  });

  it('spamming Next PAST THE END fires exactly ONE generation request, not a storm', async () => {
    const { orch, socket } = build();
    await orch.handlePlaylist({ tracks: list('a') }); // single track — end is one skip away
    for (let i = 0; i < 20; i++) orch.skipNext(); // frantic spam past the end
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1); // NOT 20 — no backlog / rate-limit storm
  });

  it('after a generation arrives, a later skip-past-end can request again (not permanently blocked)', async () => {
    const { orch, socket } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    for (let i = 0; i < 5; i++) orch.skipNext();
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);

    await orch.handlePlaylist({ tracks: list('b') }); // the generation lands
    for (let i = 0; i < 5; i++) orch.skipNext();       // spam past the new end
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(2); // one more, still coalesced
  });
});

// ═════ ATTACK 3: BACKGROUND SOCKET ASSASSINATION ═════════════════════════════
describe('ATTACK 3: OS kills the socket in background; track ends', () => {
  it('revives the socket and auto-plays the next generation without user action', async () => {
    const { orch, socket, player } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    await orch.onTrackEnded('a');
    expect(socket.ensureConnected).toHaveBeenCalled();
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);
    await orch.handlePlaylist({ tracks: list('z') }); // arrives on revived socket
    expect(player.played).toContain('spotify:track:z');
  });
});

// ═════ ATTACK 4 (autonomous): auth refresh storm during socket auth_expired ══
describe('ATTACK 4 (autonomous): concurrent refresh under an auth_expired storm', () => {
  it('never double-rotates the refresh token, even under a burst of concurrent refreshes', async () => {
    let calls = 0;
    const session = new AuthSession({
      loadTokens: async () => ({ access: 'a1', refresh: 'r1' }),
      saveTokens: async () => {},
      clearTokens: async () => {},
      refreshEndpoint: async () => { calls += 1; await tick(); return { access: 'a2', refresh: 'r2' }; },
    });
    await session.bootstrap();
    await Promise.all(Array.from({ length: 10 }, () => session.refresh()));
    expect(calls).toBe(1); // one rotation, not ten — the family is never burned by self-collision
    expect(session.getAccessToken()).toBe('a2');
  });
});

// ═════ ATTACK 5 (autonomous): a foreign-track reconcile then a fresh generation
describe('ATTACK 5 (autonomous): recovering control after the ghost', () => {
  it('a new generation after a foreign-track desync takes back playback cleanly', async () => {
    const { orch, player } = build();
    await orch.handlePlaylist({ tracks: list('a') });
    orch.reconcile({ isPlaying: true, uri: 'spotify:track:foreign' });
    expect(orch.getNowPlaying().isPlaying).toBe(false);

    // user generates a new vibe — Kokonada reclaims playback
    await orch.handlePlaylist({ tracks: list('n') });
    expect(orch.getNowPlaying().isPlaying).toBe(true);
    expect(orch.getNowPlaying().track?.id).toBe('n');
    expect(player.played).toContain('spotify:track:n');
  });
});
