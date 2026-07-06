// The Spotify App Remote is a native SDK bridge that can vanish at any instant:
// the Spotify app is swapped out, killed, loses its own auth, or the user revokes
// its background permission mid-song. EVERY one of those surfaces to JS as a
// rejected promise or a 'remoteDisconnected' event. The controller must absorb all
// of them into a clean 'disconnected' state and a {ok:false} result — never a
// fatal unhandled rejection that white-screens the app (attack #2).

import { SpotifyPlayerController, type SpotifyRemoteLike } from '../spotifyController';

class FakeRemote implements SpotifyRemoteLike {
  connected = false;
  listeners = new Map<string, Array<(...a: any[]) => void>>();
  failConnect = false;
  throwOnCommand: Error | null = null;
  played: string[] = [];
  connectAttempts = 0;

  async connect(_token: string) {
    this.connectAttempts += 1;
    if (this.failConnect) throw new Error('SPTAppRemote connection failed');
    this.connected = true;
  }
  async disconnect() { this.connected = false; }
  async isConnectedAsync() { return this.connected; }
  async playUri(uri: string) {
    if (this.throwOnCommand) throw this.throwOnCommand;
    if (!this.connected) throw new Error('not connected');
    this.played.push(uri);
  }
  async pause() { if (this.throwOnCommand) throw this.throwOnCommand; if (!this.connected) throw new Error('not connected'); }
  async resume() { if (this.throwOnCommand) throw this.throwOnCommand; if (!this.connected) throw new Error('not connected'); }
  playerState: { isPaused: boolean; track?: { uri: string } } = { isPaused: false, track: { uri: 'spotify:track:cur' } };
  throwOnState = false;
  async getPlayerState() {
    if (this.throwOnState || !this.connected) throw new Error('no state');
    return this.playerState;
  }
  addListener(event: string, cb: (...a: any[]) => void) {
    const l = this.listeners.get(event) ?? []; l.push(cb); this.listeners.set(event, l);
  }
  removeAllListeners() { this.listeners.clear(); }
  // test helper: the native side severs the connection
  sever() { this.connected = false; (this.listeners.get('remoteDisconnected') ?? []).forEach((cb) => cb()); }
}

function build(overrides: Partial<{ token: string | null; maxReconnects: number }> = {}) {
  const remote = new FakeRemote();
  const onStateChange = jest.fn();
  const onError = jest.fn();
  const controller = new SpotifyPlayerController({
    remote,
    getToken: async () => (overrides.token === undefined ? 'spotify-token' : overrides.token),
    onStateChange,
    onError,
    maxReconnects: overrides.maxReconnects ?? 2,
  });
  return { remote, controller, onStateChange, onError };
}

