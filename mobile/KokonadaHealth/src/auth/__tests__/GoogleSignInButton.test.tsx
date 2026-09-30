/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import * as RN from 'react-native';
import { StyleSheet } from 'react-native';

import {
  GoogleSignInButton,
  GOOGLE_SIGN_IN_ASPECT,
  GOOGLE_SIGN_IN_WIDTH,
  SIGN_IN_BUTTON_HEIGHT,
} from '../GoogleSignInButton';

// HX-6 (CMP-099, MB-036): the Google button IS Google's pre-approved image — never drawn in code.
// It renders at one fixed height (shared with Apple) and the file's own aspect ratio, is named by
// the words drawn on it, never dims or swaps the image while busy, and is never mirrored.

const ASSETS = path.resolve(__dirname, '../../../assets/brand/google');
const LIGHT = require('../../../assets/brand/google/google_signin_pill_light.png');
const DARK = require('../../../assets/brand/google/google_signin_pill_dark.png');

// The words drawn on the image, as recorded in the asset ledger (read from the PNG itself).
const DRAWN_WORDS = /\*\*Words drawn:\*\* "([^"]+)"/.exec(fs.readFileSync(path.join(ASSETS, 'README.md'), 'utf8'))![1];

// jest-preset replaces useColorScheme with a shared jest.fn; force the face and put it back by hand.
const colorSchemeMock = RN.useColorScheme as unknown as jest.Mock;
const PRESET_COLOR_SCHEME = colorSchemeMock.getMockImplementation();
const forceFace = (scheme: 'light' | 'dark') => colorSchemeMock.mockImplementation(() => scheme);

const flat = (node: any): Record<string, any> => (StyleSheet.flatten(node?.props?.style) as any) ?? {};
const byId = (tree: ReactTestRenderer.ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props.testID === id && typeof n.type === 'string')[0];

const trees: ReactTestRenderer.ReactTestRenderer[] = [];
async function render(el: React.ReactElement) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => { tree = ReactTestRenderer.create(el); });
  trees.push(tree);
  return tree;
}
afterEach(async () => {
  for (const t of trees.splice(0)) await ReactTestRenderer.act(async () => { t.unmount(); });
  colorSchemeMock.mockImplementation(PRESET_COLOR_SCHEME);
  jest.restoreAllMocks();
});

describe('GoogleSignInButton — the official asset, per face', () => {
  it.each([
    ['light', LIGHT],
    ['dark', DARK],
  ] as const)('the %s face shows its own pre-approved image', async (face, asset) => {
    forceFace(face);
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    expect(byId(tree, 'google-signin-image').props.source).toBe(asset);
  });

  it('the two faces use different files', () => {
    expect(LIGHT).not.toBe(DARK);
  });

  it('draws nothing in code: no text node, no G glyph — the words and the G come from the image only', async () => {
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    expect(tree.root.findAll((n) => (n.type as unknown) === 'Text')).toHaveLength(0);
  });
});

describe('GoogleSignInButton — size: one fixed height, the file\'s own aspect ratio', () => {
  it('the aspect ratio is the PNG\'s own (read from the @1x file header)', () => {
    const b = fs.readFileSync(path.join(ASSETS, 'google_signin_pill_light.png'));
    expect(GOOGLE_SIGN_IN_ASPECT).toBe(b.readUInt32BE(16) / b.readUInt32BE(20));
  });

  it('renders the image at SIGN_IN_BUTTON_HEIGHT × (height × aspect), never stretched', async () => {
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    const s = flat(byId(tree, 'google-signin-image'));
    expect(s.height).toBe(SIGN_IN_BUTTON_HEIGHT);
    expect(s.width).toBe(GOOGLE_SIGN_IN_WIDTH);
    expect(s.width / s.height).toBe(GOOGLE_SIGN_IN_ASPECT);
  });

  it.each([1.0, 2.0])('the image size is identical at font scale %s (the height ignores font scale)', async (fontScale) => {
    const dims = RN.Dimensions.get('window');
    jest.spyOn(RN, 'useWindowDimensions').mockReturnValue({ ...dims, fontScale });
    jest.spyOn(RN.PixelRatio, 'getFontScale').mockReturnValue(fontScale);
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    const s = flat(byId(tree, 'google-signin-image'));
    expect({ w: s.width, h: s.height }).toEqual({ w: GOOGLE_SIGN_IN_WIDTH, h: SIGN_IN_BUTTON_HEIGHT });
  });

  it('the pressable area is at least 48 dp tall without padding the image itself', async () => {
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    expect(flat(byId(tree, 'google-signin-button')).minHeight).toBeGreaterThanOrEqual(48);
    const img = flat(byId(tree, 'google-signin-image'));
    expect(Object.keys(img).filter((k) => /^(padding|margin)/.test(k))).toEqual([]);
  });
});

