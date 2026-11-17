/// <reference types="node" />
import * as path from 'path';
import { SpotifyRemote } from '@kokonada/spotify-remote';
import { SpotifyPlayerController, type PlayerState } from '../../experience/player/spotifyController';
import { spotifyRemoteAdapter, getSpotifyReadiness } from '../../experience/player/spotifyRemoteAdapter';
import { installSpotifyFake, type SpotifyFake } from '../spotify';
import { loadMutant } from '../mutant';
import { APP_ROOT } from '../guards/productionImports';

// Planting a mutant loads @babel/core inside the test VM on first use (src/testing/mutant.ts); under
// full-suite worker contention that cold load overran the 5 s default (q3-final-jest run file).
jest.setTimeout(30000);

// QA-048: page tests drive the player through a stateful fake covering not installed, not logged in or
// not authorised, connecting, connected, foreign track, remote disconnected and command failure. The
// global mock (jest.setup.js:83-103) fixes one state (not installed, disconnected), so an un-overridden
// page test sees one state. The fake replaces the native module's members (capture-and-restore) and
// answers as SpotifyRemoteModule.kt does (error codes :128-135, :202-223, :233-310); the code under
// test is the real adapter and the real SpotifyPlayerController.
// "No on-demand" (QA-123) and "another active device" (QA-124) have no signal in the native module or
// the controller today, so the fake does not invent one: those states are owed at P2's G0.

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

let fake: SpotifyFake;
beforeEach(() => { fake = installSpotifyFake(); });
afterEach(() => { spotifyRemoteAdapter.removeAllListeners?.(); fake.restore(); });

function controller(onRemoteState?: (s: { uri: string | null; isPaused: boolean }) => void) {
  const states: PlayerState[] = [];
  const c = new SpotifyPlayerController({
    remote: spotifyRemoteAdapter,
    getToken: getSpotifyReadiness,
    onStateChange: (s) => states.push(s),
    onRemoteState,
  });
  return { c, states };
}
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

describe('QA-048 · every player state through the real adapter and controller', () => {
  it('not installed: the readiness gate stops the connect; a play issues 0 commands', async () => {
    fake.set({ installed: false });
    const { c, states } = controller();
    expect(await c.play('spotify:track:1')).toEqual({ ok: false, reason: 'disconnected' });
    expect(states).toEqual(['connecting', 'disconnected']);
    expect(fake.commands()).toEqual([]);
    expect(fake.calls('connect')).toBe(0);
  });

  it('not installed at the native level: connect rejects SPOTIFY_NOT_INSTALLED', async () => {
    fake.set({ installed: false });
    await expect(SpotifyRemote.connect()).rejects.toMatchObject({ code: 'SPOTIFY_NOT_INSTALLED' });
  });

  it.each(['not_logged_in', 'not_authorized'] as const)('%s: one authorize() then a connect; the play lands', async (account) => {
    fake.set({ account });
    const { c } = controller();
    expect(await c.play('spotify:track:1')).toEqual({ ok: true });
    expect(fake.calls('authorize')).toBe(1);
    expect(fake.commands()).toEqual([{ name: 'playUri', args: ['spotify:track:1'] }]);
  });

  it('authorization cancelled: the connect fails and the controller is disconnected', async () => {
    fake.set({ account: 'not_logged_in', authorize: 'cancel' });
    const { c, states } = controller();
    expect(await c.connect()).toBe(false);
    expect(states).toEqual(['connecting', 'disconnected']);
  });

  it('connecting: a held handshake keeps the controller connecting until it completes', async () => {
    fake.set({ connect: 'hold' });
    const { c, states } = controller();
    const pending = c.connect();
    await settle();
    expect(c.getState()).toBe('connecting');
    fake.completeConnect();
    expect(await pending).toBe(true);
    expect(states).toEqual(['connecting', 'connected']);
  });

  it('connected: a play reaches the native player and its state comes back through playerStateChanged', async () => {
    const seen: Array<string | null> = [];
    const { c } = controller((s) => seen.push(s.uri));
    await c.play('spotify:track:1');
    expect(fake.player()).toEqual({ trackUri: 'spotify:track:1', isPaused: false });
    expect(seen).toEqual(['spotify:track:1']);
    expect(await c.getPlaybackState()).toEqual({ isPlaying: true, uri: 'spotify:track:1' });
  });

  it('foreign track: a track started inside Spotify reaches onRemoteState', async () => {
    const seen: Array<string | null> = [];
    const { c } = controller((s) => seen.push(s.uri));
    await c.play('spotify:track:1');
    fake.playForeign('spotify:track:not-ours');
    expect(seen).toEqual(['spotify:track:1', 'spotify:track:not-ours']);
  });

  it('remote disconnected: sever() degrades the controller in place and never authorizes (QA-125\'s controller half)', async () => {
    const { c, states } = controller();
    await c.play('spotify:track:1');
    fake.sever();
    expect(states[states.length - 1]).toBe('disconnected');
    expect(fake.calls('authorize')).toBe(0);
    await expect(SpotifyRemote.pause()).rejects.toMatchObject({ code: 'CONNECTION_FAILED' });
  });

  it('command failure: a scripted refusal is a command_failed, not a severance', async () => {
    const { c } = controller();
    await c.connect();
    fake.failNext('playUri');
    expect(await c.play('spotify:track:dead')).toEqual({ ok: false, reason: 'command_failed' });
  });

  it('a transient CONNECTION_FAILED at connect is a failure the controller survives', async () => {
    fake.set({ connect: 'fail' });
    const { c } = controller();
    expect(await c.connect()).toBe(false);
    fake.set({ connect: 'ok' });
    expect(await c.connect()).toBe(true);
  });
});

describe('QA-048 · listener counts', () => {
  it('the controller\'s two native listeners are live while it lives, and dispose() removes them', async () => {
    const { c } = controller(() => {});
    expect(fake.liveListeners()).toEqual({ remoteDisconnected: 1, playerStateChanged: 1 });
    await c.dispose();
    expect(fake.liveListeners()).toEqual({ remoteDisconnected: 0, playerStateChanged: 0 });
  });

  it('planted: the adapter with one unsubscribe removed (in memory) leaves a native listener live after dispose', async () => {
    const { spotifyRemoteAdapter: mutant } = loadMutant<typeof import('../../experience/player/spotifyRemoteAdapter')>(
      path.join(APP_ROOT, 'src/experience/player/spotifyRemoteAdapter.ts'),
      [{ find: 'offPlayerState?.(); offPlayerState = null;', replace: 'offPlayerState = null;' }],
      require,
    );
    const c = new SpotifyPlayerController({ remote: mutant, getToken: getSpotifyReadiness, onRemoteState: () => {} });
    await c.dispose();
    expect(fake.liveListeners().playerStateChanged).toBe(1);
    expect(() => fake.assertNoLiveListeners()).toThrow(/playerStateChanged: 1/);
  });

  it('restore() puts the global mock back by identity', () => {
    const before = SpotifyRemote.connect;
    fake.restore();
    const restored = SpotifyRemote.connect;
    expect(restored).not.toBe(before);
    expect(jest.isMockFunction(restored)).toBe(true);
    fake = installSpotifyFake();
  });
});
