import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We import the module AFTER setting up window.Spotify so the singleton gets a
// fresh start each test — we reset it by calling destroy() in afterEach.
vi.mock('../hooks/useSocket', () => ({ useSocket: vi.fn() }));

function makeMockPlayer() {
  return {
    connect:      vi.fn().mockResolvedValue(true),
    disconnect:   vi.fn(),
    pause:        vi.fn().mockResolvedValue(undefined),
    resume:       vi.fn().mockResolvedValue(undefined),
    nextTrack:    vi.fn().mockResolvedValue(undefined),
    _listeners:   {} as Record<string, ((data: unknown) => void)[]>,
    addListener(event: string, cb: (data: unknown) => void) {
      this._listeners[event] = this._listeners[event] ?? [];
      this._listeners[event].push(cb);
      return true;
    },
    removeListener: vi.fn().mockReturnValue(true),
    _emit(event: string, data: unknown) {
      (this._listeners[event] ?? []).forEach(cb => cb(data));
    },
  };
}

describe('SpotifyPlayerService', () => {
  let mockPlayer: ReturnType<typeof makeMockPlayer>;

  beforeEach(() => {
    mockPlayer = makeMockPlayer();
    (global as unknown as { Spotify: unknown }).Spotify = {
      Player: vi.fn().mockImplementation(() => mockPlayer),
    };
  });

  afterEach(async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    spotifyPlayerService.destroy();
    vi.resetModules();
  });

  it('init connects the SDK player', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    expect(mockPlayer.connect).toHaveBeenCalledOnce();
  });

  it('emits deviceId when SDK fires ready event', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    const cb = vi.fn();
    spotifyPlayerService.onStateChange(cb);

    await spotifyPlayerService.init(async () => 'test_token');
    mockPlayer._emit('ready', { device_id: 'dev_xyz' });

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: 'dev_xyz',
      isReady: true,
    }));
    expect(spotifyPlayerService.getDeviceId()).toBe('dev_xyz');
  });

  it('emits isPaused=false when player_state_changed fires with paused=false', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    const cb = vi.fn();
    spotifyPlayerService.onStateChange(cb);

    await spotifyPlayerService.init(async () => 'test_token');
    mockPlayer._emit('player_state_changed', {
      paused: false,
      position: 5000,
      duration: 210000,
      track_window: { current_track: { uri: 'spotify:track:abc' } },
    });

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      isPaused: false,
      positionMs: 5000,
      durationMs: 210000,
    }));
  });

  it('emits currentTrackUri from player_state_changed', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    const cb = vi.fn();
    spotifyPlayerService.onStateChange(cb);

    await spotifyPlayerService.init(async () => 'test_token');
    mockPlayer._emit('player_state_changed', {
      paused: false,
      position: 5000,
      duration: 210000,
      track_window: { current_track: { uri: 'spotify:track:abc' } },
    });

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ currentTrackUri: 'spotify:track:abc' }));
  });

  it('emits currentTrackUri=null when track_window is absent', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    const cb = vi.fn();
    spotifyPlayerService.onStateChange(cb);

    await spotifyPlayerService.init(async () => 'test_token');
    mockPlayer._emit('player_state_changed', { paused: true, position: 0, duration: 0 });

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ currentTrackUri: null }));
  });

  it('pause() delegates to player.pause()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.pause();
    expect(mockPlayer.pause).toHaveBeenCalledOnce();
  });

  it('resume() delegates to player.resume()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.resume();
    expect(mockPlayer.resume).toHaveBeenCalledOnce();
  });

  it('nextTrack() delegates to player.nextTrack()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.nextTrack();
    expect(mockPlayer.nextTrack).toHaveBeenCalledOnce();
  });

  it('destroy() disconnects and resets state', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    spotifyPlayerService.destroy();
    expect(mockPlayer.disconnect).toHaveBeenCalledOnce();
    expect(spotifyPlayerService.getDeviceId()).toBeNull();
  });

  it('init() is a no-op if called again before destroy()', async () => {
    const { spotifyPlayerService } = await import('../services/spotifyPlayer');
    await spotifyPlayerService.init(async () => 'test_token');
    await spotifyPlayerService.init(async () => 'test_token');
    expect(mockPlayer.connect).toHaveBeenCalledOnce(); // not twice
  });
});
