// The typed socket client — the one module that owns the connection lifecycle.
// Three behaviors the Shadow Agent attacks:
//   #3 Zombie Navigation: a stale playlist response (from before a tab switch /
//      re-request) must be DROPPED, not rendered over the fresh one — reqId gating.
//   Reconnect re-hydration: the server's emotion cache is keyed by socketId, so a
//      reconnect (new socketId) starts empty; the client MUST re-push emotion_update
//      on every (re)connect before a playlist can be requested.
//   #8 (autonomous) Self-DoS: on `auth_expired` the naive client reconnects forever
//      with the SAME dead token — an unauthorized reconnect STORM that drains the
//      battery and hammers the server. Correct: refresh the token first, reconnect
//      ONCE with the fresh one; if refresh fails, log out and STOP.

import { KokonadaSocket } from '../socketClient';
import type { SocketLike } from '../socketClient';

class FakeSocket implements SocketLike {
  handlers = new Map<string, Array<(p?: any) => void>>();
  emitted: Array<{ event: string; payload?: any }> = [];
  connected = false;
  disconnectCalls = 0;

  constructor(public token: string) {}

  on(event: string, cb: (p?: any) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }
  off(event: string, cb: (p?: any) => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb));
  }
  emit(event: string, payload?: any) {
    this.emitted.push({ event, payload });
  }
  connect() {
    this.connected = true;
    this.fire('connect');
  }
  disconnect() {
    this.connected = false;
    this.disconnectCalls += 1;
  }
  // test helper: simulate a server→client event
  fire(event: string, payload?: any) {
    (this.handlers.get(event) ?? []).slice().forEach((cb) => cb(payload));
  }
  clientEmits(event: string) {
    return this.emitted.filter((e) => e.event === event);
  }
}

const flush = () => new Promise((r) => setImmediate(r));

function build(overrides: Partial<Parameters<typeof makeDeps>[0]> = {}) {
  const created: FakeSocket[] = [];
  const deps = makeDeps(overrides);
  const client = new KokonadaSocket({
    ...deps,
    createSocket: (token: string) => { const s = new FakeSocket(token); created.push(s); return s; },
  });
  return { client, created, deps };
}

function makeDeps(overrides: any = {}) {
  return {
    getAccessToken: () => 'access-1',
    refreshToken: jest.fn(async () => 'access-2'),
    getEmotionIntent: () => ({ taps: [{ x: 0.5, y: 0.5 }], textPrompt: 'vibes', activity: 'running' }),
    onPlaylist: jest.fn(),
    onLoggedOut: jest.fn(),
    ...overrides,
  };
}

describe('KokonadaSocket — connection status wiring (Pulse indicator was dead)', () => {
  it('reports connecting → connected → disconnected across the socket lifecycle', () => {
    const statuses: string[] = [];
    const { client, created } = build({ onConnectionChange: (s: string) => statuses.push(s) });
    client.connect();
    expect(statuses).toContain('connecting'); // set the moment we open
    created[0].fire('connect');
    expect(statuses).toContain('connected');
    created[0].fire('disconnect', 'transport close');
    expect(statuses[statuses.length - 1]).toBe('disconnected');
  });

  it('reports disconnected when the socket errors on connect', () => {
    const statuses: string[] = [];
    const { client, created } = build({ onConnectionChange: (s: string) => statuses.push(s) });
    client.connect();
    created[0].fire('connect_error', new Error('websocket error'));
    expect(statuses[statuses.length - 1]).toBe('disconnected');
  });
});

describe('KokonadaSocket — ensureOpen (never emit into a null socket)', () => {
  it('requestPlaylist opens a socket if none exists — Generate pressed before any connect', () => {
    const { client, created } = build();
    const reqId = client.requestPlaylist(); // NO prior client.connect()
    expect(created).toHaveLength(1); // ensureOpen opened one
    expect(created[0].clientEmits('request_playlist')[0].payload).toEqual({ reqId });
  });

  it('ensureOpen is idempotent — a live socket is never churned', () => {
    const { client, created } = build();
    client.connect();
    client.requestPlaylist();
    client.requestPlaylist();
    expect(created).toHaveLength(1); // no extra sockets spun up
  });
});

