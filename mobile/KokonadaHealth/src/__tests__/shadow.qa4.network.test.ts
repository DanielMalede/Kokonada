// ─────────────────────────────────────────────────────────────────────────────
// QA4 — AGENT Q4: NETWORK RESILIENCE (hostile network + hostile Spotify)
// Desync the player, race the server, storm the socket. One CONFIRMED kill fixed
// here: a lost generation request wedged the single-flight guard FOREVER (stuck
// spinner) — a generation watchdog now self-heals it.
// ─────────────────────────────────────────────────────────────────────────────

import { PlaybackOrchestrator, type Scheduler } from '../experience/playback/playbackOrchestrator';
import { SpotifyPlayerController, type SpotifyRemoteLike } from '../experience/player/spotifyController';
import { KokonadaSocket, type SocketLike } from '../net/socketClient';
import { FakeSocketServer } from '../testing/socket';

// The real playbackServices graph (the last suite) opens its sockets through this factory: the
// QA-045 fake server.
const mockServer: { current: FakeSocketServer | null } = { current: null };
jest.mock('../net/socketFactory', () => ({
  createBackendSocket: (token: string) => {
    if (!mockServer.current) throw new Error('no fake socket server installed');
    return mockServer.current.createSocket(token);
  },
}));

function makeScheduler() {
  const tasks = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const s: Scheduler & { runAll(): void; count(): number } = {
    schedule(fn, ms) { const h = ++id; tasks.set(h, { fn, ms }); return h; },
    cancel(h) { tasks.delete(h); },
    runAll() { for (const [h, t] of [...tasks]) { tasks.delete(h); t.fn(); } },
    count() { return tasks.size; },
  };
  return s;
}

function fakePlayer() {
  return {
    play: jest.fn().mockResolvedValue({ ok: true }),
    pause: jest.fn().mockResolvedValue({ ok: true }),
    resume: jest.fn().mockResolvedValue({ ok: true }),
  };
}

function fakeSocket() {
  return {
    requestPlaylist: jest.fn().mockReturnValue(1),
    requestHeartPlaylist: jest.fn().mockReturnValue(1),
    ensureConnected: jest.fn(),
  };
}

const twoTracks = [
  { id: 'a', uri: 'spotify:track:a', title: 'A', artist: '' },
  { id: 'b', uri: 'spotify:track:b', title: 'B', artist: '' },
];

describe('Q4 — generation single-flight self-heals (stuck-spinner kill)', () => {
  it('a lost generation (no playlist, no error) does not wedge the guard forever', async () => {
    const scheduler = makeScheduler();
    const socket = fakeSocket();
    const orch = new PlaybackOrchestrator({ player: fakePlayer(), socket, scheduler, generationTimeoutMs: 5000 } as any);
    await orch.handlePlaylist({ tracks: twoTracks });

    orch.skipNext(); // a → b
    orch.skipNext(); // b → end → requestMore (1st generation)
    orch.skipNext(); // still past end → single-flight, NO 2nd request
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);

    // The generation is lost (server never answers). The watchdog must clear the guard.
    scheduler.runAll();

    orch.skipNext(); // now a fresh generation is allowed again
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(2);
  });

  it('a playlist arrival cancels the watchdog and re-arms the guard immediately', async () => {
    const scheduler = makeScheduler();
    const socket = fakeSocket();
    const orch = new PlaybackOrchestrator({ player: fakePlayer(), socket, scheduler, generationTimeoutMs: 5000 } as any);
    await orch.handlePlaylist({ tracks: twoTracks });
    orch.skipNext(); orch.skipNext(); // → requestMore
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(1);
    await orch.handlePlaylist({ tracks: twoTracks }); // generation arrived → guard cleared, watchdog cancelled
    expect(scheduler.count()).toBe(0);
    orch.skipNext(); orch.skipNext();
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(2);
  });

  it('playlist_error also unblocks the guard (DEFENDED)', async () => {
    const scheduler = makeScheduler();
    const socket = fakeSocket();
    const orch = new PlaybackOrchestrator({ player: fakePlayer(), socket, scheduler } as any);
    await orch.handlePlaylist({ tracks: twoTracks });
    orch.skipNext(); orch.skipNext();
    orch.onGenerationError();
    orch.skipNext();
    expect(socket.requestPlaylist).toHaveBeenCalledTimes(2);
  });
});

