import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../profileServices', () => ({
  profileController: {
    loadProfile: jest.fn(),
    logout: jest.fn().mockResolvedValue(undefined),
    deleteAccount: jest.fn().mockResolvedValue({ ok: true, data: {} }),
    disconnectYouTube: jest.fn().mockResolvedValue({ ok: true, data: { rebuilt: true, provider: 'spotify', library: 240 } }),
  },
}));

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
});