describe('KokonadaSocket — delivery guarantee (re-send pending request on reconnect)', () => {
  it('re-issues a pending request on reconnect so a swallowed/churned request is not lost', () => {
    const { client, created } = build();
    client.connect();
    const sock = created[0];
    const reqId = client.requestPlaylist();
    sock.emitted.length = 0; // clear the send-time emits
    // A token-expiry gate or churn: disconnect + reconnect with NO response having arrived.
    sock.fire('disconnect', 'io server disconnect');
    sock.fire('connect');
    const resent = sock.clientEmits('request_playlist');
    expect(resent).toHaveLength(1);
    expect(resent[0].payload).toEqual({ reqId });
  });

  it('does NOT re-issue once the response has arrived', () => {
    const { client, created } = build();
    client.connect();
    const sock = created[0];
    const reqId = client.requestPlaylist();
    sock.fire('playlist_ready', { reqId, tracks: ['a'] }); // response clears the pending request
    sock.emitted.length = 0;
    sock.fire('connect');
    expect(sock.clientEmits('request_playlist')).toHaveLength(0);
  });

  it('re-issues a pending heart-playlist request with its HR', () => {
    const { client, created } = build();
    client.connect();
    const sock = created[0];
    const reqId = client.requestHeartPlaylist(72);
    sock.emitted.length = 0;
    sock.fire('connect');
    expect(sock.clientEmits('request_heart_playlist')[0].payload).toEqual({ reqId, heartRate: 72 });
  });

  it('clears the pending request on a matching playlist_error too', () => {
    const { client, created } = build({ onGenerationError: jest.fn() });
    client.connect();
    const sock = created[0];
    const reqId = client.requestPlaylist();
    sock.fire('playlist_error', { reqId, message: 'empty' });
    sock.emitted.length = 0;
    sock.fire('connect');
    expect(sock.clientEmits('request_playlist')).toHaveLength(0);
  });
});

describe('KokonadaSocket — server contract (the event the backend actually emits)', () => {
  it('delivers a playlist_ready response to onPlaylist (backend emits playlist_ready, not playlist)', () => {
    const { client, created, deps } = build();
    client.connect();
    const reqId = client.requestPlaylist();
    // biometricHandler emits socket.emit('playlist_ready', …) on success — the mobile
    // client MUST subscribe to that exact event or a generated playlist never plays.
    created[0].fire('playlist_ready', { reqId, tracks: [{ id: 't1', uri: 'spotify:track:t1' }] });
    expect(deps.onPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({ tracks: [{ id: 't1', uri: 'spotify:track:t1' }] }),
    );
  });
});

describe('KokonadaSocket — reqId gating (Zombie Navigation, attack #3)', () => {
  it('delivers the freshest response and DROPS a stale one', () => {
    const { client, created, deps } = build();
    client.connect();
    const sock = created[0];

    const first = client.requestPlaylist();
    const second = client.requestPlaylist(); // user re-requested / switched context

    // stale response for the FIRST request arrives after the second was issued
    sock.fire('playlist_ready', { reqId: first, tracks: ['stale'] });
    expect(deps.onPlaylist).not.toHaveBeenCalled(); // zombie dropped

    // the fresh response renders
    sock.fire('playlist_ready', { reqId: second, tracks: ['fresh'] });
    expect(deps.onPlaylist).toHaveBeenCalledTimes(1);
    expect(deps.onPlaylist).toHaveBeenCalledWith(expect.objectContaining({ tracks: ['fresh'] }));
  });

  it('ignores a response with no/unknown reqId', () => {
    const { client, created, deps } = build();
    client.connect();
    client.requestPlaylist();
    created[0].fire('playlist_ready', { tracks: ['no-reqid'] });
    created[0].fire('playlist_ready', { reqId: 9999, tracks: ['unknown'] });
    expect(deps.onPlaylist).not.toHaveBeenCalled();
  });
});