describe('GoogleSignInButton — busy never alters the image', () => {
  const opacities = (tree: ReactTestRenderer.ReactTestRenderer) =>
    tree.root.findAll((n) => typeof n.type === 'string')
      .map((n) => flat(n).opacity)
      .filter((o) => o !== undefined && o !== 1);

  it('while busy: the same image, no opacity anywhere, and a spinner OUTSIDE the image', async () => {
    const tree = await render(<GoogleSignInButton busy onPress={() => {}} />);
    const img = byId(tree, 'google-signin-image');
    expect(img).toBeTruthy();
    expect(img.props.source).toBe(LIGHT); // jest-preset renders the light face by default
    expect(opacities(tree)).toEqual([]);
    const spinner = byId(tree, 'google-signin-busy');
    expect(spinner).toBeTruthy();
    expect(img.findAll((n) => n.props.testID === 'google-signin-busy')).toHaveLength(0);
  });

  it('busy and idle render the image identically (source and style)', async () => {
    const idle = byId(await render(<GoogleSignInButton busy={false} onPress={() => {}} />), 'google-signin-image');
    const busy = byId(await render(<GoogleSignInButton busy onPress={() => {}} />), 'google-signin-image');
    expect(busy.props.source).toBe(idle.props.source);
    expect(flat(busy)).toEqual(flat(idle));
  });

  it('while idle there is no spinner', async () => {
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    expect(byId(tree, 'google-signin-busy')).toBeUndefined();
  });

  it('busy disables the button and says so to assistive tech', async () => {
    const tree = await render(<GoogleSignInButton busy onPress={() => {}} />);
    const btn = byId(tree, 'google-signin-button');
    expect(btn.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true, busy: true }));
  });
});

describe('GoogleSignInButton — never mirrored', () => {
  it('under an RTL layout the image carries no flip transform, nor does anything around it', async () => {
    const was = RN.I18nManager.isRTL;
    (RN.I18nManager as any).isRTL = true;
    try {
      const tree = await render(<GoogleSignInButton busy onPress={() => {}} />);
      const transforms = tree.root.findAll((n) => typeof n.type === 'string').map((n) => flat(n).transform).filter(Boolean);
      expect(transforms).toEqual([]);
    } finally {
      (RN.I18nManager as any).isRTL = was;
    }
  });
});

describe('GoogleSignInButton — named by the words drawn on it', () => {
  it('the drawn words were read from the image: "Sign in with Google"', () => {
    expect(DRAWN_WORDS).toBe('Sign in with Google');
  });

  it('the accessible name equals the README\'s drawn words, on a button', async () => {
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    const btn = byId(tree, 'google-signin-button');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityLabel).toBe(DRAWN_WORDS);
  });

  it('the image is hidden from assistive tech, so the name is read once', async () => {
    const tree = await render(<GoogleSignInButton busy={false} onPress={() => {}} />);
    const img = byId(tree, 'google-signin-image');
    expect(img.props.accessible).toBe(false);
    expect(img.props.importantForAccessibility).toBe('no');
  });

  it('a press calls onPress', async () => {
    const onPress = jest.fn();
    const tree = await render(<GoogleSignInButton busy={false} onPress={onPress} />);
    const pressable = tree.root.findAll((n) => n.props.testID === 'google-signin-button' && typeof n.props.onPress === 'function')[0];
    await ReactTestRenderer.act(async () => { pressable.props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
