import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// CI-starvation headroom (issue #84). The first create(<ProfileScreen/>) in this file pays the
// one-time cold-require cost of the whole ProfileScreen module tree inside the jest worker. On
// resource-constrained CI runners (≈4 cores, many suites per worker) that first async-render
// act() flush occasionally exceeds jest's 5000 ms default; a timed-out act() then leaves
// react-test-renderer unable to commit, cascading the remaining tests to empty-render failures
// (reproduced exactly with --testTimeout=1). There is NO product race — the screen shows a '—'
// placeholder until loadProfile() resolves (correct async load). PR #97 fixed flush *ordering*;
// this gives the tail adequate wall-clock so starvation can't trip the default ceiling.
jest.setTimeout(20000);

jest.mock('../profileServices', () => ({
  profileController: {
    loadProfile: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    deleteAccount: jest.fn().mockResolvedValue({ ok: true, data: {} }),
    disconnectYouTube: jest.fn().mockResolvedValue({ ok: true, data: { rebuilt: true, provider: 'spotify', library: 240 } }),
    getSpotifyConnectToken: jest.fn(),
  },
}));

import { Linking } from 'react-native';
import { ProfileScreen } from '../ProfileScreen';
import { profileController } from '../profileServices';
import { playerStatusStore } from '../../player/playerStatusStore';
import { warmStore } from '../../../state/store';

const loadProfile = profileController.loadProfile as jest.Mock;
const logout = profileController.logout as jest.Mock;
const deleteAccount = profileController.deleteAccount as jest.Mock;
const disconnectYouTube = profileController.disconnectYouTube as jest.Mock;

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(<ProfileScreen />); });
  // Flush the mount effect's async loadProfile().then(setSnap) chain deterministically.
  // A single act() around create() does NOT reliably drain a resolved-promise → setSnap →
  // re-render chain, which intermittently failed the auth-critical "identity from /me"
  // assertion in CI (issue #84). A setImmediate macrotask boundary empties the ENTIRE
  // microtask queue first (the resolved promise, its .then, and React's scheduled update),
  // and the surrounding act() commits the result — deterministic across Node/scheduler timing.
  await ReactTestRenderer.act(async () => { await new Promise((resolve) => setImmediate(resolve)); });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  loadProfile.mockResolvedValue({
    me: { id: 'u1', displayName: 'Dan Malede', email: 'd@x.io', wearableProvider: null },
    integrations: { spotifyConnected: false },
  });
});

describe('ProfileScreen', () => {
  it('renders the identity from /me', async () => {
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Dan Malede');
    expect(all).toContain('d@x.io');
    expect(all).toContain('Log out');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reflects a live Spotify connection from the player status store', async () => {
    await ReactTestRenderer.act(async () => { playerStatusStore.getState().set('connected'); });
    const tree = await render();
    const all = texts(tree.toJSON()).join(' ');
    expect(all).toContain('Connected');
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    await ReactTestRenderer.act(async () => { playerStatusStore.getState().set('disconnected'); });
  });

  it('unsubscribes from every store on unmount (parity)', async () => {
    let subs = 0; let unsubs = 0;
    const realPlayer = playerStatusStore.subscribe.bind(playerStatusStore);
    const realWarm = warmStore.subscribe.bind(warmStore);
    const p = jest.spyOn(playerStatusStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realPlayer(cb); return () => { unsubs++; u(); }; });
    const w = jest.spyOn(warmStore, 'subscribe').mockImplementation((cb: any) => { subs++; const u = realWarm(cb); return () => { unsubs++; u(); }; });
    const tree = await render();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
    p.mockRestore(); w.mockRestore();
    expect(subs).toBeGreaterThan(0);
    expect(unsubs).toBe(subs);
  });

  const byLabel = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
    tree.root.findAll((n) => n.props.accessibilityLabel === label)[0];

  it('the delete flow requires a confirmation step before calling the server', async () => {
    const tree = await render();
    expect(deleteAccount).not.toHaveBeenCalled();
    // First press only opens the confirm panel — no server call yet.
    await ReactTestRenderer.act(async () => { byLabel(tree, 'delete-account').props.onPress(); });
    expect(deleteAccount).not.toHaveBeenCalled();
    // The explicit confirmation is what actually calls the server.
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'delete-confirm').props.onPress(); });
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('shows a YouTube Disconnect button when connected and routes it through the controller', async () => {
    loadProfile.mockResolvedValue({
      me: { id: 'u1', displayName: 'Dan', email: 'd@x.io', wearableProvider: null },
      integrations: { spotifyConnected: true, youtubeConnected: true },
    });
    const tree = await render();
    expect(texts(tree.toJSON()).join(' ')).toContain('YouTube Music');
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'disconnect-youtube').props.onPress(); });
    expect(disconnectYouTube).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('hides the YouTube row when YouTube is not connected', async () => {
    const tree = await render(); // beforeEach integrations has no youtubeConnected
    expect(tree.root.findAll((n) => n.props.accessibilityLabel === 'disconnect-youtube')).toHaveLength(0);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('logout routes through the controller', async () => {
    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'log-out').props.onPress(); });
    expect(logout).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('connect-spotify opens the OAuth URL with returnTo=app so the callback deep-links back into the app', async () => {
    await ReactTestRenderer.act(async () => { playerStatusStore.getState().set('disconnected'); });
    (profileController.getSpotifyConnectToken as jest.Mock).mockResolvedValue('ct-token');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);

    const tree = await render();
    await ReactTestRenderer.act(async () => { await byLabel(tree, 'connect-spotify').props.onPress(); });

    expect(openURL).toHaveBeenCalledTimes(1);
    const url = openURL.mock.calls[0][0];
    expect(url).toContain('/api/integrations/spotify/connect?ct=');
    expect(url).toContain('returnTo=app');

    openURL.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });

  it('reconnect-spotify is offered WHEN already connected and re-launches the same OAuth flow (scope migration)', async () => {
    // A stored token keeps the badge "Connected", but a new scope (playlist-modify-private)
    // only lands on a fresh grant. Without a Reconnect control the user is stranded — the
    // "Connect" button only shows when disconnected. So a Reconnect must always be reachable.
    loadProfile.mockResolvedValue({
      me: { id: 'u1', displayName: 'Dan', email: 'd@x.io', wearableProvider: null },
      integrations: { spotifyConnected: true },
    });
    (profileController.getSpotifyConnectToken as jest.Mock).mockResolvedValue('ct-token');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as any);

    const tree = await render();
    const btn = byLabel(tree, 'reconnect-spotify');
    expect(btn).toBeTruthy();
    await ReactTestRenderer.act(async () => { await btn.props.onPress(); });

    expect(openURL).toHaveBeenCalledTimes(1);
    const url = openURL.mock.calls[0][0];
    expect(url).toContain('/api/integrations/spotify/connect?ct=');
    expect(url).toContain('returnTo=app'); // same deep-link-back flow as first connect

    openURL.mockRestore();
    await ReactTestRenderer.act(async () => { tree.unmount(); });
  });
});