describe('KokonadaSocket — Live-mode auto-drive (band recalibration serves the buffer)', () => {
  it('accepts a server-pushed biometric playlist with no client reqId and routes it to onPlaylist', () => {
    const { client, created, deps } = build();
    client.connect();
    // A confirmed band transition on the server pushes a buffered playlist — there is no
    // client reqId to correlate. The reqId gate must NOT drop it, or a band shift never plays.
    created[0].fire('playlist_ready', { trigger: 'biometric', buffered: true, tracks: [{ id: 'b1', uri: 'spotify:track:b1' }] });
    expect(deps.onPlaylist).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'biometric' }));
  });

  it('a biometric auto-push does NOT consume a pending manual request', () => {
    const { client, created } = build();
    client.connect();
    const sock = created[0];
    const reqId = client.requestPlaylist(); // a manual request is in flight
    sock.emitted.length = 0;
    sock.fire('playlist_ready', { trigger: 'biometric', tracks: ['auto'] }); // an auto-drive lands
    sock.fire('connect'); // reconnect: the still-pending manual request must re-issue
    expect(sock.clientEmits('request_playlist')[0]?.payload).toEqual({ reqId });
  });

  it('emits live_mode on connect reflecting the current mode (server gates auto-drive on it)', () => {
    const { client, created } = build({ getLiveMode: () => true });
    client.connect();
    expect(created[0].clientEmits('live_mode')[0]?.payload).toEqual({ enabled: true });
  });

  it('syncLiveMode emits the current live mode immediately when the toggle flips', () => {
    let live = false;
    const { client, created } = build({ getLiveMode: () => live });
    client.connect();
    const sock = created[0];
    sock.emitted.length = 0;
    live = true;
    client.syncLiveMode();
    expect(sock.clientEmits('live_mode')[0]?.payload).toEqual({ enabled: true });
  });

  it('forwards live_assembling to onAssembling (the cold-buffer loader copy)', () => {
    const onAssembling = jest.fn();
    const { client, created } = build({ onAssembling });
    client.connect();
    created[0].fire('live_assembling', { message: 'assembling your live biometric soundscape' });
    expect(onAssembling).toHaveBeenCalledWith('assembling your live biometric soundscape');
  });
});

describe('KokonadaSocket — reconnect re-hydration', () => {
  it('re-emits emotion_update on every (re)connect before a request', () => {
    const { client, created } = build();
    client.connect();
    const sock = created[0];
    expect(sock.clientEmits('emotion_update')).toHaveLength(1); // pushed on first connect

    // A transient drop: the SAME socket auto-reconnects (socket.io does this) and
    // re-fires 'connect'. The client must re-push intent, not spawn a new socket.
    sock.fire('disconnect', 'transport close');
    sock.fire('connect');
    expect(created).toHaveLength(1); // no parallel socket
    expect(sock.clientEmits('emotion_update').length).toBeGreaterThanOrEqual(2);
  });

  it('requestPlaylist emits emotion_update THEN request_playlist in order', () => {
    const { client, created } = build();
    client.connect();
    const sock = created[0];
    sock.emitted.length = 0; // clear the connect-time re-hydration emit
    client.requestPlaylist();
    expect(sock.emitted.map((e) => e.event)).toEqual(['emotion_update', 'request_playlist']);
  });
});

describe('KokonadaSocket — playlist_error', () => {
  it('invokes onGenerationError for the current request (unblocks the generation guard)', () => {
    const onGenerationError = jest.fn();
    const { client, created } = build({ onGenerationError });
    client.connect();
    const reqId = client.requestPlaylist();
    created[0].fire('playlist_error', { reqId, message: 'No tracks matched' });
    expect(onGenerationError).toHaveBeenCalledWith('No tracks matched');
  });

  it('drops a STALE playlist_error (older reqId) — a superseded request cannot show an error', () => {
    const onGenerationError = jest.fn();
    const { client, created } = build({ onGenerationError });
    client.connect();
    const first = client.requestPlaylist();
    client.requestPlaylist(); // newer request supersedes
    created[0].fire('playlist_error', { reqId: first, message: 'stale' });
    expect(onGenerationError).not.toHaveBeenCalled();
  });
});