describe('Q4 — skip coalescing + stale-end guard (DEFENDED)', () => {
  it('a burst of skips issues exactly one play command', async () => {
    const scheduler = makeScheduler();
    const player = fakePlayer();
    const four = [
      { id: 'a', uri: 'spotify:track:a', title: '', artist: '' },
      { id: 'b', uri: 'spotify:track:b', title: '', artist: '' },
      { id: 'c', uri: 'spotify:track:c', title: '', artist: '' },
      { id: 'd', uri: 'spotify:track:d', title: '', artist: '' },
    ];
    const orch = new PlaybackOrchestrator({ player, socket: fakeSocket(), scheduler, coalesceMs: 250 } as any);
    await orch.handlePlaylist({ tracks: four }); // plays a (1 call)
    player.play.mockClear();
    orch.skipNext(); orch.skipNext(); orch.skipNext(); // spam to d
    scheduler.runAll();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledWith('spotify:track:d');
  });

  it('a stale track-end for an already-skipped track is ignored', async () => {
    const player = fakePlayer();
    const scheduler = makeScheduler();
    const orch = new PlaybackOrchestrator({ player, socket: fakeSocket(), scheduler, coalesceMs: 0 } as any);
    await orch.handlePlaylist({ tracks: twoTracks }); // current = a
    orch.skipNext();       // now intent = b
    scheduler.runAll();    // b plays
    player.play.mockClear();
    await orch.onTrackEnded('a'); // stale end for a — must be ignored
    expect(player.play).not.toHaveBeenCalled();
  });
});

describe('Q4 — URI-aware reconcile idempotence (S11-1)', () => {
  it('a foreign track playing in the Spotify app is reflected as not-ours, stably', async () => {
    const states: boolean[] = [];
    const orch = new PlaybackOrchestrator({
      player: fakePlayer(), socket: fakeSocket(), scheduler: makeScheduler(),
      onNowPlaying: (s) => states.push(s.isPlaying),
    } as any);
    await orch.handlePlaylist({ tracks: twoTracks });
    for (let i = 0; i < 5; i++) orch.reconcile({ isPlaying: true, uri: 'spotify:track:FOREIGN' });
    expect(orch.getNowPlaying().isPlaying).toBe(false);
    orch.reconcile('disconnected');
    expect(orch.getNowPlaying().isPlaying).toBe(false);
  });
});

describe('Q4 — SpotifyPlayerController never lets a rejection escape (DEFENDED)', () => {
  function remote(overrides: Partial<SpotifyRemoteLike> = {}): SpotifyRemoteLike {
    return {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      isConnectedAsync: jest.fn().mockResolvedValue(true),
      playUri: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn().mockResolvedValue(undefined),
      resume: jest.fn().mockResolvedValue(undefined),
      addListener: jest.fn(),
      removeAllListeners: jest.fn(),
      ...overrides,
    };
  }
  it('a command that throws mid-song collapses to {ok:false} + disconnected, no unhandled rejection', async () => {
    const rejections: unknown[] = [];
    const onRej = (e: unknown) => rejections.push(e);
    process.on('unhandledRejection', onRej);
    const c = new SpotifyPlayerController({ remote: remote({ playUri: jest.fn().mockRejectedValue(new Error('severed')) }), getToken: async () => 'tok' });
    await c.connect();
    const res = await c.play('spotify:track:x');
    expect(res.ok).toBe(false);
    expect(c.getState()).toBe('disconnected');
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', onRej);
    expect(rejections).toHaveLength(0);
  });
  it('getPlaybackState maps any failure to disconnected, never throws', async () => {
    const c = new SpotifyPlayerController({ remote: remote({ getPlayerState: jest.fn().mockRejectedValue(new Error('gone')) }), getToken: async () => 'tok' });
    await c.connect();
    await expect(c.getPlaybackState()).resolves.toBe('disconnected');
  });
});