describe('SpotifyPlayerController — connect', () => {
  it('connects and reports connected state', async () => {
    const { controller, onStateChange } = build();
    expect(await controller.connect()).toBe(true);
    expect(controller.getState()).toBe('connected');
    expect(onStateChange).toHaveBeenCalledWith('connected');
  });

  it('a failed connect degrades to disconnected + onError, never throws', async () => {
    const { remote, controller, onError } = build();
    remote.failConnect = true;
    await expect(controller.connect()).resolves.toBe(false);
    expect(controller.getState()).toBe('disconnected');
    expect(onError).toHaveBeenCalled();
  });

  it('a null token (Spotify not linked) fails cleanly without calling the native connect', async () => {
    const { remote, controller } = build({ token: null });
    const spy = jest.spyOn(remote, 'connect');
    expect(await controller.connect()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(controller.getState()).toBe('disconnected');
  });

  it('coalesces overlapping connects into ONE native connect (no budget drain during the handshake)', async () => {
    const remote = new FakeRemote();
    let resolveConnect!: () => void;
    remote.connect = jest.fn(async () => {
      remote.connectAttempts += 1;
      await new Promise<void>((res) => { resolveConnect = res; });
      remote.connected = true;
    });
    const controller = new SpotifyPlayerController({
      remote, getToken: async () => 'spotify-token', maxReconnects: 2,
    });

    // Two plays land during the SAME still-pending native handshake.
    const p1 = controller.play('spotify:track:a');
    const p2 = controller.play('spotify:track:b');
    await new Promise((r) => setTimeout(r, 0)); // let the shared connect reach its pending point
    resolveConnect();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(remote.connect).toHaveBeenCalledTimes(1);        // ONE native connect, shared
    expect(r1.ok && r2.ok).toBe(true);                      // both plays succeed once connected
    expect([...remote.played].sort()).toEqual(['spotify:track:a', 'spotify:track:b']); // both played (order incidental)
  });
});

describe('SpotifyPlayerController — playback', () => {
  it('plays a uri when connected', async () => {
    const { remote, controller } = build();
    await controller.connect();
    expect(await controller.play('spotify:track:abc')).toEqual({ ok: true });
    expect(remote.played).toContain('spotify:track:abc');
  });

  it('FUZZ: play with garbage uris never throws', async () => {
    const { controller } = build();
    await controller.connect();
    for (const uri of ['', null as any, undefined as any, 123 as any, {} as any]) {
      await expect(controller.play(uri)).resolves.toEqual(expect.objectContaining({ ok: expect.any(Boolean) }));
    }
  });
});

describe('SpotifyPlayerController — severance (attack #2)', () => {
  it('a command that throws mid-song (app killed) degrades gracefully, no fatal throw', async () => {
    const { remote, controller, onError } = build();
    await controller.connect();
    remote.throwOnCommand = new Error('SPTAppRemote lost connection');

    const result = await controller.play('spotify:track:x');
    expect(result).toEqual({ ok: false });
    expect(controller.getState()).toBe('disconnected');
    expect(onError).toHaveBeenCalled();
  });

  it('the native remoteDisconnected event flips state to disconnected + emits severance', async () => {
    const { remote, controller, onStateChange } = build();
    await controller.connect();
    onStateChange.mockClear();

    remote.sever(); // Spotify app swapped out / killed mid-song
    expect(controller.getState()).toBe('disconnected');
    expect(onStateChange).toHaveBeenCalledWith('disconnected');
  });

  it('revoking Spotify background permission (auth error on every command) never crashes', async () => {
    const { remote, controller } = build();
    await controller.connect();
    remote.throwOnCommand = new Error('AUTHENTICATION_SERVICE_UNAVAILABLE');
    await expect(controller.play('spotify:track:x')).resolves.toEqual({ ok: false });
    await expect(controller.pause()).resolves.toEqual({ ok: false });
    await expect(controller.resume()).resolves.toEqual({ ok: false });
    expect(controller.getState()).toBe('disconnected');
  });
});

describe('SpotifyPlayerController — getPlaybackState (foreground reconcile)', () => {
  it('maps the native player state to { isPlaying, uri }', async () => {
    const { remote, controller } = build();
    await controller.connect();
    remote.playerState = { isPaused: false, track: { uri: 'spotify:track:xyz' } };
    expect(await controller.getPlaybackState()).toEqual({ isPlaying: true, uri: 'spotify:track:xyz' });
    remote.playerState = { isPaused: true, track: { uri: 'spotify:track:xyz' } };
    expect(await controller.getPlaybackState()).toEqual({ isPlaying: false, uri: 'spotify:track:xyz' });
  });

  it('returns disconnected when not connected or the remote throws', async () => {
    const { remote, controller } = build();
    expect(await controller.getPlaybackState()).toBe('disconnected'); // never connected
    await controller.connect();
    remote.throwOnState = true;
    expect(await controller.getPlaybackState()).toBe('disconnected'); // remote gone
  });
});

describe('SpotifyPlayerController — reconnect after severance', () => {
  it('recovers on the next play after the remote comes back', async () => {
    const { remote, controller } = build();
    await controller.connect();
    remote.sever();
    expect(controller.getState()).toBe('disconnected');

    // remote is available again; a play call transparently reconnects
    const result = await controller.play('spotify:track:back');
    expect(result).toEqual({ ok: true });
    expect(controller.getState()).toBe('connected');
    expect(remote.played).toContain('spotify:track:back');
  });

  it('a permanently-severed remote does not loop forever — reconnects are capped', async () => {
    const { remote, controller } = build({ maxReconnects: 2 });
    await controller.connect();
    remote.failConnect = true; // reconnect will always fail now
    remote.sever();

    for (let i = 0; i < 10; i++) await controller.play('spotify:track:x');
    // bounded reconnect attempts, still no crash, still disconnected
    expect(controller.getState()).toBe('disconnected');
    expect(remote.connectAttempts).toBeLessThanOrEqual(3); // initial + capped retries
  });
});
