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
    // A churn: disconnect + reconnect with NO response having arrived. Only a transient drop brings the
    // SAME socket back; a server disconnect destroys it (socket.io-client socket.js:639-643), RA-6.
    sock.fire('disconnect', 'transport close');
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

  it('FINALIZES the prompt at the wire — the emitted intent is trimmed even when the live store keeps surrounding spaces (Bug 2)', () => {
    // The cold store keeps the prompt verbatim WHILE typing (so spaces never glue); the
    // submit path is the single place the prompt is finalized (.trim()). Internal spaces
    // must survive — only the leading/trailing padding is stripped as it leaves for the wire.
    const { client, created } = build({
      getEmotionIntent: () => ({ taps: [], textPrompt: '   hello world foo   ', activity: null }),
    });
    client.connect();
    const sock = created[0];
    sock.emitted.length = 0;
    client.requestPlaylist();
    const emotion = sock.emitted.find((e) => e.event === 'emotion_update');
    expect(emotion?.payload.textPrompt).toBe('hello world foo');
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

describe('KokonadaSocket — playlist_building (onboarding graceful loading, D-6)', () => {
  function buildBuilding(overrides: any = {}) {
    const scheduled: Array<() => void> = [];
    const setTimer = jest.fn((fn: () => void) => { scheduled.push(fn); return scheduled.length; });
    const clearTimer = jest.fn();
    const onBuilding = jest.fn();
    const onGenerationError = jest.fn();
    const { client, created } = build({
      setTimer, clearTimer, onBuilding, onGenerationError, buildingRetryMs: 1000, maxBuildingRetries: 3, ...overrides,
    });
    client.connect();
    return { client, sock: created[0], scheduled, setTimer, clearTimer, onBuilding, onGenerationError };
  }

  it('shows the building loader and auto-retries the SAME request — never a hard error', () => {
    const { client, sock, scheduled, onBuilding, onGenerationError } = buildBuilding();
    const reqId = client.requestPlaylist();
    sock.emitted.length = 0; // ignore the initial request emit

    sock.fire('playlist_building', { reqId, message: 'Setting up your library…' });

    expect(onBuilding).toHaveBeenCalledWith('Setting up your library…');
    expect(onGenerationError).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);            // a retry was scheduled
    scheduled[0]();                                // fire the timer
    expect(sock.clientEmits('request_playlist').map((e) => e.payload.reqId)).toContain(reqId);
  });

  it('gives up with a soft error once the retry budget is exhausted', () => {
    const { client, sock, scheduled, onGenerationError } = buildBuilding({ maxBuildingRetries: 2 });
    const reqId = client.requestPlaylist();
    for (let i = 0; i < 3; i++) {
      sock.fire('playlist_building', { reqId, message: 'building' });
      if (scheduled[i]) scheduled[i]();
    }
    expect(onGenerationError).toHaveBeenCalled();
  });

  it('a playlist_ready after building stops the retry loop (no stale re-emit)', () => {
    const { client, sock, scheduled, clearTimer } = buildBuilding();
    const reqId = client.requestPlaylist();
    sock.fire('playlist_building', { reqId });
    expect(scheduled).toHaveLength(1);

    sock.fire('playlist_ready', { reqId, tracks: [] });
    sock.emitted.length = 0;
    scheduled[0](); // a now-stale timer fires — must NOT re-emit (pending cleared)
    expect(sock.clientEmits('request_playlist')).toHaveLength(0);
    expect(clearTimer).toHaveBeenCalled();
  });

  it('ignores a stale playlist_building (superseded reqId)', () => {
    const { client, sock, onBuilding } = buildBuilding();
    client.requestPlaylist(); // reqId 1
    client.requestPlaylist(); // reqId 2 (latest)
    sock.fire('playlist_building', { reqId: 1, message: 'stale' });
    expect(onBuilding).not.toHaveBeenCalled();
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

// RA-6 (S1): a socket socket.io will never bring back must not stay in this.socket, where ensureOpen()
// trusts it. The Manager's give-up reaches the port as 'reconnect_failed' (socketFactory.ts).
describe('KokonadaSocket — a socket that will never come back is dropped (RA-6)', () => {
  const listening = (s: FakeSocket) => [...s.handlers.values()].some((l) => l.length > 0);

  it('reconnect_failed (the Manager spent its attempts): the socket is dropped, and the next request opens a new one on the current token, no refresh', () => {
    const statuses: string[] = [];
    const { client, created, deps } = build({ onConnectionChange: (s: string) => statuses.push(s) });
    client.connect();
    created[0].fire('disconnect', 'transport close');
    created[0].fire('reconnect_failed');
    expect(listening(created[0])).toBe(false);
    expect(statuses[statuses.length - 1]).toBe('disconnected');
    const reqId = client.requestPlaylist();
    expect(created.map((s) => s.token)).toEqual(['access-1', 'access-1']);
    expect(created[1].clientEmits('request_playlist').map((e) => e.payload)).toContainEqual({ reqId });
    expect(deps.refreshToken).not.toHaveBeenCalled();
  });

  it('a transport connect_error is transient: the socket stays (the Manager retries it) and nothing reopens', () => {
    const { client, created } = build();
    client.connect();
    created[0].fire('connect_error', Object.assign(new Error('xhr poll error'), { type: 'TransportError' }));
    client.requestPlaylist();
    expect(created).toHaveLength(1);
    expect(listening(created[0])).toBe(true);
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

  // RA-5 = MB-016: a disconnect() is the account boundary, so the request state ends with it.
  it('ends the pending heart request and the reqId gate: the next connect re-sends nothing, and a late reply is dropped', () => {
    const { client, created, deps } = build();
    client.connect();
    const reqA = client.requestHeartPlaylist(88);
    client.disconnect();
    client.connect();
    expect(created[1].clientEmits('request_heart_playlist')).toEqual([]);
    created[1].fire('playlist_ready', { reqId: reqA, tracks: ['late'] });
    expect(deps.onPlaylist).not.toHaveBeenCalled();
  });

  // The auth-refresh cap counts one account's storm: the next account starts with its own budget.
  it('ends the auth-refresh window: a storm that hit the cap before the close does not stop the next session\'s first refresh', async () => {
    const { client, created, deps } = build({ refreshToken: jest.fn(async () => 'access-fresh'), isSessionActive: () => true, maxAuthRefreshes: 2, now: () => 0 });
    client.connect();
    for (let i = 0; i < 3; i++) { created[created.length - 1].fire('auth_expired'); await flush(); } // the third is over the cap
    expect(created).toHaveLength(3);
    client.disconnect();
    client.connect();
    const opened = created.length;
    created[opened - 1].fire('auth_expired');
    await flush();
    expect(created).toHaveLength(opened + 1); // refreshed and reopened, not capped
    expect(deps.refreshToken).toHaveBeenCalledTimes(3);
  });
});

// RA-45 (S0, QA-096, trigger T1) and RA-47 (S3), the B1 QA brief: babel strips no console call, so
// a release build writes every console argument to logcat. A heart-rate value, and the server's
// free text (an error message can carry an upstream error's text), must never be one of them.
describe('KokonadaSocket — the logs carry no health value and no server free text (RA-45, RA-47)', () => {
  afterEach(() => { jest.restoreAllMocks(); });
  function spyLogs() {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    return { log, warn, all: () => [...log.mock.calls, ...warn.mock.calls].flat().map((a) => String(a)) };
  }

  it('requestHeartPlaylist(72) logs whether a heart rate is present, never the number', () => {
    const logs = spyLogs();
    const { client, created } = build();
    client.connect();
    client.requestHeartPlaylist(72);
    expect(created[0].clientEmits('request_heart_playlist')[0].payload.heartRate).toBe(72); // the wire still carries it
    expect(logs.all().some((a) => a.includes('72'))).toBe(false);
    expect(logs.log.mock.calls.some((c) => c.includes('hasHr='))).toBe(true);
  });

  it('connect_error logs a fixed code, never the error\'s own text', () => {
    const logs = spyLogs();
    const { client, created } = build();
    client.connect();
    created[0].fire('connect_error', Object.assign(new Error('xhr poll error: secret-host-detail'), { type: 'TransportError' }));
    created[0].fire('connect_error', new Error('user 5f2a not found: grief on a tuesday'));
    created[0].fire('connect_error', undefined);
    created[0].fire('connect_error', new Error('unauthorized')); // last: a refusal drops the socket (RA-6)
    expect(logs.all().some((a) => /secret-host-detail|5f2a|grief/.test(a))).toBe(false);
    expect(logs.warn.mock.calls).toEqual([
      ['[koko] socket connect_error:', 'transport'],
      ['[koko] socket connect_error:', 'other'],
      ['[koko] socket connect_error:', 'other'],
      ['[koko] socket connect_error:', 'unauthorized'],
    ]);
  });

  it('playlist_error and playlist_building log whether a message came, never its text', () => {
    const logs = spyLogs();
    const { client, created } = build({ onGenerationError: jest.fn(), onBuilding: jest.fn(), setTimer: jest.fn(), clearTimer: jest.fn() });
    client.connect();
    const building = client.requestPlaylist();
    created[0].fire('playlist_building', { reqId: building, message: 'MARKER-building-text' });
    const failed = client.requestPlaylist();
    created[0].fire('playlist_error', { reqId: failed, message: 'Token refresh failed: MARKER-upstream-text' });
    expect(logs.all().some((a) => a.includes('MARKER'))).toBe(false);
  });
});

// C4 (B1 charter §6 item 4): a refresh that comes back null while the session still holds its
// pair was `unavailable` (C1), not a dead session: the socket must not log the user out, and must
// not stay wedged on its dead socket either. reconnect() is the recovery: refresh, then open.
describe('KokonadaSocket — an unavailable refresh is not a logout; reconnect() recovers (C4)', () => {
  const noListeners = (s: FakeSocket) => [...s.handlers.values()].every((l) => l.length === 0);
  function buildC4(answers: Array<string | null>, sessionActive = true) {
    const refreshToken = jest.fn(async () => (answers.length ? answers.shift()! : null));
    const statuses: string[] = [];
    const built = build({ refreshToken, isSessionActive: () => sessionActive, onConnectionChange: (s: string) => statuses.push(s) });
    return { ...built, refreshToken, statuses };
  }

  it('auth_expired whose refresh is unavailable: no logout, no new socket, the dead socket is torn down, the badge reads disconnected', async () => {
    const { client, created, deps, statuses } = buildC4([null]);
    client.connect();
    created[0].fire('auth_expired');
    await flush();
    expect(deps.onLoggedOut).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(noListeners(created[0])).toBe(true);
    expect(statuses[statuses.length - 1]).toBe('disconnected');
  });

  it('reconnect() after it: a fresh socket on the refreshed token, and the pending request is re-sent there', async () => {
    const { client, created, refreshToken } = buildC4([null, 'access-3']);
    client.connect();
    const reqId = client.requestPlaylist();
    created[0].fire('auth_expired');
    await flush();
    await client.reconnect();
    expect(refreshToken).toHaveBeenCalledTimes(2);
    expect(created.map((s) => s.token)).toEqual(['access-1', 'access-3']);
    expect(created[1].clientEmits('request_playlist').map((e) => e.payload)).toContainEqual({ reqId });
  });

  it('the next request after it goes through a refresh, never through the dead token', async () => {
    const { client, created, refreshToken } = buildC4([null, 'access-3']);
    client.connect();
    created[0].fire('auth_expired');
    await flush();
    const reqId = client.requestPlaylist(); // ensureOpen: no live socket, and its access token was refused
    await flush();
    expect(refreshToken).toHaveBeenCalledTimes(2);
    expect(created.map((s) => s.token)).toEqual(['access-1', 'access-3']);
    expect(created[1].clientEmits('request_playlist').map((e) => e.payload)).toContainEqual({ reqId });
  });

  it('reconnect() when the session is dead logs out once and opens nothing', async () => {
    const { client, created, deps } = buildC4([null], false);
    await client.reconnect();
    expect(deps.onLoggedOut).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
  });

  it('reconnect() is single-flight: two calls while the refresh is pending refresh once and open one socket', async () => {
    let release!: (v: string | null) => void;
    const refreshToken = jest.fn(() => new Promise<string | null>((r) => { release = r; }));
    const { client, created } = build({ refreshToken, isSessionActive: () => true });
    const a = client.reconnect();
    const b = client.reconnect();
    release('access-3');
    await Promise.all([a, b]);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });

  it('a disconnect() while reconnect() waits on the refresh wins: nothing opens afterwards', async () => {
    let release!: (v: string | null) => void;
    const refreshToken = jest.fn(() => new Promise<string | null>((r) => { release = r; }));
    const { client, created, deps } = build({ refreshToken, isSessionActive: () => true });
    const pending = client.reconnect();
    client.disconnect(); // the user signs out mid-refresh
    release('access-3');
    await pending;
    expect(created).toHaveLength(0);
    expect(deps.onLoggedOut).not.toHaveBeenCalled();
  });

  // ARCH-309-1 = RA-1: disconnect() kept `recovery`, so after a sign-out while the socket waited on a
  // refresh, ensureOpen() and reconnect() kept answering with that dead run: the next account got no socket.
  it('a disconnect() while reconnect() waits on a refresh that never answers: ensureOpen() opens on the next account\'s token', () => {
    let token = 'access-1';
    const refreshToken = jest.fn(() => new Promise<string | null>(() => {})); // never settles
    const { client, created } = build({ refreshToken, getAccessToken: () => token, isSessionActive: () => true });
    client.connect();
    created[0].fire('auth_expired'); // reconnect(): the refresh is in flight for good
    client.disconnect(); // the user signs out
    token = 'access-b'; // and account B signs in
    client.ensureOpen();
    expect(created.map((s) => s.token)).toEqual(['access-1', 'access-b']);
  });

  it('reconnect() after a disconnect() starts a run of its own: it never returns the run the close abandoned', () => {
    const refreshToken = jest.fn(() => new Promise<string | null>(() => {})); // never settles
    const { client, created } = build({ refreshToken, isSessionActive: () => true });
    client.connect();
    created[0].fire('auth_expired');
    client.disconnect();
    void client.reconnect();
    expect(refreshToken).toHaveBeenCalledTimes(2);
  });

  it('reconnect() on a live socket replaces it: the old one is torn down and disconnected', async () => {
    const { client, created } = buildC4(['access-3']);
    client.connect();
    await client.reconnect();
    expect(created.map((s) => s.token)).toEqual(['access-1', 'access-3']);
    expect(created[0].disconnectCalls).toBeGreaterThan(0);
    expect(noListeners(created[0])).toBe(true);
  });

  it('the auth-refresh loop cap stops the loop without ending a live session, and leaves no socket listening', async () => {
    const { client, created, deps } = build({
      refreshToken: jest.fn(async () => 'access-still-dead'),
      isSessionActive: () => true,
      maxAuthRefreshes: 5,
      now: () => 0,
    });
    client.connect();
    for (let i = 0; i < 20; i++) {
      created[created.length - 1].fire('auth_expired');
      await flush();
    }
    expect(deps.onLoggedOut).not.toHaveBeenCalled();
    expect(created.length).toBeLessThanOrEqual(7);
    expect(created.every(noListeners)).toBe(true);
  });
});
