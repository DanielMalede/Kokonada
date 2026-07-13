import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';

// Mock the link-back wiring so the component's DEFAULT deps don't pull the native playback graph,
// and so the foreground/store actions are observable.
jest.mock('../spotifyLinkBack', () => ({
  isSpotifyInstalled: jest.fn().mockResolvedValue(false),
  foregroundSpotify: jest.fn().mockResolvedValue(undefined),
  getSpotifyApp: jest.fn().mockResolvedValue(undefined),
}));

import { SpotifyAttribution } from '../SpotifyAttribution';
import * as linkBack from '../spotifyLinkBack';

const installedMock = linkBack.isSpotifyInstalled as jest.Mock;
const foregroundMock = linkBack.foregroundSpotify as jest.Mock;
const getAppMock = linkBack.getSpotifyApp as jest.Mock;

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const byId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id)[0];

async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); }); // flush the installed probe
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  installedMock.mockResolvedValue(false);
  foregroundMock.mockResolvedValue(undefined);
  getAppMock.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('SpotifyAttribution — C1 attribution mark', () => {
  it('renders the official Spotify mark (labeled "Spotify") and the words "content from Spotify"', async () => {
    const tree = await render(<SpotifyAttribution />);
    const logo = byId(tree, 'spotify-attribution-logo');
    expect(logo).toBeTruthy();
    expect(logo.props.source).toBeTruthy();
    expect(logo.props.accessibilityLabel).toBe('Spotify');
    expect(texts(tree.toJSON()).join(' ')).toContain('content from Spotify');
  });

  it('uses a theme-appropriate Spotify logo (a different asset on dark vs light)', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const dark = await render(<SpotifyAttribution />);
    const darkSrc = byId(dark, 'spotify-attribution-logo').props.source;
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const light = await render(<SpotifyAttribution />);
    const lightSrc = byId(light, 'spotify-attribution-logo').props.source;
    expect(darkSrc).toBeTruthy();
    expect(lightSrc).toBeTruthy();
    expect(darkSrc).not.toEqual(lightSrc);
  });
});

describe('SpotifyAttribution — C2 link-back label reflects install state', () => {
  it('labels the link-back "OPEN SPOTIFY" when Spotify is installed', async () => {
    installedMock.mockResolvedValue(true);
    const tree = await render(<SpotifyAttribution />);
    expect(texts(tree.toJSON()).join(' ')).toContain('OPEN SPOTIFY');
    expect(texts(tree.toJSON()).join(' ')).not.toContain('GET SPOTIFY FREE');
  });

  it('labels the link-back "GET SPOTIFY FREE" when Spotify is not installed', async () => {
    installedMock.mockResolvedValue(false);
    const tree = await render(<SpotifyAttribution />);
    expect(texts(tree.toJSON()).join(' ')).toContain('GET SPOTIFY FREE');
  });

  it('the link-back is a button', async () => {
    const tree = await render(<SpotifyAttribution />);
    expect(byId(tree, 'spotify-attribution-linkback').props.accessibilityRole).toBe('button');
  });
});

describe('SpotifyAttribution — C2 link-back action', () => {
  it('installed: pressing foregrounds Spotify via the App Remote wake path', async () => {
    installedMock.mockResolvedValue(true);
    const tree = await render(<SpotifyAttribution />);
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(foregroundMock).toHaveBeenCalledTimes(1);
    expect(getAppMock).not.toHaveBeenCalled();
  });

  it('not installed: pressing opens the store to get Spotify (fallback)', async () => {
    installedMock.mockResolvedValue(false);
    const tree = await render(<SpotifyAttribution />);
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(getAppMock).toHaveBeenCalledTimes(1);
    expect(foregroundMock).not.toHaveBeenCalled();
  });

  it('never throws into the UI when foregrounding Spotify fails (wrapped)', async () => {
    installedMock.mockResolvedValue(true);
    foregroundMock.mockRejectedValue(new Error('remote dead'));
    const tree = await render(<SpotifyAttribution />);
    expect(() => byId(tree, 'spotify-attribution-linkback').props.onPress()).not.toThrow();
    await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  });
});

describe('SpotifyAttribution — reusable (injected deps override the default wiring)', () => {
  it('honours injected isSpotifyInstalled + onOpenSpotify', async () => {
    const isInstalled = jest.fn().mockResolvedValue(true);
    const onOpen = jest.fn();
    const tree = await render(<SpotifyAttribution isSpotifyInstalled={isInstalled} onOpenSpotify={onOpen} />);
    expect(isInstalled).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(foregroundMock).not.toHaveBeenCalled();
  });
});