describe('KokonadaSocket — requestHeartPlaylist', () => {
  it('emits request_heart_playlist with the HR and a reqId that gates responses', () => {
    const { client, created, deps } = build();
    client.connect();
    const sock = created[0];
    sock.emitted.length = 0;

    const reqId = client.requestHeartPlaylist(82);
    const heart = sock.emitted.find((e) => e.event === 'request_heart_playlist');
    expect(heart?.payload).toEqual({ reqId, heartRate: 82 });

    // the shared reqId counter still gates the playlist response
    sock.fire('playlist_ready', { reqId, tracks: ['h'] });
    expect(deps.onPlaylist).toHaveBeenCalledWith(expect.objectContaining({ tracks: ['h'] }));
  });

  it('a stale heart response (older reqId) is dropped', () => {
    const { client, created, deps } = build();
    client.connect();
    const first = client.requestHeartPlaylist(70);
    client.requestPlaylist(); // newer request supersedes it
    created[0].fire('playlist_ready', { reqId: first, tracks: ['stale-heart'] });
    expect(deps.onPlaylist).not.toHaveBeenCalled();
  });
});

describe('KokonadaSocket — auth_expired self-DoS defense (attack #8)', () => {
  it('refreshes the token and reconnects ONCE with the FRESH token', async () => {
    const { client, created, deps } = build();
    client.connect();
    expect(created[0].token).toBe('access-1');

    created[0].fire('auth_expired');
    await flush();

    expect(deps.refreshToken).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);            // exactly one reconnect
    expect(created[1].token).toBe('access-2');  // with the NEW token, not the dead one
    expect(deps.onLoggedOut).not.toHaveBeenCalled();
  });

  it('does NOT storm-reconnect with the dead token on the disconnect that follows auth_expired', async () => {
    const { client, created, deps } = build();
    client.connect();
    created[0].fire('auth_expired');
    created[0].fire('disconnect', 'io server disconnect'); // the server drop after auth_expired
    await flush();

    // one controlled refresh-reconnect, NOT a loop of dead-token sockets
    expect(deps.refreshToken).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(2);
    expect(created.every((s) => s.token !== 'access-1' || s === created[0])).toBe(true);
  });

  it('logs out and STOPS when the refresh fails (no infinite reconnect)', async () => {
    const { client, created, deps } = build({ refreshToken: jest.fn(async () => null) });
    client.connect();
    created[0].fire('auth_expired');
    await flush();

    expect(deps.onLoggedOut).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1); // no new socket spun up
  });
});

describe('KokonadaSocket — transient reconnects delegate to the socket (no manual storm)', () => {
  it('never spawns a parallel socket on transient disconnects', () => {
    const { client, created } = build();
    client.connect();
    // 50 transient drop/reconnect cycles on the same instance (socket.io's job)
    for (let i = 0; i < 50; i++) {
      created[0].fire('disconnect', 'transport error');
      created[0].fire('connect');
    }
    expect(created).toHaveLength(1); // the client never fought the library's backoff
  });
});

describe('KokonadaSocket — auth-refresh loop cap (self-DoS on a dying fresh token)', () => {
  it('gives up and logs out if a refreshed token keeps auth-expiring immediately', async () => {
    // refresh always yields a token that the server rejects again on connect
    const { client, created, deps } = build({
      refreshToken: jest.fn(async () => 'access-still-dead'),
      maxAuthRefreshes: 5,
      now: () => 0, // all cycles inside the window
    });
    client.connect();

    for (let i = 0; i < 20; i++) {
      created[created.length - 1].fire('auth_expired');
      await flush();
    }

    expect(deps.onLoggedOut).toHaveBeenCalled();
    expect(created.length).toBeLessThanOrEqual(7); // bounded, not 20+
  });
});

describe('KokonadaSocket — disconnect() is terminal', () => {
  it('a manual disconnect stops auto-reconnect', () => {
    const { client, created } = build();
    client.connect();
    client.disconnect();
    const n = created.length;
    created[0].fire('disconnect', 'transport close');
    expect(created.length).toBe(n); // no reconnect after an intentional close
  });
});
