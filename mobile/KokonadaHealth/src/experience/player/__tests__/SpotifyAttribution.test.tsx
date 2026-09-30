import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';

// Mock the link-back ACTIONS so the component's DEFAULT deps don't pull the native playback graph,
// and so the open-in-app / open-web-page actions are observable. The URI parser is pure and stays
// real: whether a control is drawn is decided by the same gate the actions use.
jest.mock('../spotifyLinkBack', () => ({
  isSpotifyInstalled: jest.fn().mockResolvedValue(false),
  foregroundSpotify: jest.fn().mockResolvedValue(undefined),
  openSpotifyWebPage: jest.fn().mockResolvedValue(undefined),
}));

import { SpotifyAttribution } from '../SpotifyAttribution';
import * as linkBack from '../spotifyLinkBack';

const installedMock = linkBack.isSpotifyInstalled as jest.Mock;
const foregroundMock = linkBack.foregroundSpotify as jest.Mock;
const webPageMock = linkBack.openSpotifyWebPage as jest.Mock;

const TRACK_URI = 'spotify:track:11dFghVXANMlKmJXsNCbNl';

function texts(node: any, acc: string[] = []): string[] {
  if (node == null) return acc;
  if (typeof node === 'string') { acc.push(node); return acc; }
  if (Array.isArray(node)) { node.forEach((n) => texts(n, acc)); return acc; }
  if (node.children) texts(node.children, acc);
  return acc;
}
const byId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id)[0];
const buttons = (tree: ReactTestRenderer.ReactTestRenderer) =>
  tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'button');

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
  webPageMock.mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('SpotifyAttribution — C1 attribution mark', () => {
  it('renders the official Spotify mark (labeled "Spotify") and the words "content from Spotify"', async () => {
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    const logo = byId(tree, 'spotify-attribution-logo');
    expect(logo).toBeTruthy();
    expect(logo.props.source).toBeTruthy();
    expect(logo.props.accessibilityLabel).toBe('Spotify');
    expect(texts(tree.toJSON()).join(' ')).toContain('content from Spotify');
  });

  // Designer, HX-4 round 1: at font 2.0 on a narrow phone the logo, the attribution words and the
  // link-back cannot share one line — the row must WRAP rather than clip or push the control off screen.
  it('the mark\'s row wraps, so the link-back never overflows at large font sizes or narrow widths', async () => {
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    const row = RN.StyleSheet.flatten(byId(tree, 'spotify-attribution').props.style) as any;
    expect(row.flexDirection).toBe('row');
    expect(row.flexWrap).toBe('wrap');
  });

  it('uses a theme-appropriate Spotify logo (a different asset on dark vs light)', async () => {
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark');
    const dark = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    const darkSrc = byId(dark, 'spotify-attribution-logo').props.source;
    jest.spyOn(RN, 'useColorScheme').mockReturnValue('light');
    const light = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    const lightSrc = byId(light, 'spotify-attribution-logo').props.source;
    expect(darkSrc).toBeTruthy();
    expect(lightSrc).toBeTruthy();
    expect(darkSrc).not.toEqual(lightSrc);
  });
});

// HX-4 M5 (CMP-098): the link-back control exists only when there is an exact item to link to. With
// no linkable contentUri there is no control at all — never a dead button — while the logo and the
// attribution words stay.
describe('SpotifyAttribution — no linkable item, no control', () => {
  it.each([
    ['null', null],
    ['the bare scheme', 'spotify:'],
    ['a user URI', 'spotify:user:someone'],
    ['an id with a query string', `${TRACK_URI}?si=abc`],
  ])('contentUri = %s → no link-back control, yet the mark and "content from Spotify" stay', async (_label, uri) => {
    installedMock.mockResolvedValue(true);
    const tree = await render(<SpotifyAttribution contentUri={uri} />);
    expect(byId(tree, 'spotify-attribution-linkback')).toBeUndefined();
    expect(buttons(tree)).toHaveLength(0);
    const all = texts(tree.toJSON()).join(' ');
    expect(all).not.toContain('OPEN SPOTIFY');
    expect(all).not.toContain('GET SPOTIFY FREE');
    expect(byId(tree, 'spotify-attribution-logo')).toBeTruthy();
    expect(all).toContain('content from Spotify');
  });

  it('the control appears when the item becomes linkable and goes when it stops being linkable', async () => {
    const tree = await render(<SpotifyAttribution contentUri={null} />);
    expect(byId(tree, 'spotify-attribution-linkback')).toBeUndefined();
    await ReactTestRenderer.act(async () => { tree.update(<SpotifyAttribution contentUri={TRACK_URI} />); });
    expect(byId(tree, 'spotify-attribution-linkback')).toBeTruthy();
    await ReactTestRenderer.act(async () => { tree.update(<SpotifyAttribution contentUri={null} />); });
    expect(byId(tree, 'spotify-attribution-linkback')).toBeUndefined();
  });
});