describe('Q4 — KokonadaSocket reqId gating + auth storm (DEFENDED)', () => {
  class FakeSock implements SocketLike {
    handlers = new Map<string, Array<(p?: any) => void>>();
    emitted: Array<{ event: string; payload: any }> = [];
    connected = false;
    on(e: string, cb: any) { (this.handlers.get(e) ?? this.handlers.set(e, []).get(e)!).push(cb); }
    off(e: string, cb: any) { const h = this.handlers.get(e); if (h) this.handlers.set(e, h.filter((f) => f !== cb)); }
    emit(e: string, p?: any) { this.emitted.push({ event: e, payload: p }); }
    connect() { this.connected = true; this.fire('connect'); }
    disconnect() { this.connected = false; }
    fire(e: string, p?: any) { (this.handlers.get(e) ?? []).forEach((cb) => cb(p)); }
    listenerCount(e: string) { return (this.handlers.get(e) ?? []).length; }
  }

  it('drops a stale playlist and delivers only the latest reqId', () => {
    const sock = new FakeSock();
    const playlists: any[] = [];
    const s = new KokonadaSocket({
      createSocket: () => sock, getAccessToken: () => 'tok', refreshToken: async () => 'tok2',
      getEmotionIntent: () => ({ taps: [], textPrompt: '', activity: null }),
      onPlaylist: (p) => playlists.push(p), onLoggedOut: jest.fn(),
    });
    s.connect();
    const req = s.requestPlaylist(); // latest reqId
    sock.fire('playlist_ready', { reqId: req - 1, tracks: [] }); // stale
    sock.fire('playlist_ready', { reqId: req, tracks: [{ id: 'x' }] }); // current
    expect(playlists).toHaveLength(1);
    expect(playlists[0].reqId).toBe(req);
  });

  it('re-emits emotion_update on every (re)connect (server cache is per-socketId)', () => {
    const sock = new FakeSock();
    const s = new KokonadaSocket({
      createSocket: () => sock, getAccessToken: () => 'tok', refreshToken: async () => 'tok2',
      getEmotionIntent: () => ({ taps: [{ x: 0.1, y: 0.2 }], textPrompt: 'v', activity: 'running' }),
      onPlaylist: jest.fn(), onLoggedOut: jest.fn(),
    });
    s.connect();
    expect(sock.emitted.filter((e) => e.event === 'emotion_update')).toHaveLength(1);
    sock.fire('connect'); // a transient reconnect
    expect(sock.emitted.filter((e) => e.event === 'emotion_update')).toHaveLength(2);
  });

  it('an auth_expired storm collapses to a single refresh and leaves no listeners on the dead socket', async () => {
    const sockets: FakeSock[] = [];
    let refreshCalls = 0;
    const s = new KokonadaSocket({
      createSocket: () => { const fs = new FakeSock(); sockets.push(fs); return fs; },
      getAccessToken: () => 'tok',
      refreshToken: async () => { refreshCalls++; return 'tok-fresh'; },
      getEmotionIntent: () => ({ taps: [], textPrompt: '', activity: null }),
      onPlaylist: jest.fn(), onLoggedOut: jest.fn(),
    });
    s.connect();
    const first = sockets[0];
    first.fire('auth_expired');
    first.fire('auth_expired'); // storm
    await new Promise((r) => setImmediate(r));
    expect(refreshCalls).toBe(1);
    expect(first.listenerCount('playlist_ready')).toBe(0); // teardown detached the dead socket
  });
});

// C4 through the REAL wiring (playbackServices: the kokoSocket over the app's one AuthSession and
// its Keychain endpoint): the socket's token expires while the phone is offline. The old wiring
// sent the null refresh to onLoggedOut, and onLoggedOut cleared the session: a sign-out by a
// network blip. Now the session survives, and reconnect() brings the socket back on a fresh token.
describe('Q4 — the playback socket over the real session: an offline refresh is not a sign-out (C4)', () => {
  const realFetch = (globalThis as any).fetch;
  afterEach(() => { (globalThis as any).fetch = realFetch; mockServer.current = null; jest.restoreAllMocks(); });
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

  it('auth_expired while offline keeps the session and its Keychain pair; reconnect() on the network re-sends the pending request', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const server = new FakeSocketServer({ validTokens: ['acc-a'] });
    mockServer.current = server;
    let svc: any;
    let Keychain: any;
    jest.isolateModules(() => {
      svc = require('../experience/playback/playbackServices');
      Keychain = require('react-native-keychain');
    });
    await svc.authSession.setSession({ access: 'acc-a', refresh: 'krt-a' });
    (globalThis as any).fetch = jest.fn(async () => { throw new TypeError('Network request failed'); });

    svc.kokoSocket.connect();
    server.flush();
    server.expire('acc-a');
    const reqId = svc.kokoSocket.requestPlaylist();
    await settle();
    server.flush();

    expect(svc.authSession.hasSession()).toBe(true);
    expect(svc.authSession.getAccessToken()).toBe('acc-a');
    expect(Keychain.resetGenericPassword).not.toHaveBeenCalled();
    expect(() => server.assertNoLiveListeners()).not.toThrow();

    // The network is back a minute later: past the backoff an unavailable refresh holds (RA-2, at most 60 s).
    // The hold runs on the monotonic clock (B1 C1, RA-119; MB-228), so the minute passes there; the wall
    // clock moves with it, as it does on a phone.
    const later = Date.now() + 60_000;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    const monoLater = performance.now() + 60_000;
    jest.spyOn(performance, 'now').mockReturnValue(monoLater);
    (globalThis as any).fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ token: 'acc-b', refreshToken: 'krt-b' }) }));
    server.accept('acc-b');
    await svc.kokoSocket.reconnect();
    server.flush();
    expect(server.sockets.map((s) => s.token)).toEqual(['acc-a', 'acc-b']);
    expect(server.receivedOn('request_playlist', server.sockets[1])).toEqual([{ reqId }]);
    svc.kokoSocket.disconnect();
  });
});
