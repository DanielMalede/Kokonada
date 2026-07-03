// Suspect #4 (QA4 — Network Resilience): SpotifyPlayerController supports an
// onStateChange callback, but the production `player` singleton omitted it, so the
// Spotify connection status was unobservable — no screen could show a live badge.
// The controller is wired to push transitions into this store; here we prove the
// controller→store bridge reflects every transition exactly once per change.

import { SpotifyPlayerController, type SpotifyRemoteLike } from '../spotifyController';
import { createPlayerStatusStore } from '../playerStatusStore';

function fakeRemote(overrides: Partial<SpotifyRemoteLike> = {}): SpotifyRemoteLike {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnectedAsync: jest.fn().mockResolvedValue(false),
    playUri: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn().mockResolvedValue(undefined),
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
    ...overrides,
  };
}

describe('playerStatusStore', () => {
  it('defaults to disconnected', () => {
    expect(createPlayerStatusStore().getState().status).toBe('disconnected');
  });

  it('mirrors controller state transitions (connecting → connected → disconnected)', async () => {
    const store = createPlayerStatusStore();
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.status));

    const remote = fakeRemote();
    const controller = new SpotifyPlayerController({
      remote,
      getToken: async () => 'spotify-token',
      onStateChange: (s) => store.getState().set(s),
    });

    await controller.connect();
    expect(store.getState().status).toBe('connected');
    // connecting was emitted before connected
    expect(seen).toContain('connecting');
    expect(seen[seen.length - 1]).toBe('connected');

    await controller.dispose();
    expect(store.getState().status).toBe('disconnected');
  });

  it('reflects a failed connect (no token → disconnected) without throwing', async () => {
    const store = createPlayerStatusStore();
    const controller = new SpotifyPlayerController({
      remote: fakeRemote(),
      getToken: async () => null, // Spotify not linked
      onStateChange: (s) => store.getState().set(s),
    });
    await controller.connect();
    expect(store.getState().status).toBe('disconnected');
  });
});