describe('SpotifyAttribution — C2 link-back label reflects install state', () => {
  it('labels the link-back "OPEN SPOTIFY" when Spotify is installed', async () => {
    installedMock.mockResolvedValue(true);
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    expect(texts(tree.toJSON()).join(' ')).toContain('OPEN SPOTIFY');
    expect(texts(tree.toJSON()).join(' ')).not.toContain('GET SPOTIFY FREE');
  });

  it('labels the link-back "GET SPOTIFY FREE" when Spotify is not installed', async () => {
    installedMock.mockResolvedValue(false);
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    expect(texts(tree.toJSON()).join(' ')).toContain('GET SPOTIFY FREE');
  });

  it('the link-back is a button', async () => {
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    expect(byId(tree, 'spotify-attribution-linkback').props.accessibilityRole).toBe('button');
  });
});

describe('SpotifyAttribution — C2 link-back action opens the exact item', () => {
  it('installed: pressing opens exactly contentUri in the Spotify app', async () => {
    installedMock.mockResolvedValue(true);
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(foregroundMock.mock.calls).toEqual([[TRACK_URI]]);
    expect(webPageMock).not.toHaveBeenCalled();
  });

  it('not installed: pressing opens the same item\'s web page (contentUri), never a store or download page', async () => {
    installedMock.mockResolvedValue(false);
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(webPageMock.mock.calls).toEqual([[TRACK_URI]]);
    expect(foregroundMock).not.toHaveBeenCalled();
  });

  it('after the item changes, a press links the NEW item — never the one drawn before', async () => {
    installedMock.mockResolvedValue(true);
    const next = 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh';
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    await ReactTestRenderer.act(async () => { tree.update(<SpotifyAttribution contentUri={next} />); });
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(foregroundMock.mock.calls).toEqual([[next]]);
  });

  it('never throws into the UI when opening Spotify fails (wrapped)', async () => {
    installedMock.mockResolvedValue(true);
    foregroundMock.mockRejectedValue(new Error('remote dead'));
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} />);
    expect(() => byId(tree, 'spotify-attribution-linkback').props.onPress()).not.toThrow();
    await ReactTestRenderer.act(async () => { await new Promise((r) => setImmediate(r)); });
  });
});

describe('SpotifyAttribution — reusable (injected deps override the default wiring)', () => {
  it('honours injected isSpotifyInstalled + onOpenSpotify, handing it the exact contentUri', async () => {
    const isInstalled = jest.fn().mockResolvedValue(true);
    const onOpen = jest.fn();
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} isSpotifyInstalled={isInstalled} onOpenSpotify={onOpen} />);
    expect(isInstalled).toHaveBeenCalled();
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(onOpen.mock.calls).toEqual([[TRACK_URI]]);
    expect(foregroundMock).not.toHaveBeenCalled();
  });

  it('honours an injected onGetSpotify, handing it the exact contentUri', async () => {
    const onGet = jest.fn();
    const tree = await render(<SpotifyAttribution contentUri={TRACK_URI} isSpotifyInstalled={async () => false} onGetSpotify={onGet} />);
    await ReactTestRenderer.act(async () => { byId(tree, 'spotify-attribution-linkback').props.onPress(); });
    expect(onGet.mock.calls).toEqual([[TRACK_URI]]);
    expect(webPageMock).not.toHaveBeenCalled();
  });
});

// Type-level pin (brief M5): contentUri is REQUIRED, typed string | null, so a caller must decide what
// the mark links to. `tsc` fails on the unused directive if the prop is ever made optional again.
export function _typePin() {
  // @ts-expect-error contentUri is a required prop
  return <SpotifyAttribution />;
}
